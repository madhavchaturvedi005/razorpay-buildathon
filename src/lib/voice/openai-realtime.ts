export type RealtimeEvent = Record<string, unknown>;

export type RealtimeHandle = {
  send: (event: RealtimeEvent) => boolean;
  close: () => void;
};

function waitForIce(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(), ms);
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function errorFromSdpBody(text: string, fallback: string): Error {
  try {
    const parsed = JSON.parse(text) as { error?: string | { message?: string }; detail?: string };
    const msg = parsed.detail
      || (typeof parsed.error === "string" ? parsed.error : parsed.error?.message);
    if (msg) return new Error(msg);
  } catch { /* not json */ }
  return new Error(text.slice(0, 280) || fallback);
}

export async function connectRealtimeCall(params: {
  url: string;
  onEvent: (event: RealtimeEvent) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onCreated?: (handle: RealtimeHandle) => void;
}): Promise<RealtimeHandle> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

  pc.ontrack = e => {
    const remote = e.streams[0];
    if (remote) params.onRemoteStream(remote);
  };

  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", ev => {
    try {
      params.onEvent(JSON.parse(String(ev.data)) as RealtimeEvent);
    } catch { /* ignore non-json */ }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc, 1800);

  const sdp = pc.localDescription?.sdp || offer.sdp;
  if (!sdp) {
    mic.getTracks().forEach(t => t.stop());
    pc.close();
    throw new Error("Browser could not create a WebRTC offer");
  }

  const res = await fetch(params.url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: sdp,
  });
  const body = await res.text();
  if (!res.ok || !body.includes("v=0")) {
    mic.getTracks().forEach(t => t.stop());
    pc.close();
    throw errorFromSdpBody(body, "OpenAI Realtime SDP exchange failed");
  }

  await pc.setRemoteDescription({ type: "answer", sdp: body });

  const handle: RealtimeHandle = {
    send(event) {
      if (dc.readyState !== "open") return false;
      dc.send(JSON.stringify(event));
      return true;
    },
    close() {
      try { dc.close(); } catch { /* already closed */ }
      try { pc.close(); } catch { /* already closed */ }
      mic.getTracks().forEach(t => t.stop());
    },
  };
  params.onCreated?.(handle);

  await new Promise<void>((resolve, reject) => {
    if (dc.readyState === "open") {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => reject(new Error("Realtime data channel timed out")), 12000);
    dc.addEventListener("open", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    dc.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("Realtime data channel error"));
    }, { once: true });
  });

  return handle;
}

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

export type GeminiLiveHandle = {
  sendText: (text: string) => boolean;
  sendToolResponse: (id: string, name: string, response: Record<string, unknown>) => boolean;
  close: () => void;
};

export type GeminiLiveEvent =
  | { type: "setup" }
  | { type: "audio" }
  | { type: "agent_text"; text: string }
  | { type: "user_text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "error"; message: string };

let unlockedCtx: AudioContext | null = null;
let ttsEl: HTMLAudioElement | null = null;

/** Must run in the same tick as a user click or the browser will mute playback. */
export function unlockPlayback() {
  if (typeof window === "undefined") return;
  if (!unlockedCtx) unlockedCtx = new AudioContext();
  if (unlockedCtx.state === "suspended") void unlockedCtx.resume();
  const buf = unlockedCtx.createBuffer(1, 1, unlockedCtx.sampleRate || 44100);
  const src = unlockedCtx.createBufferSource();
  const mute = unlockedCtx.createGain();
  mute.gain.value = 0;
  src.buffer = buf;
  src.connect(mute);
  mute.connect(unlockedCtx.destination);
  try { src.start(0); } catch { /* already started */ }
  ttsEl?.pause();
}

export function playbackAudioElement(): HTMLAudioElement {
  if (!ttsEl) ttsEl = new Audio();
  return ttsEl;
}

function floatToPcm16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcmFromBase64(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  const even = bytes.byteLength - (bytes.byteLength % 2);
  const copy = new ArrayBuffer(even);
  new Uint8Array(copy).set(bytes.subarray(0, even));
  return new Int16Array(copy);
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
  return out;
}

class PcmPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private next = 0;
  private ownsCtx: boolean;

  constructor() {
    this.ownsCtx = !unlockedCtx;
    this.ctx = unlockedCtx ?? new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 1;
    this.gain.connect(this.ctx.destination);
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(pcm: Int16Array) {
    if (!pcm.length) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const data = pcm16ToFloat(pcm);
    let buf: AudioBuffer;
    try {
      buf = this.ctx.createBuffer(1, data.length, OUTPUT_RATE);
    } catch {
      buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    }
    buf.getChannelData(0).set(data);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now;
    src.start(this.next);
    this.next += buf.duration;
  }

  interrupt() {
    this.next = this.ctx.currentTime;
  }

  close() {
    this.next = 0;
    try { this.gain.disconnect(); } catch { /* already closed */ }
    if (this.ownsCtx) void this.ctx.close();
  }
}

function startMic(onPcm: (pcm: Int16Array) => void): { stop: () => void } {
  let stopped = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let proc: ScriptProcessorNode | null = null;

  void (async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (stopped) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    ctx = unlockedCtx ?? new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = e => {
      const input = e.inputBuffer.getChannelData(0);
      const resampled = downsample(input, ctx!.sampleRate, INPUT_RATE);
      onPcm(floatToPcm16(resampled));
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
  })();

  return {
    stop() {
      stopped = true;
      proc?.disconnect();
      stream?.getTracks().forEach(t => t.stop());
    },
  };
}

function parseWsJson(raw: unknown): Record<string, unknown> | null {
  try {
    let text: string | null = null;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else if (typeof Uint8Array !== "undefined" && raw instanceof Uint8Array) {
      text = new TextDecoder().decode(raw);
    }
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function inlineAudio(part: { inlineData?: { data?: string }; inline_data?: { data?: string } }): string | null {
  return part.inlineData?.data || part.inline_data?.data || null;
}

export async function connectGeminiLive(params: {
  tokenUrl: string;
  session: { scenario: string; amount_paise: number; customer_name: string };
  onEvent: (event: GeminiLiveEvent) => void;
}): Promise<GeminiLiveHandle> {
  unlockPlayback();

  const minted = await fetch(params.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.session),
  }).then(r => r.json()) as {
    token?: string;
    ws_url?: string;
    setup?: Record<string, unknown>;
    attempts?: { ws_url: string; setup: Record<string, unknown>; via?: string }[];
    error?: string;
    detail?: string;
  };
  if (!minted.ws_url && !minted.attempts?.length) {
    throw new Error(minted.detail || minted.error || "Gemini Live token missing — add GEMINI_API_KEY to .env.local");
  }

  const attempts = minted.attempts?.length
    ? minted.attempts
    : minted.ws_url && minted.setup
      ? [{ ws_url: minted.ws_url, setup: minted.setup }]
      : [];

  let lastError: Error = new Error("Gemini Live socket closed before setup");
  for (const attempt of attempts) {
    try {
      return await openLiveSocket({
        wsUrl: attempt.ws_url,
        setup: attempt.setup,
        onEvent: params.onEvent,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

async function openLiveSocket(params: {
  wsUrl: string;
  setup: Record<string, unknown>;
  onEvent: (event: GeminiLiveEvent) => void;
}): Promise<GeminiLiveHandle> {
  const player = new PcmPlayer();
  await player.resume();

  const ws = new WebSocket(params.wsUrl);
  ws.binaryType = "arraybuffer";

  const send = (event: Record<string, unknown>) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(event));
    return true;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const timer = window.setTimeout(() => finish(new Error("Gemini Live setup timed out")), 5000);

      ws.onmessage = ev => {
        const msg = parseWsJson(ev.data);
        if (!msg) return;

        if (msg.setupComplete) {
          params.onEvent({ type: "setup" });
          send({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: "Customer ne phone uthaya. Hindi mein greet karo, abhi." }] }],
              turnComplete: true,
            },
          });
          finish();
          return;
        }

        const sc = msg.serverContent as {
          interrupted?: boolean;
          turnComplete?: boolean;
          modelTurn?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string }; text?: string }[] };
          outputTranscription?: { text?: string };
          inputTranscription?: { text?: string };
        } | undefined;

        if (sc?.interrupted) {
          player.interrupt();
          params.onEvent({ type: "interrupted" });
        }

        if (sc?.outputTranscription?.text) {
          params.onEvent({ type: "agent_text", text: sc.outputTranscription.text });
        }
        if (sc?.inputTranscription?.text) {
          params.onEvent({ type: "user_text", text: sc.inputTranscription.text });
        }

        for (const part of sc?.modelTurn?.parts ?? []) {
          const data = inlineAudio(part);
          if (data) {
            player.enqueue(pcmFromBase64(data));
            params.onEvent({ type: "audio" });
          }
        }

        const toolCall = msg.toolCall as { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] } | undefined;
        for (const fn of toolCall?.functionCalls ?? []) {
          let args: Record<string, unknown> = {};
          try {
            args = (typeof fn.args === "string" ? JSON.parse(fn.args) : (fn.args ?? {})) as Record<string, unknown>;
          } catch { args = {}; }
          params.onEvent({
            type: "tool_call",
            id: String(fn.id ?? fn.name ?? ""),
            name: String(fn.name ?? ""),
            args,
          });
        }

        if (sc?.turnComplete) {
          params.onEvent({ type: "turn_complete" });
        }

        const err = msg.error as { message?: string } | string | undefined;
        const errMsg = typeof err === "string" ? err : err?.message;
        if (errMsg) {
          params.onEvent({ type: "error", message: errMsg });
          finish(new Error(errMsg));
        }
      };

      ws.onopen = () => {
        send({ setup: params.setup });
      };
      ws.onerror = () => finish(new Error("Gemini Live socket failed"));
      ws.onclose = ev => {
        if (!settled) {
          const extra = ev.reason ? `: ${ev.reason}` : ev.code ? ` (${ev.code})` : "";
          finish(new Error(`Gemini Live socket closed before setup${extra}`));
        }
      };
    });
  } catch (err) {
    player.close();
    try { ws.close(); } catch { /* ignore */ }
    throw err;
  }

  const mic = startMic(pcm => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    send({
      realtimeInput: {
        audio: {
          data: bytesToBase64(bytes),
          mimeType: `audio/pcm;rate=${INPUT_RATE}`,
        },
      },
    });
  });

  return {
    sendText(text) {
      return send({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      });
    },
    sendToolResponse(id, name, response) {
      return send({
        toolResponse: {
          functionResponses: [{ id, name, response }],
        },
      });
    },
    close() {
      mic.stop();
      player.close();
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}

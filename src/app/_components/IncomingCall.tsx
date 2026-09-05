"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, Send } from "lucide-react";
import type { OfferType, PtpExtract } from "@/lib/types";
import {
  connectGeminiLive,
  playbackAudioElement,
  unlockPlayback,
  type GeminiLiveHandle,
} from "@/lib/voice/gemini-live";

type Chip = { id: string; label: string; utterance: string };
type OfferChip = { offer_id: OfferType; label: string; press_key: number | null };

interface TurnResponse {
  session_id?: string | null;
  agent: string;
  live?: boolean;
  silent_only?: boolean;
  chips?: Chip[];
  offer_chips?: OfferChip[];
  policy?: { max_days: number; allowed: boolean; reason: string; days_until: number | null } | null;
  extract?: PtpExtract | null;
  committed?: { ptp_id: string; promised_date: string | null; intent: string } | null;
  kill_switch?: boolean;
  done?: boolean;
  llm_configured?: boolean;
  event_status?: string | null;
  coupon?: { code: string; percent: number; new_amount: number; valid_hours: number } | null;
}

export type AppliedCoupon = { code: string; percent: number; new_amount: number; valid_hours: number };

type Line = { who: "agent" | "you"; text: string };

function speakBrowser(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.pitch = 1.02;
  // Roman Hinglish is Latin script — hi-IN voices often stay silent on it.
  const latin = /[A-Za-z]/.test(text);
  u.lang = latin ? "en-IN" : "hi-IN";
  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find(v => v.lang.toLowerCase().startsWith(latin ? "en-in" : "hi")) ||
    voices.find(v => /india/i.test(v.name)) ||
    voices.find(v => v.lang.toLowerCase().startsWith("en"));
  if (voice) {
    u.voice = voice;
    if (voice.lang) u.lang = voice.lang;
  }
  window.speechSynthesis.speak(u);
}

export function IncomingCall({
  scenario,
  amountPaise,
  eventId,
  customerName,
  onClose,
  onCouponApplied,
}: {
  scenario: string;
  amountPaise: number;
  eventId: string;
  customerName: string;
  onClose: () => void;
  onCouponApplied?: (coupon: AppliedCoupon) => void;
}) {
  const [phase, setPhase] = useState<"ringing" | "talking" | "ended">("ringing");
  const [maxDays, setMaxDays] = useState<number>(5);
  const [lines, setLines] = useState<Line[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [offers, setOffers] = useState<OfferChip[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [llmOn, setLlmOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const sessionId = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveRef = useRef<GeminiLiveHandle | null>(null);
  const heardLiveAudio = useRef(false);
  const ttsWatch = useRef<number | null>(null);
  const handledCalls = useRef<Set<string>>(new Set());
  const agentDraft = useRef("");
  const userDraft = useRef("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/guardrails")
      .then(r => r.json())
      .then((c: { ptp_max_days?: number }) => {
        if (c.ptp_max_days) setMaxDays(c.ptp_max_days);
      })
      .catch(() => {});
    fetch("/api/realtime/session")
      .then(r => r.json())
      .then((d: { configured?: boolean }) => setLlmOn(Boolean(d.configured)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    return () => {
      teardownMedia();
    };
  }, []);

  function teardownMedia() {
    if (ttsWatch.current) {
      window.clearTimeout(ttsWatch.current);
      ttsWatch.current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    liveRef.current?.close();
    liveRef.current = null;
    heardLiveAudio.current = false;
    agentDraft.current = "";
    userDraft.current = "";
    const remote = remoteAudioRef.current;
    if (remote) {
      remote.pause();
      remote.srcObject = null;
    }
  }

  function sendLiveText(text: string): boolean {
    return liveRef.current?.sendText(text) ?? false;
  }

  function flushDrafts() {
    const agent = agentDraft.current.trim();
    const user = userDraft.current.trim();
    agentDraft.current = "";
    userDraft.current = "";
    if (user) setLines(prev => [...prev, { who: "you", text: user }]);
    if (agent) setLines(prev => [...prev, { who: "agent", text: agent }]);
  }

  async function speak(text: string) {
    if (!text?.trim() || heardLiveAudio.current) return;
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("audio")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = playbackAudioElement();
        audioRef.current = a;
        a.pause();
        if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
        a.volume = 1;
        a.src = url;
        await a.play();
        return;
      }
    } catch { /* browser TTS */ }
    if (!heardLiveAudio.current) speakBrowser(text);
  }

  async function turn(utterance: string, offerId?: OfferType): Promise<TurnResponse> {
    const res = await fetch("/api/voice/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId.current,
        event_id: eventId,
        scenario,
        amount_paise: amountPaise,
        customer_name: customerName,
        utterance,
        offer_id: offerId,
      }),
    });
    return res.json();
  }

  function applyTurn(data: TurnResponse, includeAgentLine: boolean) {
    if (data.session_id) sessionId.current = data.session_id;
    if (data.llm_configured) setLlmOn(true);
    if (data.policy?.max_days) setMaxDays(data.policy.max_days);
    setChips(data.chips ?? []);
    setOffers(data.offer_chips ?? []);
    setDone(Boolean(data.done));
    if (includeAgentLine && data.agent) {
      setLines(prev => [...prev, { who: "agent", text: data.agent }]);
    }
    if (data.committed?.promised_date) {
      setOutcome(`Promise captured for ${data.committed.promised_date} (within ${data.policy?.max_days ?? maxDays}-day policy). Event is now in progress — Recover will not nag until that date.`);
    } else if (data.kill_switch) {
      setOutcome("Dispute kill-switch. Event blocked. All automated contact stopped.");
    } else if (data.coupon) {
      onCouponApplied?.(data.coupon);
      setOutcome(`${data.coupon.percent}% off applied · ${data.coupon.code}. Cart total is now updated — complete checkout.`);
    } else if (data.done) {
      setOutcome(data.agent);
    }
  }

  async function answer(opts: { mic: boolean }) {
    unlockPlayback();
    audioRef.current = playbackAudioElement();
    heardLiveAudio.current = false;
    setPhase("talking");
    setBusy(true);
    setLiveError(null);
    try {
      if (opts.mic) {
        setConnecting(true);
        try {
          await startRealtime();
          setLive(true);
        } catch (err) {
          setLive(false);
          liveRef.current = null;
          setLiveError(err instanceof Error ? `${err.message} — falling back to spoken TTS` : "Live Realtime failed");
        } finally {
          setConnecting(false);
        }
      }

      const data = await turn("");
      const liveOn = Boolean(liveRef.current);
      applyTurn(data, !liveOn);
      if (!liveOn && data.agent) {
        await speak(data.agent);
      }
      if (data.done) {
        window.setTimeout(() => setPhase("ended"), 4200);
      }
    } catch (err) {
      setConnecting(false);
      setLive(false);
      setLiveError(err instanceof Error ? err.message : "Call failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleToolCall(name: string, callId: string, args: { utterance?: string; offer_id?: OfferType }) {
    if (!name) return;
    const id = callId || `${name}:${JSON.stringify(args)}`;
    if (handledCalls.current.has(id)) return;
    handledCalls.current.add(id);

    if (name === "accept_offer" && args.offer_id) {
      const result = await turn(`[offer:${args.offer_id}]`, args.offer_id);
      applyTurn(result, false);
      liveRef.current?.sendToolResponse(id, name, {
        ok: true,
        say_to_customer: result.agent,
        offer_ref: (result as { offer_ref?: string | null }).offer_ref ?? null,
        event_status: result.event_status,
        coupon: result.coupon,
      });
      return;
    }

    if (name === "commit_customer_intent" && args.utterance) {
      const result = await turn(args.utterance);
      applyTurn(result, false);
      liveRef.current?.sendToolResponse(id, name, {
        ok: true,
        policy: result.policy,
        committed: result.committed,
        event_status: result.event_status,
      });
    }
  }

  async function startRealtime(): Promise<void> {
    const handle = await connectGeminiLive({
      tokenUrl: "/api/realtime/session",
      session: {
        scenario,
        amount_paise: amountPaise,
        customer_name: customerName,
      },
      onEvent(ev) {
        if (ev.type === "audio") {
          heardLiveAudio.current = true;
          audioRef.current?.pause();
          if (typeof window !== "undefined") window.speechSynthesis?.cancel();
        }
        if (ev.type === "agent_text") agentDraft.current += ev.text;
        if (ev.type === "user_text") userDraft.current += ev.text;
        if (ev.type === "turn_complete") flushDrafts();
        if (ev.type === "tool_call") {
          void handleToolCall(ev.name, ev.id, ev.args as { utterance?: string; offer_id?: OfferType });
        }
        if (ev.type === "error") setLiveError(ev.message);
      },
    });
    liveRef.current = handle;
  }

  async function say(utterance: string) {
    if (!utterance.trim() || busy || done) return;
    setDraft("");
    setLines(prev => [...prev, { who: "you", text: utterance }]);
    if (liveRef.current) {
      sendLiveText(utterance);
      return;
    }
    setBusy(true);
    try {
      const data = await turn(utterance);
      applyTurn(data, true);
      await speak(data.agent);
    } finally {
      setBusy(false);
    }
  }

  async function tapOffer(o: OfferChip) {
    if (busy || done) return;
    const accept = o.press_key ? `${o.press_key} — ${o.label}` : `Haan, ${o.label}`;
    setLines(prev => [...prev, { who: "you", text: accept }]);
    if (liveRef.current) {
      sendLiveText(`${accept}. accept_offer with offer_id ${o.offer_id}`);
      return;
    }
    setBusy(true);
    try {
      const data = await turn(accept, o.offer_id);
      applyTurn(data, true);
      await speak(data.agent);
      if (data.done) window.setTimeout(() => setPhase("ended"), 5200);
    } finally {
      setBusy(false);
    }
  }

  function pressDigit(n: number) {
    if (busy || done) return;
    if (n === 2 && scenario === "abandoned_cart") {
      setLines(prev => [...prev, { who: "you", text: "2 — No thanks" }]);
      setOutcome("Customer declined the offer. Cart is still waiting.");
      setPhase("ended");
      teardownMedia();
      return;
    }
    const match = offers.find(o => o.press_key === n);
    if (match) {
      void tapOffer(match);
      return;
    }
    if (n === 1) {
      const disc = offers.find(o => o.offer_id === "discount") ?? { offer_id: "discount" as const, label: "10% off · COMEBACK10", press_key: 1 };
      void tapOffer(disc);
    }
  }

  async function recordClip() {
    if (liveRef.current || recording || busy || done) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      setRecording(true);
      rec.start();
      await new Promise(r => window.setTimeout(r, 4500));
      rec.stop();
      await new Promise<void>(r => { rec.onstop = () => r(); });
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "speech.webm");
      const data = await fetch("/api/voice/transcribe", { method: "POST", body: fd }).then(r => r.json()) as { text?: string; error?: string };
      if (data.text) await say(data.text);
    } catch {
      setRecording(false);
    }
  }

  function hangUp() {
    teardownMedia();
    onClose();
  }

  if (phase === "ringing") {
    return (
      <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 sm:items-center">
        <div className="w-full max-w-sm overflow-hidden rounded-[28px] bg-[#111318] text-white shadow-2xl">
          <div className="px-6 pb-6 pt-10 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 ring-4 ring-emerald-500/30 animate-pulse">
              <Phone className="h-8 w-8 text-emerald-400" />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Incoming call
            </div>
            <div className="mt-2 text-xl font-semibold">Lumen Store</div>
            <div className="mt-1 text-sm text-white/55">
              {scenario === "abandoned_cart"
                ? "About the cart you left · coupon waiting"
                : "AI recovery agent · about your payment"}
            </div>
            <div className="mt-4 rounded-full bg-white/8 px-3 py-1.5 text-[11px] text-white/70">
              {scenario === "abandoned_cart" ? "Cart save call" : `Policy window ${maxDays} days`}
              {llmOn ? " · Gemini Live 2.5 voice" : " · add GEMINI_API_KEY for live voice"}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 px-6 pb-8">
            <button
              onClick={hangUp}
              className="flex flex-col items-center gap-2 rounded-2xl bg-white/8 py-4 text-xs font-medium text-white/80 hover:bg-white/12"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500">
                <PhoneOff className="h-5 w-5" />
              </span>
              Decline
            </button>
            <button
              onClick={() => answer({ mic: llmOn })}
              className="flex flex-col items-center gap-2 rounded-2xl bg-white/8 py-4 text-xs font-medium text-white/80 hover:bg-white/12"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500">
                <Phone className="h-5 w-5" />
              </span>
              {llmOn ? "Answer live" : "Answer"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "ended") {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-[28px] bg-[#111318] p-6 text-center text-white shadow-2xl">
          <PhoneOff className="mx-auto h-8 w-8 text-white/40" />
          <div className="mt-3 text-lg font-semibold">Call ended</div>
          {outcome && <p className="mt-2 text-sm text-white/60">{outcome}</p>}
          <p className="mt-2 text-[11px] text-white/35">Merchant Overview, Voice + PTP, Audit, and the event row update from this call.</p>
          <button
            onClick={hangUp}
            className="mt-6 w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black"
          >
            Back to account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="flex h-[min(92vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-[#111318] text-white shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20">
            <Phone className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">AI recovery agent</div>
            <div className="text-[11px] text-white/45">
              Lumen Store · {connecting
                ? "connecting Gemini Live…"
                : live
                  ? "live · Gemini 2.5 native audio"
                  : liveError
                    ? "live failed"
                    : `policy ${maxDays} days`}
            </div>
          </div>
          <button
            onClick={() => { teardownMedia(); setPhase("ended"); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500"
            aria-label="Hang up"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>

        {liveError && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-[11px] text-red-200">
            Live Realtime failed: {liveError}
          </div>
        )}

        <div ref={scroller} className="flex-1 space-y-3 overflow-auto px-4 py-4">
          {lines.map((l, i) => (
            <div key={`${i}-${l.text.slice(0, 12)}`} className={`flex ${l.who === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                l.who === "you" ? "bg-[#2B84EA] text-white" : "bg-white/10 text-white/90"
              }`}>
                {l.text}
              </div>
            </div>
          ))}
          {(busy || connecting) && (
            <div className="text-[11px] text-white/35">
              {connecting ? "Connecting live voice…" : live ? "Listening…" : "Agent listening…"}
            </div>
          )}
        </div>

        {!done && (
          <div className="space-y-2 border-t border-white/8 p-3">
            {(scenario === "abandoned_cart" || offers.some(o => o.press_key)) && (
              <IvrPad onPress={pressDigit} disabled={busy} highlight={1} />
            )}
            {offers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {offers.map(o => (
                  <button
                    key={o.offer_id}
                    disabled={busy}
                    onClick={() => tapOffer(o)}
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                  >
                    {o.press_key ? `Press ${o.press_key} · ` : ""}{o.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {chips.map(c => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => say(c.utterance)}
                  className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/12 disabled:opacity-40"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={e => { e.preventDefault(); say(draft); }}
            >
              {!live && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={recordClip}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    recording ? "bg-red-500" : "bg-white/10"
                  }`}
                  aria-label="Hold to talk"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <div className="relative flex-1">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={live
                    ? "Mic is live — just talk, or type…"
                    : recording
                      ? "Listening…"
                      : scenario === "abandoned_cart"
                        ? "Cart kyun chhoda? Hindi mein bolo…"
                        : "Type or tap a reply…"}
                  className="w-full rounded-full border border-white/12 bg-white/6 py-2.5 px-4 text-sm outline-none placeholder:text-white/30"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}

        {done && (
          <div className="border-t border-white/8 p-4">
            {outcome && <p className="mb-3 text-xs text-white/55">{outcome}</p>}
            <button
              onClick={() => setPhase("ended")}
              className="w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black"
            >
              End call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IvrPad({ onPress, disabled, highlight }: { onPress: (n: number) => void; disabled: boolean; highlight: number }) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
  const hint: Record<number, string> = { 1: "Take 10% off", 2: "No thanks" };
  return (
    <div>
      <div className="mb-2 text-center text-[11px] text-white/40">Press 1 to apply the coupon and resume checkout</div>
      <div className="grid grid-cols-3 gap-1.5 px-6">
        {keys.map(n => (
          <button
            key={n}
            disabled={disabled}
            onClick={() => onPress(n)}
            className={`rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 ${
              n === highlight
                ? "bg-emerald-500 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.35)]"
                : "bg-white/8 text-white/80 hover:bg-white/12"
            } ${n === 0 ? "col-start-2" : ""}`}
          >
            <div>{n}</div>
            {hint[n] && <div className="text-[9px] font-medium opacity-80">{hint[n]}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

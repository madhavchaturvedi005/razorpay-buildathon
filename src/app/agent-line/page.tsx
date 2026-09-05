"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Phone, PhoneCall, Play, Pause, Save, Radio, CreditCard,
  Clock, Hash, Sparkles, ChevronRight,
} from "lucide-react";
import type { AgentLineConfig, CallSession } from "@/lib/types";
import { inr } from "@/lib/ui/format";
import { callDurationSec, turnsToRecordingScript } from "@/lib/engine/agent-line";
import { IncomingCall } from "../_components/IncomingCall";
import { playTtsBlob, stopTtsPlayback } from "@/lib/voice/gemini-live";

interface Target {
  event_id: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  type: string;
  decline_code: string | null;
  scenario: string;
}

interface Payload {
  config: AgentLineConfig;
  live_voice: boolean;
  subscription: {
    status: string;
    plan: string;
    renews_on: string;
    price_paise: number;
    minutes_included: number;
    minutes_used: number;
    minutes_remaining: number;
    calls_included: number;
    calls_used: number;
    calls_remaining: number;
  };
  calls: CallSession[];
  targets: Target[];
}

function scenarioFor(t: Target): string {
  if (t.type === "checkout_abandon") return "abandoned_cart";
  if (t.type === "invoice_overdue") return "overdue_invoice";
  if (t.decline_code === "bank_not_responding") return "gateway_timeout";
  return t.decline_code || "insufficient_funds";
}

export default function AgentLinePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [display, setDisplay] = useState("");
  const [sip, setSip] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<CallSession | null>(null);
  const [targetId, setTargetId] = useState("");
  const [calling, setCalling] = useState<Target | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const json = await fetch("/api/agent-line").then(r => r.json()) as Payload;
    setData(json);
    setName(json.config.caller_name);
    setNumber(json.config.caller_number);
    setDisplay(json.config.caller_display);
    setSip(json.config.sip_enabled);
    setTargetId(cur => cur || json.targets[0]?.event_id || "");
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const target = useMemo(
    () => data?.targets.find(t => t.event_id === targetId) ?? data?.targets[0] ?? null,
    [data, targetId],
  );

  async function save() {
    setSaving(true);
    await fetch("/api/agent-line", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caller_name: name, caller_number: number, caller_display: display, sip_enabled: sip }),
    });
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
    await load();
  }

  async function playRecording(session: CallSession) {
    if (playing === session.session_id) {
      stopTtsPlayback();
      setPlaying(null);
      return;
    }
    setPlaying(session.session_id);
    const text = turnsToRecordingScript(session.turns);
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("audio") || ct.includes("octet-stream")) {
        const blob = await res.blob();
        if (blob.size > 200) {
          await playTtsBlob(blob);
          setPlaying(null);
          return;
        }
      }
    } catch { /* browser TTS */ }
    window.speechSynthesis?.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    u.onend = () => setPlaying(null);
    window.speechSynthesis?.speak(u);
  }

  if (!data) {
    return <div className="py-20 text-center text-sm text-gray-500">Loading agent line…</div>;
  }

  const sub = data.subscription;
  const minPct = Math.round((sub.minutes_used / Math.max(1, sub.minutes_included)) * 100);
  const callPct = Math.round((sub.calls_used / Math.max(1, sub.calls_included)) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Agent Line</h1>
        <p className="mt-1 text-sm text-gray-400">
          Caller ID customers see, voice subscription usage, and every recovery call on this line.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Phone className="h-4 w-4 text-indigo-400" /> Agent number
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name" value={display} onChange={setDisplay} />
            <Field label="Agent name" value={name} onChange={setName} />
            <Field label="Caller number" value={number} onChange={setNumber} mono />
            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-xs text-gray-400">SIP / outbound enabled</span>
              <input type="checkbox" checked={sip} onChange={e => setSip(e.target.checked)} />
            </label>
          </div>
          <button onClick={save} disabled={saving} className="btn-primary mt-4 !py-2 !px-4 text-xs">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : saved ? "Saved" : "Save number"}
          </button>
          <p className="mt-2 text-[11px] text-gray-500">
            This number is shown on the customer incoming-call screen and used as the From line when you place a call here.
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CreditCard className="h-4 w-4 text-emerald-400" /> Subscription
            </div>
            <span className="chip border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">{sub.status}</span>
          </div>
          <div className="text-lg font-semibold text-white">{sub.plan}</div>
          <div className="mt-1 text-xs text-gray-500">{inr(sub.price_paise)} / month · renews {sub.renews_on}</div>
          <Meter label="Voice minutes" used={sub.minutes_used} total={sub.minutes_included} pct={minPct} icon={Clock} />
          <Meter label="Agent calls" used={sub.calls_used} total={sub.calls_included} pct={callPct} icon={Hash} />
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <PhoneCall className="h-4 w-4 text-indigo-400" /> Place an agent call
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Dials from {data.config.caller_number} using the same recovery agent as Customer View
          {data.live_voice ? " · Gemini Live is on." : " · add GEMINI_API_KEY for live voice."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 text-xs text-gray-400">
            Customer
            <select
              value={target?.event_id ?? ""}
              onChange={e => setTargetId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              {(data.targets.length ? data.targets : []).map(t => (
                <option key={t.event_id} value={t.event_id}>
                  {t.customer_name} · {t.event_id} · {inr(t.amount)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!target || !sip}
            onClick={() => target && setCalling(target)}
            className="btn-primary !py-2 !px-4 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" /> Call now
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Radio className="h-4 w-4 text-indigo-400" /> Call log
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">{data.calls.length} sessions on this line · transcripts + recording playback</p>
          </div>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {data.calls.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-500">No calls yet. Place one above or recover from the queue.</div>
          ) : data.calls.map(c => {
            const dur = callDurationSec(c);
            const mm = String(Math.floor(dur / 60)).padStart(2, "0");
            const ss = String(dur % 60).padStart(2, "0");
            return (
              <div key={c.session_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-white/[0.02]">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.05] text-xs font-semibold text-gray-300">
                  {c.customer_name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{c.customer_name}</span>
                    <span className="chip border border-white/10 text-[10px] text-gray-400">{c.scenario}</span>
                    {c.live_llm && <span className="chip border border-indigo-500/20 bg-indigo-500/10 text-[10px] text-indigo-300">live</span>}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {c.event_id ?? "no event"} · {new Date(c.created_at).toLocaleString("en-IN")} · {c.outcome ?? c.status}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-gray-400">{mm}:{ss}</div>
                <button onClick={() => playRecording(c)} className="btn-ghost !py-1.5 !px-3 text-xs">
                  {playing === c.session_id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  Recording
                </button>
                <button onClick={() => setSelected(c)} className="btn-ghost !py-1.5 !px-3 text-xs">
                  Transcript <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <TranscriptDrawer
          session={selected}
          caller={data.config.caller_number}
          onClose={() => setSelected(null)}
          onPlay={() => playRecording(selected)}
          playing={playing === selected.session_id}
        />
      )}

      {calling && (
        <IncomingCall
          mode="outbound"
          scenario={scenarioFor(calling)}
          amountPaise={calling.amount}
          eventId={calling.event_id}
          customerName={calling.customer_name}
          callerNumber={data.config.caller_number}
          callerDisplay={data.config.caller_display}
          onClose={() => { setCalling(null); load(); }}
        />
      )}
    </div>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="text-xs text-gray-400">
      {label}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/50 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function Meter({
  label, used, total, pct, icon: Icon,
}: {
  label: string; used: number; total: number; pct: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-gray-400"><Icon className="h-3.5 w-3.5" />{label}</span>
        <span className="tabular-nums text-gray-300">{used} / {total} · {total - used} left</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function TranscriptDrawer({
  session, caller, onClose, onPlay, playing,
}: {
  session: CallSession;
  caller: string;
  onClose: () => void;
  onPlay: () => void;
  playing: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div className="card recover-modal max-h-[88vh] w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">{session.customer_name}</div>
            <div className="text-xs text-gray-500">From {caller} · {session.scenario} · {session.outcome ?? session.status}</div>
          </div>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-white">Close</button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto px-5 py-4">
          {session.turns.map((t, i) => (
            <div key={i} className={`flex ${t.who === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                t.who === "you" ? "bg-indigo-600 text-white" : "bg-white/10 text-gray-100"
              }`}>
                <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">{t.who === "you" ? "customer" : "agent"}</div>
                {t.text}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.06] px-5 py-3">
          <button onClick={onPlay} className="btn-primary !py-2 !px-4 text-xs">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? "Stop recording" : "Play recording"}
          </button>
        </div>
      </div>
    </div>
  );
}

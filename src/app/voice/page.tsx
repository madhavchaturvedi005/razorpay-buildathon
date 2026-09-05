"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Phone, Sparkles, ShieldAlert, CalendarClock, Ban,
  CheckCircle2, RefreshCw, MessageSquare, Mic,
} from "lucide-react";
import { inr } from "@/lib/ui/format";
import type { PtpExtract, PromiseToPay, CallSession } from "@/lib/types";

interface Canned {
  id: string;
  title: string;
  customer: string;
  amount_paise: number;
  event_id: string;
  language: string;
  transcript: string;
  expected: string;
}

const INTENT_TONE: Record<string, string> = {
  promise_to_pay: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  hardship: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  complaint: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  optout: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  refuse: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  unknown: "border-white/10 bg-white/5 text-gray-300",
};

export default function VoicePage() {
  const [canned, setCanned] = useState<Canned[]>([]);
  const [llm, setLlm] = useState(false);
  const [promises, setPromises] = useState<PromiseToPay[]>([]);
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [active, setActive] = useState<string>("ptp_payday");
  const [transcript, setTranscript] = useState("");
  const [amount, setAmount] = useState(420000);
  const [eventId, setEventId] = useState("demo_001");
  const [customer, setCustomer] = useState("Arjun Sharma");
  const [extract, setExtract] = useState<PtpExtract | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [killed, setKilled] = useState(false);

  const load = useCallback(async () => {
    const data = await fetch("/api/voice/extract").then(r => r.json());
    setCanned(data.canned ?? []);
    setLlm(Boolean(data.llm_configured));
    setPromises(data.promises ?? []);
    setCalls(data.calls ?? []);
    const first = (data.canned ?? [])[0] as Canned | undefined;
    if (first && !transcript) {
      setTranscript(first.transcript);
      setAmount(first.amount_paise);
      setEventId(first.event_id);
      setCustomer(first.customer);
      setActive(first.id);
    }
  }, [transcript]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = window.setInterval(() => { load(); }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  function pick(c: Canned) {
    setActive(c.id);
    setTranscript(c.transcript);
    setAmount(c.amount_paise);
    setEventId(c.event_id);
    setCustomer(c.customer);
    setExtract(null);
    setCommitMsg(null);
    setKilled(false);
  }

  async function runExtract() {
    setBusy(true);
    setCommitMsg(null);
    setKilled(false);
    try {
      const data = await fetch("/api/voice/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, amount_paise: amount, canned_id: active }),
      }).then(r => r.json());
      setExtract(data.extract);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!extract) return;
    setBusy(true);
    try {
      const data = await fetch("/api/voice/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          customer_name: customer,
          transcript,
          extract,
        }),
      }).then(r => r.json());
      setKilled(Boolean(data.kill_switch));
      setCommitMsg(data.message);
      const list = await fetch("/api/voice/commit").then(r => r.json());
      setPromises(list.promises ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <Phone className="h-6 w-6 text-indigo-400" />
            Hinglish voice recovery
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            This page is the merchant lab. Live calls on Customer View write promises and audit rows here.
            PTP window is set in Guardrails (5 / 10 / 15 days) — the model cannot override it.
          </p>
          <a href="/customer" className="mt-3 inline-flex text-xs font-medium text-indigo-300 hover:text-indigo-200">
            Open customer view → incoming call →
          </a>
        </div>
        <span className={`chip ${llm ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>
          <Sparkles className="h-3 w-3" />
          {llm ? "OpenAI live" : "Degraded · add OPENAI_API_KEY for live voice"}
        </span>
      </div>

      {calls.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white">Calls happening now</h2>
          <p className="mt-0.5 text-xs text-gray-500">Same sessions as Customer View. This list refreshes every 4s.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {calls.map(c => (
              <div key={c.session_id} className="rounded-lg border border-white/[0.06] px-3 py-2 text-xs">
                <div className="flex justify-between text-white">
                  <span className="font-medium">{c.customer_name}</span>
                  <span className="text-gray-500">{c.status}{c.live_llm ? " · live" : ""}</span>
                </div>
                <div className="mt-0.5 text-gray-400">{c.outcome ?? c.scenario} · {c.event_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canned.map(c => (
          <button
            key={c.id}
            onClick={() => pick(c)}
            className={`card card-hover p-4 text-left ${active === c.id ? "border-indigo-500/40" : ""}`}
          >
            <div className="text-xs text-gray-500">{c.language} · {c.event_id}</div>
            <div className="mt-1 text-sm font-semibold text-white">{c.title}</div>
            <div className="mt-0.5 text-xs text-gray-400">{c.customer} · {inr(c.amount_paise)}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Mic className="h-4 w-4 text-indigo-400" /> Call transcript
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-bold text-indigo-300">AI</span>
              Recovery agent · {customer}
            </div>
            <p className="text-sm leading-relaxed text-gray-200">{transcript || "Pick a call on the left."}</p>
          </div>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500/50"
            placeholder="Paste or type a Hinglish reply…"
          />
          <button onClick={runExtract} disabled={busy || !transcript} className="btn-primary w-full">
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Extract promise-to-pay
          </button>
        </div>

        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessageSquare className="h-4 w-4 text-indigo-400" /> Structured extract
          </div>
          {!extract ? (
            <div className="flex h-64 items-center justify-center text-sm text-gray-500">
              Run extract. The model cannot move money — it only returns JSON.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip border ${INTENT_TONE[extract.intent] ?? INTENT_TONE.unknown}`}>
                  {extract.intent.replace(/_/g, " ")}
                </span>
                <span className="chip border border-white/10 text-gray-400">
                  {extract.source === "llm_ptp" ? "AI · LLM" : "AI · degraded corpus"}
                </span>
                <span className="chip border border-white/10 text-gray-400">
                  {Math.round(extract.confidence * 100)}% conf
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Promised date" value={extract.promised_date ?? "—"} icon={CalendarClock} />
                <Field label="Amount" value={extract.promised_amount_paise ? inr(extract.promised_amount_paise) : "—"} />
                <Field label="Hardship" value={extract.hardship ? "Yes — pause" : "No"} />
                <Field label="Do not call until" value={extract.do_not_call_until ?? "—"} />
                <Field
                  label="Dispute language"
                  value={extract.dispute_language ? "YES — kill switch" : "No"}
                  danger={extract.dispute_language}
                />
                <Field label="Source" value={extract.source} />
              </dl>
              <p className="text-xs leading-relaxed text-gray-500">{extract.rationale}</p>
              <button
                onClick={commit}
                disabled={busy}
                className={`w-full ${extract.dispute_language ? "btn-ghost border-rose-500/30 text-rose-300" : "btn-primary"}`}
              >
                {extract.dispute_language ? (
                  <><ShieldAlert className="h-4 w-4" /> Commit — fire kill switch</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Commit to ledger</>
                )}
              </button>
            </>
          )}

          {commitMsg && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${
              killed
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}>
              {killed && <Ban className="mb-1 inline h-4 w-4" />} {commitMsg}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Promise-to-pay tracker</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            One check-back on the promised date. Broken promise → human, not more nagging.
          </p>
        </div>
        {promises.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">No promises captured yet.</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {promises.map(p => (
              <div key={p.ptp_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">{p.customer_name}</div>
                  <div className="truncate text-xs text-gray-500">{p.transcript}</div>
                </div>
                <span className={`chip border ${INTENT_TONE[p.intent] ?? INTENT_TONE.unknown}`}>{p.intent.replace(/_/g, " ")}</span>
                <span className="text-xs text-gray-400 tabular-nums">{p.promised_date ?? "—"}</span>
                <span className={`text-xs font-medium ${
                  p.status === "killed" ? "text-rose-400" : p.status === "open" ? "text-emerald-400" : "text-gray-400"
                }`}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, icon: Icon, danger,
}: {
  label: string; value: string; icon?: React.ComponentType<{ className?: string }>; danger?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${danger ? "text-rose-300" : "text-gray-100"}`}>
        {Icon && <Icon className="h-3.5 w-3.5 text-gray-500" />}
        {value}
      </div>
    </div>
  );
}

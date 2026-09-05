"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Sparkles, Phone, Mail, MessageCircle, ShieldAlert, X, Zap,
  Check, Loader2, Volume2, CreditCard,
} from "lucide-react";
import type { RecoveryEvent } from "@/lib/types";
import { inr } from "@/lib/ui/format";
import { buildRecoverBrief, type OutreachChannel } from "@/lib/engine/recover-brief";

type Phase = "brief" | "running" | "outreach" | "done";

export function RecoverModal({
  event,
  onClose,
  onComplete,
}: {
  event: RecoveryEvent;
  onClose: () => void;
  onComplete: () => void;
}) {
  const router = useRouter();
  const brief = useMemo(() => {
    try {
      return buildRecoverBrief(event);
    } catch {
      return buildRecoverBrief({
        ...event,
        customer_name: event.customer_name || "Customer",
        amount: Number(event.amount) || 0,
        dispute_flag: Boolean(event.dispute_flag),
        ground_truth_recoverable: Boolean(event.ground_truth_recoverable),
      });
    }
  }, [event]);
  const [channel, setChannel] = useState<OutreachChannel>(brief.recommendedChannel);
  const [comment, setComment] = useState(brief.defaultComment);
  const [phase, setPhase] = useState<Phase>("brief");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [beat, setBeat] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (phase !== "outreach") return;
    if (channel !== "call") return;
    setBeat(1);
    const id = window.setInterval(() => {
      setBeat(b => {
        if (b >= brief.callBeats.length) {
          window.clearInterval(id);
          return b;
        }
        return b + 1;
      });
    }, 900);
    const done = window.setTimeout(() => setPhase("done"), 900 * (brief.callBeats.length + 2));
    return () => { window.clearInterval(id); window.clearTimeout(done); };
  }, [phase, channel, brief.callBeats.length]);

  useEffect(() => {
    if (phase !== "outreach") return;
    if (channel === "call") return;
    const t = window.setTimeout(() => setPhase("done"), channel === "silent" ? 1200 : 2200);
    return () => window.clearTimeout(t);
  }, [phase, channel]);

  async function proceed() {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.event_id}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, comment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Recover failed");
        setResult(data);
        setPhase("done");
        return;
      }
      setResult(data);
      if (channel === "stop") {
        setPhase("done");
        return;
      }
      setPhase("outreach");
    } catch (err) {
      setError(String(err));
      setPhase("done");
    }
  }

  const guardrail = result?.guardrail_result as { allow?: boolean; reason_code?: string; bound_checked?: string } | undefined;
  const execution = result?.execution as { outcome?: string; needs_payment?: boolean; simulated?: boolean } | undefined;
  const allowed = guardrail?.allow !== false;
  const canPay = Boolean(allowed && execution?.needs_payment && execution?.outcome !== "blocked");

  const tone =
    brief.recoverabilityLabel === "High" ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
      : brief.recoverabilityLabel === "Medium" ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
        : brief.recoverabilityLabel === "Low" ? "text-orange-300 bg-orange-500/10 border-orange-500/20"
          : "text-rose-300 bg-rose-500/10 border-rose-500/20";

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#111318] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-indigo-500/15 via-emerald-500/5 to-transparent" />

        <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-indigo-300">AI recovery brief</div>
              <h2 className="text-base font-semibold text-white">{brief.title}</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {event.customer_name} · {inr(event.amount)} · {event.event_id}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative overflow-y-auto px-5 py-4" style={{ maxHeight: "min(70vh, 560px)" }}>
          {phase === "brief" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl border px-3 py-3 ${tone}`}>
                  <div className="text-[11px] uppercase tracking-wide opacity-70">Can we recover this?</div>
                  <div className="mt-1 text-lg font-semibold">
                    {brief.canRecover ? "Yes — likely" : "No — do not chase"}
                  </div>
                  <div className="text-xs opacity-80">{brief.recoverabilityPct}% calibrated · {brief.recoverabilityLabel}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Recommended play</div>
                  <div className="mt-1 text-lg font-semibold text-white capitalize">{brief.recommendedChannel === "stop" ? "Stop" : brief.recommendedChannel}</div>
                  <div className="text-xs text-gray-500">{brief.offer ?? "Cheapest channel that still lifts recovery"}</div>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-gray-300">{brief.why}</p>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">What should we do?</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {brief.actions.map(action => {
                    const active = channel === action.id;
                    const Icon = action.id === "call" ? Phone
                      : action.id === "email" ? Mail
                        : action.id === "whatsapp" ? MessageCircle
                          : action.id === "silent" ? Zap
                            : ShieldAlert;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => setChannel(action.id)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-indigo-400/50 bg-indigo-500/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${active ? "text-indigo-300" : "text-gray-500"}`} />
                          <span className="text-sm font-medium text-white">{action.label}</span>
                          {action.recommended && (
                            <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              AI pick
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{action.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Operator comment</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {brief.commentChips.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setComment(chip)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        comment === chip
                          ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-200"
                          : "border-white/10 text-gray-400 hover:text-white"
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-400/50"
                />
              </div>
            </div>
          )}

          {phase === "running" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
              <p className="text-sm font-medium text-white">Agent is running the bounded pipeline…</p>
              <p className="text-xs text-gray-500">Diagnose → EV rank → guardrail → execute</p>
            </div>
          )}

          {phase === "outreach" && (
            <OutreachMock
              channel={channel}
              brief={brief}
              event={event}
              beat={beat}
              blocked={guardrail?.allow === false}
            />
          )}

          {phase === "done" && (
            <div className="space-y-4">
              {channel !== "stop" && (
                <OutreachMock
                  channel={channel}
                  brief={brief}
                  event={event}
                  beat={brief.callBeats.length}
                  settled
                  blocked={guardrail?.allow === false}
                />
              )}

              <div className={`rounded-xl border p-4 ${
                !allowed || !brief.canRecover
                  ? "border-rose-500/25 bg-rose-500/10"
                  : "border-emerald-500/25 bg-emerald-500/10"
              }`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {allowed && brief.canRecover ? <Check className="h-4 w-4 text-emerald-300" /> : <ShieldAlert className="h-4 w-4 text-rose-300" />}
                  <span className={allowed && brief.canRecover ? "text-emerald-200" : "text-rose-200"}>
                    {error
                      ? error
                      : !allowed
                        ? `Guardrail blocked · ${guardrail?.reason_code ?? "blocked"}`
                        : execution?.outcome === "recovered"
                          ? "Recovered — no customer action needed"
                          : execution?.outcome === "escalated"
                            ? "Escalated to a human"
                            : channel === "stop"
                              ? "No outreach sent"
                              : "Play dispatched. Waiting on the customer."}
                  </span>
                </div>
                {guardrail?.bound_checked && (
                  <p className="mt-2 font-mono text-[11px] text-gray-400">{guardrail.bound_checked}</p>
                )}
                <p className="mt-2 text-xs text-gray-400">Comment logged: {comment}</p>
              </div>
            </div>
          )}
        </div>

        <footer className="relative flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          {phase === "brief" && (
            <>
              <button onClick={onClose} className="btn-ghost !py-2 !px-3 text-xs">Cancel</button>
              <button onClick={proceed} className="btn-primary !py-2 !px-4 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                {channel === "stop" ? "Log stop" : "Proceed with this play"}
              </button>
            </>
          )}
          {phase === "running" && (
            <button onClick={onClose} className="btn-ghost !py-2 !px-3 text-xs">Cancel</button>
          )}
          {phase === "outreach" && (
            <button onClick={() => setPhase("done")} className="btn-ghost !py-2 !px-3 text-xs">
              Continue
            </button>
          )}
          {phase === "done" && (
            <>
              {canPay && (
                <button
                  onClick={() => { onComplete(); router.push(`/pay/${event.event_id}`); }}
                  className="btn-ghost !py-2 !px-3 text-xs"
                >
                  <CreditCard className="h-3.5 w-3.5" /> Open as customer
                </button>
              )}
              <button
                onClick={() => { onComplete(); onClose(); }}
                className="btn-primary !py-2 !px-4 text-xs"
              >
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}

function OutreachMock({
  channel, brief, event, beat, settled, blocked,
}: {
  channel: OutreachChannel;
  brief: ReturnType<typeof buildRecoverBrief>;
  event: RecoveryEvent;
  beat: number;
  settled?: boolean;
  blocked?: boolean;
}) {
  if (channel === "silent") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
        <Zap className="mx-auto h-6 w-6 text-indigo-300" />
        <p className="mt-2 text-sm font-medium text-white">Silent retry in flight</p>
        <p className="mt-1 text-xs text-gray-500">{event.customer_name} is not contacted. Gateway is being re-tried in the background.</p>
      </div>
    );
  }

  if (channel === "email") {
    return (
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111318]">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-400">
          <Mail className="h-3.5 w-3.5 text-sky-300" /> Gmail · Inbox
        </div>
        <div className="space-y-2 px-4 py-3 text-sm">
          <div className="text-xs text-gray-500">From recover@{`lumen.store`} · to {event.customer_email}</div>
          <div className="font-medium text-white">{brief.emailSubject}</div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{brief.emailBody}</p>
          {settled && (
            <p className={`text-[11px] ${blocked ? "text-amber-300" : "text-emerald-400"}`}>
              {blocked ? "Preview only — live send was blocked by a guardrail" : "Mock delivered to Gmail"}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (channel === "whatsapp") {
    return (
      <div className="overflow-hidden rounded-xl border border-emerald-900/40 bg-[#0b1410]">
        <div className="flex items-center gap-2 bg-[#075E54] px-4 py-2.5 text-sm text-white">
          <MessageCircle className="h-4 w-4" />
          <div>
            <div className="text-xs font-semibold">Lumen Store</div>
            <div className="text-[10px] text-emerald-100/80">WhatsApp Business · {event.customer_phone}</div>
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-[#005c4b] px-3 py-2 text-sm leading-relaxed text-white">
            {brief.whatsapp}
          </div>
          {settled && (
            <p className={`mt-3 text-[11px] ${blocked ? "text-amber-300" : "text-emerald-400"}`}>
              {blocked ? "Preview only — live send was blocked by a guardrail" : "Mock delivered on WhatsApp"}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (channel === "call") {
    const shown = brief.callBeats.slice(0, Math.max(beat, settled ? brief.callBeats.length : 0));
    return (
      <div className="overflow-hidden rounded-xl border border-indigo-500/20 bg-[#0e1018]">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/20">
            <Volume2 className="h-4 w-4 text-indigo-300" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">Live agent call · {event.customer_name}</div>
            <div className="text-[11px] text-gray-500">{event.customer_phone} · Hinglish recovery</div>
          </div>
          {!settled && <span className="ml-auto animate-pulse text-[11px] text-emerald-400">Connected</span>}
        </div>
        <div className="space-y-2 px-4 py-3">
          {shown.map((line, i) => (
            <div key={i} className={`flex ${line.who === "agent" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                line.who === "agent"
                  ? "rounded-tl-sm bg-white/10 text-gray-100"
                  : "rounded-tr-sm bg-indigo-600 text-white"
              }`}>
                <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">{line.who}</div>
                {line.text}
              </div>
            </div>
          ))}
          {brief.offer && settled && (
            <p className="pt-1 text-[11px] text-amber-300">Offer on the table: {brief.offer}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
      No customer message was sent.
    </div>
  );
}

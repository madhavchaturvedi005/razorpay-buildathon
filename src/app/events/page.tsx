"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { RecoveryEvent } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  payment_failure: "Payment Failure",
  checkout_abandon: "Checkout Abandon",
  invoice_overdue: "Invoice Overdue",
  subscription_failure: "Subscription",
};

const TYPE_COLORS: Record<string, string> = {
  payment_failure: "text-red-400 bg-red-950",
  checkout_abandon: "text-orange-400 bg-orange-950",
  invoice_overdue: "text-yellow-400 bg-yellow-950",
  subscription_failure: "text-purple-400 bg-purple-950",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  in_progress: "text-blue-400",
  recovered: "text-emerald-400",
  blocked: "text-red-400",
  escalated: "text-yellow-400",
  failed: "text-gray-500",
};

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    const typeParam = filter !== "all" ? `&type=${filter}` : "";
    const res = await fetch(`/api/events?limit=100${typeParam}`);
    const data = await res.json();
    setEvents(data.events ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const id = window.setInterval(fetchEvents, 4000);
    return () => window.clearInterval(id);
  }, [fetchEvents]);

  async function recover(event_id: string) {
    setRecoveringId(event_id);
    setLastResult(null);
    setLastEventId(null);
    try {
      const res = await fetch(`/api/events/${event_id}/recover`, { method: "POST" });
      const data = await res.json();
      setLastResult(data);
      setLastEventId(event_id);
      // Refresh events
      await fetchEvents();
    } finally {
      setRecoveringId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Event Feed</h1>
          <p className="text-sm text-gray-400 mt-1">
            {events.length} events · click "Recover" to run the full pipeline live
          </p>
        </div>
        <div className="flex gap-2">
          {["all", "payment_failure", "checkout_abandon", "invoice_overdue", "subscription_failure"].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === t
                  ? "bg-gray-700 text-white"
                  : "bg-gray-900 text-gray-400 hover:text-white border border-gray-800"
              }`}
            >
              {t === "all" ? "All" : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Last result panel */}
      {lastResult && (
        <ResultPanel
          result={lastResult}
          eventId={lastEventId}
          onClose={() => { setLastResult(null); setLastEventId(null); }}
          onPay={(id) => router.push(`/pay/${id}`)}
        />
      )}

      {/* Event table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Event ID</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Type</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Customer</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Signal</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400">Dispute</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-400"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  Loading events…
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  No events. Go to Dashboard and click "Seed Events".
                </td>
              </tr>
            ) : (
              events.map(event => (
                <tr
                  key={event.event_id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {event.event_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLORS[event.type]}`}>
                      {TYPE_LABELS[event.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-200">{event.customer_name}</div>
                    <div className="text-xs text-gray-500">{event.customer_email}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {(event.amount / 100).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {event.decline_code
                      ? <span className="font-mono">{event.decline_code}</span>
                      : event.days_overdue > 0
                      ? <span>{event.days_overdue}d overdue</span>
                      : event.abandonment_reason
                      ? <span>{event.abandonment_reason}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${STATUS_COLORS[event.status]}`}>
                      {event.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {event.dispute_flag && (
                      <span className="text-xs text-red-400 font-medium bg-red-950 px-2 py-0.5 rounded">
                        DISPUTE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => recover(event.event_id)}
                      disabled={
                        recoveringId === event.event_id ||
                        event.status === "recovered" ||
                        event.status === "blocked" ||
                        event.status === "escalated"
                      }
                      className="px-3 py-1 text-xs bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-800 text-emerald-300 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {recoveringId === event.event_id ? "Running…" : "Recover"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultPanel({
  result, eventId, onClose, onPay,
}: {
  result: Record<string, unknown>;
  eventId: string | null;
  onClose: () => void;
  onPay: (id: string) => void;
}) {
  const guardrail = result.guardrail_result as Record<string, unknown> | undefined;
  const execution = result.execution as Record<string, unknown> | undefined;
  const allowed = guardrail?.allow;
  const outcome = String((execution as Record<string, unknown>)?.outcome ?? "—");
  const needsPayment = Boolean((execution as Record<string, unknown>)?.needs_payment);
  const canPay = Boolean(allowed) && needsPayment && outcome !== "blocked" && outcome !== "escalated" && Boolean(eventId);

  return (
    <div className={`border rounded-xl p-5 space-y-4 ${
      allowed ? "bg-emerald-950/40 border-emerald-800" : "bg-red-950/40 border-red-800"
    }`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-sm">
            {allowed
              ? canPay
                ? "✓ Agent action taken — recovery link dispatched to customer"
                : "✓ Pipeline complete"
              : "⛔ Guardrail Blocked"}
          </h3>
          {canPay && (
            <p className="text-xs text-gray-400 mt-0.5">
              The agent sent a recovery link to the customer. Use the button below to simulate the customer receiving and paying it.
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs ml-4">✕</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <ResultField label="Diagnosis" value={String(result.diagnosis ?? "—")} />
        <ResultField label="AI used" value={String(result.ai_used ?? "rules")} />
        <ResultField label="Tier" value={String(result.tier_label ?? result.tier ?? "—")} />
        <ResultField label="Intervention" value={String((result.plan as Record<string, unknown>)?.primary ?? "—")} />
        <ResultField
          label="Guardrail"
          value={allowed ? "PASSED" : String(guardrail?.reason_code ?? "BLOCKED")}
          color={allowed ? "green" : "red"}
        />
        <ResultField
          label="Outcome"
          value={outcome}
          color={outcome === "recovered" ? "green" : outcome === "blocked" || outcome === "escalated" ? "red" : "default"}
        />
      </div>

      <div className="text-xs font-mono text-gray-400 bg-gray-900/60 rounded p-3">
        bound_checked: {String(guardrail?.bound_checked ?? "")}
      </div>

      {/* Simulate customer paying */}
      {canPay && (
        <div className="bg-gray-900/60 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📧</span>
            <div>
              <p className="text-xs font-semibold text-gray-200">Recovery link sent to customer</p>
              <p className="text-xs text-gray-500">In production, Razorpay emails/SMSes this link. Here you can open it to simulate the customer&apos;s experience.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => eventId && onPay(eventId)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <span>👤</span> Simulate: Open as Customer →
            </button>
            <span className="text-xs text-gray-600">Preview what the customer sees</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultField({ label, value, color = "default" }: { label: string; value: string; color?: "green" | "red" | "default" }) {
  const colorClass = { green: "text-emerald-400", red: "text-red-400", default: "text-gray-200" }[color];
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-medium font-mono ${colorClass}`}>{value}</div>
    </div>
  );
}

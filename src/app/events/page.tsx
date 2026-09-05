"use client";

import { useEffect, useState, useCallback } from "react";
import type { RecoveryEvent } from "@/lib/types";
import { RecoverModal } from "../_components/RecoverModal";

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
  const [events, setEvents] = useState<RecoveryEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<RecoveryEvent | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Event Feed</h1>
          <p className="mt-1 text-sm text-gray-400">
            {events.length} events · Recover opens an AI brief, then mocks WhatsApp / Gmail / a live call
          </p>
        </div>
        <div className="flex gap-2">
          {["all", "payment_failure", "checkout_abandon", "invoice_overdue", "subscription_failure"].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                filter === t
                  ? "bg-gray-700 text-white"
                  : "border border-gray-800 bg-gray-900 text-gray-400 hover:text-white"
              }`}
            >
              {t === "all" ? "All" : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
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
                  No events. Go to Dashboard and click &quot;Seed Events&quot;.
                </td>
              </tr>
            ) : (
              events.map(event => (
                <tr
                  key={event.event_id}
                  className="border-b border-gray-800/50 transition-colors hover:bg-gray-800/30"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {event.event_id}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[event.type]}`}>
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
                      <span className="rounded bg-red-950 px-2 py-0.5 text-xs font-medium text-red-400">
                        DISPUTE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setActive(event)}
                      disabled={
                        event.status === "recovered" ||
                        event.status === "blocked" ||
                        event.status === "escalated"
                      }
                      className="rounded border border-emerald-800 bg-emerald-900/60 px-3 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Recover
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {active && (
        <RecoverModal
          event={active}
          onClose={() => setActive(null)}
          onComplete={() => { fetchEvents(); }}
        />
      )}
    </div>
  );
}

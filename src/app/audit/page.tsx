"use client";

import { useEffect, useState, useCallback } from "react";
import type { AuditLog } from "@/lib/types";

const OUTCOME_COLORS: Record<string, string> = {
  recovered: "text-emerald-400 bg-emerald-950",
  pending: "text-blue-400 bg-blue-950",
  blocked: "text-red-400 bg-red-950",
  escalated: "text-yellow-400 bg-yellow-950",
  failed: "text-gray-400 bg-gray-800",
};

const CODE_DANGER: string[] = [
  "DISPUTE_KILL_SWITCH", "ATTEMPT_CAP_EXCEEDED", "CONTACT_WINDOW_BLOCKED",
  "DISCOUNT_CAP_EXCEEDED", "HUMAN_HANDOFF_THRESHOLD", "MANDATE_REVOKED_STOP",
  "PTP_DISPUTE_KILL", "PTP_OUTSIDE_POLICY", "OPEN_PTP_HOLD", "ALREADY_PAID", "NEGATIVE_EV_STOP",
];

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    const outcomeParam = filter !== "all" ? `&outcome=${filter}` : "";
    const res = await fetch(`/api/audit?limit=200${outcomeParam}`);
    const data = await res.json();
    setLogs(data.logs ?? []);
    setCounts(data.counts?.by_outcome ?? {});
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 5s for live demo feel
  useEffect(() => {
    const id = setInterval(fetchLogs, 5000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  const totalLogs = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-sm text-gray-400 mt-1">
            {totalLogs} entries · SHA-256 hash-chained · every refusal is as auditable as every send
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const v = await fetch("/api/audit/verify").then(r => r.json());
              alert(v.message);
            }}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
          >
            Verify chain
          </button>
          <button
            onClick={async () => {
              if (!confirm("Edit the newest row outside the writer? Verification should fail.")) return;
              const v = await fetch("/api/audit/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json());
              alert(v.verify?.message ?? "Tampered");
              fetchLogs();
            }}
            className="px-3 py-1.5 text-xs bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded-lg transition-colors"
          >
            Tamper newest row
          </button>
          <button
            onClick={() => { setLoading(true); fetchLogs(); }}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Outcome filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {["all", "recovered", "blocked", "escalated", "pending", "failed"].map(outcome => (
          <button
            key={outcome}
            onClick={() => setFilter(outcome)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              filter === outcome
                ? "bg-gray-700 text-white"
                : "bg-gray-900 text-gray-400 hover:text-white border border-gray-800"
            }`}
          >
            {outcome === "all" ? `All (${totalLogs})` : `${outcome} (${counts[outcome] ?? 0})`}
          </button>
        ))}
      </div>

      {/* Log table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-3 py-3 font-medium text-gray-400 whitespace-nowrap">Timestamp</th>
              <th className="px-3 py-3 font-medium text-gray-400">Event ID</th>
              <th className="px-3 py-3 font-medium text-gray-400">Diagnosis</th>
              <th className="px-3 py-3 font-medium text-gray-400">Reason Code</th>
              <th className="px-3 py-3 font-medium text-gray-400">Plain English</th>
              <th className="px-3 py-3 font-medium text-gray-400">Bound Checked</th>
              <th className="px-3 py-3 font-medium text-gray-400 text-right">Amount (₹)</th>
              <th className="px-3 py-3 font-medium text-gray-400">AI</th>
              <th className="px-3 py-3 font-medium text-gray-400">Hash</th>
              <th className="px-3 py-3 font-medium text-gray-400">Outcome</th>
              <th className="px-3 py-3 font-medium text-gray-400">Razorpay Ref</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-500">
                  No audit logs yet. Recover some events from the Events page.
                </td>
              </tr>
            ) : (
              logs.map(log => {
                const isDanger = CODE_DANGER.includes(log.reason_code);
                return (
                  <tr
                    key={log.log_id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors ${
                      isDanger ? "bg-red-950/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 font-mono text-gray-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString("en-IN")}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-gray-400">
                      {log.event_id}
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {log.diagnosis}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-xs ${isDanger ? "text-red-400" : "text-blue-400"}`}>
                        {log.reason_code}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 max-w-xs">
                      {log.plain_english}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-gray-500 max-w-xs truncate" title={log.bound_checked}>
                      {log.bound_checked}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-right text-gray-300">
                      {(log.amount / 100).toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-gray-500">
                      {log.ai_source ?? "rules"}{log.simulated ? " · sim" : ""}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-gray-600" title={log.hash ?? ""}>
                      {log.hash ? log.hash.slice(0, 10) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${OUTCOME_COLORS[log.outcome] ?? "text-gray-400"}`}>
                        {log.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-blue-400 text-xs">
                      {log.razorpay_ref ? (
                        <span title={log.razorpay_ref}>
                          {log.razorpay_ref.slice(0, 20)}…
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-600">
        RBI §32.1O, §454Z, §32.1D — every log entry is the digital equivalent of mandatory call recording.
        Machine-readable reason code + plain-English pair for compliance review.
      </p>
    </div>
  );
}

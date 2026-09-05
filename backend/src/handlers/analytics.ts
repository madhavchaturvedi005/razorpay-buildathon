import type { Hono } from "hono";
import { db } from "@/lib/db";
import { diagnose } from "@/lib/engine/diagnosis";
import { decide } from "@/lib/engine/decision";
import type { RecoveryEvent } from "@/lib/types";

export function mountAnalytics(app: Hono) {
  app.get("/api/analytics", c => c.json(analytics()));
}

function analytics() {
  const events = db.listEvents({ limit: 2000 });
  if (events.length === 0) return { seeded: false };

  let totalOutstanding = 0;
  let recoveredAmount = 0;
  let atRiskAmount = 0;
  let atRiskAccounts = 0;
  let recoveredCount = 0;
  let blockedCount = 0;
  const byStatus: Record<string, number> = {};

  for (const e of events) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    if (e.status === "recovered") {
      recoveredAmount += e.amount;
      recoveredCount++;
    } else if (e.status === "blocked") {
      blockedCount++;
    } else {
      totalOutstanding += e.amount;
      if (e.status === "pending" || e.status === "in_progress") {
        atRiskAmount += e.amount;
        atRiskAccounts++;
      }
    }
  }

  const attempted = recoveredCount + atRiskAccounts;
  const successRate = attempted > 0 ? (recoveredCount / attempted) * 100 : 0;

  const agingBuckets = [
    { bucket: "0–15 days", min: 0, max: 15, count: 0, amount: 0 },
    { bucket: "16–45 days", min: 16, max: 45, count: 0, amount: 0 },
    { bucket: "46–90 days", min: 46, max: 90, count: 0, amount: 0 },
    { bucket: "90+ days", min: 91, max: 99999, count: 0, amount: 0 },
  ];
  for (const e of events) {
    if (e.days_overdue > 0) {
      const b = agingBuckets.find(b => e.days_overdue >= b.min && e.days_overdue <= b.max);
      if (b) { b.count++; b.amount += e.amount; }
    }
  }

  const reasonMap: Record<string, number> = {};
  for (const e of events) {
    if (e.decline_code) reasonMap[e.decline_code] = (reasonMap[e.decline_code] ?? 0) + 1;
    else if (e.abandonment_reason) reasonMap[e.abandonment_reason] = (reasonMap[e.abandonment_reason] ?? 0) + 1;
  }
  const failureReasons = Object.entries(reasonMap)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const typeMap: Record<string, { count: number; amount: number }> = {};
  for (const e of events) {
    if (!typeMap[e.type]) typeMap[e.type] = { count: 0, amount: 0 };
    typeMap[e.type].count++;
    typeMap[e.type].amount += e.amount;
  }

  const queue = events
    .filter(e => e.status === "pending" || e.status === "in_progress")
    .map(e => {
      const diagnosis = diagnose(e);
      const plan = decide(diagnosis, 0, e.amount);
      const urgency = e.days_overdue > 0 ? 1 + e.days_overdue / 30 : 1;
      return {
        event_id: e.event_id,
        customer_name: e.customer_name,
        customer_email: e.customer_email,
        type: e.type,
        amount: e.amount,
        days_overdue: e.days_overdue,
        decline_code: e.decline_code,
        dispute_flag: e.dispute_flag,
        status: e.status,
        diagnosis,
        recommended_action: plan.primary,
        priority: e.amount * urgency,
      };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);

  const promises = db.listPromises(40);
  const calls = db.listCallSessions(12);

  return {
    seeded: true,
    kpis: {
      total_outstanding: totalOutstanding,
      recovered_amount: recoveredAmount,
      at_risk_amount: atRiskAmount,
      at_risk_accounts: atRiskAccounts,
      recovered_count: recoveredCount,
      blocked_count: blockedCount,
      total_events: events.length,
      success_rate: Math.round(successRate * 10) / 10,
    },
    aging: agingBuckets.map(({ bucket, count, amount }) => ({ bucket, count, amount })),
    failure_reasons: failureReasons,
    by_type: Object.entries(typeMap).map(([type, v]) => ({ type, ...v })),
    by_status: byStatus,
    trend: buildTrend(events),
    queue,
    live: {
      open_promises: promises.filter(p => p.status === "open" && p.intent === "promise_to_pay").length,
      disputes_from_calls: promises.filter(p => p.status === "killed" || p.dispute_language).length,
      calls: calls.map(c => ({
        session_id: c.session_id,
        customer_name: c.customer_name,
        event_id: c.event_id,
        scenario: c.scenario,
        outcome: c.outcome,
        live_llm: c.live_llm,
        status: c.status,
        updated_at: c.updated_at,
        last_line: c.turns[c.turns.length - 1]?.text ?? null,
      })),
      recent_promises: promises.slice(0, 8).map(p => ({
        ptp_id: p.ptp_id,
        customer_name: p.customer_name,
        event_id: p.event_id,
        intent: p.intent,
        promised_date: p.promised_date,
        status: p.status,
        created_at: p.created_at,
      })),
    },
  };
}

function buildTrend(events: RecoveryEvent[]) {
  const days = 14;
  const today = new Date();
  const buckets: { date: string; label: string; recovered: number; at_risk: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({
      date: key,
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      recovered: 0,
      at_risk: 0,
    });
  }
  for (const e of events) {
    const key = e.timestamp.slice(0, 10);
    const b = buckets.find(b => b.date === key);
    if (b) {
      if (e.status === "recovered") b.recovered += e.amount;
      else b.at_risk += e.amount;
    }
  }
  return buckets;
}

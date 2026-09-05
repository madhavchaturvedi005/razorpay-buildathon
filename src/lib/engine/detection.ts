import type { RecoveryEvent } from "../types";

// ─── Detection: is this event actually at-risk and processable? ───────────────
// Returns true if the event should enter the recovery pipeline.

export function isAtRisk(event: RecoveryEvent): boolean {
  // Already processed — skip
  if (event.status !== "pending" && event.status !== "in_progress") return false;

  switch (event.type) {
    case "payment_failure":
      // All payment failures are at-risk by definition
      return true;

    case "checkout_abandon":
      // All abandonment events are at-risk
      return true;

    case "invoice_overdue":
      // Any invoice with days_overdue > 0 is at-risk
      return event.days_overdue > 0;

    case "subscription_failure":
      // All subscription failures are at-risk
      return true;

    default:
      return false;
  }
}

// ─── Detect severity tier for prioritisation ──────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

export function detectSeverity(event: RecoveryEvent): Severity {
  // Disputes are always critical
  if (event.dispute_flag) return "critical";

  // High-value invoices or large amounts
  const amountINR = event.amount / 100;

  if (event.type === "invoice_overdue") {
    if (event.days_overdue > 60) return "critical";
    if (event.days_overdue > 30 || amountINR > 100000) return "high";
    return "medium";
  }

  if (event.type === "payment_failure" || event.type === "subscription_failure") {
    if (event.decline_code === "hard_decline") return "high";
    if (amountINR > 10000) return "high";
    return "medium";
  }

  if (event.type === "checkout_abandon") {
    if (amountINR > 5000) return "high";
    return "low";
  }

  return "medium";
}

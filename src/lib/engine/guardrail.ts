import type {
  RecoveryEvent,
  InterventionType,
  GuardrailConfig,
  GuardrailResult,
} from "../types";
import { db } from "../db";
import { isCustomerFacing as tierCustomerFacing } from "./tier";
import { daysUntilIso, evaluatePtpPolicy } from "./ptp-policy";

// ─── Guardrail: pure gating function ─────────────────────────────────────────
// Runs BEFORE every execution. If it returns allow=false, nothing executes.
// This is the RBI-modelled compliance layer — the whole "bounded agent" story.
//
// Regulatory basis:
//   Contact window: RBI §32.1O (RBC 4th Amendment, Aug 6 2026, eff. Jan 1 2027)
//   Attempt cap:    TRAI TCCCPR + fair-practice spirit (RBI has no numerical cap)
//   Dispute stop:   RBI §454Z — post-complaint contact = harsh practice
//   Human handoff:  RBI §32.1D — graded escalation matrix required

export function check(
  event: RecoveryEvent,
  intervention: InterventionType,
  config: GuardrailConfig,
  attempts: { count: number; silent_retry_count: number },
): GuardrailResult {
  // ── 0. Already paid (HappyGarg: re-read status at execution time) ────────
  if (event.status === "recovered") {
    return {
      allow: false,
      reason_code: "ALREADY_PAID",
      bound_checked: `status=recovered | never contact someone who has settled`,
    };
  }

  // ── 0b. Mandate revoked — further debit is unauthorised ─────────────────
  if (intervention === "mandate_stop" || event.decline_code === "upi_mandate_cancelled") {
    if (intervention === "mandate_stop" || intervention === "silent_retry" || intervention === "payday_retry" || intervention === "multi_acquirer_reroute") {
      return {
        allow: false,
        reason_code: "MANDATE_REVOKED_STOP",
        bound_checked: `decline_code=upi_mandate_cancelled | further debit would be unauthorised`,
      };
    }
  }

  // ── 1. Dispute kill-switch ────────────────────────────────────────────────
  // Highest priority — check first, no exceptions.
  if (event.dispute_flag) {
    return {
      allow: false,
      reason_code: "DISPUTE_KILL_SWITCH",
      bound_checked: `dispute_flag=true | ALL CONTACT STOPPED`,
    };
  }

  // ── 1b. Open promise-to-pay — do not nag until the promised date ────────
  if (customerFacingIntervention(intervention)) {
    const open = db.getOpenPromise(event.event_id);
    if (open?.promised_date && daysUntilIso(open.promised_date) >= 0) {
      return {
        allow: false,
        reason_code: "OPEN_PTP_HOLD",
        bound_checked: `open PTP ${open.promised_date} still in window | one check-back only, no further contact`,
      };
    }
  }

  // ── 2. Dispute stop intervention ────────────────────────────────────────
  if (intervention === "dispute_stop") {
    return {
      allow: false,
      reason_code: "DISPUTE_KILL_SWITCH",
      bound_checked: `intervention=dispute_stop | flagged as dispute, no further action`,
    };
  }

  // ── 3. Human handoff threshold ───────────────────────────────────────────
  // Past the threshold day, agent can only recommend — must return blocked
  // with HUMAN_HANDOFF_THRESHOLD so the human queue UI picks it up.
  if (
    event.type === "invoice_overdue" &&
    event.days_overdue >= config.human_handoff_day &&
    intervention !== "human_handoff"
  ) {
    return {
      allow: false,
      reason_code: "HUMAN_HANDOFF_THRESHOLD",
      bound_checked: `days_overdue=${event.days_overdue} >= threshold=${config.human_handoff_day} | human approval required`,
    };
  }

  // ── 4. Contact window check ──────────────────────────────────────────────
  // Silent retries and multi-acquirer reroutes don't contact the customer
  // so they bypass the window check.
  const customerFacing = customerFacingIntervention(intervention);
  if (customerFacing) {
    const nowInWindow = isWithinContactWindow(
      config.contact_window_start,
      config.contact_window_end,
    );
    if (!nowInWindow) {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      return {
        allow: false,
        reason_code: "CONTACT_WINDOW_BLOCKED",
        bound_checked: `current_time=${timeStr} | allowed=${config.contact_window_start}–${config.contact_window_end}`,
      };
    }
  }

  // ── 5. Attempt cap ────────────────────────────────────────────────────────
  // Hard stop after N total attempts per event, regardless of amount.
  // Silent retries count separately (silent_retry_cap).
  if (intervention === "silent_retry" || intervention === "multi_acquirer_reroute") {
    if (attempts.silent_retry_count >= config.silent_retry_cap) {
      return {
        allow: false,
        reason_code: "ATTEMPT_CAP_EXCEEDED",
        bound_checked: `silent_retry_count=${attempts.silent_retry_count}/${config.silent_retry_cap} | cap reached`,
      };
    }
  } else {
    if (attempts.count >= config.attempt_cap) {
      return {
        allow: false,
        reason_code: "ATTEMPT_CAP_EXCEEDED",
        bound_checked: `attempt=${attempts.count}/${config.attempt_cap} | hard stop`,
      };
    }
  }

  // ── 6. Discount cap ───────────────────────────────────────────────────────
  // Agent cannot offer more than N% discount without human approval.
  // (early_discount_offer is always 3% in decision.ts, but this guards
  //  against any future change that exceeds the policy limit)
  // We pass discount_pct as part of the context via intervention name check.
  // The actual cap check happens in execution.ts when discount_pct is known.
  // Here we just allow the guardrail to be overridden for the demo.

  // ── All checks passed ─────────────────────────────────────────────────────
  const windowStr = customerFacing
    ? `window: within ${config.contact_window_start}–${config.contact_window_end} OK`
    : "window: N/A (non-customer-facing)";
  const attemptsStr = customerFacingIntervention(intervention)
    ? `attempt: ${attempts.count + 1}/${config.attempt_cap}`
    : `silent_retry: ${attempts.silent_retry_count + 1}/${config.silent_retry_cap}`;

  return {
    allow: true,
    reason_code: null,
    bound_checked: `${attemptsStr} | ${windowStr} | dispute_flag=false`,
  };
}

// ─── Check discount cap separately (called from execution.ts) ─────────────────

export function checkDiscountCap(
  discount_pct: number,
  config: GuardrailConfig,
): GuardrailResult {
  if (discount_pct > config.discount_cap_pct) {
    return {
      allow: false,
      reason_code: "DISCOUNT_CAP_EXCEEDED",
      bound_checked: `requested_discount=${discount_pct}% > cap=${config.discount_cap_pct}% | human approval required`,
    };
  }
  return {
    allow: true,
    reason_code: null,
    bound_checked: `discount=${discount_pct}% <= cap=${config.discount_cap_pct}% | OK`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function customerFacingIntervention(intervention: InterventionType): boolean {
  return tierCustomerFacing(intervention);
}

function isWithinContactWindow(startStr: string, endStr: string): boolean {
  const now = new Date();
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

// ─── Demo break-it scenarios ─────────────────────────────────────────────────
// These simulate guardrail violations for the live demo panel.

export type BreakItScenario =
  | "out_of_window"      // simulate current time = 21:00
  | "attempt_cap"        // force 6th attempt
  | "discount_cap"       // try to offer 20% discount
  | "dispute_flag"       // flag the event mid-sequence
  | "ptp_window";        // customer promises outside merchant PTP cap

export function checkBreakIt(
  scenario: BreakItScenario,
  config: GuardrailConfig,
  event?: RecoveryEvent,
): GuardrailResult {
  switch (scenario) {
    case "out_of_window":
      return {
        allow: false,
        reason_code: "CONTACT_WINDOW_BLOCKED",
        bound_checked: `simulated_time=21:00 | allowed=${config.contact_window_start}–${config.contact_window_end} | BLOCKED`,
      };

    case "attempt_cap":
      return {
        allow: false,
        reason_code: "ATTEMPT_CAP_EXCEEDED",
        bound_checked: `attempt=${config.attempt_cap + 1}/${config.attempt_cap} | HARD STOP — no further automated action`,
      };

    case "discount_cap":
      return {
        allow: false,
        reason_code: "DISCOUNT_CAP_EXCEEDED",
        bound_checked: `requested_discount=20% > cap=${config.discount_cap_pct}% | human approval required`,
      };

    case "dispute_flag":
      return {
        allow: false,
        reason_code: "DISPUTE_KILL_SWITCH",
        bound_checked: `dispute_flag=true | ALL AUTOMATED CONTACT STOPPED — RBI §454Z`,
      };

    case "ptp_window": {
      const d = new Date();
      d.setDate(d.getDate() + config.ptp_max_days + 10);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const promised = `${y}-${m}-${day}`;
      const policy = evaluatePtpPolicy(promised, config.ptp_max_days);
      return {
        allow: false,
        reason_code: "PTP_OUTSIDE_POLICY",
        bound_checked: `customer promised ${promised} (${policy.days_until}d) | merchant cap ${policy.max_days}d | NOT CAPTURED`,
      };
    }
  }
}

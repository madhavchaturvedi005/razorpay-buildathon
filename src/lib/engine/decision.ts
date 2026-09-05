import type { DiagnosisTag, EvCandidate, InterventionPlan, InterventionType, ReasonCode } from "../types";
import { rankPlan } from "./ev";

// ─── Decision: playbook first, then EV rank among allowed actions ─────────────
// Compliance stops (mandate / dispute / human) are never EV-overridden.

export function decide(
  diagnosis: DiagnosisTag,
  currentAttempts: number,
  amountPaise = 0,
): InterventionPlan {
  return decideWithEv(diagnosis, currentAttempts, amountPaise).plan;
}

export function decideWithEv(
  diagnosis: DiagnosisTag,
  currentAttempts: number,
  amountPaise: number,
): { plan: InterventionPlan; candidates: EvCandidate[] } {
  const playbook = playbookDecide(diagnosis, currentAttempts);
  if (
    playbook.primary === "mandate_stop" ||
    playbook.primary === "dispute_stop" ||
    playbook.primary === "human_handoff"
  ) {
    return { plan: playbook, candidates: [] };
  }
  if (amountPaise <= 0) return { plan: playbook, candidates: [] };
  return rankPlan(playbook, amountPaise);
}

function playbookDecide(diagnosis: DiagnosisTag, currentAttempts: number): InterventionPlan {
  switch (diagnosis) {
    case "insufficient_funds":
      if (currentAttempts === 0) {
        return { primary: "payday_retry", secondary: "emi_offer" };
      }
      return { primary: "emi_offer", secondary: "partial_payment" };

    case "expired_card":
      return { primary: "upi_fallback_link", secondary: "card_update_link" };

    case "gateway_timeout":
      if (currentAttempts < 3) {
        return { primary: "silent_retry", secondary: "multi_acquirer_reroute" };
      }
      return { primary: "multi_acquirer_reroute", secondary: "upi_fallback_link" };

    case "hard_decline":
      return { primary: "upi_fallback_link", secondary: "card_update_link" };

    case "checkout_price_surprise":
      return { primary: "gentle_reminder", secondary: "emi_offer" };

    case "checkout_forced_signup":
      return { primary: "guest_checkout_link", secondary: "gentle_reminder" };

    case "invoice_day_1_15":
      return { primary: "gentle_reminder", secondary: null };

    case "invoice_day_16_45":
      if (currentAttempts === 0) {
        return { primary: "firm_reminder_payment_link", secondary: "partial_payment" };
      }
      if (currentAttempts === 1) {
        return { primary: "whatsapp_payment_link", secondary: null, discount_pct: 3 };
      }
      return { primary: "promise_to_pay_capture", secondary: null };

    case "invoice_day_46_plus":
      return { primary: "human_handoff", secondary: null };

    case "subscription_card_issue":
      return { primary: "upi_fallback_link", secondary: "card_update_link" };

    case "subscription_upi_cancelled":
      // Recoup: debiting a withdrawn mandate is an unauthorised debit. Stop.
      return { primary: "mandate_stop", secondary: "upi_fallback_link" };

    case "dispute_flagged":
      return { primary: "dispute_stop", secondary: null };

    default:
      return { primary: "gentle_reminder", secondary: null };
  }
}

export const INTERVENTION_REASON_CODE: Record<InterventionType, ReasonCode> = {
  payday_retry:              "SOFT_DECLINE_PAYDAY_RETRY",
  emi_offer:                 "EMI_OPTION_SHOWN",
  partial_payment:           "PARTIAL_PAYMENT_OFFERED",
  upi_fallback_link:         "UPI_FALLBACK_LINK_SENT",
  card_update_link:          "CARD_UPDATE_LINK_SENT",
  guest_checkout_link:       "GUEST_CHECKOUT_LINK_SENT",
  silent_retry:              "SILENT_RETRY_GATEWAY_TIMEOUT",
  multi_acquirer_reroute:    "MULTI_ACQUIRER_REROUTE",
  gentle_reminder:           "GENTLE_REMINDER_SENT",
  firm_reminder_payment_link: "FIRM_REMINDER_PAYMENT_LINK",
  whatsapp_payment_link:     "WHATSAPP_PAYMENT_LINK_SENT",
  early_discount_offer:      "EARLY_DISCOUNT_OFFERED",
  promise_to_pay_capture:    "PROMISE_TO_PAY_CAPTURED",
  human_handoff:             "HUMAN_HANDOFF_QUEUED",
  dispute_stop:              "DISPUTE_KILL_SWITCH",
  pre_expiry_alert:          "PRE_EXPIRY_ALERT_SENT",
  mandate_stop:              "MANDATE_REVOKED_STOP",
};

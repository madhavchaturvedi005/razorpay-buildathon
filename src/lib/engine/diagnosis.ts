import type { RecoveryEvent, DiagnosisTag, DiagnosisResult } from "../types";
import { parseIssuerString } from "./issuer";
import { diagnoseIssuerWithLlm, llmConfigured } from "./llm";

// ─── Diagnosis: map event signals → root-cause tag ────────────────────────────
// Known decline codes: rules. Messy issuer strings: LLM tail (degraded corpus if no key).

export function diagnose(event: RecoveryEvent): DiagnosisTag {
  return diagnoseDetailedSync(event).tag;
}

export function diagnoseDetailedSync(event: RecoveryEvent): DiagnosisResult {
  if (event.dispute_flag) {
    return {
      tag: "dispute_flagged",
      source: "rules",
      rationale: "Dispute flag set — all automated contact halted",
      confidence: 1,
    };
  }

  // Clean coded path — do not spend a model call
  if (event.decline_code) {
    return {
      tag: diagnoseFromCode(event),
      source: "rules",
      rationale: `Mapped decline_code=${event.decline_code}`,
      confidence: 0.99,
    };
  }

  if (event.issuer_raw) {
    const parsed = parseIssuerString(event.issuer_raw);
    return {
      tag: parsed.confidence >= 0.7 ? parsed.tag : "gateway_timeout",
      source: "degraded",
      rationale: parsed.rationale,
      confidence: parsed.confidence,
    };
  }

  switch (event.type) {
    case "checkout_abandon":
      return {
        tag: diagnoseAbandon(event),
        source: "rules",
        rationale: `Abandonment reason=${event.abandonment_reason}`,
        confidence: 0.9,
      };
    case "invoice_overdue":
      return {
        tag: diagnoseInvoice(event),
        source: "rules",
        rationale: `Days overdue=${event.days_overdue}`,
        confidence: 0.99,
      };
    default:
      return {
        tag: "gateway_timeout",
        source: "rules",
        rationale: "No decline code — treat as transient",
        confidence: 0.5,
      };
  }
}

export async function diagnoseDetailed(event: RecoveryEvent): Promise<DiagnosisResult> {
  if (event.dispute_flag || event.decline_code || !event.issuer_raw) {
    return diagnoseDetailedSync(event);
  }
  if (!llmConfigured()) return diagnoseDetailedSync(event);

  const parsed = await diagnoseIssuerWithLlm(event.issuer_raw);
  const tag = parsed.confidence >= 0.7 ? parsed.tag : "gateway_timeout";
  return {
    tag,
    source: parsed.source,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
  };
}

function diagnoseFromCode(event: RecoveryEvent): DiagnosisTag {
  switch (event.type) {
    case "payment_failure":
    case "subscription_failure":
      return diagnosePaymentFailure(event);
    case "checkout_abandon":
      return diagnoseAbandon(event);
    case "invoice_overdue":
      return diagnoseInvoice(event);
    default:
      return "dispute_flagged";
  }
}

function diagnosePaymentFailure(event: RecoveryEvent): DiagnosisTag {
  switch (event.decline_code) {
    case "insufficient_funds":
      return "insufficient_funds";
    case "expired_card":
    case "invalid_card":
      return "expired_card";
    case "gateway_timeout":
    case "bank_not_responding":
      return "gateway_timeout";
    case "hard_decline":
      return "hard_decline";
    case "upi_mandate_cancelled":
      return "subscription_upi_cancelled";
    default:
      return "gateway_timeout";
  }
}

function diagnoseAbandon(event: RecoveryEvent): DiagnosisTag {
  switch (event.abandonment_reason) {
    case "forced_signup":
      return "checkout_forced_signup";
    default:
      return "checkout_price_surprise";
  }
}

function diagnoseInvoice(event: RecoveryEvent): DiagnosisTag {
  const d = event.days_overdue;
  if (d <= 15) return "invoice_day_1_15";
  if (d <= 45) return "invoice_day_16_45";
  return "invoice_day_46_plus";
}

export const DIAGNOSIS_DESCRIPTIONS: Record<DiagnosisTag, string> = {
  insufficient_funds: "Soft decline — insufficient funds at time of charge",
  expired_card: "Hard decline — card expired or invalid; retry will fail",
  gateway_timeout: "Transient failure — gateway or bank network timeout",
  hard_decline: "Hard decline — card blocked, stolen, or account closed",
  checkout_price_surprise: "Checkout abandoned — price or UX friction",
  checkout_forced_signup: "Checkout abandoned — forced account creation",
  invoice_day_1_15: "Invoice overdue — early stage (day 1–15)",
  invoice_day_16_45: "Invoice overdue — mid stage (day 16–45)",
  invoice_day_46_plus: "Invoice overdue — late stage (day 46+), human required",
  subscription_card_issue: "Subscription failure — card issue (expired or insufficient)",
  subscription_upi_cancelled: "Subscription failure — UPI mandate cancelled by customer",
  dispute_flagged: "DISPUTE FLAGGED — all automated contact halted immediately",
};

// ─── Core event types ────────────────────────────────────────────────────────

export type EventType =
  | "payment_failure"
  | "checkout_abandon"
  | "invoice_overdue"
  | "subscription_failure";

export type DeclineCode =
  | "insufficient_funds"
  | "expired_card"
  | "invalid_card"
  | "gateway_timeout"
  | "bank_not_responding"
  | "hard_decline"
  | "upi_mandate_cancelled"
  | null;

export type EventStatus =
  | "pending"       // not yet processed
  | "in_progress"   // recovery pipeline running
  | "recovered"     // successfully recovered
  | "blocked"       // guardrail blocked all actions
  | "escalated"     // handed to human
  | "failed";       // recovery failed

export interface RecoveryEvent {
  event_id: string;
  type: EventType;
  amount: number;           // in paise (INR × 100)
  currency: string;         // "INR"
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  decline_code: DeclineCode;
  days_overdue: number;     // 0 for non-invoice events
  dispute_flag: boolean;
  abandonment_reason: string | null;  // "price_surprise" | "forced_signup" | null
  ground_truth_recoverable: boolean;  // honest label for measurement
  timestamp: string;        // ISO8601
  status: EventStatus;
  razorpay_order_id: string | null;
  razorpay_link_id: string | null;
  razorpay_invoice_id: string | null;
  issuer_raw?: string | null; // messy bank/issuer string — LLM tail input
}

// ─── Diagnosis ───────────────────────────────────────────────────────────────

export type DiagnosisTag =
  | "insufficient_funds"
  | "expired_card"
  | "gateway_timeout"
  | "hard_decline"
  | "checkout_price_surprise"
  | "checkout_forced_signup"
  | "invoice_day_1_15"
  | "invoice_day_16_45"
  | "invoice_day_46_plus"
  | "subscription_card_issue"
  | "subscription_upi_cancelled"
  | "dispute_flagged";

// ─── Intervention ────────────────────────────────────────────────────────────

export type InterventionType =
  | "payday_retry"
  | "emi_offer"
  | "partial_payment"
  | "upi_fallback_link"
  | "card_update_link"
  | "guest_checkout_link"
  | "silent_retry"
  | "multi_acquirer_reroute"
  | "gentle_reminder"
  | "firm_reminder_payment_link"
  | "whatsapp_payment_link"
  | "early_discount_offer"
  | "promise_to_pay_capture"
  | "human_handoff"
  | "dispute_stop"
  | "pre_expiry_alert"
  | "mandate_stop";

export interface InterventionPlan {
  primary: InterventionType;
  secondary: InterventionType | null;
  discount_pct?: number;    // for early_discount_offer
  skipped_negative_ev?: boolean;
}

export type ContactTier = "silent" | "contact" | "voice" | "stop";

export type AiSource = "rules" | "llm_tail" | "llm_ptp" | "degraded";

export interface DiagnosisResult {
  tag: DiagnosisTag;
  source: AiSource;
  rationale: string;
  confidence: number;
}

export interface EvCandidate {
  intervention: InterventionType | "stop";
  p_recover: number;
  amount: number;
  cost_paise: number;
  annoyance_paise: number;
  ev_paise: number;
  selected: boolean;
}

export type PtpIntent =
  | "promise_to_pay"
  | "refuse"
  | "hardship"
  | "complaint"
  | "optout"
  | "unknown";

export interface PtpExtract {
  intent: PtpIntent;
  promised_date: string | null;
  promised_amount_paise: number | null;
  hardship: boolean;
  do_not_call_until: string | null;
  dispute_language: boolean;
  confidence: number;
  rationale: string;
  source: AiSource;
}

export interface PromiseToPay {
  ptp_id: string;
  event_id: string | null;
  customer_name: string;
  transcript: string;
  intent: PtpIntent;
  promised_date: string | null;
  promised_amount_paise: number | null;
  hardship: boolean;
  do_not_call_until: string | null;
  dispute_language: boolean;
  confidence: number;
  source: AiSource;
  status: "open" | "kept" | "broken" | "killed";
  created_at: string;
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export type AuditOutcome = "recovered" | "pending" | "blocked" | "escalated" | "failed";

export type ReasonCode =
  | "SOFT_DECLINE_PAYDAY_RETRY"
  | "EMI_OPTION_SHOWN"
  | "PARTIAL_PAYMENT_OFFERED"
  | "UPI_FALLBACK_LINK_SENT"
  | "CARD_UPDATE_LINK_SENT"
  | "GUEST_CHECKOUT_LINK_SENT"
  | "SILENT_RETRY_GATEWAY_TIMEOUT"
  | "MULTI_ACQUIRER_REROUTE"
  | "GENTLE_REMINDER_SENT"
  | "FIRM_REMINDER_PAYMENT_LINK"
  | "WHATSAPP_PAYMENT_LINK_SENT"
  | "EARLY_DISCOUNT_OFFERED"
  | "PROMISE_TO_PAY_CAPTURED"
  | "HUMAN_HANDOFF_QUEUED"
  | "DISPUTE_KILL_SWITCH"
  | "ATTEMPT_CAP_EXCEEDED"
  | "CONTACT_WINDOW_BLOCKED"
  | "DISCOUNT_CAP_EXCEEDED"
  | "HUMAN_HANDOFF_THRESHOLD"
  | "PRE_EXPIRY_ALERT_SENT"
  | "MANDATE_REVOKED_STOP"
  | "ALREADY_PAID"
  | "NEGATIVE_EV_STOP"
  | "PTP_DISPUTE_KILL"
  | "PTP_OUTSIDE_POLICY"
  | "OPEN_PTP_HOLD"
  | "COPY_POLICY_BLOCKED";

export const REASON_CODE_DESCRIPTIONS: Record<ReasonCode, string> = {
  SOFT_DECLINE_PAYDAY_RETRY: "Retry queued for payday window (1st–7th of month)",
  EMI_OPTION_SHOWN: "EMI / affordability widget shown — customer can split payment",
  PARTIAL_PAYMENT_OFFERED: "50% now / 50% on next payday option presented",
  UPI_FALLBACK_LINK_SENT: "UPI payment link sent — expired card bypassed entirely",
  CARD_UPDATE_LINK_SENT: "Card update portal link dispatched to customer",
  GUEST_CHECKOUT_LINK_SENT: "No-signup guest checkout link sent for abandoned cart",
  SILENT_RETRY_GATEWAY_TIMEOUT: "Silent immediate retry — gateway timeout, no customer contact",
  MULTI_ACQUIRER_REROUTE: "Rerouted to backup acquirer after primary switch failure",
  GENTLE_REMINDER_SENT: "Gentle invoice reminder sent with payment link (day 1–15)",
  FIRM_REMINDER_PAYMENT_LINK: "Firm reminder + payment link sent (day 16–45)",
  WHATSAPP_PAYMENT_LINK_SENT: "WhatsApp payment link sent — higher open rate than SMS",
  EARLY_DISCOUNT_OFFERED: "3% early-settlement discount offered for 48h payment",
  PROMISE_TO_PAY_CAPTURED: "Customer committed to a payment date — single check-back scheduled",
  HUMAN_HANDOFF_QUEUED: "Escalated to human review queue — agent recommends, human approves",
  DISPUTE_KILL_SWITCH: "All actions halted — dispute flag detected, zero further contact",
  ATTEMPT_CAP_EXCEEDED: "Hard stop — 5/5 attempts reached, no further automated action",
  CONTACT_WINDOW_BLOCKED: "Action deferred — outside allowed contact window (08:00–19:00)",
  DISCOUNT_CAP_EXCEEDED: "Requested discount exceeds policy limit — human approval required",
  HUMAN_HANDOFF_THRESHOLD: "Invoice past day-46 threshold — only human can approve next contact",
  PRE_EXPIRY_ALERT_SENT: "Proactive card expiry alert sent 7 days before renewal",
  MANDATE_REVOKED_STOP: "UPI mandate revoked — further debit would be unauthorised. Stop permanently.",
  ALREADY_PAID: "Customer already settled — no further contact",
  NEGATIVE_EV_STOP: "Expected value of contact is negative — skip outreach",
  PTP_DISPUTE_KILL: "Dispute language detected in voice/PTP — all contact halted (RBI §454Z)",
  PTP_OUTSIDE_POLICY: "Promised date is outside the merchant’s allowed payment window — not captured",
  OPEN_PTP_HOLD: "Open promise-to-pay is still inside the merchant window — no further nag until that date",
  COPY_POLICY_BLOCKED: "Model draft contained forbidden amounts, threats, or URLs — not sent",
};

export interface CallTurn {
  who: "agent" | "you";
  text: string;
  at: string;
}

export interface CallSession {
  session_id: string;
  event_id: string | null;
  customer_name: string;
  scenario: string;
  live_llm: boolean;
  status: "live" | "ended";
  outcome: string | null;
  turns: CallTurn[];
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  log_id: string;
  event_id: string;
  diagnosis: DiagnosisTag;
  reason_code: ReasonCode;
  plain_english: string;
  intervention: InterventionType | "none";
  secondary_offered: InterventionType | null;
  bound_checked: string;     // human-readable summary of guardrail state
  outcome: AuditOutcome;
  amount: number;
  razorpay_ref: string | null;  // real Razorpay link/order/invoice ID
  timestamp: string;
  seq?: number;
  prev_hash?: string | null;
  hash?: string | null;
  ai_source?: AiSource;
  simulated?: boolean;
}

// ─── Guardrail config ────────────────────────────────────────────────────────

export interface GuardrailConfig {
  contact_window_start: string;   // "08:00"
  contact_window_end: string;     // "19:00"
  attempt_cap: number;            // 5
  discount_cap_pct: number;       // 5 (max % agent can offer without human)
  human_handoff_day: number;      // 46
  silent_retry_cap: number;       // 3 (gateway timeout retries)
  ptp_max_days: number;           // merchant policy: promise-to-pay must fall within N days
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  contact_window_start: "08:00",
  contact_window_end: "19:00",
  attempt_cap: 5,
  discount_cap_pct: 5,
  human_handoff_day: 46,
  silent_retry_cap: 3,
  ptp_max_days: 5,
};

// ─── Policies & Discounts (merchant-configured recovery offers) ───────────────
// The call agent may ONLY offer what the merchant enabled here. Money actions
// (link/EMI/discount) stay deterministic — the model just narrates them.

export type OfferType =
  | "upi_link"        // send a UPI payment link (bypasses a dead/short card)
  | "emi"             // split into N monthly instalments
  | "partial"         // 50% now / 50% later
  | "card_update"     // update the saved card
  | "guest_checkout"  // resume without forcing a signup
  | "discount"        // apply a discount from the catalog
  | "reminder"        // gentle payment-link reminder
  | "silent_retry";   // no contact — retry quietly (gateway timeout)

export type PolicyTrigger =
  | "insufficient_funds"
  | "expired_card"
  | "hard_decline"
  | "gateway_timeout"
  | "abandoned_cart_price"   // reached payment, left over cost → discount
  | "abandoned_cart_signup"  // bounced at forced signup → guest checkout
  | "overdue_invoice"
  | "subscription_cancelled"; // UPI mandate revoked → stop, do not debit

export interface PolicyOffer {
  type: OfferType;
  enabled: boolean;
  press_key: number | null;   // IVR-style "press 1 and we send the UPI link"
  emi_months: number | null;  // only for type=emi
  label: string;              // merchant-facing chip label
  say: string;                // Hinglish snippet the agent speaks
}

export interface RecoveryPolicy {
  trigger: PolicyTrigger;
  label: string;
  enabled: boolean;
  offers: PolicyOffer[];
  updated_at: string;
}

export type DiscountTrigger = "abandoned_cart" | "overdue_invoice" | "any";

export interface Discount {
  id: string;
  product: string;          // product name, or "*" for any cart
  percent_off: number;
  code: string;
  min_cart_paise: number;   // minimum order value to qualify
  valid_hours: number;      // offer expiry window
  trigger: DiscountTrigger;
  enabled: boolean;
  created_at: string;
}

// ─── Guardrail check result ───────────────────────────────────────────────────

export interface GuardrailResult {
  allow: boolean;
  reason_code: ReasonCode | null;
  bound_checked: string;
}

// ─── Measurement ─────────────────────────────────────────────────────────────

export interface ArmResult {
  id: string;
  label: string;
  recovered_count: number;
  recovered_paise: number;
  attempted: number;
  rate: number;
  contact_cost_paise: number;
  cost_per_100_recovered: number; // rupees of outreach per ₹100 recovered
  actions: number;
  violations: number;
}

export interface MeasurementResult {
  total_events: number;
  attempted: number;
  baseline_recovered: number;
  orchestrated_recovered: number;
  baseline_rate: number;    // recovered / attempted (%)
  orchestrated_rate: number;
  lift: number;             // orchestrated - baseline (pp)
  seed: number;
  simulated: true;
  arms: ArmResult[];
  orchestrated_recovered_paise: number;
  baseline_recovered_paise: number;
}

// ─── Calibration data from real research benchmarks ─────────────────────────
// Sources: Recurflux 2026, RetentionLens 2026, Atradius Barometer India 2026,
//          FireAI DSO Guide 2026, Joy Gospel LinkedIn Research (50 Razorpay dashboards)

export const CALIBRATION = {
  // Seed volumes per event type
  volumes: {
    payment_failure: 200,
    checkout_abandon: 150,
    invoice_overdue: 100,
    subscription_failure: 100,
  },

  // Decline code distribution within payment failures (from SaveMRR 2026, Visa/MC)
  decline_code_weights: {
    expired_card: 0.27,
    insufficient_funds: 0.22,
    bank_not_responding: 0.18,   // maps to "bank decline"
    gateway_timeout: 0.15,
    upi_mandate_cancelled: 0.12,
    hard_decline: 0.06,
  },

  // Abandonment reason distribution (Razorpay 2026 blog)
  abandonment_weights: {
    price_surprise: 0.44,     // 39-48% cite unexpected costs
    forced_signup: 0.19,      // ~19% forced account creation
    checkout_too_long: 0.18,  // too long
    other: 0.19,
  },

  // Invoice aging distribution
  // Healthy AR: 60-70% in 0-30 bucket (from project spec)
  invoice_aging_weights: [
    { min: 1,  max: 15,  weight: 0.35 },   // gentle reminder zone
    { min: 16, max: 45,  weight: 0.30 },   // firm reminder zone
    { min: 46, max: 90,  weight: 0.25 },   // human handoff zone
    { min: 91, max: 180, weight: 0.10 },   // write-off risk
  ],

  // Ground-truth recoverability probabilities (calibrated to benchmarks)
  // These determine the honest recovered/attempted denominator
  recoverability: {
    // Payment failures: 60-70% are soft declines (recoverable)
    insufficient_funds: 0.72,     // soft decline, high recovery with payday retry
    expired_card: 0.68,           // recoverable via UPI fallback
    gateway_timeout: 0.85,        // most transient — highest recovery
    bank_not_responding: 0.55,
    upi_mandate_cancelled: 0.60,
    hard_decline: 0.10,           // stolen/closed — nearly unrecoverable

    // Checkout abandonment
    price_surprise: 0.38,         // ~39% cite this; link + EMI helps
    forced_signup: 0.42,          // guest checkout link is effective
    checkout_too_long: 0.28,
    other_abandon: 0.22,

    // Invoice overdue — from FireAI 2026 data
    invoice_day_1_15: 0.92,
    invoice_day_16_45: 0.75,
    invoice_day_46_90: 0.55,
    invoice_day_91_plus: 0.35,

    // Subscription failures (involuntary churn)
    subscription_card: 0.62,
    subscription_upi: 0.58,
  },

  // Intervention success probabilities (what the engine achieves)
  // Used to simulate outcome vs ground_truth_recoverable
  intervention_success_rates: {
    payday_retry: 0.45,
    emi_offer: 0.35,
    partial_payment: 0.30,
    upi_fallback_link: 0.68,
    card_update_link: 0.42,
    guest_checkout_link: 0.55,
    silent_retry: 0.78,
    multi_acquirer_reroute: 0.60,
    gentle_reminder: 0.55,
    firm_reminder_payment_link: 0.42,
    whatsapp_payment_link: 0.48,
    early_discount_offer: 0.52,
    promise_to_pay_capture: 0.35,
    human_handoff: 0.65,
    mandate_stop: 0,
  },

  // Outreach cost in paise (₹0.01). Silent is free. Voice is expensive.
  intervention_costs_paise: {
    payday_retry: 0,
    silent_retry: 0,
    multi_acquirer_reroute: 0,
    mandate_stop: 0,
    dispute_stop: 0,
    human_handoff: 0,
    upi_fallback_link: 35,
    card_update_link: 35,
    guest_checkout_link: 35,
    gentle_reminder: 20,
    firm_reminder_payment_link: 20,
    whatsapp_payment_link: 35,
    emi_offer: 35,
    partial_payment: 35,
    early_discount_offer: 35,
    promise_to_pay_capture: 450,
    pre_expiry_alert: 20,
  } as Record<string, number>,

  // Annoyance penalty in paise — contact burns customer attention (RBI harsh-practice spirit)
  annoyance_paise: {
    silent: 0,
    contact: 200,
    voice: 800,
    stop: 0,
  },

  // Measurement targets (for demo claim)
  baseline_recovery_rate: 0.22,    // naive single-retry, unmanaged
  orchestrated_recovery_rate: 0.54, // full engine with guardrails
};

// ─── Weighted random picker ───────────────────────────────────────────────────

export function weightedRandom<T>(items: Record<string, number>): T {
  const entries = Object.entries(items);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key as T;
  }
  return entries[entries.length - 1][0] as T;
}

export function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function weightedBool(probability: number): boolean {
  return Math.random() < probability;
}

// ─── Shared formatting + label helpers for the UI layer ──────────────────────

// Amounts are stored in paise (INR × 100)
export function inr(paise: number, opts?: { compact?: boolean; decimals?: boolean }): string {
  const rupees = paise / 100;
  if (opts?.compact && rupees >= 100000) {
    if (rupees >= 10000000) return `₹${(rupees / 10000000).toFixed(2)} Cr`;
    return `₹${(rupees / 100000).toFixed(2)} L`;
  }
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  payment_failure: "Payment Failure",
  checkout_abandon: "Checkout Abandoned",
  invoice_overdue: "Invoice Overdue",
  subscription_failure: "Subscription Failure",
};

export const DECLINE_LABELS: Record<string, string> = {
  insufficient_funds: "Insufficient Funds",
  expired_card: "Expired Card",
  invalid_card: "Invalid Card",
  gateway_timeout: "Gateway Timeout",
  bank_not_responding: "Bank Not Responding",
  hard_decline: "Hard Decline",
  upi_mandate_cancelled: "UPI Mandate Cancelled",
  price_surprise: "Unexpected Costs",
  forced_signup: "Forced Signup",
  checkout_too_long: "Checkout Too Long",
  other: "Other",
};

export const INTERVENTION_LABELS: Record<string, string> = {
  payday_retry: "Payday Retry",
  emi_offer: "EMI Offer",
  partial_payment: "Partial Payment",
  upi_fallback_link: "UPI Fallback Link",
  card_update_link: "Card Update Link",
  guest_checkout_link: "Guest Checkout Link",
  silent_retry: "Silent Retry",
  multi_acquirer_reroute: "Acquirer Reroute",
  gentle_reminder: "Gentle Reminder",
  firm_reminder_payment_link: "Firm Reminder + Link",
  whatsapp_payment_link: "WhatsApp Link",
  early_discount_offer: "Early Discount",
  promise_to_pay_capture: "Promise to Pay",
  human_handoff: "Human Handoff",
  dispute_stop: "Dispute Stop",
  mandate_stop: "Mandate Stop",
};

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending:     { label: "Pending",     tone: "text-slate-300 bg-slate-500/10 border-slate-500/20" },
  in_progress: { label: "In Progress", tone: "text-blue-300 bg-blue-500/10 border-blue-500/20" },
  recovered:   { label: "Recovered",   tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
  blocked:     { label: "Blocked",     tone: "text-rose-300 bg-rose-500/10 border-rose-500/20" },
  escalated:   { label: "Escalated",   tone: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
  failed:      { label: "Failed",      tone: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

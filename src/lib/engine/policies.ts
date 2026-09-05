import type {
  Discount,
  InterventionType,
  OfferType,
  PolicyOffer,
  PolicyTrigger,
  RecoveryPolicy,
} from "../types";

// ─── Offer → intervention/label metadata ─────────────────────────────────────

export const OFFER_INTERVENTION: Record<OfferType, InterventionType> = {
  upi_link: "upi_fallback_link",
  emi: "emi_offer",
  partial: "partial_payment",
  card_update: "card_update_link",
  guest_checkout: "guest_checkout_link",
  discount: "early_discount_offer",
  reminder: "gentle_reminder",
  silent_retry: "silent_retry",
};

export const OFFER_META: Record<OfferType, { title: string; blurb: string }> = {
  upi_link: { title: "UPI payment link", blurb: "Pull from any bank/app — bypasses the failed card" },
  emi: { title: "No-cost EMI", blurb: "Split the amount into monthly instalments" },
  partial: { title: "Partial payment", blurb: "50% now, 50% on the next payday" },
  card_update: { title: "Update saved card", blurb: "Fix an expired / changed card" },
  guest_checkout: { title: "Guest checkout", blurb: "Finish without creating an account" },
  discount: { title: "Discount", blurb: "Apply an offer from the discount catalog" },
  reminder: { title: "Reminder + link", blurb: "Gentle nudge with a payment link" },
  silent_retry: { title: "Silent retry", blurb: "No contact — retry quietly in the background" },
};

// Map a live-call scenario to a policy trigger.
export function scenarioToTrigger(scenario: string): PolicyTrigger {
  switch (scenario) {
    case "insufficient_funds": return "insufficient_funds";
    case "expired_card": return "expired_card";
    case "hard_decline": return "hard_decline";
    case "gateway_timeout": return "gateway_timeout";
    case "overdue_invoice": return "overdue_invoice";
    case "abandoned_cart": return "abandoned_cart_price";
    default: return "insufficient_funds";
  }
}

function offer(
  type: OfferType,
  label: string,
  say: string,
  extra?: Partial<PolicyOffer>,
): PolicyOffer {
  return {
    type,
    enabled: true,
    press_key: null,
    emi_months: null,
    label,
    say,
    ...extra,
  };
}

// ─── Default policies (research-backed recovery playbook per reason) ──────────

export const DEFAULT_POLICIES: RecoveryPolicy[] = [
  {
    trigger: "insufficient_funds",
    label: "Insufficient funds",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("upi_link", "Press 1 → UPI link", "1 dabaiye, main abhi UPI link bhej deti hoon — kisi bhi doosre account ya app se de sakte ho.", { press_key: 1 }),
      offer("emi", "3-month EMI", "3 mahine ka no-cost EMI bhi hai — pura ek saath dene ki zaroorat nahi.", { emi_months: 3 }),
      offer("partial", "50/50 partial", "Ya aadha abhi, aadha next salary pe — partial payment bhi chalega."),
    ],
  },
  {
    trigger: "expired_card",
    label: "Expired card",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("upi_link", "Press 1 → UPI link", "Card expire ho gaya hai. 1 dabaiye toh UPI link bhej deti hoon — turant ho jayega.", { press_key: 1 }),
      offer("card_update", "Update card", "Ya naya card update kar do, main portal ka link bhej deti hoon."),
    ],
  },
  {
    trigger: "hard_decline",
    label: "Hard decline",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("upi_link", "Press 1 → UPI link", "Bank ne card decline kiya. 1 dabaiye, UPI link se try karte hain.", { press_key: 1 }),
      offer("card_update", "Update card", "Ya doosra card add kar sakte ho."),
    ],
  },
  {
    trigger: "gateway_timeout",
    label: "Gateway timeout",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("silent_retry", "Silent retry", "Yeh transient issue tha — hum chup-chaap retry kar rahe hain, aapko kuch karne ki zaroorat nahi."),
    ],
  },
  {
    trigger: "abandoned_cart_price",
    label: "Abandoned cart · price",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("discount", "Offer discount", "Aap payment tak aaye the — aapke liye ek special discount hai. 1 dabaiye toh code laga ke link bhej deti hoon.", { press_key: 1 }),
      offer("emi", "3-month EMI", "Total zyada lag raha ho toh 3-mahine EMI pe bhi le sakte ho.", { emi_months: 3 }),
    ],
  },
  {
    trigger: "abandoned_cart_signup",
    label: "Abandoned cart · signup",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("guest_checkout", "Guest checkout", "Account banane ki zaroorat nahi — guest checkout link bhej deti hoon, seedha pay karo."),
    ],
  },
  {
    trigger: "overdue_invoice",
    label: "Overdue invoice",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      offer("reminder", "Reminder + link", "Invoice due hai — payment link bhej deti hoon, aaram se pay kar dena."),
      offer("discount", "Early settlement", "Abhi settle karo toh early-payment discount mil jayega.", { press_key: 1 }),
      offer("partial", "50/50 partial", "Cash-flow tight ho toh aadha abhi aadha baad mein bhi kar sakte ho."),
    ],
  },
  {
    trigger: "subscription_cancelled",
    label: "Subscription · mandate revoked",
    enabled: true,
    updated_at: new Date().toISOString(),
    offers: [
      // Mandate revoked = debiting again is unauthorised. No push offers; only a fresh mandate if THEY want it.
      offer("upi_link", "New mandate (opt-in only)", "Aapne mandate cancel kiya tha, hum dobara debit nahi karenge. Agar aap chaho toh naya UPI link bhej sakti hoon — bilkul aapki marzi.", { enabled: false }),
    ],
  },
];

export const DEFAULT_DISCOUNTS: Discount[] = [
  {
    id: "disc_headphones",
    product: "Lumen Studio Headphones",
    percent_off: 10,
    code: "COMEBACK10",
    min_cart_paise: 200000,
    valid_hours: 48,
    trigger: "abandoned_cart",
    enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "disc_cart_any",
    product: "*",
    percent_off: 5,
    code: "FINISH5",
    min_cart_paise: 100000,
    valid_hours: 24,
    trigger: "abandoned_cart",
    enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "disc_invoice_early",
    product: "*",
    percent_off: 3,
    code: "EARLY3",
    min_cart_paise: 0,
    valid_hours: 72,
    trigger: "overdue_invoice",
    enabled: true,
    created_at: new Date().toISOString(),
  },
];

// Pick the best applicable discount for a cart/invoice.
export function pickDiscount(
  discounts: Discount[],
  trigger: DiscountLike,
  amountPaise: number,
): Discount | null {
  const eligible = discounts.filter(d =>
    d.enabled &&
    (d.trigger === trigger || d.trigger === "any") &&
    amountPaise >= d.min_cart_paise,
  );
  if (eligible.length === 0) return null;
  // Highest percent wins (already gated by the discount cap at execute time).
  return eligible.sort((a, b) => b.percent_off - a.percent_off)[0];
}

type DiscountLike = "abandoned_cart" | "overdue_invoice" | "any";

// Build the Hinglish snippet the agent uses to present enabled offers.
export function offersSpeech(policy: RecoveryPolicy | null, discount: Discount | null): string {
  if (!policy || !policy.enabled) return "";
  const lines = policy.offers
    .filter(o => o.enabled)
    .map(o => {
      if (o.type === "discount" && discount) {
        return `${o.say} (${discount.percent_off}% off, code ${discount.code})`;
      }
      if (o.type === "emi" && o.emi_months) {
        return o.say.replace(/\bEMI\b/, `${o.emi_months}-mahine EMI`);
      }
      return o.say;
    });
  return lines.join(" ");
}

// Offer chips the customer can tap on the call.
export function offerChips(policy: RecoveryPolicy | null): {
  offer_id: OfferType;
  label: string;
  press_key: number | null;
}[] {
  if (!policy || !policy.enabled) return [];
  return policy.offers
    .filter(o => o.enabled && o.type !== "silent_retry")
    .map(o => ({ offer_id: o.type, label: o.label, press_key: o.press_key }));
}

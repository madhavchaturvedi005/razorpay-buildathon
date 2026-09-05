export type DemoScenario =
  | "insufficient_funds"
  | "expired_card"
  | "overdue_invoice"
  | "abandoned_cart"
  | "gateway_timeout";

export const DEMO_CUSTOMER = {
  name: "Arjun Sharma",
  firstName: "Arjun",
  email: "arjun.sharma@example.com",
  phone: "+91 98765 43210",
  customerId: "cust_N8k2mQ1pA3",
  upi: "arjun@okhdfcbank",
  bank: "HDFC Bank",
  accountLast4: "4412",
};

export const DEMO_MERCHANT = {
  name: "Lumen Store",
  legal: "Lumen Retail Pvt Ltd",
  gstin: "29AABCU9603R1ZM",
};

export interface DemoTxn {
  id: string;
  amount: number;
  status: "captured" | "failed" | "created";
  method: string;
  note: string;
  time: string;
}

export interface ScenarioDef {
  id: DemoScenario;
  label: string;
  nav: "home" | "payments" | "invoices" | "checkout";
  due: number;
  wallet: number;
  description: string;
  decline: string | null;
  ai: {
    diagnosis: string;
    why: string;
    confidence: number;
    actions: string[];
  };
  cart?: { name: string; qty: number; price: number; img: string }[];
  invoice?: { number: string; issued: string; dueDate: string; daysOverdue: number };
  card?: { brand: string; last4: string; expiry: string };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "insufficient_funds",
    label: "Insufficient funds",
    nav: "payments",
    due: 420000,
    wallet: 184000,
    description: "HDFC declined the card charge — not enough balance.",
    decline: "insufficient_funds",
    card: { brand: "Visa", last4: "4242", expiry: "08/28" },
    ai: {
      diagnosis: "Soft decline · Insufficient funds",
      why: "Arjun’s HDFC account has ₹1,840. The charge is ₹4,200. Retrying the same card will fail again — this is recoverable with EMI, a partial pay, or topping up the wallet.",
      confidence: 72,
      actions: [
        "Offer 3-month no-cost EMI (₹1,400 / month)",
        "Let him add money, then retry",
        "Fall back to UPI from another account",
      ],
    },
  },
  {
    id: "expired_card",
    label: "Expired card",
    nav: "payments",
    due: 299900,
    wallet: 850000,
    description: "Saved Visa ending 4242 expired in Dec 2025.",
    decline: "expired_card",
    card: { brand: "Visa", last4: "4242", expiry: "12/25" },
    ai: {
      diagnosis: "Hard instrument failure · Expired card",
      why: "Retrying an expired card never recovers. In India the highest-lift path is a UPI fallback link, then a card-update portal.",
      confidence: 68,
      actions: [
        "Send a UPI payment link (GPay / PhonePe)",
        "Ask him to update the saved card",
        "Do not retry the expired Visa",
      ],
    },
  },
  {
    id: "overdue_invoice",
    label: "Overdue invoice",
    nav: "invoices",
    due: 1850000,
    wallet: 2200000,
    description: "Invoice INV-2048 is 12 days past due.",
    decline: null,
    invoice: {
      number: "INV-2048",
      issued: "12 Aug 2026",
      dueDate: "22 Aug 2026",
      daysOverdue: 12,
    },
    ai: {
      diagnosis: "B2B invoice · Day 1–15 bucket",
      why: "Still in the gentle-reminder window. A payment link plus a clear due-date reminder recovers ~92% of invoices in this age. No penalty yet — keep the tone helpful.",
      confidence: 92,
      actions: [
        "Send a Razorpay payment link on email + SMS",
        "Offer 50/50 split if cash-flow is tight",
        "Escalate only after day 46",
      ],
    },
  },
  {
    id: "abandoned_cart",
    label: "Abandoned cart",
    nav: "checkout",
    due: 329900,
    wallet: 1200000,
    description: "Left checkout after seeing the total — likely a price surprise.",
    decline: null,
    cart: [
      { name: "Lumen Studio Headphones", qty: 1, price: 249900, img: "🎧" },
      { name: "USB-C Hub", qty: 1, price: 49900, img: "🔌" },
      { name: "Express shipping", qty: 1, price: 30100, img: "📦" },
    ],
    ai: {
      diagnosis: "Abandoned cart · price surprise",
      why: "Arjun reached pay, then left when shipping showed up. The play is a recovery call within minutes: offer COMEBACK10 (10% off), press 1 to apply, resume guest checkout. No signup.",
      confidence: 55,
      actions: [
        "Call within 2 minutes of abandon",
        "Press 1 → apply COMEBACK10 (10%, 48h)",
        "Resume guest checkout at the new total",
      ],
    },
  },
  {
    id: "gateway_timeout",
    label: "Gateway timeout",
    nav: "payments",
    due: 149900,
    wallet: 500000,
    description: "HDFC didn’t respond in time. Transient — not the customer’s fault.",
    decline: "gateway_timeout",
    card: { brand: "Mastercard", last4: "1111", expiry: "08/28" },
    ai: {
      diagnosis: "Transient gateway timeout",
      why: "The customer did everything right. Contacting them now would feel like spam. Silent retry (up to 3) then acquirer reroute recovers ~78% of these without a single nudge.",
      confidence: 85,
      actions: [
        "Silent retry immediately (no SMS / email)",
        "Reroute via backup acquirer if retry 3 fails",
        "Only then send a UPI fallback link",
      ],
    },
  },
];

export function getScenario(id: DemoScenario): ScenarioDef {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}

export const PAST_TXNS: DemoTxn[] = [
  { id: "pay_N7kLm2pQ", amount: 89900, status: "captured", method: "UPI", note: "Lumen Store", time: "2 Sep, 7:14 PM" },
  { id: "pay_M4sRt9vB", amount: 24900, status: "captured", method: "Card", note: "Spotify", time: "28 Aug, 11:02 AM" },
  { id: "pay_K2aWx8cD", amount: 120000, status: "captured", method: "Netbanking", note: "Jio Fiber", time: "14 Aug, 9:40 AM" },
];

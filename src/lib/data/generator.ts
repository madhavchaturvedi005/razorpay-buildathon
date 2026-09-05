import type { RecoveryEvent, DeclineCode } from "../types";
import {
  CALIBRATION,
  weightedRandom,
  randomInRange,
  weightedBool,
} from "./calibration";
import { MESSY_ISSUER_EXAMPLES } from "../engine/issuer";

// ─── Static customer pool ────────────────────────────────────────────────────

const CUSTOMERS = [
  { id: "cust_001", name: "Arjun Sharma",   email: "arjun.sharma@example.com",  phone: "+919876543210" },
  { id: "cust_002", name: "Priya Patel",    email: "priya.patel@example.com",   phone: "+919876543211" },
  { id: "cust_003", name: "Rohit Gupta",    email: "rohit.gupta@example.com",   phone: "+919876543212" },
  { id: "cust_004", name: "Sneha Iyer",     email: "sneha.iyer@example.com",    phone: "+919876543213" },
  { id: "cust_005", name: "Vikram Reddy",   email: "vikram.reddy@example.com",  phone: "+919876543214" },
  { id: "cust_006", name: "Kavya Nair",     email: "kavya.nair@example.com",    phone: "+919876543215" },
  { id: "cust_007", name: "Amit Kumar",     email: "amit.kumar@example.com",    phone: "+919876543216" },
  { id: "cust_008", name: "Deepa Menon",    email: "deepa.menon@example.com",   phone: "+919876543217" },
  { id: "cust_009", name: "Rajesh Singh",   email: "rajesh.singh@example.com",  phone: "+919876543218" },
  { id: "cust_010", name: "Ananya Joshi",   email: "ananya.joshi@example.com",  phone: "+919876543219" },
  // B2B customers for invoices
  { id: "cust_b01", name: "Infosys Ltd",    email: "accounts@infosys.example",  phone: "+918028520000" },
  { id: "cust_b02", name: "TCS Payments",   email: "finance@tcs.example",       phone: "+912267789999" },
  { id: "cust_b03", name: "Wipro Ventures", email: "ap@wipro.example",          phone: "+918028440011" },
  { id: "cust_b04", name: "HCL Tech",       email: "payables@hcl.example",      phone: "+911204326000" },
  { id: "cust_b05", name: "Mindtree Corp",  email: "finance@mindtree.example",  phone: "+918067191234" },
];

function randomCustomer(b2b = false) {
  const pool = b2b ? CUSTOMERS.slice(10) : CUSTOMERS.slice(0, 10);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Amount ranges (in paise) ─────────────────────────────────────────────────

const AMOUNT_RANGES = {
  payment_failure:      { min: 29900,  max: 999900  },   // ₹299–₹9,999
  checkout_abandon:     { min: 49900,  max: 1499900 },   // ₹499–₹14,999
  invoice_overdue:      { min: 500000, max: 50000000 },  // ₹5,000–₹5,00,000
  subscription_failure: { min: 29900,  max: 299900  },   // ₹299–₹2,999
};

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function randomTimestamp(daysBack = 90): string {
  const now = Date.now();
  const past = now - randomInRange(0, daysBack) * 86400000;
  return new Date(past).toISOString();
}

let eventCounter = 0;
function nextId(prefix: string): string {
  eventCounter++;
  return `${prefix}_${String(eventCounter).padStart(4, "0")}`;
}

// ─── Individual generators ────────────────────────────────────────────────────

function generatePaymentFailure(index: number): RecoveryEvent {
  const declineCode = weightedRandom<string>(CALIBRATION.decline_code_weights) as DeclineCode;
  const cust = randomCustomer(false);
  const amount = randomInRange(
    AMOUNT_RANGES.payment_failure.min,
    AMOUNT_RANGES.payment_failure.max,
  );

  const recoverProb =
    CALIBRATION.recoverability[declineCode as keyof typeof CALIBRATION.recoverability] ??
    CALIBRATION.recoverability.hard_decline;

  return {
    event_id: `evt_pf_${String(index + 1).padStart(4, "0")}`,
    type: "payment_failure",
    amount,
    currency: "INR",
    customer_id: cust.id,
    customer_name: cust.name,
    customer_email: cust.email,
    customer_phone: cust.phone,
    decline_code: declineCode,
    days_overdue: 0,
    dispute_flag: declineCode === "hard_decline" && weightedBool(0.15),
    abandonment_reason: null,
    ground_truth_recoverable: weightedBool(recoverProb),
    timestamp: randomTimestamp(30),
    status: "pending",
    razorpay_order_id: null,
    razorpay_link_id: null,
    razorpay_invoice_id: null,
    issuer_raw: weightedBool(0.12)
      ? (MESSY_ISSUER_EXAMPLES.find(e => e.expected === (
          declineCode === "upi_mandate_cancelled" ? "subscription_upi_cancelled"
          : declineCode === "bank_not_responding" ? "gateway_timeout"
          : declineCode === "invalid_card" ? "expired_card"
          : declineCode
        ))?.raw ?? `ISSUER_RAW/${declineCode}`)
      : null,
  };
}

function generateCheckoutAbandon(index: number): RecoveryEvent {
  const reason = weightedRandom<string>(CALIBRATION.abandonment_weights);
  const cust = randomCustomer(false);
  const amount = randomInRange(
    AMOUNT_RANGES.checkout_abandon.min,
    AMOUNT_RANGES.checkout_abandon.max,
  );

  const recoverMap: Record<string, number> = {
    price_surprise: CALIBRATION.recoverability.price_surprise,
    forced_signup: CALIBRATION.recoverability.forced_signup,
    checkout_too_long: CALIBRATION.recoverability.checkout_too_long,
    other: CALIBRATION.recoverability.other_abandon,
  };

  return {
    event_id: `evt_ca_${String(index + 1).padStart(4, "0")}`,
    type: "checkout_abandon",
    amount,
    currency: "INR",
    customer_id: cust.id,
    customer_name: cust.name,
    customer_email: cust.email,
    customer_phone: cust.phone,
    decline_code: null,
    days_overdue: 0,
    dispute_flag: false,
    abandonment_reason: reason,
    ground_truth_recoverable: weightedBool(recoverMap[reason] ?? 0.25),
    timestamp: randomTimestamp(14),
    status: "pending",
    razorpay_order_id: null,
    razorpay_link_id: null,
    razorpay_invoice_id: null,
    issuer_raw: null,
  };
}

function generateInvoiceOverdue(index: number): RecoveryEvent {
  // Pick an aging bucket
  const buckets = CALIBRATION.invoice_aging_weights;
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  let r = Math.random() * totalWeight;
  let bucket = buckets[0];
  for (const b of buckets) {
    r -= b.weight;
    if (r <= 0) { bucket = b; break; }
  }
  const days = randomInRange(bucket.min, bucket.max);

  const cust = randomCustomer(true);
  const amount = randomInRange(
    AMOUNT_RANGES.invoice_overdue.min,
    AMOUNT_RANGES.invoice_overdue.max,
  );

  const recoverProb =
    days <= 15  ? CALIBRATION.recoverability.invoice_day_1_15 :
    days <= 45  ? CALIBRATION.recoverability.invoice_day_16_45 :
    days <= 90  ? CALIBRATION.recoverability.invoice_day_46_90 :
                  CALIBRATION.recoverability.invoice_day_91_plus;

  return {
    event_id: `evt_io_${String(index + 1).padStart(4, "0")}`,
    type: "invoice_overdue",
    amount,
    currency: "INR",
    customer_id: cust.id,
    customer_name: cust.name,
    customer_email: cust.email,
    customer_phone: cust.phone,
    decline_code: null,
    days_overdue: days,
    dispute_flag: days > 60 && weightedBool(0.08), // 8% of 60+ day invoices have disputes
    abandonment_reason: null,
    ground_truth_recoverable: weightedBool(recoverProb),
    timestamp: new Date(Date.now() - days * 86400000).toISOString(),
    status: "pending",
    razorpay_order_id: null,
    razorpay_link_id: null,
    razorpay_invoice_id: null,
    issuer_raw: null,
  };
}

function generateSubscriptionFailure(index: number): RecoveryEvent {
  const isUpiIssue = weightedBool(0.35); // 35% UPI-related
  const declineCode: DeclineCode = isUpiIssue
    ? "upi_mandate_cancelled"
    : weightedRandom<string>({
        insufficient_funds: 0.35,
        expired_card: 0.40,
        hard_decline: 0.10,
        gateway_timeout: 0.15,
      }) as DeclineCode;

  const cust = randomCustomer(false);
  const amount = randomInRange(
    AMOUNT_RANGES.subscription_failure.min,
    AMOUNT_RANGES.subscription_failure.max,
  );

  const recoverProb = isUpiIssue
    ? CALIBRATION.recoverability.subscription_upi
    : CALIBRATION.recoverability.subscription_card;

  return {
    event_id: `evt_sf_${String(index + 1).padStart(4, "0")}`,
    type: "subscription_failure",
    amount,
    currency: "INR",
    customer_id: cust.id,
    customer_name: cust.name,
    customer_email: cust.email,
    customer_phone: cust.phone,
    decline_code: declineCode,
    days_overdue: 0,
    dispute_flag: false,
    abandonment_reason: null,
    ground_truth_recoverable: weightedBool(recoverProb),
    timestamp: randomTimestamp(30),
    status: "pending",
    razorpay_order_id: null,
    razorpay_link_id: null,
    razorpay_invoice_id: null,
    issuer_raw: null,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateSyntheticBatch(): RecoveryEvent[] {
  const events: RecoveryEvent[] = [];
  const v = CALIBRATION.volumes;

  // Seed with deterministic-ish data by resetting counter
  eventCounter = 0;

  for (let i = 0; i < v.payment_failure; i++) {
    events.push(generatePaymentFailure(i));
  }
  for (let i = 0; i < v.checkout_abandon; i++) {
    events.push(generateCheckoutAbandon(i));
  }
  for (let i = 0; i < v.invoice_overdue; i++) {
    events.push(generateInvoiceOverdue(i));
  }
  for (let i = 0; i < v.subscription_failure; i++) {
    events.push(generateSubscriptionFailure(i));
  }

  // Shuffle for realistic ordering
  for (let i = events.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [events[i], events[j]] = [events[j], events[i]];
  }

  return events;
}

// ─── Demo-specific seeds (for guardrail break-it scenarios) ──────────────────

export function generateDemoEvents(): RecoveryEvent[] {
  const now = new Date().toISOString();

  return [
    // 1. Standard soft decline — shows normal recovery path
    {
      event_id: "demo_001",
      type: "payment_failure",
      amount: 420000,
      currency: "INR",
      customer_id: "cust_001",
      customer_name: "Arjun Sharma",
      customer_email: "arjun.sharma@example.com",
      customer_phone: "+919876543210",
      decline_code: "insufficient_funds",
      days_overdue: 0,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    // 2. Expired card — shows UPI fallback path
    {
      event_id: "demo_002",
      type: "payment_failure",
      amount: 299900,
      currency: "INR",
      customer_id: "cust_002",
      customer_name: "Priya Patel",
      customer_email: "priya.patel@example.com",
      customer_phone: "+919876543211",
      decline_code: "expired_card",
      days_overdue: 0,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    // 3. Gateway timeout — shows silent retry path
    {
      event_id: "demo_003",
      type: "payment_failure",
      amount: 149900,
      currency: "INR",
      customer_id: "cust_003",
      customer_name: "Rohit Gupta",
      customer_email: "rohit.gupta@example.com",
      customer_phone: "+919876543212",
      decline_code: "gateway_timeout",
      days_overdue: 0,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    // 4. Invoice 55 days overdue — shows human handoff path
    {
      event_id: "demo_004",
      type: "invoice_overdue",
      amount: 15000000,
      currency: "INR",
      customer_id: "cust_b01",
      customer_name: "Infosys Ltd",
      customer_email: "accounts@infosys.example",
      customer_phone: "+918028520000",
      decline_code: null,
      days_overdue: 55,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: new Date(Date.now() - 55 * 86400000).toISOString(),
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    // 5. Dispute flag — shows kill-switch
    {
      event_id: "demo_005",
      type: "payment_failure",
      amount: 599900,
      currency: "INR",
      customer_id: "cust_004",
      customer_name: "Sneha Iyer",
      customer_email: "sneha.iyer@example.com",
      customer_phone: "+919876543213",
      decline_code: "hard_decline",
      days_overdue: 0,
      dispute_flag: true,
      abandonment_reason: null,
      ground_truth_recoverable: false,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    // 6. Invoice 28 days — normal B2B flow
    {
      event_id: "demo_006",
      type: "invoice_overdue",
      amount: 7500000,
      currency: "INR",
      customer_id: "cust_b02",
      customer_name: "TCS Payments",
      customer_email: "finance@tcs.example",
      customer_phone: "+912267789999",
      decline_code: null,
      days_overdue: 28,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: new Date(Date.now() - 28 * 86400000).toISOString(),
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
    {
      event_id: "demo_007",
      type: "payment_failure",
      amount: 890000,
      currency: "INR",
      customer_id: "cust_005",
      customer_name: "Vikram Reddy",
      customer_email: "vikram.reddy@example.com",
      customer_phone: "+919876543214",
      decline_code: null,
      days_overdue: 0,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: "HDFC_UPI_MANDATE_REVOKED_BY_CUSTOMER",
    },
    {
      event_id: "demo_008",
      type: "subscription_failure",
      amount: 199900,
      currency: "INR",
      customer_id: "cust_006",
      customer_name: "Kavya Nair",
      customer_email: "kavya.nair@example.com",
      customer_phone: "+919876543215",
      decline_code: "upi_mandate_cancelled",
      days_overdue: 0,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: now,
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: "UPI AUTOPAY MANDATE CANCELLED BY CUSTOMER IN GPAY",
    },
    {
      event_id: "demo_009",
      type: "invoice_overdue",
      amount: 18500000,
      currency: "INR",
      customer_id: "cust_b03",
      customer_name: "Wipro Ventures",
      customer_email: "ap@wipro.example",
      customer_phone: "+918028440011",
      decline_code: null,
      days_overdue: 22,
      dispute_flag: false,
      abandonment_reason: null,
      ground_truth_recoverable: true,
      timestamp: new Date(Date.now() - 22 * 86400000).toISOString(),
      status: "pending",
      razorpay_order_id: null,
      razorpay_link_id: null,
      razorpay_invoice_id: null,
      issuer_raw: null,
    },
  ];
}

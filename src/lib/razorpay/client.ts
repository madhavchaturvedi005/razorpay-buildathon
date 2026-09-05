// ─── Razorpay test-mode REST client ──────────────────────────────────────────
// Uses the official razorpay npm SDK. All calls go to test-mode (rzp_test_...).

import Razorpay from "razorpay";

function getClient(): Razorpay {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || key_id === "rzp_test_REPLACE_ME") {
    throw new Error(
      "RAZORPAY_KEY_ID is not configured. " +
      "Add your rzp_test_... key to .env.local and restart the server."
    );
  }
  if (!key_secret || key_secret === "REPLACE_ME_SECRET") {
    throw new Error("RAZORPAY_KEY_SECRET is not configured in .env.local");
  }

  return new Razorpay({ key_id, key_secret });
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface CreateOrderParams {
  amount: number;      // paise
  currency?: string;
  receipt?: string;
  partial_payment?: boolean;
  first_payment_min_amount?: number;  // paise; for partial payment
  notes?: Record<string, string>;
}

export async function createOrder(params: CreateOrderParams) {
  const rzp = getClient();
  const order = await rzp.orders.create({
    amount: params.amount,
    currency: params.currency ?? "INR",
    receipt: params.receipt ?? `rcpt_${Date.now()}`,
    partial_payment: params.partial_payment ?? false,
    first_payment_min_amount: params.first_payment_min_amount,
    notes: params.notes ?? {},
  });
  return order;
}

// ─── Payment Links ────────────────────────────────────────────────────────────

export interface CreatePaymentLinkParams {
  amount: number;       // paise
  description: string;
  customer: {
    name: string;
    email: string;
    contact: string;
  };
  method?: "upi" | "card" | "netbanking" | "wallet";
  notes?: Record<string, string>;
  expire_by?: number;   // UNIX timestamp
}

export async function createPaymentLink(params: CreatePaymentLinkParams) {
  const rzp = getClient();

  // Expire in 24 hours by default
  const expire_by = params.expire_by ?? Math.floor(Date.now() / 1000) + 86400;

  const link = await (rzp.paymentLink as any).create({
    amount: params.amount,
    currency: "INR",
    description: params.description,
    customer: params.customer,
    expire_by,
    notify: { sms: false, email: false },
    reminder_enable: false,  // agent controls reminders, not Razorpay
    notes: {
      ...(params.notes ?? {}),
      ...(params.method ? { preferred_method: params.method } : {}),
    },
  });

  return link as { id: string; short_url: string; status: string };
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export interface CreateInvoiceParams {
  customer_name: string;
  customer_email: string;
  customer_contact: string;
  amount: number;           // paise
  description: string;
  partial_payment?: boolean;
  notes?: Record<string, string>;
}

export async function createInvoice(params: CreateInvoiceParams) {
  const rzp = getClient();
  const expire_by = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 day expiry

  const invoice = await rzp.invoices.create({
    type: "link",
    description: params.description,
    partial_payment: params.partial_payment ?? false,
    customer: {
      name: params.customer_name,
      email: params.customer_email,
      contact: params.customer_contact,
    },
    line_items: [
      {
        name: params.description,
        amount: params.amount,
        currency: "INR",
        quantity: 1,
      },
    ],
    sms_notify: 1,
    email_notify: 1,
    expire_by,
    notes: params.notes ?? {},
  } as Parameters<typeof rzp.invoices.create>[0]);

  return invoice as { id: string; short_url: string; status: string };
}

// ─── Graceful fallback for when keys are not yet configured ──────────────────
// Returns a simulated response so the UI still works in demo-without-keys mode.

export interface SimulatedRef {
  id: string;
  short_url: string;
  status: string;
  _simulated: true;
}

export function simulatedPaymentLink(eventId: string): SimulatedRef {
  return {
    id: `sim_link_${eventId}_${Date.now()}`,
    short_url: `https://rzp.io/i/sim_${eventId}`,
    status: "created",
    _simulated: true,
  };
}

export function simulatedOrder(eventId: string, amount: number): SimulatedRef {
  return {
    id: `sim_order_${eventId}_${Date.now()}`,
    short_url: `https://checkout.razorpay.com/v1/sim_${eventId}`,
    status: "created",
    _simulated: true,
  };
}

export function simulatedInvoice(eventId: string): SimulatedRef {
  return {
    id: `sim_inv_${eventId}_${Date.now()}`,
    short_url: `https://rzp.io/i/inv_${eventId}`,
    status: "draft",
    _simulated: true,
  };
}

export function isKeysConfigured(): boolean {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  return (
    !!key_id && key_id !== "rzp_test_REPLACE_ME" &&
    !!key_secret && key_secret !== "REPLACE_ME_SECRET"
  );
}

export function isWebhookSecretConfigured(): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  return Boolean(secret) && secret !== "your_webhook_secret_here";
}

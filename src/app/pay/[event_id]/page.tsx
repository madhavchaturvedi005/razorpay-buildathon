"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { RecoveryEvent } from "@/lib/types";

// ─── Razorpay checkout.js type augmentation ───────────────────────────────────
declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance { open(): void }
interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

// ─── Session state ────────────────────────────────────────────────────────────
type Stage = "loading" | "ready" | "paying" | "success" | "failed" | "error";

interface PaySession {
  event: RecoveryEvent;
  order: { id: string; amount: number; currency: string };
  key_id: string | null;
  simulated: boolean;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  payment_failure: "Payment Failure",
  checkout_abandon: "Checkout Abandoned",
  invoice_overdue: "Invoice Overdue",
  subscription_failure: "Subscription Failure",
};

const INTERVENTION_LABELS: Record<string, string> = {
  upi_fallback_link: "UPI Fallback",
  card_update_link: "Card Update",
  emi_offer: "EMI Plan",
  partial_payment: "Partial Payment",
  silent_retry: "Silent Retry",
  gentle_reminder: "Invoice Reminder",
  firm_reminder_payment_link: "Payment Link",
  default: "Payment Recovery",
};

function formatAmount(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function PayPage() {
  const { event_id } = useParams<{ event_id: string }>();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<PaySession | null>(null);
  const [successData, setSuccessData] = useState<{
    payment_id: string; order_id: string; amount: number; simulated: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load event + order
  const loadSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/pay/${event_id}`);
      if (!res.ok) throw new Error("Event not found");
      const data = await res.json() as PaySession;
      setSession(data);
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setStage("error");
    }
  }, [event_id]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Confirm payment (real or simulated)
  const confirm = useCallback(async (
    payment_id: string,
    order_id: string,
    signature?: string,
    simulated?: boolean,
  ) => {
    setStage("paying");
    try {
      const res = await fetch(`/api/pay/${event_id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpay_payment_id: payment_id,
          razorpay_order_id: order_id,
          razorpay_signature: signature,
          simulated: simulated ?? false,
        }),
      });
      const data = await res.json() as { success: boolean; payment_id: string; order_id: string; amount: number; simulated: boolean };
      if (!res.ok || !data.success) throw new Error("Confirmation failed");
      setSuccessData(data);
      setStage("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation failed");
      setStage("failed");
    }
  }, [event_id]);

  // Open real Razorpay checkout
  const openRazorpay = useCallback(async () => {
    if (!session || !session.key_id) return;

    // Load the Razorpay checkout.js script
    if (!window.Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Razorpay script"));
        document.body.appendChild(script);
      });
    }

    const rzp = new window.Razorpay({
      key: session.key_id,
      amount: session.order.amount,
      currency: "INR",
      name: "AI Revenue Recovery",
      description: `Recovering ${EVENT_TYPE_LABELS[session.event.type] ?? "payment"}`,
      order_id: session.order.id,
      handler: (response: RazorpayResponse) => {
        confirm(
          response.razorpay_payment_id,
          response.razorpay_order_id,
          response.razorpay_signature,
          false,
        );
      },
      prefill: {
        name: session.event.customer_name,
        email: session.event.customer_email,
        contact: session.event.customer_phone,
      },
      theme: { color: "#10b981" },
      modal: {
        ondismiss: () => setStage("ready"),
      },
    });
    rzp.open();
  }, [session, confirm]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (stage === "loading") {
    return <PageShell><LoadingState /></PageShell>;
  }

  if (stage === "error" || !session) {
    return (
      <PageShell>
        <div className="text-center py-16">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-red-400 font-medium">{error ?? "Something went wrong"}</p>
          <button onClick={() => router.push("/events")} className="mt-6 text-sm text-gray-400 hover:text-white underline">
            ← Back to Events
          </button>
        </div>
      </PageShell>
    );
  }

  if (stage === "success" && successData) {
    return (
      <PageShell>
        <SuccessScreen
          data={successData}
          event={session.event}
          onAudit={() => router.push("/audit")}
          onEvents={() => router.push("/events")}
        />
      </PageShell>
    );
  }

  if (stage === "failed") {
    return (
      <PageShell>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">❌</div>
          <p className="text-red-400 font-semibold text-lg mb-2">Payment Failed</p>
          <p className="text-gray-400 text-sm mb-6">{error ?? "The payment could not be processed."}</p>
          <button
            onClick={() => { setError(null); setStage("ready"); }}
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium"
          >
            Try Again
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Ready / Paying ──────────────────────────────────────────────────────────
  const { event, order, simulated } = session;

  return (
    <PageShell>
      <div className="max-w-md mx-auto space-y-6">
        {/* Event context */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Recovery Checkout</span>
            {simulated && (
              <span className="text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800 px-2 py-0.5 rounded-full">
                Test / Simulated
              </span>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Customer</p>
            <p className="text-sm font-medium text-white">{event.customer_name}</p>
            <p className="text-xs text-gray-400">{event.customer_email}</p>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-xs text-gray-500">Event type</p>
              <p className="text-sm text-gray-300">{EVENT_TYPE_LABELS[event.type] ?? event.type}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Amount due</p>
              <p className="text-2xl font-bold font-mono text-emerald-400">{formatAmount(event.amount)}</p>
            </div>
          </div>
          {event.decline_code && (
            <div className="bg-red-950/40 border border-red-900 rounded-lg p-3 text-xs">
              <span className="text-red-400">Original failure: </span>
              <span className="text-gray-300 font-mono">{event.decline_code}</span>
            </div>
          )}
          {event.days_overdue > 0 && (
            <div className="bg-yellow-950/40 border border-yellow-900 rounded-lg p-3 text-xs">
              <span className="text-yellow-400">Invoice overdue by </span>
              <span className="text-gray-300 font-semibold">{event.days_overdue} days</span>
            </div>
          )}
        </div>

        {/* Checkout section */}
        {simulated ? (
          <SimulatedCheckout
            event={event}
            order={order}
            paying={stage === "paying"}
            onPay={() => {
              const payment_id = `pay_sim_${Date.now()}`;
              confirm(payment_id, order.id, undefined, true);
            }}
          />
        ) : (
          <RealCheckoutButton
            paying={stage === "paying"}
            onPay={openRazorpay}
          />
        )}

        <button onClick={() => router.push("/events")} className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors py-1">
          ← Back to Events
        </button>
      </div>
    </PageShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Demo banner — only visible in this simulation */}
      <div className="bg-yellow-900/40 border-b border-yellow-800/50 px-6 py-2 flex items-center gap-2">
        <span className="text-yellow-400 text-xs font-semibold">👤 CUSTOMER VIEW SIMULATION</span>
        <span className="text-yellow-700 text-xs">— This is what the customer sees after receiving the recovery link. You are previewing as the merchant.</span>
      </div>
      {/* Razorpay-like nav */}
      <div className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center text-xs font-bold">R</div>
        <span className="text-sm font-medium text-gray-200">Razorpay</span>
        <span className="text-gray-700">·</span>
        <span className="text-xs text-gray-500">Secure Checkout</span>
        <div className="ml-auto text-xs text-gray-600">🔒 Test Mode</div>
      </div>
      <div className="flex-1 px-4 py-10">{children}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="max-w-md mx-auto space-y-4 animate-pulse">
      <div className="h-48 bg-gray-800 rounded-xl" />
      <div className="h-64 bg-gray-800 rounded-xl" />
    </div>
  );
}

function RealCheckoutButton({ paying, onPay }: { paying: boolean; onPay: () => void }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center space-y-4">
      <div className="text-4xl">💳</div>
      <p className="text-sm text-gray-300">
        Complete this payment using Razorpay's secure test checkout.
      </p>
      <button
        onClick={onPay}
        disabled={paying}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {paying ? (
          <><Spinner />Processing…</>
        ) : (
          <>Pay with Razorpay →</>
        )}
      </button>
      <p className="text-xs text-gray-600">Test mode — no real money is charged</p>
    </div>
  );
}

function SimulatedCheckout({
  event, order, paying, onPay,
}: {
  event: RecoveryEvent;
  order: { id: string; amount: number };
  paying: boolean;
  onPay: () => void;
}) {
  const [method, setMethod] = useState<"card" | "upi">("card");
  const [cardNum, setCardNum] = useState("4111 1111 1111 1111");
  const [expiry, setExpiry] = useState("12/28");
  const [cvv, setCvv] = useState("123");
  const [name, setName] = useState(event.customer_name);
  const [upiId, setUpiId] = useState("success@razorpay");

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-emerald-900/30 border-b border-emerald-900/50 px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">₹</div>
        <div>
          <p className="text-sm font-semibold text-white">Razorpay Checkout</p>
          <p className="text-xs text-emerald-400">{formatAmount(order.amount)}</p>
        </div>
        <div className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded font-mono">
          {order.id.slice(0, 18)}…
        </div>
      </div>

      {/* Method tabs */}
      <div className="flex border-b border-gray-800">
        {(["card", "upi"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              method === m
                ? "text-emerald-400 border-b-2 border-emerald-500 bg-gray-800/40"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {m === "card" ? "💳 Card" : "📱 UPI"}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="p-5 space-y-4">
        {method === "card" ? (
          <>
            <Field label="Card Number" value={cardNum} onChange={setCardNum} mono />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiry (MM/YY)" value={expiry} onChange={setExpiry} mono />
              <Field label="CVV" value={cvv} onChange={setCvv} mono />
            </div>
            <Field label="Name on Card" value={name} onChange={setName} />
            <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg p-3 text-xs text-blue-300">
              <span className="font-semibold">Test card:</span> use 4111 1111 1111 1111 · CVV 123 · any future expiry
            </div>
          </>
        ) : (
          <>
            <Field label="UPI ID" value={upiId} onChange={setUpiId} mono />
            <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg p-3 text-xs text-blue-300">
              <span className="font-semibold">Test UPI:</span> use <span className="font-mono">success@razorpay</span> for instant success
            </div>
          </>
        )}

        <button
          onClick={onPay}
          disabled={paying}
          className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2 mt-2"
        >
          {paying ? (
            <><Spinner />Processing payment…</>
          ) : (
            <>Pay {formatAmount(order.amount)} →</>
          )}
        </button>

        <p className="text-center text-xs text-gray-600">
          Secured by Razorpay · Simulated test mode
        </p>
      </div>
    </div>
  );
}

function SuccessScreen({
  data, event, onAudit, onEvents,
}: {
  data: { payment_id: string; order_id: string; amount: number; simulated: boolean };
  event: RecoveryEvent;
  onAudit: () => void;
  onEvents: () => void;
}) {
  const now = new Date().toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Simulation banner */}
      <div className="bg-yellow-900/30 border border-yellow-800/50 rounded-xl px-5 py-3 flex items-center gap-2">
        <span className="text-yellow-400 text-xs font-semibold">👤 Customer paid</span>
        <span className="text-yellow-700 text-xs">— Razorpay confirmed the payment. Your merchant dashboard is now updated.</span>
      </div>

      {/* Success banner */}
      <div className="bg-emerald-950/50 border border-emerald-700 rounded-xl p-8 text-center space-y-3">
        <div className="text-6xl">✅</div>
        <h2 className="text-2xl font-bold text-emerald-400">Revenue Recovered!</h2>
        <p className="text-sm text-gray-300">
          The agent successfully recovered{" "}
          <span className="font-semibold text-white">{formatAmount(data.amount)}</span>{" "}
          from {event.customer_name}
        </p>
      </div>

      {/* Receipt */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800 overflow-hidden">
        <div className="px-5 py-3 bg-gray-800/40">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Payment Receipt</p>
        </div>
        <ReceiptRow label="Payment ID" value={data.payment_id} mono />
        <ReceiptRow label="Order ID" value={data.order_id} mono />
        <ReceiptRow label="Amount" value={formatAmount(data.amount)} highlight />
        <ReceiptRow label="Customer" value={event.customer_name} />
        <ReceiptRow label="Email" value={event.customer_email} />
        <ReceiptRow label="Time" value={now} />
        <ReceiptRow
          label="Mode"
          value={data.simulated ? "Simulated (test)" : "Razorpay Test"}
          muted
        />
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onAudit}
          className="py-2.5 text-sm bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors font-medium"
        >
          View Audit Log
        </button>
        <button
          onClick={onEvents}
          className="py-2.5 text-sm bg-emerald-700 hover:bg-emerald-600 rounded-lg transition-colors font-medium"
        >
          Back to Events
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-600 transition-colors ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

function ReceiptRow({
  label, value, mono = false, highlight = false, muted = false,
}: {
  label: string; value: string; mono?: boolean; highlight?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""} ${highlight ? "text-emerald-400 font-bold" : muted ? "text-gray-500" : "text-gray-200"}`}>
        {value}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

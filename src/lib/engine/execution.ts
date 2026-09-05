import type {
  RecoveryEvent,
  InterventionPlan,
  DiagnosisTag,
  AuditOutcome,
  GuardrailResult,
  AiSource,
} from "../types";
import {
  createPaymentLink, createInvoice, createOrder,
  simulatedPaymentLink, simulatedOrder, simulatedInvoice,
  isKeysConfigured,
} from "../razorpay/client";
import { db } from "../db";
import { writeAuditLog } from "./audit";
import { CALIBRATION } from "../data/calibration";
import { check } from "./guardrail";

// ─── Execution: call real Razorpay → compute outcome ─────────────────────────

export interface ExecutionResult {
  outcome: AuditOutcome;
  razorpay_ref: string | null;
  razorpay_url: string | null;
  simulated: boolean;
  needs_payment: boolean;
}

// Interventions that require the customer to take action (go through checkout).
// These stay "in_progress" until confirmed via /api/pay/[id]/confirm.
const CUSTOMER_ACTION_INTERVENTIONS = new Set([
  "upi_fallback_link",
  "card_update_link",
  "guest_checkout_link",
  "gentle_reminder",
  "firm_reminder_payment_link",
  "whatsapp_payment_link",
  "partial_payment",
  "emi_offer",
  "payday_retry",
  "pre_expiry_alert",
  "early_discount_offer",
]);

export async function execute(
  event: RecoveryEvent,
  plan: InterventionPlan,
  guardrail: GuardrailResult,
  diagnosis: DiagnosisTag,
  aiSource: AiSource = "rules",
): Promise<ExecutionResult> {
  // HappyGarg: stopping rules run twice. Re-read the event just before send.
  const fresh = db.getEvent(event.event_id) ?? event;
  const attempts = db.getAttempts(event.event_id);
  const config = db.getGuardrailConfig();
  let liveGuardrail = guardrail;
  if (guardrail.allow) {
    liveGuardrail = check(fresh, plan.primary, config, attempts);
  }

  if (plan.skipped_negative_ev) {
    liveGuardrail = {
      allow: false,
      reason_code: "NEGATIVE_EV_STOP",
      bound_checked: `EV of ${plan.primary} is negative — skip outreach`,
    };
  }

  // Guardrail blocked — no execution
  if (!liveGuardrail.allow) {
    writeAuditLog({
      event_id: event.event_id,
      diagnosis,
      guardrail: liveGuardrail,
      plan,
      outcome: determineBlockedOutcome(liveGuardrail.reason_code),
      amount: event.amount,
      razorpay_ref: null,
      ai_source: aiSource,
      simulated: false,
    });

    // Update event status
    const newStatus =
      liveGuardrail.reason_code === "HUMAN_HANDOFF_THRESHOLD" ? "escalated" :
      liveGuardrail.reason_code === "DISPUTE_KILL_SWITCH" || liveGuardrail.reason_code === "MANDATE_REVOKED_STOP" || liveGuardrail.reason_code === "PTP_DISPUTE_KILL" || liveGuardrail.reason_code === "NEGATIVE_EV_STOP" ? "blocked" :
      "pending";

    db.updateEventStatus(event.event_id, newStatus === "pending" && (liveGuardrail.reason_code === "ATTEMPT_CAP_EXCEEDED" || liveGuardrail.reason_code === "MANDATE_REVOKED_STOP") ? "blocked" : newStatus);

    return {
      outcome: determineBlockedOutcome(liveGuardrail.reason_code),
      razorpay_ref: null,
      razorpay_url: null,
      simulated: false,
      needs_payment: false,
    };
  }

  // ── Increment attempt counter ─────────────────────────────────────────────
  const isSilent = plan.primary === "silent_retry" || plan.primary === "multi_acquirer_reroute";
  db.incrementAttempt(event.event_id, isSilent);

  // ── Execute intervention via Razorpay ─────────────────────────────────────
  let razorpay_ref: string | null = null;
  let razorpay_url: string | null = null;
  let simulated = false;

  try {
    const result = await callRazorpay(event, plan);
    razorpay_ref = result?.id ?? null;
    razorpay_url = result?.short_url ?? null;
    simulated = (result as any)?._simulated ?? false;
  } catch (err) {
    // If Razorpay call fails, fall back to simulated ref
    console.error(`Razorpay call failed for ${event.event_id}:`, err);
    const sim = simulatedPaymentLink(event.event_id);
    razorpay_ref = sim.id;
    razorpay_url = sim.short_url;
    simulated = true;
  }

  // ── Determine outcome ─────────────────────────────────────────────────────
  // For interventions that need customer action (payment links, checkouts),
  // we set status to in_progress and wait for the customer to pay via /pay/[id].
  // Silent/internal actions (retries, escalations) resolve immediately.
  const needsCustomerAction = CUSTOMER_ACTION_INTERVENTIONS.has(plan.primary);

  let outcome: AuditOutcome;
  let newEventStatus: RecoveryEvent["status"];

  if (plan.primary === "human_handoff") {
    outcome = "escalated";
    newEventStatus = "escalated";
  } else if (plan.primary === "dispute_stop") {
    outcome = "blocked";
    newEventStatus = "blocked";
  } else if (needsCustomerAction) {
    // Awaiting customer to complete checkout — not yet recovered
    outcome = "pending";
    newEventStatus = "in_progress";
  } else {
    // Silent retries / internal actions — simulate outcome immediately
    const rate = CALIBRATION.intervention_success_rates[
      plan.primary as keyof typeof CALIBRATION.intervention_success_rates
    ] ?? 0.3;
    const recovered = event.ground_truth_recoverable && Math.random() < rate;
    outcome = recovered ? "recovered" : "pending";
    newEventStatus = recovered ? "recovered" : "in_progress";
  }

  // ── Update event in DB ────────────────────────────────────────────────────
  db.updateEventStatus(event.event_id, newEventStatus, {
    razorpay_link_id: razorpay_ref ?? undefined,
  });

  // ── Write audit log ───────────────────────────────────────────────────────
  writeAuditLog({
    event_id: event.event_id,
    diagnosis,
    guardrail: liveGuardrail,
    plan,
    outcome,
    amount: event.amount,
    razorpay_ref,
    ai_source: aiSource,
    simulated,
  });

  return { outcome, razorpay_ref, razorpay_url, simulated, needs_payment: needsCustomerAction };
}

// ─── Razorpay API dispatch ────────────────────────────────────────────────────

async function callRazorpay(
  event: RecoveryEvent,
  plan: InterventionPlan,
): Promise<{ id: string; short_url: string; _simulated?: boolean } | null> {
  // If keys are not configured, use simulated responses
  if (!isKeysConfigured()) {
    return getSimulatedRef(event, plan.primary);
  }

  switch (plan.primary) {
    case "upi_fallback_link":
    case "card_update_link":
    case "guest_checkout_link":
    case "gentle_reminder":
    case "firm_reminder_payment_link":
    case "whatsapp_payment_link": {
      const link = await createPaymentLink({
        amount: event.amount,
        description: getInterventionDescription(plan.primary, event),
        customer: {
          name: event.customer_name,
          email: event.customer_email,
          contact: event.customer_phone,
        },
        method: plan.primary === "upi_fallback_link" ? "upi" : undefined,
        notes: {
          event_id: event.event_id,
          intervention: plan.primary,
          recovery_agent: "ai_recovery_v1",
        },
      });
      return link;
    }

    case "gentle_reminder":
    case "firm_reminder_payment_link":
      if (event.type === "invoice_overdue") {
        const inv = await createInvoice({
          customer_name: event.customer_name,
          customer_email: event.customer_email,
          customer_contact: event.customer_phone,
          amount: event.amount,
          description: `Invoice recovery — ${event.days_overdue} days overdue`,
          partial_payment: plan.secondary === "partial_payment",
          notes: {
            event_id: event.event_id,
            days_overdue: String(event.days_overdue),
          },
        });
        return inv;
      }
      // Fall through to payment link for non-invoice
      return createPaymentLink({
        amount: event.amount,
        description: getInterventionDescription(plan.primary, event),
        customer: {
          name: event.customer_name,
          email: event.customer_email,
          contact: event.customer_phone,
        },
        notes: { event_id: event.event_id, intervention: plan.primary },
      });

    case "partial_payment": {
      const order = await createOrder({
        amount: event.amount,
        partial_payment: true,
        first_payment_min_amount: Math.floor(event.amount * 0.5),
        receipt: `rcpt_${event.event_id}`,
        notes: { event_id: event.event_id, type: "partial_payment" },
      });
      return { id: order.id as string, short_url: `https://checkout.razorpay.com/${order.id}` };
    }

    case "emi_offer":
    case "payday_retry": {
      const link = await createPaymentLink({
        amount: event.amount,
        description: getInterventionDescription(plan.primary, event),
        customer: {
          name: event.customer_name,
          email: event.customer_email,
          contact: event.customer_phone,
        },
        notes: {
          event_id: event.event_id,
          intervention: plan.primary,
          recovery_agent: "ai_recovery_v1",
        },
      });
      return link;
    }

    case "silent_retry":
    case "multi_acquirer_reroute":
    case "promise_to_pay_capture":
    case "pre_expiry_alert":
    case "early_discount_offer":
    case "mandate_stop":
    case "human_handoff":
    case "dispute_stop":
      // These are queue/internal actions — no Razorpay call needed
      return null;

    default:
      return null;
  }
}

function getSimulatedRef(event: RecoveryEvent, intervention: string) {
  if (intervention.includes("link") || intervention.includes("reminder") || intervention === "payday_retry" || intervention === "emi_offer") {
    return simulatedPaymentLink(event.event_id);
  }
  if (intervention === "partial_payment") {
    return simulatedOrder(event.event_id, event.amount);
  }
  if (event.type === "invoice_overdue") {
    return simulatedInvoice(event.event_id);
  }
  return null;
}


function determineBlockedOutcome(
  reasonCode: string | null,
): AuditOutcome {
  if (reasonCode === "HUMAN_HANDOFF_THRESHOLD") return "escalated";
  return "blocked";
}

function getInterventionDescription(intervention: string, event: RecoveryEvent): string {
  const amountINR = (event.amount / 100).toLocaleString("en-IN");
  switch (intervention) {
    case "upi_fallback_link":
      return `Pay ₹${amountINR} via UPI — your card could not be charged`;
    case "card_update_link":
      return `Update your card to complete payment of ₹${amountINR}`;
    case "guest_checkout_link":
      return `Complete your purchase of ₹${amountINR} — no account needed`;
    case "gentle_reminder":
      return `Friendly reminder — ₹${amountINR} payment pending`;
    case "firm_reminder_payment_link":
      return `Action required — ₹${amountINR} is ${event.days_overdue} days overdue`;
    case "whatsapp_payment_link":
      return `Pay ₹${amountINR} via WhatsApp link`;
    default:
      return `Payment of ₹${amountINR} pending`;
  }
}

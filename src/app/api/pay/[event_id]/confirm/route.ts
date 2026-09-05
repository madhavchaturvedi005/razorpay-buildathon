import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPaymentSignature } from "@/lib/razorpay/signature";
import { isKeysConfigured } from "@/lib/razorpay/client";
import { writeAuditLog } from "@/lib/engine/audit";
import { diagnose } from "@/lib/engine/diagnosis";
import { decide } from "@/lib/engine/decision";
import { check } from "@/lib/engine/guardrail";

// POST /api/pay/[event_id]/confirm
// Called after Razorpay checkout succeeds (or simulated success)
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, simulated? }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ event_id: string }> },
) {
  const { event_id } = await params;
  const body = await req.json() as {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
    simulated?: boolean;
  };

  const event = db.getEvent(event_id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const payment_id = body.razorpay_payment_id ?? `sim_pay_${event_id}_${Date.now()}`;
  const order_id   = body.razorpay_order_id ?? `sim_order_${event_id}`;

  // Signature verification (only for real payments)
  if (!body.simulated && isKeysConfigured() && body.razorpay_signature) {
    const valid = verifyPaymentSignature({
      order_id,
      payment_id,
      signature: body.razorpay_signature,
    });
    if (!valid) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
    }
  }

  // Mark event as recovered
  db.updateEventStatus(event_id, "recovered", {
    razorpay_order_id: order_id,
    razorpay_link_id: payment_id,
  });

  // Write audit log
  const diagnosis = diagnose(event);
  const attempts  = db.getAttempts(event_id);
  const plan      = decide(diagnosis, attempts.count);
  const config    = db.getGuardrailConfig();
  const guardrail = check(event, plan.primary, config, attempts);

  writeAuditLog({
    event_id,
    diagnosis,
    guardrail,
    plan,
    outcome: "recovered",
    amount: event.amount,
    razorpay_ref: payment_id,
  });

  return NextResponse.json({
    success: true,
    payment_id,
    order_id,
    amount: event.amount,
    event_id,
    simulated: body.simulated ?? false,
  });
}

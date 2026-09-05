import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createOrder, isKeysConfigured, simulatedOrder } from "@/lib/razorpay/client";
import { writeAuditLog } from "@/lib/engine/audit";
import { diagnose } from "@/lib/engine/diagnosis";
import { decide } from "@/lib/engine/decision";
import { check } from "@/lib/engine/guardrail";

// GET /api/pay/[event_id]
// Returns event details + Razorpay order (or simulated order) for the checkout page
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ event_id: string }> },
) {
  const { event_id } = await params;
  const event = db.getEvent(event_id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const keysOk = isKeysConfigured();
  let order: { id: string; amount: number; currency: string; _simulated?: boolean } | null = null;

  if (keysOk) {
    try {
      const o = await createOrder({
        amount: event.amount,
        receipt: `rcpt_${event_id}_${Date.now()}`,
        notes: { event_id, recovery_agent: "ai_recovery_v1" },
      });
      order = { id: o.id as string, amount: event.amount, currency: "INR" };
    } catch (err) {
      console.error("Order creation failed:", err);
    }
  }

  if (!order) {
    const sim = simulatedOrder(event_id, event.amount);
    order = { id: sim.id, amount: event.amount, currency: "INR", _simulated: true };
  }

  return NextResponse.json({
    event,
    order,
    key_id: keysOk ? process.env.RAZORPAY_KEY_ID : null,
    simulated: !keysOk || (order as any)._simulated === true,
  });
}

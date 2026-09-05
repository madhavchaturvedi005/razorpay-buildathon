import type { Hono } from "hono";
import { db } from "@/lib/db";
import { createOrder, isKeysConfigured, simulatedOrder } from "@/lib/razorpay/client";
import { verifyPaymentSignature } from "@/lib/razorpay/signature";
import { writeAuditLog } from "@/lib/engine/audit";
import { diagnose } from "@/lib/engine/diagnosis";
import { decide } from "@/lib/engine/decision";
import { check } from "@/lib/engine/guardrail";

export function mountPay(app: Hono) {
  app.get("/api/pay/:event_id", async c => {
    const event_id = c.req.param("event_id");
    const event = db.getEvent(event_id);
    if (!event) return c.json({ error: "Event not found" }, 404);

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
    return c.json({
      event,
      order,
      key_id: keysOk ? process.env.RAZORPAY_KEY_ID : null,
      simulated: !keysOk || order._simulated === true,
    });
  });

  app.post("/api/pay/:event_id/confirm", async c => {
    const event_id = c.req.param("event_id");
    const body = await c.req.json() as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      simulated?: boolean;
    };
    const event = db.getEvent(event_id);
    if (!event) return c.json({ error: "Event not found" }, 404);

    const payment_id = body.razorpay_payment_id ?? `sim_pay_${event_id}_${Date.now()}`;
    const order_id = body.razorpay_order_id ?? `sim_order_${event_id}`;

    if (!body.simulated && isKeysConfigured() && body.razorpay_signature) {
      const valid = verifyPaymentSignature({
        order_id,
        payment_id,
        signature: body.razorpay_signature,
      });
      if (!valid) return c.json({ error: "Signature verification failed" }, 400);
    }

    db.updateEventStatus(event_id, "recovered", {
      razorpay_order_id: order_id,
      razorpay_link_id: payment_id,
    });

    const diagnosis = diagnose(event);
    const attempts = db.getAttempts(event_id);
    const plan = decide(diagnosis, attempts.count);
    const config = db.getGuardrailConfig();
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

    return c.json({
      success: true,
      payment_id,
      order_id,
      amount: event.amount,
      event_id,
      simulated: body.simulated ?? false,
    });
  });
}

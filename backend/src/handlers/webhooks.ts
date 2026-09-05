import type { Hono } from "hono";
import { verifyWebhookSignature } from "@/lib/razorpay/signature";
import { isWebhookSecretConfigured } from "@/lib/razorpay/client";
import { db } from "@/lib/db";
import { writeBlockedAuditLog } from "@/lib/engine/audit";

export function mountWebhooks(app: Hono) {
  app.get("/api/webhooks/razorpay", c => c.json({
    status: "ok",
    webhook_secret_configured: isWebhookSecretConfigured(),
    demo_simulation: "POST with { _demo: true, event: 'payment.dispute.created', event_id: '...' }",
  }));

  app.post("/api/webhooks/razorpay", async c => {
    const rawBody = await c.req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (body._demo === true) return handleDemo(body);

    const signature = c.req.header("x-razorpay-signature") ?? "";
    if (!isWebhookSecretConfigured()) {
      console.warn("RAZORPAY_WEBHOOK_SECRET not configured, skipping signature verification");
    } else if (!verifyWebhookSignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET ?? "")) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    return handleReal(body);
  });
}

function handleDemo(body: Record<string, unknown>) {
  const event_type = body.event as string;
  const event_id = (body.event_id as string) ?? "demo_001";
  const event = db.getEvent(event_id);
  if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

  switch (event_type) {
    case "payment.failed":
      db.updateEventStatus(event_id, "failed");
      return Response.json({ handled: true, event: event_type, message: "Payment marked as failed." });
    case "payment.captured":
      db.updateEventStatus(event_id, "recovered");
      return Response.json({ handled: true, event: event_type, message: "Payment captured — event marked as recovered." });
    case "payment.dispute.created":
      db.setDisputeFlag(event_id);
      writeBlockedAuditLog({
        event_id,
        diagnosis: "dispute_flagged",
        reason_code: "DISPUTE_KILL_SWITCH",
        bound_checked: "dispute_flag=true | ALL AUTOMATED CONTACT STOPPED — RBI §454Z",
        amount: event.amount,
      });
      return Response.json({
        handled: true,
        event: event_type,
        message: "Dispute flag set. All automated contact stopped immediately. Audit log written.",
      });
    default:
      return Response.json({ handled: false, event: event_type });
  }
}

function handleReal(body: Record<string, unknown>) {
  const event_type = body.event as string;
  const payload = body.payload as Record<string, unknown>;
  switch (event_type) {
    case "payment.failed":
    case "payment.captured": {
      const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown>;
      const notes = payment?.notes as Record<string, string> | undefined;
      const event_id = notes?.event_id;
      if (event_id) {
        db.updateEventStatus(event_id, event_type === "payment.captured" ? "recovered" : "failed");
      }
      break;
    }
    case "payment.dispute.created": {
      const dispute = (payload?.dispute as Record<string, unknown>)?.entity as Record<string, unknown>;
      console.log("Dispute created for payment:", dispute?.payment_id);
      break;
    }
  }
  return Response.json({ handled: true, event: event_type });
}

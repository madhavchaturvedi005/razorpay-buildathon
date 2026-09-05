import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay/signature";
import { isWebhookSecretConfigured } from "@/lib/razorpay/client";
import { db } from "@/lib/db";
import { writeBlockedAuditLog } from "@/lib/engine/audit";

// POST /api/webhooks/razorpay
// Handles real Razorpay webhook events + demo simulation trigger.
//
// Real webhooks: sent by Razorpay, signed with HMAC-SHA256
// Demo simulation: POST with body { _demo: true, event: "payment.failed" | "payment.dispute.created", event_id: string }

export async function POST(req: Request) {
  const rawBody = await req.text();

  // Check if this is a demo simulation request
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body._demo === true) {
    return handleDemoSimulation(body);
  }

  // Real webhook — verify signature
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  if (!isWebhookSecretConfigured()) {
    console.warn("RAZORPAY_WEBHOOK_SECRET not configured, skipping signature verification");
  } else {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
    const valid = verifyWebhookSignature(rawBody, signature, secret);
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  return handleRealWebhook(body);
}

async function handleDemoSimulation(body: Record<string, unknown>) {
  const event_type = body.event as string;
  const event_id = body.event_id as string ?? "demo_001";

  const event = db.getEvent(event_id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  switch (event_type) {
    case "payment.failed":
      db.updateEventStatus(event_id, "failed");
      return NextResponse.json({
        handled: true,
        event: event_type,
        message: "Payment marked as failed. Recovery pipeline will process.",
      });

    case "payment.captured":
      db.updateEventStatus(event_id, "recovered");
      return NextResponse.json({
        handled: true,
        event: event_type,
        message: "Payment captured — event marked as recovered.",
      });

    case "payment.dispute.created": {
      db.setDisputeFlag(event_id);
      writeBlockedAuditLog({
        event_id,
        diagnosis: "dispute_flagged",
        reason_code: "DISPUTE_KILL_SWITCH",
        bound_checked: "dispute_flag=true | ALL AUTOMATED CONTACT STOPPED — RBI §454Z",
        amount: event.amount,
      });
      return NextResponse.json({
        handled: true,
        event: event_type,
        message: "Dispute flag set. All automated contact stopped immediately. Audit log written.",
      });
    }

    default:
      return NextResponse.json({ handled: false, event: event_type });
  }
}

async function handleRealWebhook(body: Record<string, unknown>) {
  const event_type = body.event as string;
  const payload = body.payload as Record<string, unknown>;

  switch (event_type) {
    case "payment.failed": {
      const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown>;
      const notes = payment?.notes as Record<string, string> | undefined;
      const event_id = notes?.event_id;
      if (event_id) {
        db.updateEventStatus(event_id, "failed");
      }
      break;
    }

    case "payment.captured": {
      const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown>;
      const notes = payment?.notes as Record<string, string> | undefined;
      const event_id = notes?.event_id;
      if (event_id) {
        db.updateEventStatus(event_id, "recovered");
      }
      break;
    }

    case "payment.dispute.created": {
      const dispute = (payload?.dispute as Record<string, unknown>)?.entity as Record<string, unknown>;
      const payment_id = dispute?.payment_id as string;
      if (payment_id) {
        // Find event by razorpay refs — best effort
        console.log("Dispute created for payment:", payment_id);
      }
      break;
    }
  }

  return NextResponse.json({ handled: true, event: event_type });
}

// GET — webhook health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    webhook_secret_configured: !!process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET !== "your_webhook_secret_here",
    demo_simulation: "POST with { _demo: true, event: 'payment.dispute.created', event_id: '...' }",
  });
}

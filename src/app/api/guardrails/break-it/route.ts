import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkBreakIt, type BreakItScenario } from "@/lib/engine/guardrail";
import { writeBlockedAuditLog } from "@/lib/engine/audit";
import type { DiagnosisTag } from "@/lib/types";

// POST /api/guardrails/break-it
// Simulates a guardrail violation for the live demo panel.
// Body: { scenario: "out_of_window" | "attempt_cap" | "discount_cap" | "dispute_flag", event_id?: string }
export async function POST(req: Request) {
  const body = await req.json() as {
    scenario: BreakItScenario;
    event_id?: string;
  };

  const config = db.getGuardrailConfig();
  const result = checkBreakIt(body.scenario, config);

  // Write an audit log for this blocked attempt so it appears in the log table
  const eventId = body.event_id ?? "demo_001";
  const event = db.getEvent(eventId);

  const diagnosis: DiagnosisTag =
    body.scenario === "dispute_flag" ? "dispute_flagged" :
    body.scenario === "out_of_window" ? "insufficient_funds" :
    "invoice_day_16_45";

  writeBlockedAuditLog({
    event_id: eventId,
    diagnosis,
    reason_code: result.reason_code!,
    bound_checked: result.bound_checked,
    amount: event?.amount ?? 420000,
  });

  // If scenario is dispute_flag and an event_id is given, actually set the flag
  if (body.scenario === "dispute_flag" && event) {
    db.setDisputeFlag(eventId);
  }

  return NextResponse.json({
    scenario: body.scenario,
    guardrail_result: result,
    message: getScenarioMessage(body.scenario),
    audit_written: true,
  });
}

function getScenarioMessage(scenario: BreakItScenario): string {
  switch (scenario) {
    case "out_of_window":
      return "Agent tried to send a nudge at 21:00 — blocked. Contact window is 08:00–19:00 (RBI §32.1O).";
    case "attempt_cap":
      return "Agent tried to make a 6th contact attempt — blocked. Hard stop at 5 attempts per event.";
    case "discount_cap":
      return "Agent tried to offer a 20% discount — blocked. Policy cap is 5%. Human approval required.";
    case "dispute_flag":
      return "Dispute flag detected — ALL automated contact stopped immediately. RBI §454Z: continued contact = harsh practice.";
    case "ptp_window":
      return "Customer promised a date outside the merchant PTP window. Promise not captured — same rule as the live call.";
  }
}

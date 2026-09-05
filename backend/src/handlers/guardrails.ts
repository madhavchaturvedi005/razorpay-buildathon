import type { Hono } from "hono";
import { db } from "@/lib/db";
import { checkBreakIt, type BreakItScenario } from "@/lib/engine/guardrail";
import { writeBlockedAuditLog } from "@/lib/engine/audit";
import { DEFAULT_GUARDRAIL_CONFIG, type DiagnosisTag, type GuardrailConfig } from "@/lib/types";

export function mountGuardrails(app: Hono) {
  app.get("/api/guardrails", c => c.json(db.getGuardrailConfig()));

  app.patch("/api/guardrails", async c => {
    const body = await c.req.json() as Partial<GuardrailConfig>;
    return c.json(db.updateGuardrailConfig(body));
  });

  app.post("/api/guardrails", c => {
    const updated = db.updateGuardrailConfig(DEFAULT_GUARDRAIL_CONFIG);
    return c.json({ reset: true, config: updated });
  });

  app.post("/api/guardrails/break-it", async c => {
    const body = await c.req.json() as { scenario: BreakItScenario; event_id?: string };
    const config = db.getGuardrailConfig();
    const result = checkBreakIt(body.scenario, config);
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
    if (body.scenario === "dispute_flag" && event) db.setDisputeFlag(eventId);

    return c.json({
      scenario: body.scenario,
      guardrail_result: result,
      message: message(body.scenario),
      audit_written: true,
    });
  });
}

function message(scenario: BreakItScenario): string {
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

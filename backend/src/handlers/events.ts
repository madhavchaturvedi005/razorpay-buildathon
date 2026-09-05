import type { Hono } from "hono";
import { db } from "@/lib/db";
import { isAtRisk } from "@/lib/engine/detection";
import { diagnoseDetailed } from "@/lib/engine/diagnosis";
import { decideWithEv } from "@/lib/engine/decision";
import { check } from "@/lib/engine/guardrail";
import { execute } from "@/lib/engine/execution";
import { contactTier, TIER_LABEL } from "@/lib/engine/tier";

export function mountEvents(app: Hono) {
  app.get("/api/events", c => {
    const q = new URL(c.req.url).searchParams;
    const type = q.get("type") ?? undefined;
    const status = q.get("status") ?? undefined;
    const limit = parseInt(q.get("limit") ?? "50");
    const offset = parseInt(q.get("offset") ?? "0");
    const events = db.listEvents({ type, status, limit, offset });
    return c.json({ events, counts: db.countEvents(), limit, offset });
  });

  app.post("/api/events/:id/recover", async c => {
    const id = c.req.param("id");
    const event = db.getEvent(id);
    if (!event) return c.json({ error: "Event not found" }, 404);
    if (!isAtRisk(event)) {
      return c.json({ error: "Event is not at-risk or already processed", status: event.status }, 400);
    }

    const diagnosis = await diagnoseDetailed(event);
    const attempts = db.getAttempts(id);
    const { plan, candidates } = decideWithEv(diagnosis.tag, attempts.count, event.amount);
    const config = db.getGuardrailConfig();
    const guardrail = check(event, plan.primary, config, attempts);
    const result = await execute(event, plan, guardrail, diagnosis.tag, diagnosis.source);
    const updatedEvent = db.getEvent(id);
    const auditLogs = db.listAuditLogs({ event_id: id, limit: 1 });
    const tier = contactTier(plan.primary);

    return c.json({
      event_id: id,
      diagnosis: diagnosis.tag,
      diagnosis_result: diagnosis,
      ai_used: diagnosis.source,
      tier,
      tier_label: TIER_LABEL[tier],
      plan,
      ev_candidates: candidates,
      guardrail_result: {
        allow: guardrail.allow,
        reason_code: guardrail.reason_code,
        bound_checked: guardrail.bound_checked,
      },
      execution: result,
      latest_audit: auditLogs[0] ?? null,
      updated_event: updatedEvent,
    });
  });
}

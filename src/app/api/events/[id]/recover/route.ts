import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAtRisk } from "@/lib/engine/detection";
import { diagnoseDetailed } from "@/lib/engine/diagnosis";
import { decideWithEv } from "@/lib/engine/decision";
import { check } from "@/lib/engine/guardrail";
import { execute } from "@/lib/engine/execution";
import { contactTier, TIER_LABEL } from "@/lib/engine/tier";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const event = db.getEvent(id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!isAtRisk(event)) {
    return NextResponse.json({
      error: "Event is not at-risk or already processed",
      status: event.status,
    }, { status: 400 });
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

  return NextResponse.json({
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
}

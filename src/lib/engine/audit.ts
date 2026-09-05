import type {
  AuditLog,
  AuditOutcome,
  DiagnosisTag,
  InterventionType,
  ReasonCode,
  GuardrailResult,
  InterventionPlan,
  AiSource,
} from "../types";
import { REASON_CODE_DESCRIPTIONS } from "../types";
import { db } from "../db";
import { INTERVENTION_REASON_CODE } from "./decision";

// ─── Audit log writer ─────────────────────────────────────────────────────────
// Every action (allowed OR blocked) writes an audit entry onto the hash chain.

export interface WriteAuditParams {
  event_id: string;
  diagnosis: DiagnosisTag;
  guardrail: GuardrailResult;
  plan: InterventionPlan;
  outcome: AuditOutcome;
  amount: number;
  razorpay_ref?: string | null;
  ai_source?: AiSource;
  simulated?: boolean;
}

function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function writeAuditLog(params: WriteAuditParams): AuditLog {
  const {
    event_id, diagnosis, guardrail, plan, outcome, amount, razorpay_ref,
    ai_source, simulated,
  } = params;

  const reason_code: ReasonCode = guardrail.allow
    ? getSuccessReasonCode(plan.primary)
    : (guardrail.reason_code as ReasonCode);

  const log: AuditLog = {
    log_id: generateLogId(),
    event_id,
    diagnosis,
    reason_code,
    plain_english: REASON_CODE_DESCRIPTIONS[reason_code] ?? "Action logged",
    intervention: guardrail.allow ? plan.primary : "none",
    secondary_offered: plan.secondary ?? null,
    bound_checked: guardrail.bound_checked,
    outcome,
    amount,
    razorpay_ref: razorpay_ref ?? null,
    timestamp: new Date().toISOString(),
    ai_source: ai_source ?? "rules",
    simulated: simulated ?? false,
  };

  db.insertAuditLog(log);
  return db.listAuditLogs({ event_id, limit: 1 })[0] ?? log;
}

function getSuccessReasonCode(intervention: InterventionType): ReasonCode {
  return INTERVENTION_REASON_CODE[intervention] ?? "GENTLE_REMINDER_SENT";
}

export function writeBlockedAuditLog(params: {
  event_id: string;
  diagnosis: DiagnosisTag;
  reason_code: ReasonCode;
  bound_checked: string;
  amount: number;
  ai_source?: AiSource;
}): AuditLog {
  const log: AuditLog = {
    log_id: generateLogId(),
    event_id: params.event_id,
    diagnosis: params.diagnosis,
    reason_code: params.reason_code,
    plain_english: REASON_CODE_DESCRIPTIONS[params.reason_code] ?? "Action blocked",
    intervention: "none",
    secondary_offered: null,
    bound_checked: params.bound_checked,
    outcome: "blocked",
    amount: params.amount,
    razorpay_ref: null,
    timestamp: new Date().toISOString(),
    ai_source: params.ai_source ?? "rules",
    simulated: false,
  };
  db.insertAuditLog(log);
  return db.listAuditLogs({ event_id: params.event_id, limit: 1 })[0] ?? log;
}

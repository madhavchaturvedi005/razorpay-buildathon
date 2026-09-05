import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog, writeBlockedAuditLog } from "@/lib/engine/audit";
import { evaluatePtpPolicy } from "@/lib/engine/ptp-policy";
import type { PtpExtract, PromiseToPay } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json() as {
    event_id?: string;
    customer_name?: string;
    transcript?: string;
    extract?: PtpExtract;
  };

  const extract = body.extract;
  if (!extract || !body.transcript) {
    return NextResponse.json({ error: "extract + transcript required" }, { status: 400 });
  }

  const event = body.event_id ? db.getEvent(body.event_id) : null;
  const customer = body.customer_name || event?.customer_name || "Unknown";
  const amount = event?.amount ?? extract.promised_amount_paise ?? 0;

  const ptp: PromiseToPay = {
    ptp_id: `ptp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    event_id: event?.event_id ?? null,
    customer_name: customer,
    transcript: body.transcript,
    intent: extract.intent,
    promised_date: extract.promised_date,
    promised_amount_paise: extract.promised_amount_paise,
    hardship: extract.hardship,
    do_not_call_until: extract.do_not_call_until,
    dispute_language: extract.dispute_language,
    confidence: extract.confidence,
    source: extract.source,
    status: extract.dispute_language || extract.intent === "complaint" ? "killed" : "open",
    created_at: new Date().toISOString(),
  };

  const policy = evaluatePtpPolicy(extract.promised_date, db.getGuardrailConfig().ptp_max_days);

  if (extract.intent === "promise_to_pay" && !policy.allowed) {
    writeBlockedAuditLog({
      event_id: event?.event_id ?? "voice_orphan",
      diagnosis: "invoice_day_16_45",
      reason_code: "PTP_OUTSIDE_POLICY",
      bound_checked: `promised_date=${extract.promised_date ?? "none"} days=${policy.days_until} cap=${policy.max_days}d | not captured`,
      amount,
      ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
    });
    return NextResponse.json({
      committed: null,
      kill_switch: false,
      policy,
      message: policy.reason === "outside_window"
        ? `Merchant policy allows payment within ${policy.max_days} days. ${policy.days_until} days is outside the window — promise not captured.`
        : `Need a date inside the ${policy.max_days}-day merchant window.`,
    });
  }

  db.insertPromise(ptp);

  if (extract.dispute_language || extract.intent === "complaint") {
    if (event) db.setDisputeFlag(event.event_id);
    writeBlockedAuditLog({
      event_id: event?.event_id ?? "voice_orphan",
      diagnosis: "dispute_flagged",
      reason_code: "PTP_DISPUTE_KILL",
      bound_checked: `voice extract intent=${extract.intent} dispute_language=true | RBI §454Z`,
      amount,
      ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
    });
    return NextResponse.json({
      committed: ptp,
      kill_switch: true,
      message: "Dispute language detected. All automated contact halted.",
    });
  }

  if (extract.intent === "promise_to_pay") {
    writeAuditLog({
      event_id: event?.event_id ?? "voice_orphan",
      diagnosis: "invoice_day_16_45",
      guardrail: {
        allow: true,
        reason_code: null,
        bound_checked: `promised_date=${extract.promised_date ?? "unset"} within ${policy.max_days}d merchant policy | single check-back only`,
      },
      plan: { primary: "promise_to_pay_capture", secondary: null },
      outcome: "pending",
      amount,
      ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
      simulated: true,
    });
  }

  return NextResponse.json({
    committed: ptp,
    kill_switch: false,
    message: extract.intent === "promise_to_pay"
      ? "Promise captured. One check-back on the promised date, then human if broken."
      : `Logged as ${extract.intent}. No further automated contact from this turn.`,
  });
}

export async function GET() {
  return NextResponse.json({ promises: db.listPromises(50) });
}

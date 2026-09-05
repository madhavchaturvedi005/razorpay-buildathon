import { NextResponse } from "next/server";
import { extractPtpWithLlm, llmConfigured } from "@/lib/engine/llm";
import { CANNED_CALLS } from "@/lib/engine/ptp";
import { db } from "@/lib/db";

export async function GET() {
  return NextResponse.json({
    canned: CANNED_CALLS,
    llm_configured: llmConfigured(),
    promises: db.listPromises(30),
    calls: db.listCallSessions(20),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    transcript?: string;
    amount_paise?: number;
    canned_id?: string;
  };

  let transcript = body.transcript?.trim() ?? "";
  let amount = body.amount_paise ?? 420000;

  if (body.canned_id) {
    const canned = CANNED_CALLS.find(c => c.id === body.canned_id);
    if (canned) {
      transcript = canned.transcript;
      amount = canned.amount_paise;
    }
  }

  if (!transcript) {
    return NextResponse.json({ error: "transcript required" }, { status: 400 });
  }

  const extract = await extractPtpWithLlm(transcript, amount);

  return NextResponse.json({
    transcript,
    amount_paise: amount,
    extract,
    llm_configured: llmConfigured(),
    policy: "AI proposes structured fields. Guardrail decides whether contact continues.",
  });
}

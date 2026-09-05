import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { GuardrailConfig } from "@/lib/types";

// GET /api/guardrails — read current config
export async function GET() {
  const config = db.getGuardrailConfig();
  return NextResponse.json(config);
}

// PATCH /api/guardrails — update config
export async function PATCH(req: Request) {
  const body = await req.json() as Partial<GuardrailConfig>;
  const updated = db.updateGuardrailConfig(body);
  return NextResponse.json(updated);
}

// POST /api/guardrails — reset to defaults
export async function POST() {
  const { DEFAULT_GUARDRAIL_CONFIG } = await import("@/lib/types");
  const updated = db.updateGuardrailConfig(DEFAULT_GUARDRAIL_CONFIG);
  return NextResponse.json({ reset: true, config: updated });
}

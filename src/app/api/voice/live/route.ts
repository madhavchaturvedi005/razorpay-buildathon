import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { llmConfigured } from "@/lib/engine/llm";

export async function GET() {
  return NextResponse.json({
    llm_configured: llmConfigured(),
    promises: db.listPromises(40),
    calls: db.listCallSessions(20),
  });
}

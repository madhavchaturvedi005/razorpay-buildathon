import { NextResponse } from "next/server";
import { geminiConfigured, geminiLiveModel } from "@/lib/engine/gemini";

export async function GET() {
  return NextResponse.json({
    configured: geminiConfigured(),
    model: geminiLiveModel(),
    provider: "gemini",
    transport: "websocket",
  });
}

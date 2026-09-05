import { NextResponse } from "next/server";
import { geminiConfigured, geminiLiveModel } from "@/lib/engine/gemini";
import { mintLiveSession } from "@/lib/voice/mint-live-session";

export async function GET() {
  return NextResponse.json({
    configured: geminiConfigured(),
    model: geminiLiveModel(),
    provider: "gemini",
    transport: "websocket",
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    scenario?: string;
    amount_paise?: number;
    customer_name?: string;
  };
  const minted = await mintLiveSession(body);
  if ("error" in minted) {
    return NextResponse.json(minted, { status: 400 });
  }
  return NextResponse.json(minted);
}

import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/voice/tts";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { text?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const spoken = await synthesizeSpeech(text);
  if (!spoken.ok) {
    return NextResponse.json({ fallback: true });
  }
  return new NextResponse(new Uint8Array(spoken.bytes), {
    headers: {
      "Content-Type": spoken.contentType,
      "Cache-Control": "no-store",
    },
  });
}

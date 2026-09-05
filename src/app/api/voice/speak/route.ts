import { NextResponse } from "next/server";
import { llmConfig, llmConfigured } from "@/lib/engine/llm";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { text?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (!llmConfigured()) {
    return NextResponse.json({ fallback: true });
  }

  const { key, base } = llmConfig();
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_TTS_MODEL || "tts-1-hd",
      voice: process.env.LLM_TTS_VOICE || "coral",
      speed: 0.97,
      input: text.slice(0, 4000),
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ fallback: true });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(buf, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { llmConfig, llmConfigured } from "@/lib/engine/llm";

export async function POST(req: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: "LLM_API_KEY / OPENAI_API_KEY not set" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }

  const { key, base } = llmConfig();
  const out = new FormData();
  out.append("model", process.env.LLM_STT_MODEL || "whisper-1");
  out.append("file", file, "speech.webm");
  out.append("language", "hi");

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err.slice(0, 400) }, { status: 502 });
  }
  const data = await res.json() as { text?: string };
  return NextResponse.json({ text: data.text ?? "" });
}

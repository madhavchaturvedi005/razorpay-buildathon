import { geminiApiKey, geminiLiveVoice } from "@/lib/engine/gemini";
import { llmConfig, llmConfigured } from "@/lib/engine/llm";

export type TtsResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false };

const GEMINI_TTS_MODELS = [
  process.env.GEMINI_TTS_MODEL,
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
].filter((m, i, all): m is string => Boolean(m) && all.indexOf(m) === i);

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sampleRateFromMime(mime: string): number {
  const m = mime.match(/rate=(\d+)/i);
  return m ? Number(m[1]) : 24000;
}

async function openaiSpeech(text: string): Promise<TtsResult> {
  if (!llmConfigured()) return { ok: false };
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
  if (!res.ok) return { ok: false };
  return {
    ok: true,
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}

async function geminiSpeech(text: string): Promise<TtsResult> {
  const key = geminiApiKey();
  if (!key) return { ok: false };
  const voice = geminiLiveVoice();
  const prompt = `Speak this in a natural Indian Hinglish voice, calm female collections agent, no extra words:\n${text.slice(0, 3500)}`;

  for (const model of GEMINI_TTS_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            },
          }),
        },
      );
      if (!res.ok) continue;
      const json = await res.json() as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mimeType?: string } }[] } }[];
      };
      const part = json.candidates?.[0]?.content?.parts?.[0];
      const inline = part?.inlineData ?? part?.inline_data;
      if (!inline?.data) continue;
      const mime = inline.mimeType || "audio/L16;codec=pcm;rate=24000";
      const raw = Buffer.from(inline.data, "base64");
      if (/wav|mpeg|mp3|ogg/i.test(mime)) {
        return { ok: true, bytes: raw, contentType: mime };
      }
      return {
        ok: true,
        bytes: pcm16ToWav(raw, sampleRateFromMime(mime)),
        contentType: "audio/wav",
      };
    } catch {
      continue;
    }
  }
  return { ok: false };
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  const gemini = await geminiSpeech(text);
  if (gemini.ok) return gemini;
  return openaiSpeech(text);
}

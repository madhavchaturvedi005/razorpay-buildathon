import { geminiApiKey, geminiLiveModel, geminiLiveModelCandidates } from "@/lib/engine/gemini";
import { geminiLiveSetup, realtimeCallContext } from "@/lib/voice/realtime-config";

export type LiveAttempt = {
  ws_url: string;
  setup: Record<string, unknown>;
  model: string;
  via: string;
};

function constrainedUrl(token: string): string {
  // Do not encode slashes in auth_tokens/<id> — Google treats %2F as a path break.
  const value = token.startsWith("auth_tokens/") ? token : encodeURIComponent(token);
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${value}`;
}

async function mintEphemeralToken(key: string): Promise<string | null> {
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const bodies: unknown[] = [
    { uses: 1, expireTime, newSessionExpireTime },
    { authToken: { uses: 1, expireTime, newSessionExpireTime } },
  ];
  const urls = [
    `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(key)}`,
    "https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
  ];

  for (const url of urls) {
    for (const body of bodies) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) continue;
        const parsed = JSON.parse(text) as { name?: string; token?: string; authToken?: { name?: string } };
        const name = parsed.name || parsed.token || parsed.authToken?.name;
        if (name) return name;
      } catch {
        /* try next shape */
      }
    }
  }
  return null;
}

function slimSetup(setup: Record<string, unknown>): Record<string, unknown> {
  const generationConfig = (setup.generationConfig ?? {}) as Record<string, unknown>;
  const speechConfig = (generationConfig.speechConfig ?? {}) as Record<string, unknown>;
  const voiceConfig = (speechConfig.voiceConfig ?? {}) as Record<string, unknown>;
  return {
    model: setup.model,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig },
    },
    systemInstruction: setup.systemInstruction,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export async function mintLiveSession(body: {
  scenario?: string;
  amount_paise?: number;
  customer_name?: string;
}): Promise<{ token: string; model: string; ws_url: string; setup: Record<string, unknown>; attempts: LiveAttempt[] } | { error: string; detail: string }> {
  const key = geminiApiKey();
  if (!key) {
    return {
      error: "GEMINI_API_KEY missing",
      detail: "Add GEMINI_API_KEY from Google AI Studio to .env.local and restart next dev.",
    };
  }

  const ctx = realtimeCallContext({
    scenario: body.scenario,
    amount: body.amount_paise,
    customer: body.customer_name,
  });
  const models = geminiLiveModelCandidates().slice(0, 2);
  const token = await mintEphemeralToken(key);
  const attempts: LiveAttempt[] = [];
  // Never ship the raw API key to the browser WebSocket. Railway / production
  // origins get blocked by AI Studio referrer rules, and the key would leak.
  if (token) {
    for (const model of models) {
      const slim = slimSetup(geminiLiveSetup({ ...ctx, model }));
      attempts.push({ ws_url: constrainedUrl(token), setup: slim, model, via: "token-v1alpha" });
    }
  }

  const first = attempts[0];
  if (!first) {
    return {
      error: "Gemini Live websocket unavailable",
      detail: "Ephemeral token mint failed. Call audio will use server TTS instead of a browser Live socket.",
    };
  }

  return {
    token,
    model: geminiLiveModel(),
    ws_url: first.ws_url,
    setup: first.setup,
    attempts,
  };
}

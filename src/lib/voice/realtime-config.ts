import { db } from "@/lib/db";
import { offersForScenario, realtimeInstructions } from "@/lib/engine/apply-call";
import { geminiLiveModel, geminiLiveVoice } from "@/lib/engine/gemini";

export function realtimeCallContext(params: {
  scenario?: string | null;
  amount?: number | null;
  customer?: string | null;
}) {
  const scenario = params.scenario || "abandoned_cart";
  const amount = params.amount || 329900;
  const customer = params.customer || "Arjun Sharma";
  return {
    scenario,
    amount,
    customer,
    firstName: customer.split(" ")[0] ?? "ji",
    maxDays: db.getGuardrailConfig().ptp_max_days,
  };
}

export function geminiFunctionDeclarations(params: {
  scenario: string;
  amount: number;
}): Record<string, unknown>[] {
  const offerIds = offersForScenario(params.scenario, params.amount).map(o => o.offer_id);
  const fns: Record<string, unknown>[] = [
    {
      name: "commit_customer_intent",
      description: "Commit what the customer said so merchant systems update. Call this when they promise a date, dispute, or report hardship.",
      parameters: {
        type: "object",
        properties: {
          utterance: { type: "string", description: "Verbatim customer sentence" },
        },
        required: ["utterance"],
      },
    },
  ];
  if (offerIds.length) {
    fns.push({
      name: "accept_offer",
      description: "Execute a merchant-approved offer the customer accepted. Returns the real coupon code, amount, or payment link to read back.",
      parameters: {
        type: "object",
        properties: {
          offer_id: { type: "string", enum: offerIds },
        },
        required: ["offer_id"],
      },
    });
  }
  return fns;
}

export function geminiLiveSetup(params: {
  scenario: string;
  amount: number;
  firstName: string;
  maxDays: number;
  model?: string;
}): Record<string, unknown> {
  return {
    model: `models/${params.model || geminiLiveModel()}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: geminiLiveVoice() },
        },
      },
    },
    systemInstruction: {
      parts: [{
        text: realtimeInstructions({
          firstName: params.firstName,
          amountPaise: params.amount,
          scenario: params.scenario,
          maxDays: params.maxDays,
        }),
      }],
    },
    tools: [{ functionDeclarations: geminiFunctionDeclarations(params) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

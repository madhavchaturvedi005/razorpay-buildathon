import type { DiagnosisTag, PtpExtract } from "../types";
import { parseIssuerString } from "./issuer";
import { extractPtpRules } from "./ptp";

// Optional live LLM. The agent is LLM-absent-safe: no key ⇒ degraded corpus/rules.
// The model never authors an amount, link, deadline, or UPI handle.

export function llmConfig() {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    key,
    base: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  };
}

export function llmConfigured(): boolean {
  return Boolean(llmConfig().key);
}

async function chatJson(system: string, user: string): Promise<unknown | null> {
  const { key, base, model } = llmConfig();
  if (!key) return null;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const TAGS: DiagnosisTag[] = [
  "insufficient_funds",
  "expired_card",
  "gateway_timeout",
  "hard_decline",
  "subscription_upi_cancelled",
  "dispute_flagged",
];

export async function diagnoseIssuerWithLlm(raw: string): Promise<{
  tag: DiagnosisTag;
  confidence: number;
  rationale: string;
  source: "llm_tail" | "degraded";
}> {
  const fallback = parseIssuerString(raw);
  const parsed = await chatJson(
    `You classify Indian payment-issuer decline strings into one tag.
Allowed tags: ${TAGS.join(", ")}.
Return JSON: {"tag":"...","confidence":0-1,"rationale":"one sentence"}.
Never invent payment amounts or UPI ids. If unsure, tag gateway_timeout with confidence < 0.7.`,
    raw,
  );
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { tag?: string; confidence?: number; rationale?: string };
    if (obj.tag && (TAGS as string[]).includes(obj.tag)) {
      return {
        tag: obj.tag as DiagnosisTag,
        confidence: Math.min(1, Math.max(0, Number(obj.confidence) || 0.6)),
        rationale: obj.rationale || "LLM tail classification",
        source: "llm_tail",
      };
    }
  }
  return { ...fallback, source: "degraded" };
}

export async function extractPtpWithLlm(transcript: string, amountPaise: number): Promise<PtpExtract> {
  const fallback = extractPtpRules(transcript, amountPaise);
  const parsed = await chatJson(
    `You extract a structured promise-to-pay from Hinglish/Hindi/English collections replies.
Return JSON with keys:
intent: promise_to_pay | refuse | hardship | complaint | optout | unknown
promised_date: YYYY-MM-DD or null (resolve relative dates like "15 tarikh" or "N din / N days" against today)
promised_amount_paise: integer or null — if the customer did not name an amount, use ${amountPaise}
hardship: boolean
do_not_call_until: YYYY-MM-DD or null
dispute_language: true if they mention complaint, ombudsman, RBI, lawyer, police, fraud
confidence: 0-1
rationale: one sentence
NEVER invent a new amount. NEVER include a payment link or UPI handle.`,
    transcript,
  );
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const intent = String(obj.intent ?? "unknown") as PtpExtract["intent"];
    const allowed = ["promise_to_pay", "refuse", "hardship", "complaint", "optout", "unknown"];
    if (allowed.includes(intent)) {
      const amount = obj.promised_amount_paise == null
        ? amountPaise
        : Number(obj.promised_amount_paise);
      // Model must not author a different amount
      const safeAmount = Number.isFinite(amount) && Math.abs(amount - amountPaise) < 1
        ? amountPaise
        : amountPaise;
      return {
        intent,
        promised_date: obj.promised_date ? String(obj.promised_date) : null,
        promised_amount_paise: intent === "promise_to_pay" ? safeAmount : null,
        hardship: Boolean(obj.hardship) || intent === "hardship",
        do_not_call_until: obj.do_not_call_until ? String(obj.do_not_call_until) : null,
        dispute_language: Boolean(obj.dispute_language) || intent === "complaint",
        confidence: Math.min(1, Math.max(0, Number(obj.confidence) || 0.7)),
        rationale: String(obj.rationale ?? "LLM PTP extract"),
        source: "llm_ptp",
      };
    }
  }
  return fallback;
}

// Reflex: reject any model draft that contains a digit, URL, or ₹ span.
export function validateModelCopy(text: string): { ok: boolean; reason: string } {
  if (/https?:\/\//i.test(text) || /upi:\/\//i.test(text)) {
    return { ok: false, reason: "COPY_POLICY_BLOCKED: model authored a URL" };
  }
  if (/[₹]|rs\.?\s*\d/i.test(text) || /\d{2,}/.test(text)) {
    return { ok: false, reason: "COPY_POLICY_BLOCKED: model authored an amount or identifier" };
  }
  if (/legal action|cibil|police|your family|ombudsman|arrest/i.test(text)) {
    return { ok: false, reason: "COPY_POLICY_BLOCKED: harsh-practice language (RBI 32.1Z)" };
  }
  return { ok: true, reason: "copy policy passed — amounts injected from DB" };
}

export async function generateCallReply(params: {
  firstName: string;
  merchant: string;
  amountPaise: number;
  issue: string;
  maxDays: number;
  extract: PtpExtract | null;
  policyAllowed: boolean;
  policyReason: string;
  daysUntil: number | null;
  fallbackText: string;
  doneHint: boolean;
  scenario?: string;
  cartIntent?: string;
  couponCode?: string;
  couponPercent?: number;
}): Promise<{ text: string; live: boolean }> {
  const amt = `₹${(params.amountPaise / 100).toLocaleString("en-IN")}`;
  const isCart = params.scenario === "abandoned_cart";

  const cartSystem = `You are ${params.merchant}'s shopping assistant on a short courtesy call with ${params.firstName}.
This is NOT a collections call. They did NOT fail a payment. They left items in a cart.
LANGUAGE: Speak conversational Hindi (bol-chal Hindi / Hinglish). Devanagari nahi — Roman Hindi, jaise Indians phone pe bolte hain.
Examples of tone: "Namaste, main payment nahi maang rahi, cart save hai." "Theek hai, coupon laga deti hoon."
English only for product names and coupon codes (COMEBACK10).
Facts:
- Cart value (do not call this "amount due"): ${amt}
- Coupons: ${params.couponPercent ?? 10}% off, code ${params.couponCode ?? "COMEBACK10"}
- Customer intent: ${params.cartIntent ?? "opening"}
- Context: ${params.issue}

Write the NEXT spoken line only. JSON: {"text":"..."}
Rules:
- 1-3 short Hindi/Hinglish sentences. Garamjoshi, low-pressure.
- NEVER say they need to pay, amount is due, overdue, recover, or "kab tak pay karoge".
- Invite a coupon, save the cart, or hang up.`;

  const collectionsSystem = `You are ${params.merchant}'s recovery voice agent on a call with ${params.firstName}.
LANGUAGE: Conversational Hindi / Hinglish in Roman script (jaise phone pe). Not English-only. Not Devanagari.
Facts:
- Amount due: ${amt}
- Issue: ${params.issue}
- Promise-to-pay window: ${params.maxDays} days. You cannot override this.
- Extracted intent: ${params.extract?.intent ?? "none yet"}
- Promised date: ${params.extract?.promised_date ?? "none"}
- Policy allowed: ${params.policyAllowed}
- Policy reason: ${params.policyReason}
- Days until promised date: ${params.daysUntil ?? "n/a"}

Write the NEXT spoken line only. JSON: {"text":"..."}
Rules:
- 1-3 short spoken Hindi sentences. No markdown. No URLs. No UPI ids. No threats.
- If policyAllowed is false and intent is promise_to_pay, refuse the date and ask if they can do ${params.maxDays} days.
- If policyAllowed is true, confirm the date, one reminder that day, goodbye.
- If complaint/dispute, stop contact.
- If hardship, pause nags, mention EMI to a human, goodbye.
- If opening, ask kya hua.`;

  const parsed = await chatJson(
    isCart ? cartSystem : collectionsSystem,
    isCart
      ? (params.cartIntent ? `Customer just said something. Intent=${params.cartIntent}. Produce the agent reply.` : `Opening line of a cart-save call. Do not ask them to pay.`)
      : params.extract
        ? `Customer just spoke. Produce the agent reply.`
        : `This is the opening line of the call.`,
  );
  if (parsed && typeof parsed === "object" && "text" in parsed) {
    const text = String((parsed as { text: unknown }).text ?? "").trim();
    if (text) {
      if (isCart && /(need to pay|amount due|overdue|kab tak pay|settle karo|recover)/i.test(text)) {
        return { text: params.fallbackText, live: true };
      }
      return { text, live: true };
    }
  }
  return { text: params.fallbackText, live: false };
}

import type { Hono } from "hono";
import { db } from "@/lib/db";
import { continueCall, openCall } from "@/lib/engine/apply-call";
import { extractPtpWithLlm, llmConfig, llmConfigured } from "@/lib/engine/llm";
import { geminiConfigured, geminiLiveModel } from "@/lib/engine/gemini";
import { mintLiveSession } from "@/lib/voice/mint-live-session";
import { CANNED_CALLS } from "@/lib/engine/ptp";
import { evaluatePtpPolicy } from "@/lib/engine/ptp-policy";
import { writeAuditLog, writeBlockedAuditLog } from "@/lib/engine/audit";
import type { PtpExtract, PromiseToPay } from "@/lib/types";

export function mountVoice(app: Hono) {
  app.get("/api/voice/live", c => c.json({
    llm_configured: llmConfigured(),
    promises: db.listPromises(40),
    calls: db.listCallSessions(20),
  }));

  app.get("/api/voice/extract", c => c.json({
    canned: CANNED_CALLS,
    llm_configured: llmConfigured(),
    promises: db.listPromises(30),
    calls: db.listCallSessions(20),
  }));

  app.post("/api/voice/extract", async c => {
    const body = await c.req.json().catch(() => ({})) as {
      transcript?: string;
      amount_paise?: number;
      canned_id?: string;
    };
    let transcript = body.transcript?.trim() ?? "";
    let amount = body.amount_paise ?? 420000;
    if (body.canned_id) {
      const canned = CANNED_CALLS.find(x => x.id === body.canned_id);
      if (canned) {
        transcript = canned.transcript;
        amount = canned.amount_paise;
      }
    }
    if (!transcript) return c.json({ error: "transcript required" }, 400);
    const extract = await extractPtpWithLlm(transcript, amount);
    return c.json({
      transcript,
      amount_paise: amount,
      extract,
      llm_configured: llmConfigured(),
      policy: "AI proposes structured fields. Guardrail decides whether contact continues.",
    });
  });

  app.get("/api/voice/commit", c => c.json({ promises: db.listPromises(50) }));

  app.post("/api/voice/commit", async c => {
    const body = await c.req.json() as {
      event_id?: string;
      customer_name?: string;
      transcript?: string;
      extract?: PtpExtract;
    };
    const extract = body.extract;
    if (!extract || !body.transcript) {
      return c.json({ error: "extract + transcript required" }, 400);
    }
    const event = body.event_id ? db.getEvent(body.event_id) : null;
    const customer = body.customer_name || event?.customer_name || "Unknown";
    const amount = event?.amount ?? extract.promised_amount_paise ?? 0;
    const ptp: PromiseToPay = {
      ptp_id: `ptp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      event_id: event?.event_id ?? null,
      customer_name: customer,
      transcript: body.transcript,
      intent: extract.intent,
      promised_date: extract.promised_date,
      promised_amount_paise: extract.promised_amount_paise,
      hardship: extract.hardship,
      do_not_call_until: extract.do_not_call_until,
      dispute_language: extract.dispute_language,
      confidence: extract.confidence,
      source: extract.source,
      status: extract.dispute_language || extract.intent === "complaint" ? "killed" : "open",
      created_at: new Date().toISOString(),
    };
    const policy = evaluatePtpPolicy(extract.promised_date, db.getGuardrailConfig().ptp_max_days);
    if (extract.intent === "promise_to_pay" && !policy.allowed) {
      writeBlockedAuditLog({
        event_id: event?.event_id ?? "voice_orphan",
        diagnosis: "invoice_day_16_45",
        reason_code: "PTP_OUTSIDE_POLICY",
        bound_checked: `promised_date=${extract.promised_date ?? "none"} days=${policy.days_until} cap=${policy.max_days}d | not captured`,
        amount,
        ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
      });
      return c.json({
        committed: null,
        kill_switch: false,
        policy,
        message: policy.reason === "outside_window"
          ? `Merchant policy allows payment within ${policy.max_days} days. ${policy.days_until} days is outside the window — promise not captured.`
          : `Need a date inside the ${policy.max_days}-day merchant window.`,
      });
    }
    db.insertPromise(ptp);
    if (extract.dispute_language || extract.intent === "complaint") {
      if (event) db.setDisputeFlag(event.event_id);
      writeBlockedAuditLog({
        event_id: event?.event_id ?? "voice_orphan",
        diagnosis: "dispute_flagged",
        reason_code: "PTP_DISPUTE_KILL",
        bound_checked: `voice extract intent=${extract.intent} dispute_language=true | RBI §454Z`,
        amount,
        ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
      });
      return c.json({
        committed: ptp,
        kill_switch: true,
        message: "Dispute language detected. All automated contact halted.",
      });
    }
    if (extract.intent === "promise_to_pay") {
      writeAuditLog({
        event_id: event?.event_id ?? "voice_orphan",
        diagnosis: "invoice_day_16_45",
        guardrail: {
          allow: true,
          reason_code: null,
          bound_checked: `promised_date=${extract.promised_date ?? "unset"} within ${policy.max_days}d merchant policy | single check-back only`,
        },
        plan: { primary: "promise_to_pay_capture", secondary: null },
        outcome: "pending",
        amount,
        ai_source: extract.source === "llm_ptp" ? "llm_ptp" : "degraded",
        simulated: true,
      });
    }
    return c.json({
      committed: ptp,
      kill_switch: false,
      message: extract.intent === "promise_to_pay"
        ? "Promise captured. One check-back on the promised date, then human if broken."
        : `Logged as ${extract.intent}. No further automated contact from this turn.`,
    });
  });

  app.post("/api/voice/turn", async c => {
    const body = await c.req.json().catch(() => ({})) as {
      session_id?: string;
      event_id?: string;
      scenario?: string;
      amount_paise?: number;
      customer_name?: string;
      utterance?: string;
      offer_id?: import("@/lib/types").OfferType;
    };
    const utterance = body.utterance?.trim() ?? "";
    // An offer chip tap arrives with an offer_id (and a synthetic utterance).
    if (!utterance && !body.offer_id) return c.json(await openCall(body));
    return c.json(await continueCall({ ...body, utterance: utterance || `[offer:${body.offer_id}]` }));
  });

  app.post("/api/voice/speak", async c => {
    const body = await c.req.json().catch(() => ({})) as { text?: string };
    const text = body.text?.trim();
    if (!text) return c.json({ error: "text required" }, 400);
    if (!llmConfigured()) return c.json({ fallback: true });
    const { key, base } = llmConfig();
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_TTS_MODEL || "tts-1",
        voice: process.env.LLM_TTS_VOICE || "nova",
        input: text.slice(0, 4000),
      }),
    });
    if (!res.ok) return c.json({ fallback: true });
    return new Response(await res.arrayBuffer(), {
      headers: {
        "Content-Type": res.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  });

  app.post("/api/voice/transcribe", async c => {
    if (!llmConfigured()) {
      return c.json({ error: "LLM_API_KEY / OPENAI_API_KEY not set" }, 400);
    }
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return c.json({ error: "audio file required" }, 400);
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
    if (!res.ok) return c.json({ error: (await res.text()).slice(0, 400) }, 502);
    const data = await res.json() as { text?: string };
    return c.json({ text: data.text ?? "" });
  });

  app.get("/api/realtime/session", c => c.json({
    configured: geminiConfigured(),
    model: geminiLiveModel(),
    provider: "gemini",
    transport: "websocket",
  }));

  app.post("/api/realtime/session", async c => {
    const body = await c.req.json().catch(() => ({})) as {
      scenario?: string;
      amount_paise?: number;
      customer_name?: string;
    };
    const minted = await mintLiveSession(body);
    if ("error" in minted) return c.json(minted, 400);
    return c.json(minted);
  });
}

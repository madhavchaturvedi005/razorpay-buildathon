import { db } from "../db";
import { writeAuditLog, writeBlockedAuditLog } from "./audit";
import { extractPtpWithLlm, generateCallReply, llmConfigured } from "./llm";
import { agentReply, openingLine, REPLY_CHIPS } from "./call-script";
import { CART_CHIPS, cartAgentReply, extractCartIntent } from "./cart-script";
import { evaluatePtpPolicy } from "./ptp-policy";
import {
  offerChips,
  offersSpeech,
  pickDiscount,
  scenarioToTrigger,
} from "./policies";
import {
  createPaymentLink,
  isKeysConfigured,
  simulatedPaymentLink,
} from "../razorpay/client";
import type {
  CallSession, CallTurn, Discount, OfferType, PtpExtract, PromiseToPay, RecoveryPolicy,
} from "../types";

const MERCHANT = "Lumen Store";

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

// Resolve the merchant-configured offers for a live-call scenario.
function resolveOffers(scenario: string, amountPaise: number): {
  policy: RecoveryPolicy | null;
  discount: Discount | null;
  offers_text: string;
  chips: ReturnType<typeof offerChips>;
} {
  const trigger = scenarioToTrigger(scenario);
  const policy = db.getPolicy(trigger);
  const discTrigger =
    trigger === "overdue_invoice" ? "overdue_invoice" :
    trigger.startsWith("abandoned_cart") ? "abandoned_cart" : "any";
  const wantsDiscount = !!policy?.offers.some(o => o.enabled && o.type === "discount");
  const discount = wantsDiscount
    ? pickDiscount(db.listDiscounts(), discTrigger, amountPaise)
    : null;
  return {
    policy,
    discount,
    offers_text: offersSpeech(policy, discount),
    chips: offerChips(policy),
  };
}

const ISSUE: Record<string, string> = {
  insufficient_funds: "HDFC declined the card — not enough balance",
  expired_card: "saved card is expired",
  overdue_invoice: "invoice is overdue",
  abandoned_cart: "left headphones in the cart — shopping save, not a failed payment",
  gateway_timeout: "bank timed out; silent retry already running",
};

export async function openCall(params: {
  event_id?: string;
  scenario?: string;
  amount_paise?: number;
  customer_name?: string;
}) {
  const config = db.getGuardrailConfig();
  const event = params.event_id ? db.getEvent(params.event_id) : null;
  const amount = params.amount_paise ?? event?.amount ?? 420000;
  const customer = params.customer_name || event?.customer_name || "Arjun Sharma";
  const firstName = customer.split(" ")[0] ?? "ji";
  const scenario = params.scenario || "insufficient_funds";
  const opening = openingLine(scenario, firstName, amount, MERCHANT);
  const live = llmConfigured();
  const offers = resolveOffers(scenario, amount);

  const issueWithOffers = offers.offers_text
    ? `${ISSUE[scenario] ?? scenario}. Merchant-approved offers you may present: ${offers.offers_text}`
    : ISSUE[scenario] ?? scenario;
  const fallbackText = scenario === "abandoned_cart"
    ? opening.text
    : (opening.silent_only || !offers.offers_text ? opening.text : `${opening.text} ${offers.offers_text}`);

  const spoken = await generateCallReply({
    firstName,
    merchant: MERCHANT,
    amountPaise: amount,
    issue: scenario === "abandoned_cart"
      ? "Customer abandoned a product cart. Offer coupons only. Do not ask them to pay."
      : issueWithOffers,
    maxDays: config.ptp_max_days,
    extract: null,
    policyAllowed: false,
    policyReason: "no_date",
    daysUntil: null,
    fallbackText,
    doneHint: opening.silent_only,
    scenario,
    couponCode: offers.discount?.code ?? "COMEBACK10",
    couponPercent: offers.discount?.percent_off ?? 10,
  });

  const now = new Date().toISOString();
  const session: CallSession = {
    session_id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    event_id: event?.event_id ?? params.event_id ?? null,
    customer_name: customer,
    scenario,
    live_llm: spoken.live,
    status: opening.silent_only ? "ended" : "live",
    outcome: opening.silent_only ? "silent_retry" : null,
    turns: [{ who: "agent", text: spoken.text, at: now }],
    created_at: now,
    updated_at: now,
  };
  db.insertCallSession(session);

  if (event) {
    if (opening.silent_only) {
      db.incrementAttempt(event.event_id, true);
      if (event.status === "pending") db.updateEventStatus(event.event_id, "in_progress");
    } else {
      db.incrementAttempt(event.event_id, false);
      if (event.status === "pending") db.updateEventStatus(event.event_id, "in_progress");
    }
  }

  return {
    session_id: session.session_id,
    phase: "open" as const,
    agent: spoken.text,
    live: spoken.live,
    silent_only: opening.silent_only,
    chips: opening.silent_only ? [] : (scenario === "abandoned_cart" ? CART_CHIPS : REPLY_CHIPS),
    offer_chips: opening.silent_only ? [] : offers.chips,
    discount: offers.discount,
    policy: {
      max_days: config.ptp_max_days,
      allowed: false,
      reason: "no_date" as const,
      days_until: null as number | null,
    },
    extract: null as PtpExtract | null,
    committed: null,
    done: opening.silent_only,
    llm_configured: live,
  };
}

export async function continueCall(params: {
  session_id?: string;
  event_id?: string;
  scenario?: string;
  amount_paise?: number;
  customer_name?: string;
  utterance: string;
  offer_id?: OfferType;
}) {
  const config = db.getGuardrailConfig();
  const session = params.session_id ? db.getCallSession(params.session_id) : null;
  const eventId = session?.event_id ?? params.event_id;
  const event = eventId ? db.getEvent(eventId) : null;
  const amount = params.amount_paise ?? event?.amount ?? 420000;
  const customer = params.customer_name || session?.customer_name || event?.customer_name || "Arjun Sharma";
  const firstName = customer.split(" ")[0] ?? "ji";
  const scenario = session?.scenario || params.scenario || "insufficient_funds";

  // ── Deterministic offer acceptance (customer tapped an offer chip) ──────────
  if (params.offer_id) {
    return await applyOfferTurn({
      offer_id: params.offer_id,
      session,
      event,
      scenario,
      customer,
      firstName,
      amount,
      utterance: params.utterance,
    });
  }

  // Abandoned cart: coupon conversation — never treat as a debt collection.
  if (scenario === "abandoned_cart" && !params.offer_id) {
    const intent = extractCartIntent(params.utterance);
    const offers = resolveOffers(scenario, amount);
    const couponCode = offers.discount?.code ?? "COMEBACK10";
    const percent = offers.discount?.percent_off ?? 10;
    const scripted = cartAgentReply({ intent, firstName, merchant: MERCHANT, couponCode, percent });

    if (scripted.applyCoupon || intent === "accept_coupon") {
      return await applyOfferTurn({
        offer_id: "discount",
        session,
        event,
        scenario,
        customer,
        firstName,
        amount,
        utterance: params.utterance,
      });
    }

    const spoken = await generateCallReply({
      firstName,
      merchant: MERCHANT,
      amountPaise: amount,
      issue: "Abandoned cart — suggest coupons only, never demand payment",
      maxDays: config.ptp_max_days,
      extract: null,
      policyAllowed: false,
      policyReason: "no_date",
      daysUntil: null,
      fallbackText: scripted.text,
      doneHint: scripted.done,
      scenario,
      cartIntent: intent,
      couponCode,
      couponPercent: percent,
    });

    const youTurn: CallTurn = { who: "you", text: params.utterance, at: new Date().toISOString() };
    const agentTurn: CallTurn = { who: "agent", text: spoken.text, at: new Date().toISOString() };
    if (session) {
      db.updateCallSession(session.session_id, {
        turns: [...session.turns, youTurn, agentTurn],
        live_llm: spoken.live || session.live_llm,
        status: scripted.done ? "ended" : "live",
        outcome: intent,
      });
    }

    return {
      session_id: session?.session_id ?? null,
      phase: "turn" as const,
      agent: spoken.text,
      live: spoken.live,
      silent_only: false,
      chips: scripted.done ? [] : CART_CHIPS,
      offer_chips: scripted.done ? [] : offers.chips,
      policy: null,
      extract: null,
      committed: null,
      kill_switch: false,
      done: scripted.done,
      event_status: event ? db.getEvent(event.event_id)?.status ?? event.status : null,
      llm_configured: llmConfigured(),
    };
  }

  const extract = await extractPtpWithLlm(params.utterance, amount);
  const policy = evaluatePtpPolicy(extract.promised_date, config.ptp_max_days);
  const scripted = agentReply(extract, policy, MERCHANT);
  const spoken = await generateCallReply({
    firstName,
    merchant: MERCHANT,
    amountPaise: amount,
    issue: ISSUE[scenario] ?? scenario,
    maxDays: config.ptp_max_days,
    extract,
    policyAllowed: policy.allowed,
    policyReason: policy.reason,
    daysUntil: policy.days_until,
    fallbackText: scripted.text,
    doneHint: scripted.done,
  });

  const applied = applyExtract({
    event,
    customer,
    utterance: params.utterance,
    extract,
    amount,
  });

  const youTurn: CallTurn = { who: "you", text: params.utterance, at: new Date().toISOString() };
  const agentTurn: CallTurn = { who: "agent", text: spoken.text, at: new Date().toISOString() };
  if (session) {
    const turns = [...session.turns, youTurn, agentTurn];
    db.updateCallSession(session.session_id, {
      turns,
      live_llm: spoken.live || session.live_llm,
      status: scripted.done ? "ended" : "live",
      outcome: applied.outcome,
    });
  }

  return {
    session_id: session?.session_id ?? null,
    phase: "turn" as const,
    agent: spoken.text,
    live: spoken.live,
    silent_only: false,
    chips: scripted.done ? [] : (scenario === "abandoned_cart" ? CART_CHIPS : REPLY_CHIPS.filter(c => c.id === "d5" || c.id === "d10" || c.id === "hardship")),
    offer_chips: scripted.done ? [] : resolveOffers(scenario, amount).chips,
    policy,
    extract,
    committed: applied.committed,
    kill_switch: applied.kill_switch,
    done: scripted.done,
    event_status: event ? db.getEvent(event.event_id)?.status ?? event.status : null,
    llm_configured: llmConfigured(),
  };
}

// ─── Deterministic offer execution ───────────────────────────────────────────
// Money-moving actions never go through the model. The merchant policy decides
// what is offered; guardrails decide what is allowed; this function executes it.

async function safeLink(params: {
  amountPaise: number;
  description: string;
  customer: string;
  method?: "upi";
}): Promise<{ url: string; ref: string; simulated: boolean }> {
  const eventKey = Math.random().toString(36).slice(2, 8);
  if (!isKeysConfigured()) {
    const sim = simulatedPaymentLink(eventKey);
    return { url: sim.short_url, ref: sim.id, simulated: true };
  }
  try {
    const link = await createPaymentLink({
      amount: params.amountPaise,
      description: params.description,
      customer: { name: params.customer, email: "customer@example.com", contact: "+919999999999" },
      method: params.method,
    });
    return { url: link.short_url, ref: link.id, simulated: false };
  } catch {
    const sim = simulatedPaymentLink(eventKey);
    return { url: sim.short_url, ref: sim.id, simulated: true };
  }
}

async function applyOfferTurn(params: {
  offer_id: OfferType;
  session: CallSession | null;
  event: ReturnType<typeof db.getEvent>;
  scenario: string;
  customer: string;
  firstName: string;
  amount: number;
  utterance: string;
}) {
  const { offer_id, session, event, scenario, customer, firstName, amount, utterance } = params;
  const config = db.getGuardrailConfig();
  const policy = db.getPolicy(scenarioToTrigger(scenario));
  const offer = policy?.offers.find(o => o.type === offer_id && o.enabled) ?? null;
  const eventId = event?.event_id ?? session?.event_id ?? "voice_call";
  const live = llmConfigured();

  let text = "";
  let blocked = false;
  let ref: string | null = null;
  let coupon: { code: string; percent: number; new_amount: number; valid_hours: number } | null = null;

  if (!offer) {
    text = "Woh option abhi available nahi hai. Koi aur tarika batao?";
    return finishOfferTurn({ session, event, utterance, text, done: false, outcome: "offer_unavailable", offerType: offer_id });
  }

  switch (offer_id) {
    case "discount": {
      const discTrigger =
        scenario === "overdue_invoice" ? "overdue_invoice" :
        scenario === "abandoned_cart" ? "abandoned_cart" : "any";
      const discount = pickDiscount(db.listDiscounts(), discTrigger, amount);
      if (!discount) {
        text = "Abhi aapke cart pe koi discount apply nahi hota. Main payment link bhej deti hoon.";
        break;
      }
      if (discount.percent_off > config.discount_cap_pct) {
        // Guardrail: over the cap → cannot auto-apply, needs a human.
        blocked = true;
        writeBlockedAuditLog({
          event_id: eventId,
          diagnosis: "checkout_price_surprise",
          reason_code: "DISCOUNT_CAP_EXCEEDED",
          bound_checked: `discount ${discount.percent_off}% > cap ${config.discount_cap_pct}% | needs human approval`,
          amount,
          ai_source: live ? "llm_ptp" : "degraded",
        });
        text = `Yeh ${discount.percent_off}% discount policy limit (${config.discount_cap_pct}%) se zyada hai — main khud apply nahi kar sakti. Team se approve karwa ke bhej dungi.`;
        break;
      }
      const discounted = Math.round(amount * (1 - discount.percent_off / 100));
      const link = await safeLink({ amountPaise: discounted, description: `${MERCHANT} — ${discount.percent_off}% off (${discount.code})`, customer });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: "checkout_price_surprise",
        guardrail: { allow: true, reason_code: null, bound_checked: `discount ${discount.percent_off}% ≤ cap ${config.discount_cap_pct}% | code ${discount.code}` },
        plan: { primary: "early_discount_offer", secondary: null, discount_pct: discount.percent_off },
        outcome: "pending",
        amount: discounted,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `Ho gaya ${firstName}! ${discount.percent_off}% off laga diya — code ${discount.code}. Naya total ${rupees(discounted)}, ${discount.valid_hours} ghante ke andar. Cart mein coupon apply ho chuka hai. Checkout khol ke Pay dabaaiye.`;
      coupon = { code: discount.code, percent: discount.percent_off, new_amount: discounted, valid_hours: discount.valid_hours };
      break;
    }
    case "emi": {
      const months = offer.emi_months ?? 3;
      const perMonth = Math.round(amount / months);
      writeAuditLog({
        event_id: eventId,
        diagnosis: "insufficient_funds",
        guardrail: { allow: true, reason_code: null, bound_checked: `EMI ${months} months × ${rupees(perMonth)} presented on live call` },
        plan: { primary: "emi_offer", secondary: null },
        outcome: "pending",
        amount,
        ai_source: live ? "llm_ptp" : "degraded",
      });
      text = `Perfect. ${months}-mahine ka no-cost EMI set kar diya — har mahine sirf ${rupees(perMonth)}. Pehli kist ka link bhej rahi hoon, wahin se confirm ho jayega.`;
      break;
    }
    case "partial": {
      const half = Math.round(amount / 2);
      const link = await safeLink({ amountPaise: half, description: `${MERCHANT} — 50% now`, customer });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: "insufficient_funds",
        guardrail: { allow: true, reason_code: null, bound_checked: `partial 50/50 — ${rupees(half)} now` },
        plan: { primary: "partial_payment", secondary: null },
        outcome: "pending",
        amount: half,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `Theek hai — abhi ${rupees(half)}, baaki next payday pe. Pehle half ka link: ${link.url}`;
      break;
    }
    case "upi_link": {
      const link = await safeLink({ amountPaise: amount, description: `${MERCHANT} payment`, customer, method: "upi" });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: scenario === "expired_card" ? "expired_card" : "insufficient_funds",
        guardrail: { allow: true, reason_code: null, bound_checked: "UPI fallback link sent on live call" },
        plan: { primary: "upi_fallback_link", secondary: null },
        outcome: "pending",
        amount,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `UPI link bhej diya — GPay, PhonePe, kisi bhi app se ${rupees(amount)} de sakte ho: ${link.url}`;
      break;
    }
    case "card_update": {
      const link = await safeLink({ amountPaise: amount, description: `${MERCHANT} — update card`, customer });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: "expired_card",
        guardrail: { allow: true, reason_code: null, bound_checked: "card update link sent on live call" },
        plan: { primary: "card_update_link", secondary: null },
        outcome: "pending",
        amount,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `Naya card add karne ka link bhej diya: ${link.url}`;
      break;
    }
    case "guest_checkout": {
      const link = await safeLink({ amountPaise: amount, description: `${MERCHANT} — guest checkout`, customer });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: "checkout_forced_signup",
        guardrail: { allow: true, reason_code: null, bound_checked: "guest checkout link sent — no signup" },
        plan: { primary: "guest_checkout_link", secondary: null },
        outcome: "pending",
        amount,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `Account ki zaroorat nahi — guest checkout link: ${link.url}. Seedha pay kar do.`;
      break;
    }
    case "reminder": {
      const link = await safeLink({ amountPaise: amount, description: `${MERCHANT} — payment link`, customer });
      ref = link.ref;
      writeAuditLog({
        event_id: eventId,
        diagnosis: "invoice_day_1_15",
        guardrail: { allow: true, reason_code: null, bound_checked: "gentle reminder + payment link sent" },
        plan: { primary: "gentle_reminder", secondary: null },
        outcome: "pending",
        amount,
        razorpay_ref: link.ref,
        ai_source: live ? "llm_ptp" : "degraded",
        simulated: link.simulated,
      });
      text = `Payment link bhej diya, aaram se pay kar dena: ${link.url}`;
      break;
    }
    default: {
      text = "Samajh gayi, note kar liya.";
    }
  }

  if (event && !blocked && event.status === "pending") {
    db.updateEventStatus(event.event_id, "in_progress");
  }

  return finishOfferTurn({
    session, event, utterance, text,
    done: !blocked,
    outcome: blocked ? "offer_blocked" : `offer_${offer_id}`,
    offerType: offer_id,
    ref,
    coupon,
  });
}

function finishOfferTurn(params: {
  session: CallSession | null;
  event: ReturnType<typeof db.getEvent>;
  utterance: string;
  text: string;
  done: boolean;
  outcome: string;
  offerType: OfferType;
  ref?: string | null;
  coupon?: { code: string; percent: number; new_amount: number; valid_hours: number } | null;
}) {
  const { session, event, utterance, text, done, outcome } = params;
  const now = new Date().toISOString();
  if (session) {
    const turns: CallTurn[] = [
      ...session.turns,
      { who: "you", text: utterance, at: now },
      { who: "agent", text, at: now },
    ];
    db.updateCallSession(session.session_id, { turns, status: done ? "ended" : "live", outcome });
  }
  return {
    session_id: session?.session_id ?? null,
    phase: "offer" as const,
    agent: text,
    live: llmConfigured(),
    silent_only: false,
    chips: [],
    offer_chips: [],
    policy: null,
    extract: null as PtpExtract | null,
    committed: null,
    offer: params.offerType,
    offer_ref: params.ref ?? null,
    coupon: params.coupon ?? null,
    done,
    event_status: event ? db.getEvent(event.event_id)?.status ?? event.status : null,
    llm_configured: llmConfigured(),
  };
}

function applyExtract(params: {
  event: ReturnType<typeof db.getEvent>;
  customer: string;
  utterance: string;
  extract: PtpExtract;
  amount: number;
}): { committed: PromiseToPay | null; kill_switch: boolean; outcome: string | null } {
  const { event, customer, utterance, extract, amount } = params;
  const policy = evaluatePtpPolicy(extract.promised_date, db.getGuardrailConfig().ptp_max_days);
  const live = extract.source === "llm_ptp" || llmConfigured();

  if (extract.dispute_language || extract.intent === "complaint") {
    const committed = persist(event?.event_id ?? null, customer, utterance, extract, "killed");
    if (event) db.setDisputeFlag(event.event_id);
    writeBlockedAuditLog({
      event_id: event?.event_id ?? "voice_call",
      diagnosis: "dispute_flagged",
      reason_code: "PTP_DISPUTE_KILL",
      bound_checked: `live call intent=${extract.intent} | RBI §454Z`,
      amount,
      ai_source: live ? "llm_ptp" : "degraded",
    });
    return { committed, kill_switch: true, outcome: "dispute" };
  }

  if (extract.intent === "hardship") {
    const committed = persist(event?.event_id ?? null, customer, utterance, extract, "open");
    if (event && event.status !== "blocked") {
      db.updateEventStatus(event.event_id, "escalated");
    }
    writeAuditLog({
      event_id: event?.event_id ?? "voice_call",
      diagnosis: "invoice_day_16_45",
      guardrail: {
        allow: true,
        reason_code: null,
        bound_checked: "hardship captured on live call | pause nags, human EMI/partial",
      },
      plan: { primary: "human_handoff", secondary: "emi_offer" },
      outcome: "escalated",
      amount,
      ai_source: live ? "llm_ptp" : "degraded",
      simulated: false,
    });
    return { committed, kill_switch: false, outcome: "hardship" };
  }

  if (extract.intent === "optout" || extract.intent === "refuse") {
    const committed = persist(event?.event_id ?? null, customer, utterance, extract, "open");
    if (event) db.updateEventStatus(event.event_id, "blocked");
    return { committed, kill_switch: false, outcome: extract.intent };
  }

  if (extract.intent === "promise_to_pay" && policy.allowed) {
    const committed = persist(event?.event_id ?? null, customer, utterance, extract, "open");
    if (event && event.status !== "blocked" && event.status !== "recovered") {
      db.updateEventStatus(event.event_id, "in_progress");
    }
    writeAuditLog({
      event_id: event?.event_id ?? "voice_call",
      diagnosis: "invoice_day_16_45",
      guardrail: {
        allow: true,
        reason_code: null,
        bound_checked: `promised_date=${extract.promised_date} within ${policy.max_days}d merchant policy | single check-back`,
      },
      plan: { primary: "promise_to_pay_capture", secondary: null },
      outcome: "pending",
      amount,
      ai_source: live ? "llm_ptp" : "degraded",
      simulated: false,
    });
    return { committed, kill_switch: false, outcome: "promise_to_pay" };
  }

  if (extract.intent === "promise_to_pay" && !policy.allowed && policy.reason === "outside_window") {
    writeBlockedAuditLog({
      event_id: event?.event_id ?? "voice_call",
      diagnosis: "invoice_day_16_45",
      reason_code: "PTP_OUTSIDE_POLICY",
      bound_checked: `promised ${policy.days_until}d > merchant cap ${policy.max_days}d | not captured`,
      amount,
      ai_source: live ? "llm_ptp" : "degraded",
    });
    return { committed: null, kill_switch: false, outcome: "ptp_refused" };
  }

  return { committed: null, kill_switch: false, outcome: extract.intent };
}

function persist(
  eventId: string | null,
  customer: string,
  transcript: string,
  extract: PtpExtract,
  status: PromiseToPay["status"],
): PromiseToPay {
  const ptp: PromiseToPay = {
    ptp_id: `ptp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    event_id: eventId,
    customer_name: customer,
    transcript,
    intent: extract.intent,
    promised_date: extract.promised_date,
    promised_amount_paise: extract.promised_amount_paise,
    hardship: extract.hardship,
    do_not_call_until: extract.do_not_call_until,
    dispute_language: extract.dispute_language,
    confidence: extract.confidence,
    source: extract.source,
    status,
    created_at: new Date().toISOString(),
  };
  db.insertPromise(ptp);
  return ptp;
}

// Offer chips available on a live call for a given scenario (drives the
// realtime accept_offer tool enum + instructions).
export function offersForScenario(scenario: string, amountPaise: number): ReturnType<typeof offerChips> {
  return resolveOffers(scenario, amountPaise).chips;
}

export function realtimeInstructions(params: {
  firstName: string;
  amountPaise: number;
  scenario: string;
  maxDays: number;
}): string {
  const amt = `₹${(params.amountPaise / 100).toLocaleString("en-IN")}`;
  const offers = resolveOffers(params.scenario, params.amountPaise);
  const offerLine = offers.offers_text
    ? `\nMerchant-approved offers (present these, do NOT invent others): ${offers.offers_text}`
    : "";
  const offerMenu = offers.chips.length
    ? "\nOffer menu (call accept_offer with the matching offer_id the moment the customer accepts one, or presses its key):\n" +
      offers.chips.map(o => `  - ${o.offer_id}${o.press_key ? ` (press ${o.press_key})` : ""}: ${o.label}`).join("\n")
    : "";
  if (params.scenario === "abandoned_cart") {
    return `Aap Lumen Store ki shopping assistant ho, live phone call pe ${params.firstName} se.
Yeh Gemini Live native audio hai — asli awaaz mein bolo, jaise asli Indian customer-care wali.
BOHASHA: Hindi / Hinglish, Roman script (Devanagari mat). English sirf coupon code aur product name.
Natural, warm, thoda casual. Robot / IVR / scripted mat sunao. Short sentences. Ek baat poocho, suno, phir bolo.
Example: "Namaste Arjun, main payment nahi maang rahi. Cart save hai. Das percent off hai, COMEBACK10. Ek dabaao toh laga deti hoon."

Yeh collections nahi hai. Unhone product cart mein chhod diya. Koi failed payment nahi.
Cart value (due mat kehna): ${amt}
Approved coupon only: ${offers.discount ? `${offers.discount.percent_off}% off, code ${offers.discount.code}` : "COMEBACK10 10% off"}.
${offerMenu}

Rules:
- Dono taraf baat: suno, interrupt allow, phir jawab do.
- Kabhi mat bolo ki unhe pay karna hai, recover, settle, ya "kab tak pay karoge".
- Coupon offer karo. Agar haan ya press 1, accept_offer call karo with offer_id "discount".
- Nahi / baad mein / already bought — thanks, call band.
- Coupon code invent mat karo.`;
  }

  return `Aap Lumen Store ki recovery agent ho, live two-way call pe ${params.firstName} se.
Yeh Gemini Live native audio hai. Asli awaaz, natural Hindi / Hinglish. Robot / IVR mat sunao.
BOHASHA: Hindi / Hinglish, Roman script. English sirf numbers, dates, UPI ke liye.
Short, warm, clear. Ek sawaal, suno, phir bolo.

Amount due ${amt}. Issue: ${ISSUE[params.scenario] ?? params.scenario}.${offerLine}${offerMenu}
Policy: promise-to-pay sirf ${params.maxDays} din ke andar. Zyada maange toh mana karo.
Amount, URL, UPI, discount code invent mat karo. accept_offer tool real link/code dega — woh padh ke bolo.
Legal, CIBIL, police, family threaten mat karo.
Pehle poocho kya hua, phir date lo ya offer do.
Offer accept / press 1 → accept_offer. Date / dispute / hardship → commit_customer_intent.
RBI / ombudsman / fraud → tool ke baad band.
Gateway timeout: silent retry chal raha hai — batao aur hang up.`;
}

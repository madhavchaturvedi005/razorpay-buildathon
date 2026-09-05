import type { DiagnosisTag, RecoveryEvent } from "../types";
import { CALIBRATION } from "../data/calibration";
import { inr } from "../ui/format";

export type OutreachChannel = "whatsapp" | "email" | "call" | "all" | "silent" | "stop";

export interface RecoverAction {
  id: OutreachChannel;
  label: string;
  hint: string;
  recommended: boolean;
}

export interface RecoverBrief {
  diagnosis: DiagnosisTag;
  title: string;
  why: string;
  canRecover: boolean;
  recoverabilityPct: number;
  recoverabilityLabel: "High" | "Medium" | "Low" | "None";
  recommendedChannel: OutreachChannel;
  actions: RecoverAction[];
  defaultComment: string;
  commentChips: string[];
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
  callBeats: { who: "agent" | "customer"; text: string }[];
  offer: string | null;
}

const TITLES: Record<DiagnosisTag, string> = {
  insufficient_funds: "Soft decline — wallet ran short",
  expired_card: "Expired / invalid card",
  gateway_timeout: "Transient gateway / bank timeout",
  hard_decline: "Hard decline — card blocked or closed",
  checkout_price_surprise: "Abandoned cart — price surprise",
  checkout_forced_signup: "Abandoned cart — forced signup",
  invoice_day_1_15: "Invoice overdue · early window",
  invoice_day_16_45: "Invoice overdue · mid window",
  invoice_day_46_plus: "Invoice overdue · late stage",
  subscription_card_issue: "Subscription — card issue",
  subscription_upi_cancelled: "UPI mandate cancelled",
  dispute_flagged: "Dispute flagged — stop all contact",
};

function diagnoseEvent(event: RecoveryEvent): DiagnosisTag {
  if (event.dispute_flag) return "dispute_flagged";
  if (event.type === "checkout_abandon") {
    return event.abandonment_reason === "forced_signup"
      ? "checkout_forced_signup"
      : "checkout_price_surprise";
  }
  if (event.type === "invoice_overdue") {
    if (event.days_overdue <= 15) return "invoice_day_1_15";
    if (event.days_overdue <= 45) return "invoice_day_16_45";
    return "invoice_day_46_plus";
  }
  switch (event.decline_code) {
    case "insufficient_funds":
      return "insufficient_funds";
    case "expired_card":
    case "invalid_card":
      return event.type === "subscription_failure" ? "subscription_card_issue" : "expired_card";
    case "gateway_timeout":
    case "bank_not_responding":
      return "gateway_timeout";
    case "hard_decline":
      return "hard_decline";
    case "upi_mandate_cancelled":
      return "subscription_upi_cancelled";
    default:
      return event.type === "subscription_failure" ? "subscription_card_issue" : "gateway_timeout";
  }
}

function recoverabilityPct(tag: DiagnosisTag, event: RecoveryEvent): number {
  const r = CALIBRATION.recoverability;
  const map: Partial<Record<DiagnosisTag, number>> = {
    insufficient_funds: r.insufficient_funds,
    expired_card: r.expired_card,
    gateway_timeout: r.gateway_timeout,
    hard_decline: r.hard_decline,
    checkout_price_surprise: r.price_surprise,
    checkout_forced_signup: r.forced_signup,
    invoice_day_1_15: r.invoice_day_1_15,
    invoice_day_16_45: r.invoice_day_16_45,
    invoice_day_46_plus: r.invoice_day_46_90,
    subscription_card_issue: r.subscription_card,
    subscription_upi_cancelled: r.subscription_upi,
    dispute_flagged: 0,
  };
  let pct = Math.round((map[tag] ?? 0.4) * 100);
  if (!event.ground_truth_recoverable) pct = Math.min(pct, 12);
  return pct;
}

function firstName(name: string) {
  return name.split(" ")[0] || name;
}

function channelFor(tag: DiagnosisTag): OutreachChannel {
  switch (tag) {
    case "dispute_flagged":
    case "subscription_upi_cancelled":
    case "invoice_day_46_plus":
      return "stop";
    case "gateway_timeout":
      return "whatsapp";
    case "expired_card":
    case "subscription_card_issue":
    case "invoice_day_1_15":
      return "email";
    case "insufficient_funds":
    case "hard_decline":
    case "checkout_price_surprise":
    case "checkout_forced_signup":
    case "invoice_day_16_45":
      return "call";
    default:
      return "whatsapp";
  }
}

function actionsFor(recommended: OutreachChannel, tag: DiagnosisTag): RecoverAction[] {
  if (recommended === "stop") {
    return [
      { id: "stop", label: "Stop outreach", hint: "Dispute / mandate / late invoice — do not contact", recommended: true },
    ];
  }

  const all: RecoverAction = {
    id: "all",
    label: "All of the above",
    hint: "WhatsApp + Gmail + agent call together — same payment link on every channel.",
    recommended: false,
  };

  const light: RecoverAction[] = [
    { id: "whatsapp", label: "WhatsApp nudge", hint: "One-tap UPI / retry link. No call.", recommended: recommended === "whatsapp" },
    { id: "email", label: "Gmail / payment mail", hint: "Payment link in the inbox. Low annoyance.", recommended: recommended === "email" },
    { id: "silent", label: "Silent retry", hint: "Re-hit the gateway. Customer never sees this.", recommended: tag === "gateway_timeout" },
    { id: "call", label: "Agent call", hint: "Ask what happened. Offer EMI or a discount.", recommended: false },
    all,
  ];

  const heavy: RecoverAction[] = [
    { id: "call", label: "Agent call", hint: "Diagnose the issue live. Convince with EMI / coupon.", recommended: recommended === "call" },
    { id: "whatsapp", label: "WhatsApp instead", hint: "Send the offer in chat if you do not want to call.", recommended: false },
    { id: "email", label: "Gmail instead", hint: "Mail the payment link + discount copy.", recommended: false },
    all,
  ];

  return recommended === "call" ? heavy : light;
}

export function buildRecoverBrief(event: RecoveryEvent): RecoverBrief {
  const diagnosis = diagnoseEvent(event);
  const pct = recoverabilityPct(diagnosis, event);
  const recommendedChannel = channelFor(diagnosis);
  const canRecover = !event.dispute_flag && recommendedChannel !== "stop" && (event.ground_truth_recoverable || pct >= 25);
  const name = firstName(event.customer_name);
  const amt = inr(event.amount);
  const merchant = "Lumen Store";

  const recoverabilityLabel: RecoverBrief["recoverabilityLabel"] =
    pct >= 65 ? "High" : pct >= 40 ? "Medium" : pct > 0 ? "Low" : "None";

  const why = (() => {
    switch (diagnosis) {
      case "gateway_timeout":
        return `The bank timed out — ${name} did everything right. A WhatsApp or mail with a retry link (or a silent retry) usually recovers this without a call.`;
      case "expired_card":
      case "subscription_card_issue":
        return `Retrying the same card will fail. Send a UPI / card-update link on WhatsApp or Gmail. Call only if they ignore it.`;
      case "insufficient_funds":
        return `This is recoverable, but not by retrying the same charge. An agent should ask about payday, then offer EMI or a partial pay.`;
      case "hard_decline":
        return `The card is likely blocked or closed. A short call to switch to UPI is higher-lift than another card retry.`;
      case "checkout_price_surprise":
        return `${name} dropped off when extra cost appeared. A live call with a 10% comeback coupon is the play.`;
      case "checkout_forced_signup":
        return `Forced account creation killed the cart. Call, skip signup, and send a guest-checkout link.`;
      case "invoice_day_1_15":
        return `Still in the gentle window. Mail a clear due-date reminder — calling this early feels like spam.`;
      case "invoice_day_16_45":
        return `Mid-age invoice. A firm call plus a small early-settlement discount recovers most of these.`;
      case "invoice_day_46_plus":
        return `Past the human-handoff threshold. The agent must not nag — queue for a person.`;
      case "subscription_upi_cancelled":
        return `Mandate was withdrawn. Another debit would be unauthorised. Stop.`;
      case "dispute_flagged":
        return `Dispute flag is on. All automated contact is illegal under the kill-switch.`;
      default:
        return `Pick the cheapest channel that can still recover ${amt}.`;
    }
  })();

  const offer =
    diagnosis === "checkout_price_surprise" || diagnosis === "checkout_forced_signup"
      ? "COMEBACK10 · 10% off if they complete today"
      : diagnosis === "insufficient_funds"
        ? "3 × no-cost EMI, or 50% now / 50% payday"
        : diagnosis === "invoice_day_16_45"
          ? "3% early-settlement if paid in 48h"
          : diagnosis === "expired_card" || diagnosis === "subscription_card_issue"
            ? "UPI fallback — skip the dead card"
            : diagnosis === "hard_decline"
              ? "Switch to UPI, do not retry the card"
              : null;

  const link = `pay.lumen.store/${event.event_id}`;

  const whatsapp =
    diagnosis === "gateway_timeout"
      ? `Hi ${name}, ${merchant} here. Your ${amt} payment didn't go through — the bank timed out, not you. Tap to finish in 30s: ${link}`
      : diagnosis === "expired_card" || diagnosis === "subscription_card_issue"
        ? `Hi ${name}, your saved card has expired so ${amt} to ${merchant} didn't go through. Pay with UPI instead (no card update needed): ${link}`
        : `Hi ${name}, ${merchant} here about ${amt}. ${offer ?? "A fresh payment link is ready."} Pay here: ${link}`;

  const emailSubject =
    diagnosis === "gateway_timeout"
      ? `${merchant}: bank timeout on ${amt} — retry in one tap`
      : diagnosis === "expired_card"
        ? `Your card expired — complete ${amt} via UPI`
        : `Complete your ${amt} payment with ${merchant}`;

  const emailBody = `${whatsapp}\n\nIf this wasn't you, ignore the mail. We will not call unless you reply.`;

  const callBeats: RecoverBrief["callBeats"] = (() => {
    if (diagnosis === "insufficient_funds") {
      return [
        { who: "agent", text: `Namaste ${name}, main ${merchant} se bol rahi hoon. ${amt} cut nahi hua — account mein balance kam tha. Kya hua exactly?` },
        { who: "customer", text: "Salary late aayi hai… next week possible hai." },
        { who: "agent", text: "Theek hai. 3 EMI mein split kar sakte ho, ya aadha ab aur aadha payday pe. Koi extra charge nahi." },
      ];
    }
    if (diagnosis.startsWith("checkout")) {
      return [
        { who: "agent", text: `Namaste ${name}, aapka cart ${amt} pe ruk gaya. Shipping dekh ke drop kiya kya?` },
        { who: "customer", text: "Haan, extra charges unexpected the." },
        { who: "agent", text: `Samajh gayi. COMEBACK10 laga deti hoon — 10% off, guest checkout, koi signup nahi. Abhi complete karoge?` },
      ];
    }
    if (diagnosis === "invoice_day_16_45") {
      return [
        { who: "agent", text: `Namaste ${name}, invoice ${amt} ${event.days_overdue} din se pending hai. Koi issue hai settlement mein?` },
        { who: "customer", text: "Finance approval slow hai." },
        { who: "agent", text: "Agar 48 ghante mein clear ho jaye to 3% early-settlement de sakte hain. Link WhatsApp pe bhej deti hoon." },
      ];
    }
    if (diagnosis === "hard_decline") {
      return [
        { who: "agent", text: `Namaste ${name}, card bank ne block kiya. UPI se ${amt} nikal sakte ho — card retry kaam nahi karega.` },
        { who: "customer", text: "Haan, naya UPI try karte hain." },
      ];
    }
    return [
      { who: "agent", text: `Namaste ${name}, ${amt} pending hai ${merchant} pe. Main UPI link bhej rahi hoon — 30 second lagenge.` },
      { who: "customer", text: "Ok, send the link." },
    ];
  })();

  const defaultComment =
    recommendedChannel === "call"
      ? "Try agent call — ask the issue first, then offer EMI / discount. Do not threaten."
      : recommendedChannel === "whatsapp"
        ? "WhatsApp only. No call. One payment link, then stop."
        : recommendedChannel === "email"
          ? "Mail the UPI / retry link. Call only if they ignore it for 24h."
          : recommendedChannel === "silent"
            ? "Silent retry. Do not message the customer."
            : "Do not contact. Log and hand off.";

  const commentChips =
    recommendedChannel === "call"
      ? ["Try agent call", "All of the above", "Ask payday first", "WhatsApp only — no call"]
      : ["WhatsApp only — no call", "Mail the UPI link", "All of the above", "Escalate to agent call"];

  return {
    diagnosis,
    title: TITLES[diagnosis],
    why,
    canRecover,
    recoverabilityPct: pct,
    recoverabilityLabel,
    recommendedChannel,
    actions: actionsFor(recommendedChannel, diagnosis),
    defaultComment,
    commentChips,
    whatsapp,
    emailSubject,
    emailBody,
    callBeats,
    offer,
  };
}

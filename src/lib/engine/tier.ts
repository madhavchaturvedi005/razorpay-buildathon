import type { ContactTier, InterventionType } from "../types";

// HappyGarg pattern: cheapest tier first. Silent retries never burn a contact slot.

const SILENT: InterventionType[] = [
  "payday_retry",
  "silent_retry",
  "multi_acquirer_reroute",
];

const VOICE: InterventionType[] = [
  "promise_to_pay_capture",
];

const STOP: InterventionType[] = [
  "dispute_stop",
  "mandate_stop",
  "human_handoff",
];

export function contactTier(intervention: InterventionType | "none" | "stop"): ContactTier {
  if (intervention === "none" || intervention === "stop") return "stop";
  if (SILENT.includes(intervention as InterventionType)) return "silent";
  if (VOICE.includes(intervention as InterventionType)) return "voice";
  if (STOP.includes(intervention as InterventionType)) return "stop";
  return "contact";
}

export function isCustomerFacing(intervention: InterventionType): boolean {
  const t = contactTier(intervention);
  return t === "contact" || t === "voice";
}

export const TIER_LABEL: Record<ContactTier, string> = {
  silent: "Tier 1 · Silent",
  contact: "Tier 2 · Contact",
  voice: "Tier 3 · Voice",
  stop: "Stop",
};

export const TIER_COST_HINT: Record<ContactTier, string> = {
  silent: "₹0 · no customer contact",
  contact: "~₹0.35 · WhatsApp / link",
  voice: "~₹4.50 · Hinglish call",
  stop: "₹0 · no action",
};

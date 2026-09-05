import type { CallSession, CallTurn } from "../types";

export function callDurationSec(session: CallSession): number {
  if (session.turns.length === 0) return 18;
  return Math.max(22, session.turns.length * 24);
}

export function callMinutes(session: CallSession): number {
  return Math.max(1, Math.round(callDurationSec(session) / 60));
}

export function transcriptText(session: CallSession): string {
  return session.turns.map(t => t.text).filter(Boolean).join(" ");
}

export const MOCK_CALLS: CallSession[] = [
  {
    session_id: "mock_call_priya_upi",
    event_id: "demo_002",
    customer_name: "Priya Patel",
    scenario: "expired_card",
    live_llm: false,
    status: "ended",
    outcome: "upi_link_sent",
    created_at: "2026-09-04T11:18:00.000Z",
    updated_at: "2026-09-04T11:21:40.000Z",
    turns: [
      { who: "agent", text: "Namaste Priya, main Lumen Store se bol rahi hoon. Saved card expire ho chuka hai, isliye ₹2,999 cut nahi hua.", at: "2026-09-04T11:18:12.000Z" },
      { who: "you", text: "Haan, naya card abhi update nahi kiya.", at: "2026-09-04T11:18:40.000Z" },
      { who: "agent", text: "Koi baat nahi. UPI se nikal sakte ho — card update ki zaroorat nahi. Link WhatsApp pe bhej deti hoon.", at: "2026-09-04T11:19:05.000Z" },
      { who: "you", text: "Ok, send the link.", at: "2026-09-04T11:19:22.000Z" },
    ],
  },
  {
    session_id: "mock_call_arjun_emi",
    event_id: "demo_001",
    customer_name: "Arjun Sharma",
    scenario: "insufficient_funds",
    live_llm: true,
    status: "ended",
    outcome: "promise_to_pay",
    created_at: "2026-09-03T16:42:00.000Z",
    updated_at: "2026-09-03T16:47:10.000Z",
    turns: [
      { who: "agent", text: "Namaste Arjun, HDFC ne balance kam hone ki wajah se ₹4,200 decline kiya. Kya hua exactly?", at: "2026-09-03T16:42:20.000Z" },
      { who: "you", text: "Salary 7 tarikh ko aati hai.", at: "2026-09-03T16:43:01.000Z" },
      { who: "agent", text: "Theek hai. 3 EMI mein split kar sakte ho, ya 7 tarikh ko promise. Extra charge nahi.", at: "2026-09-03T16:43:40.000Z" },
      { who: "you", text: "7th ko kar dunga, full amount.", at: "2026-09-03T16:44:12.000Z" },
      { who: "agent", text: "Promise captured for 7 Sep. We will not nag until that date.", at: "2026-09-03T16:44:40.000Z" },
    ],
  },
  {
    session_id: "mock_call_rohit_timeout",
    event_id: "demo_003",
    customer_name: "Rohit Gupta",
    scenario: "gateway_timeout",
    live_llm: false,
    status: "ended",
    outcome: "silent_retry",
    created_at: "2026-09-02T09:05:00.000Z",
    updated_at: "2026-09-02T09:05:40.000Z",
    turns: [
      { who: "agent", text: "Bank timed out — this is not on you. Silent retry is already running. No customer nag required.", at: "2026-09-02T09:05:12.000Z" },
    ],
  },
];

export function turnsToRecordingScript(turns: CallTurn[]): string {
  const spoken = turns.filter(t => t.who === "agent").map(t => t.text);
  return spoken.join(". ") || "No agent audio was captured on this call.";
}

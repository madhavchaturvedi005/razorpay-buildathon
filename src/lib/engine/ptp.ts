import type { PtpExtract } from "../types";

// HappyGarg: Hinglish voice → structured promise-to-pay JSON.
// Rules parser is the LLM-absent path. It is deterministic and demo-complete.

function thisOrNextMonth(day: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const candidate = new Date(y, m, day);
  if (candidate.getDate() <= now.getDate() && day <= 28) {
    return iso(new Date(y, m + 1, day));
  }
  return iso(candidate);
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const HINDI_MONTH: Record<string, number> = {
  jan: 0, january: 0, farvari: 1, feb: 1, february: 1,
  march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
  july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

function parseDate(text: string): string | null {
  const din = text.match(/(\d{1,2})\s*(din|days?)\b/i);
  if (din) {
    const n = Number(din[1]);
    if (n >= 1 && n <= 90) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return iso(d);
    }
  }

  const tarikh = text.match(/(\d{1,2})\s*(tarikh|taarikh|th|st|nd|rd)/i);
  if (tarikh) return thisOrNextMonth(Number(tarikh[1]));

  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const dmy = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return iso(new Date(year, month, day));
  }

  const named = text.match(/(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)/i);
  if (named) {
    const day = Number(named[1]);
    const month = HINDI_MONTH[named[2].toLowerCase()] ?? 0;
    const now = new Date();
    let year = now.getFullYear();
    const dt = new Date(year, month, day);
    if (dt < now) year += 1;
    return iso(new Date(year, month, day));
  }

  if (/\b(kal|tomorrow)\b/i.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return iso(d);
  }
  if (/\b(parso|day after)\b/i.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return iso(d);
  }
  return null;
}

export function extractPtpRules(transcript: string, amountPaise: number): PtpExtract {
  const t = transcript.trim();
  const promised = parseDate(t);
  const isPtp =
    Boolean(promised) ||
    /de dunga|de dungi|pay kar dunga|payment kar|kal de|salary.*aa|payday/i.test(t);

  const wantsQuiet =
    /\b(dnd|do not (call|disturb)|mat call|call mat|opt[ -]?out|unsubscribe)\b/i.test(t);

  const dispute =
    /complaint|ombudsman|rbi|lawyer|vakil|police|thana|fraud|dhoka|court|cyber\s*cell/i.test(t);
  if (dispute) {
    return {
      intent: "complaint",
      promised_date: null,
      promised_amount_paise: null,
      hardship: false,
      do_not_call_until: null,
      dispute_language: true,
      confidence: 0.95,
      rationale: "Dispute/complaint language — RBI §454Z kill-switch",
      source: "degraded",
    };
  }

  if (/naukri (chali|nahi)|job (lost|loss)|layoff|ghar pe mariz|hospital|medical emergency|baarish|flood/i.test(t)) {
    return {
      intent: "hardship",
      promised_date: promised,
      promised_amount_paise: null,
      hardship: true,
      do_not_call_until: promised,
      dispute_language: false,
      confidence: 0.88,
      rationale: "Hardship signal — pause outreach, offer partial/EMI, do not escalate",
      source: "degraded",
    };
  }

  if (isPtp) {
    return {
      intent: "promise_to_pay",
      promised_date: promised,
      promised_amount_paise: amountPaise,
      hardship: false,
      do_not_call_until: wantsQuiet ? (promised ?? parseDate(t)) : promised,
      dispute_language: false,
      confidence: promised ? 0.92 : 0.7,
      rationale: promised
        ? `Promise captured for ${promised} — one check-back, then human if broken${wantsQuiet ? "; quiet until then" : ""}`
        : "Promise language without a clear date — schedule a single reminder",
      source: "degraded",
    };
  }

  if (wantsQuiet) {
    return {
      intent: "optout",
      promised_date: null,
      promised_amount_paise: null,
      hardship: false,
      do_not_call_until: promised,
      dispute_language: false,
      confidence: 0.9,
      rationale: "Customer asked not to be contacted",
      source: "degraded",
    };
  }

  if (/\b(nahi dunga|nahi de sakta|won't pay|will not pay|refuse)\b/i.test(t) && !/tab de|baad de|later/i.test(t)) {
    return {
      intent: "refuse",
      promised_date: null,
      promised_amount_paise: null,
      hardship: false,
      do_not_call_until: null,
      dispute_language: false,
      confidence: 0.8,
      rationale: "Explicit refusal — stop automated contact, queue human",
      source: "degraded",
    };
  }

  return {
    intent: "unknown",
    promised_date: null,
    promised_amount_paise: null,
    hardship: false,
    do_not_call_until: null,
    dispute_language: false,
    confidence: 0.4,
    rationale: "Could not classify — no automated contact from this turn",
    source: "degraded",
  };
}

export const CANNED_CALLS: {
  id: string;
  title: string;
  customer: string;
  amount_paise: number;
  event_id: string;
  language: string;
  transcript: string;
  expected: PtpExtract["intent"];
}[] = [
  {
    id: "ptp_payday",
    title: "Payday promise",
    customer: "Arjun Sharma",
    amount_paise: 420000,
    event_id: "demo_001",
    language: "Hinglish",
    transcript:
      "Bhai salary 15 tarikh ko aayegi, tab poora de dunga. Abhi mat call karna please — office mein baith ke baat nahi kar sakta.",
    expected: "promise_to_pay",
  },
  {
    id: "hardship",
    title: "Hardship — job loss",
    customer: "Kavya Nair",
    amount_paise: 299900,
    event_id: "demo_002",
    language: "Hinglish",
    transcript:
      "Naukri chali gayi last week, abhi nahi de sakta. Thoda time do, EMI pe baat kar sakte ho kya? Family ke saath manage kar rahi hoon.",
    expected: "hardship",
  },
  {
    id: "dispute",
    title: "Dispute language — kill switch",
    customer: "Sneha Iyer",
    amount_paise: 599900,
    event_id: "demo_005",
    language: "Hinglish",
    transcript:
      "Yeh toh fraud hai, maine yeh charge authorize nahi kiya. Complaint daal dungi RBI ombudsman mein. Lawyer ko bhej rahi hoon, ab call mat karna.",
    expected: "complaint",
  },
  {
    id: "refuse",
    title: "Refusal",
    customer: "Rohit Gupta",
    amount_paise: 149900,
    event_id: "demo_003",
    language: "English",
    transcript: "I will not pay this. Stop calling me. Put me on DND.",
    expected: "optout",
  },
];

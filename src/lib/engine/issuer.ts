import type { DiagnosisTag } from "../types";

// Reflex pattern: rules cover clean decline codes. The tail parses messy issuer
// strings that a lookup table cannot. This corpus matcher is the LLM-absent
// fallback (degraded mode). A live LLM is used when LLM_API_KEY is set.

export interface IssuerParse {
  tag: DiagnosisTag;
  confidence: number;
  rationale: string;
}

const PATTERNS: { re: RegExp; tag: DiagnosisTag; why: string }[] = [
  {
    re: /mandate[_\s-]*(revok|cancel|withdraw)|revoked_by_customer|enach[_\s-]*revok|upi[_\s-]*autopay[_\s-]*(cancel|revok)/i,
    tag: "subscription_upi_cancelled",
    why: "Issuer string indicates the UPI/eNACH mandate was withdrawn",
  },
  {
    re: /insufficient|not[_\s-]*sufficient|nsf|funds[_\s-]*not|low[_\s-]*balance|ecom[_\s-]*limit/i,
    tag: "insufficient_funds",
    why: "Issuer string indicates a soft funds decline",
  },
  {
    re: /expir(ed|y)|card[_\s-]*expired|\b54\b|invalid[_\s-]*card/i,
    tag: "expired_card",
    why: "Issuer string indicates expired or invalid card",
  },
  {
    re: /timeout|issuer[_\s-]*unavailable|bank[_\s-]*not[_\s-]*respond|91\b|96\b|switch[_\s-]*fail|gateway/i,
    tag: "gateway_timeout",
    why: "Issuer string indicates a transient switch/issuer timeout",
  },
  {
    re: /do[_\s-]*not[_\s-]*honor|\b05\b|stolen|lost[_\s-]*card|pick[_\s-]*up|account[_\s-]*closed|blocked[_\s-]*card|hard[_\s-]*declin/i,
    tag: "hard_decline",
    why: "Issuer string indicates a hard decline — retrying the same rail will fail",
  },
];

export function parseIssuerString(raw: string): IssuerParse {
  const text = raw.trim();
  if (!text) {
    return {
      tag: "gateway_timeout",
      confidence: 0.2,
      rationale: "Empty issuer string — safe default to transient timeout",
    };
  }
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { tag: p.tag, confidence: 0.86, rationale: p.why };
    }
  }
  return {
    tag: "gateway_timeout",
    confidence: 0.45,
    rationale: "Unmatched issuer string — conservative transient default (confidence-gated)",
  };
}

export const MESSY_ISSUER_EXAMPLES: { raw: string; expected: DiagnosisTag }[] = [
  { raw: "DO_NOT_HONOR / 05 / ISSUER_DECLINED / HDFC", expected: "hard_decline" },
  { raw: "HDFC_UPI_MANDATE_REVOKED_BY_CUSTOMER", expected: "subscription_upi_cancelled" },
  { raw: "INSUFFICIENT FUNDS - RRN: 609412334455 / NSF", expected: "insufficient_funds" },
  { raw: "ISSUER_UNAVAILABLE / 91 / BANK_NOT_RESPONDING", expected: "gateway_timeout" },
  { raw: "EXPIRED CARD XXXX5421 / RESP 54", expected: "expired_card" },
];

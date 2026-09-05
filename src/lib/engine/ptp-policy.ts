export type PtpPolicyReason = "within_policy" | "outside_window" | "no_date" | "past";

export interface PtpPolicyResult {
  allowed: boolean;
  reason: PtpPolicyReason;
  days_until: number | null;
  max_days: number;
  promised_date: string | null;
}

export function daysUntilIso(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function evaluatePtpPolicy(
  promisedDate: string | null,
  maxDays: number,
): PtpPolicyResult {
  const cap = Number.isFinite(maxDays) ? Math.max(1, Math.round(maxDays)) : 5;
  if (!promisedDate) {
    return {
      allowed: false,
      reason: "no_date",
      days_until: null,
      max_days: cap,
      promised_date: null,
    };
  }
  const days = daysUntilIso(promisedDate);
  if (days < 0) {
    return {
      allowed: false,
      reason: "past",
      days_until: days,
      max_days: cap,
      promised_date: promisedDate,
    };
  }
  if (days > cap) {
    return {
      allowed: false,
      reason: "outside_window",
      days_until: days,
      max_days: cap,
      promised_date: promisedDate,
    };
  }
  return {
    allowed: true,
    reason: "within_policy",
    days_until: days,
    max_days: cap,
    promised_date: promisedDate,
  };
}

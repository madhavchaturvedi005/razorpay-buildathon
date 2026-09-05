import { createHash } from "crypto";
import type { AuditLog } from "../types";

export const GENESIS_HASH = "0".repeat(64);

export function canonicalAudit(log: Pick<AuditLog, "log_id" | "event_id" | "diagnosis" | "reason_code" | "plain_english" | "intervention" | "outcome" | "amount" | "timestamp">): string {
  // Stable key order — never hash the hash fields themselves.
  return JSON.stringify({
    amount: log.amount,
    diagnosis: log.diagnosis,
    event_id: log.event_id,
    intervention: log.intervention,
    log_id: log.log_id,
    outcome: log.outcome,
    plain_english: log.plain_english,
    reason_code: log.reason_code,
    timestamp: log.timestamp,
  });
}

export function hashRow(seq: number, prevHash: string, canonical: string): string {
  return createHash("sha256")
    .update(`${seq}|${prevHash}|${canonical}`)
    .digest("hex");
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  broken_at: number | null;
  message: string;
}

export function verifyChain(logsOldestFirst: AuditLog[]): ChainCheck {
  let prev = GENESIS_HASH;
  for (const log of logsOldestFirst) {
    const seq = log.seq ?? 0;
    const expectedPrev = log.prev_hash ?? GENESIS_HASH;
    if (expectedPrev !== prev) {
      return {
        ok: false,
        checked: seq,
        broken_at: seq,
        message: `Chain fork at seq ${seq}: prev_hash does not match predecessor`,
      };
    }
    const expected = hashRow(seq, expectedPrev, canonicalAudit(log));
    if (!log.hash || log.hash !== expected) {
      return {
        ok: false,
        checked: seq,
        broken_at: seq,
        message: `Hash mismatch at seq ${seq} — payload was edited, deleted, or reordered`,
      };
    }
    prev = log.hash;
  }
  return {
    ok: true,
    checked: logsOldestFirst.length,
    broken_at: null,
    message: logsOldestFirst.length === 0
      ? "Empty ledger"
      : `Chain intact · ${logsOldestFirst.length} rows · SHA-256`,
  };
}

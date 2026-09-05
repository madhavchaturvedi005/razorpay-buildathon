import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type {
  RecoveryEvent,
  AuditLog,
  GuardrailConfig,
  PromiseToPay,
  CallSession,
  CallTurn,
  RecoveryPolicy,
  PolicyOffer,
  Discount,
} from "./types";
import { DEFAULT_GUARDRAIL_CONFIG as DEFAULT_CONFIG } from "./types";
import { canonicalAudit, GENESIS_HASH, hashRow, verifyChain } from "./engine/ledger";
import { DEFAULT_POLICIES, DEFAULT_DISCOUNTS } from "./engine/policies";

// ─── Database path ────────────────────────────────────────────────────────────
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "recovery.db");

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ─── Singleton connection ─────────────────────────────────────────────────────
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  migrateSchema(_db);
  initGuardrailConfig(_db);
  initPolicies(_db);
  return _db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      decline_code TEXT,
      days_overdue INTEGER NOT NULL DEFAULT 0,
      dispute_flag INTEGER NOT NULL DEFAULT 0,
      abandonment_reason TEXT,
      ground_truth_recoverable INTEGER NOT NULL DEFAULT 1,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      razorpay_order_id TEXT,
      razorpay_link_id TEXT,
      razorpay_invoice_id TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      log_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      plain_english TEXT NOT NULL,
      intervention TEXT NOT NULL DEFAULT 'none',
      secondary_offered TEXT,
      bound_checked TEXT NOT NULL,
      outcome TEXT NOT NULL,
      amount INTEGER NOT NULL,
      razorpay_ref TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempt_tracker (
      event_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      silent_retry_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS guardrail_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      contact_window_start TEXT NOT NULL DEFAULT '08:00',
      contact_window_end TEXT NOT NULL DEFAULT '19:00',
      attempt_cap INTEGER NOT NULL DEFAULT 5,
      discount_cap_pct REAL NOT NULL DEFAULT 5,
      human_handoff_day INTEGER NOT NULL DEFAULT 46,
      silent_retry_cap INTEGER NOT NULL DEFAULT 3,
      ptp_max_days INTEGER NOT NULL DEFAULT 5
    );

    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some(c => c.name === column);
}

function migrateSchema(db: Database.Database) {
  const eventCols: [string, string][] = [
    ["issuer_raw", "TEXT"],
  ];
  for (const [col, def] of eventCols) {
    if (!columnExists(db, "events", col)) {
      db.exec(`ALTER TABLE events ADD COLUMN ${col} ${def}`);
    }
  }

  const auditCols: [string, string][] = [
    ["seq", "INTEGER"],
    ["prev_hash", "TEXT"],
    ["hash", "TEXT"],
    ["ai_source", "TEXT DEFAULT 'rules'"],
    ["simulated", "INTEGER DEFAULT 0"],
  ];
  for (const [col, def] of auditCols) {
    if (!columnExists(db, "audit_logs", col)) {
      db.exec(`ALTER TABLE audit_logs ADD COLUMN ${col} ${def}`);
    }
  }

  if (!columnExists(db, "guardrail_config", "ptp_max_days")) {
    db.exec(`ALTER TABLE guardrail_config ADD COLUMN ptp_max_days INTEGER NOT NULL DEFAULT 5`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS promises (
      ptp_id TEXT PRIMARY KEY,
      event_id TEXT,
      customer_name TEXT NOT NULL,
      transcript TEXT NOT NULL,
      intent TEXT NOT NULL,
      promised_date TEXT,
      promised_amount_paise INTEGER,
      hardship INTEGER NOT NULL DEFAULT 0,
      do_not_call_until TEXT,
      dispute_language INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'degraded',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS call_sessions (
      session_id TEXT PRIMARY KEY,
      event_id TEXT,
      customer_name TEXT NOT NULL,
      scenario TEXT NOT NULL,
      live_llm INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'live',
      outcome TEXT,
      turns TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_policies (
      trigger TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      offers TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      percent_off REAL NOT NULL DEFAULT 0,
      code TEXT NOT NULL,
      min_cart_paise INTEGER NOT NULL DEFAULT 0,
      valid_hours INTEGER NOT NULL DEFAULT 24,
      trigger TEXT NOT NULL DEFAULT 'any',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  backfillHashes(db);
}

function backfillHashes(db: Database.Database) {
  const rows = db.prepare(
    "SELECT * FROM audit_logs WHERE hash IS NULL OR seq IS NULL ORDER BY timestamp ASC, log_id ASC",
  ).all() as Record<string, unknown>[];
  if (rows.length === 0) return;

  const last = db.prepare(
    "SELECT seq, hash FROM audit_logs WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1",
  ).get() as { seq: number; hash: string } | undefined;

  let seq = last?.seq ?? 0;
  let prev = last?.hash ?? GENESIS_HASH;

  const upd = db.prepare(
    "UPDATE audit_logs SET seq = ?, prev_hash = ?, hash = ? WHERE log_id = ?",
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      seq += 1;
      const canonical = canonicalAudit({
        log_id: String(r.log_id),
        event_id: String(r.event_id),
        diagnosis: r.diagnosis as never,
        reason_code: r.reason_code as never,
        plain_english: String(r.plain_english),
        intervention: r.intervention as never,
        outcome: r.outcome as never,
        amount: Number(r.amount),
        timestamp: String(r.timestamp),
      });
      const hash = hashRow(seq, prev, canonical);
      upd.run(seq, prev, hash, r.log_id);
      prev = hash;
    }
  });
  tx();
}

function initGuardrailConfig(db: Database.Database) {
  const existing = db.prepare("SELECT id FROM guardrail_config WHERE id = 1").get();
  if (!existing) {
    db.prepare(`
      INSERT INTO guardrail_config
        (id, contact_window_start, contact_window_end, attempt_cap, discount_cap_pct, human_handoff_day, silent_retry_cap)
      VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      DEFAULT_CONFIG.contact_window_start,
      DEFAULT_CONFIG.contact_window_end,
      DEFAULT_CONFIG.attempt_cap,
      DEFAULT_CONFIG.discount_cap_pct,
      DEFAULT_CONFIG.human_handoff_day,
      DEFAULT_CONFIG.silent_retry_cap,
    );
  }
}

function initPolicies(db: Database.Database) {
  const hasPolicy = db.prepare("SELECT COUNT(*) as c FROM recovery_policies").get() as { c: number };
  if (hasPolicy.c === 0) {
    const ins = db.prepare(
      "INSERT INTO recovery_policies (trigger, label, enabled, offers, updated_at) VALUES (?,?,?,?,?)",
    );
    for (const p of DEFAULT_POLICIES) {
      ins.run(p.trigger, p.label, p.enabled ? 1 : 0, JSON.stringify(p.offers), p.updated_at);
    }
  }
  const hasDiscount = db.prepare("SELECT COUNT(*) as c FROM discounts").get() as { c: number };
  if (hasDiscount.c === 0) {
    const ins = db.prepare(
      "INSERT INTO discounts (id, product, percent_off, code, min_cart_paise, valid_hours, trigger, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    );
    for (const d of DEFAULT_DISCOUNTS) {
      ins.run(d.id, d.product, d.percent_off, d.code, d.min_cart_paise, d.valid_hours, d.trigger, d.enabled ? 1 : 0, d.created_at);
    }
  }
}

// ─── Event helpers ────────────────────────────────────────────────────────────

function rowToEvent(row: Record<string, unknown>): RecoveryEvent {
  return {
    ...(row as unknown as RecoveryEvent),
    dispute_flag: Boolean(row.dispute_flag),
    ground_truth_recoverable: Boolean(row.ground_truth_recoverable),
    decline_code: (row.decline_code as RecoveryEvent["decline_code"]) ?? null,
    abandonment_reason: (row.abandonment_reason as string) ?? null,
    razorpay_order_id: (row.razorpay_order_id as string) ?? null,
    razorpay_link_id: (row.razorpay_link_id as string) ?? null,
    razorpay_invoice_id: (row.razorpay_invoice_id as string) ?? null,
    issuer_raw: (row.issuer_raw as string) ?? null,
  };
}

// ─── DB API ───────────────────────────────────────────────────────────────────

export const db = {
  // ── Events ──
  insertEvent(event: RecoveryEvent): void {
    const d = getDb();
    d.prepare(`
      INSERT OR REPLACE INTO events
        (event_id, type, amount, currency, customer_id, customer_name, customer_email,
         customer_phone, decline_code, days_overdue, dispute_flag, abandonment_reason,
         ground_truth_recoverable, timestamp, status, razorpay_order_id, razorpay_link_id, razorpay_invoice_id, issuer_raw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      event.event_id, event.type, event.amount, event.currency,
      event.customer_id, event.customer_name, event.customer_email, event.customer_phone,
      event.decline_code, event.days_overdue,
      event.dispute_flag ? 1 : 0,
      event.abandonment_reason,
      event.ground_truth_recoverable ? 1 : 0,
      event.timestamp, event.status,
      event.razorpay_order_id, event.razorpay_link_id, event.razorpay_invoice_id,
      event.issuer_raw ?? null,
    );
  },

  getEvent(id: string): RecoveryEvent | null {
    const row = getDb().prepare("SELECT * FROM events WHERE event_id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
  },

  listEvents(filter?: { type?: string; status?: string; limit?: number; offset?: number }): RecoveryEvent[] {
    let sql = "SELECT * FROM events WHERE 1=1";
    const params: (string | number)[] = [];
    if (filter?.type) { sql += " AND type = ?"; params.push(filter.type); }
    if (filter?.status) { sql += " AND status = ?"; params.push(filter.status); }
    sql += " ORDER BY timestamp DESC";
    if (filter?.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
    if (filter?.offset) { sql += " OFFSET ?"; params.push(filter.offset); }
    const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  },

  updateEventStatus(
    id: string,
    status: RecoveryEvent["status"],
    refs?: Partial<Pick<RecoveryEvent, "razorpay_order_id" | "razorpay_link_id" | "razorpay_invoice_id" | "dispute_flag">>,
  ): void {
    const d = getDb();
    d.prepare(`
      UPDATE events SET status = ?,
        razorpay_order_id = COALESCE(?, razorpay_order_id),
        razorpay_link_id  = COALESCE(?, razorpay_link_id),
        razorpay_invoice_id = COALESCE(?, razorpay_invoice_id),
        dispute_flag = COALESCE(?, dispute_flag)
      WHERE event_id = ?
    `).run(
      status,
      refs?.razorpay_order_id ?? null,
      refs?.razorpay_link_id ?? null,
      refs?.razorpay_invoice_id ?? null,
      refs?.dispute_flag !== undefined ? (refs.dispute_flag ? 1 : 0) : null,
      id,
    );
  },

  setDisputeFlag(id: string): void {
    getDb().prepare("UPDATE events SET dispute_flag = 1, status = 'blocked' WHERE event_id = ?").run(id);
  },

  countEvents(): { total: number; by_status: Record<string, number> } {
    const total = (getDb().prepare("SELECT COUNT(*) as c FROM events").get() as { c: number }).c;
    const rows = getDb().prepare("SELECT status, COUNT(*) as c FROM events GROUP BY status").all() as { status: string; c: number }[];
    const by_status: Record<string, number> = {};
    for (const r of rows) by_status[r.status] = r.c;
    return { total, by_status };
  },

  clearEvents(): void {
    const d = getDb();
    d.prepare("DELETE FROM events").run();
    d.prepare("DELETE FROM attempt_tracker").run();
    d.prepare("DELETE FROM audit_logs").run();
    d.prepare("DELETE FROM promises").run();
    d.prepare("DELETE FROM call_sessions").run();
  },

  // ── Audit log ──
  insertAuditLog(log: AuditLog): void {
    const d = getDb();
    const last = d.prepare(
      "SELECT seq, hash FROM audit_logs WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1",
    ).get() as { seq: number; hash: string } | undefined;
    const seq = (last?.seq ?? 0) + 1;
    const prev_hash = last?.hash ?? GENESIS_HASH;
    const hash = hashRow(seq, prev_hash, canonicalAudit(log));

    d.prepare(`
      INSERT INTO audit_logs
        (log_id, event_id, diagnosis, reason_code, plain_english, intervention,
         secondary_offered, bound_checked, outcome, amount, razorpay_ref, timestamp,
         seq, prev_hash, hash, ai_source, simulated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      log.log_id, log.event_id, log.diagnosis, log.reason_code, log.plain_english,
      log.intervention, log.secondary_offered, log.bound_checked,
      log.outcome, log.amount, log.razorpay_ref, log.timestamp,
      seq, prev_hash, hash, log.ai_source ?? "rules", log.simulated ? 1 : 0,
    );
  },

  listAuditLogs(filter?: { event_id?: string; outcome?: string; limit?: number; offset?: number }): AuditLog[] {
    let sql = "SELECT * FROM audit_logs WHERE 1=1";
    const params: (string | number)[] = [];
    if (filter?.event_id) { sql += " AND event_id = ?"; params.push(filter.event_id); }
    if (filter?.outcome) { sql += " AND outcome = ?"; params.push(filter.outcome); }
    sql += " ORDER BY timestamp DESC";
    if (filter?.limit) { sql += " LIMIT ?"; params.push(filter.limit); }
    if (filter?.offset) { sql += " OFFSET ?"; params.push(filter.offset); }
    const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      ...(r as unknown as AuditLog),
      secondary_offered: (r.secondary_offered as AuditLog["secondary_offered"]) ?? null,
      razorpay_ref: (r.razorpay_ref as string) ?? null,
      seq: (r.seq as number) ?? undefined,
      prev_hash: (r.prev_hash as string) ?? null,
      hash: (r.hash as string) ?? null,
      ai_source: (r.ai_source as AuditLog["ai_source"]) ?? "rules",
      simulated: Boolean(r.simulated),
    }));
  },

  countAuditLogs(): { total: number; by_outcome: Record<string, number> } {
    const total = (getDb().prepare("SELECT COUNT(*) as c FROM audit_logs").get() as { c: number }).c;
    const rows = getDb().prepare("SELECT outcome, COUNT(*) as c FROM audit_logs GROUP BY outcome").all() as { outcome: string; c: number }[];
    const by_outcome: Record<string, number> = {};
    for (const r of rows) by_outcome[r.outcome] = r.c;
    return { total, by_outcome };
  },

  // ── Attempt tracker ──
  getAttempts(event_id: string): { count: number; silent_retry_count: number } {
    const row = getDb().prepare("SELECT count, silent_retry_count FROM attempt_tracker WHERE event_id = ?").get(event_id) as { count: number; silent_retry_count: number } | undefined;
    return row ?? { count: 0, silent_retry_count: 0 };
  },

  incrementAttempt(event_id: string, isSilent = false): void {
    const d = getDb();
    const existing = d.prepare("SELECT count, silent_retry_count FROM attempt_tracker WHERE event_id = ?").get(event_id) as { count: number; silent_retry_count: number } | undefined;
    if (existing) {
      if (isSilent) {
        d.prepare("UPDATE attempt_tracker SET silent_retry_count = silent_retry_count + 1 WHERE event_id = ?")
          .run(event_id);
      } else {
        d.prepare("UPDATE attempt_tracker SET count = count + 1 WHERE event_id = ?")
          .run(event_id);
      }
    } else {
      d.prepare("INSERT INTO attempt_tracker (event_id, count, silent_retry_count) VALUES (?, ?, ?)")
        .run(event_id, isSilent ? 0 : 1, isSilent ? 1 : 0);
    }
  },

  // ── Guardrail config ──
  getGuardrailConfig(): GuardrailConfig {
    const row = getDb().prepare("SELECT * FROM guardrail_config WHERE id = 1").get() as GuardrailConfig | undefined;
    if (!row) return DEFAULT_CONFIG;
    return {
      ...DEFAULT_CONFIG,
      ...row,
      ptp_max_days: Number(row.ptp_max_days ?? DEFAULT_CONFIG.ptp_max_days),
    };
  },

  updateGuardrailConfig(patch: Partial<GuardrailConfig>): GuardrailConfig {
    const current = this.getGuardrailConfig();
    const merged = { ...current, ...patch };
    getDb().prepare(`
      UPDATE guardrail_config SET
        contact_window_start = ?,
        contact_window_end = ?,
        attempt_cap = ?,
        discount_cap_pct = ?,
        human_handoff_day = ?,
        silent_retry_cap = ?,
        ptp_max_days = ?
      WHERE id = 1
    `).run(
      merged.contact_window_start,
      merged.contact_window_end,
      merged.attempt_cap,
      merged.discount_cap_pct,
      merged.human_handoff_day,
      merged.silent_retry_cap,
      merged.ptp_max_days,
    );
    return merged;
  },

  listAuditOldestFirst(): AuditLog[] {
    const rows = getDb().prepare(
      "SELECT * FROM audit_logs WHERE seq IS NOT NULL ORDER BY seq ASC",
    ).all() as Record<string, unknown>[];
    return rows.map(r => ({
      ...(r as unknown as AuditLog),
      secondary_offered: (r.secondary_offered as AuditLog["secondary_offered"]) ?? null,
      razorpay_ref: (r.razorpay_ref as string) ?? null,
      seq: (r.seq as number) ?? undefined,
      prev_hash: (r.prev_hash as string) ?? null,
      hash: (r.hash as string) ?? null,
      ai_source: (r.ai_source as AuditLog["ai_source"]) ?? "rules",
      simulated: Boolean(r.simulated),
    }));
  },

  verifyAuditChain() {
    return verifyChain(this.listAuditOldestFirst());
  },

  tamperAuditLog(log_id: string): boolean {
    const result = getDb().prepare(
      "UPDATE audit_logs SET plain_english = ? WHERE log_id = ?",
    ).run("TAMPERED — this row was edited outside the append-only writer", log_id);
    return result.changes > 0;
  },

  insertPromise(p: PromiseToPay): void {
    getDb().prepare(`
      INSERT INTO promises
        (ptp_id, event_id, customer_name, transcript, intent, promised_date,
         promised_amount_paise, hardship, do_not_call_until, dispute_language,
         confidence, source, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      p.ptp_id, p.event_id, p.customer_name, p.transcript, p.intent, p.promised_date,
      p.promised_amount_paise, p.hardship ? 1 : 0, p.do_not_call_until,
      p.dispute_language ? 1 : 0, p.confidence, p.source, p.status, p.created_at,
    );
  },

  listPromises(limit = 50): PromiseToPay[] {
    const rows = getDb().prepare(
      "SELECT * FROM promises ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as Record<string, unknown>[];
    return rows.map(rowToPromise);
  },

  getOpenPromise(event_id: string): PromiseToPay | null {
    const row = getDb().prepare(
      `SELECT * FROM promises
       WHERE event_id = ? AND status = 'open' AND intent = 'promise_to_pay'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(event_id) as Record<string, unknown> | undefined;
    return row ? rowToPromise(row) : null;
  },

  insertCallSession(s: CallSession): void {
    getDb().prepare(`
      INSERT INTO call_sessions
        (session_id, event_id, customer_name, scenario, live_llm, status, outcome, turns, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      s.session_id, s.event_id, s.customer_name, s.scenario,
      s.live_llm ? 1 : 0, s.status, s.outcome,
      JSON.stringify(s.turns), s.created_at, s.updated_at,
    );
  },

  updateCallSession(session_id: string, patch: Partial<Pick<CallSession, "status" | "outcome" | "turns" | "live_llm">>): void {
    const cur = this.getCallSession(session_id);
    if (!cur) return;
    const next: CallSession = {
      ...cur,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    getDb().prepare(
      `UPDATE call_sessions SET status = ?, outcome = ?, turns = ?, live_llm = ?, updated_at = ? WHERE session_id = ?`,
    ).run(
      next.status, next.outcome, JSON.stringify(next.turns),
      next.live_llm ? 1 : 0, next.updated_at, session_id,
    );
  },

  getCallSession(session_id: string): CallSession | null {
    const row = getDb().prepare("SELECT * FROM call_sessions WHERE session_id = ?").get(session_id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  },

  listCallSessions(limit = 30): CallSession[] {
    const rows = getDb().prepare(
      "SELECT * FROM call_sessions ORDER BY updated_at DESC LIMIT ?",
    ).all(limit) as Record<string, unknown>[];
    return rows.map(rowToSession);
  },

  // ── Recovery policies ──
  listPolicies(): RecoveryPolicy[] {
    const rows = getDb().prepare("SELECT * FROM recovery_policies").all() as Record<string, unknown>[];
    return rows.map(rowToPolicy);
  },

  getPolicy(trigger: string): RecoveryPolicy | null {
    const row = getDb().prepare("SELECT * FROM recovery_policies WHERE trigger = ?").get(trigger) as Record<string, unknown> | undefined;
    return row ? rowToPolicy(row) : null;
  },

  updatePolicy(trigger: string, patch: Partial<Pick<RecoveryPolicy, "enabled" | "offers" | "label">>): RecoveryPolicy | null {
    const current = this.getPolicy(trigger);
    if (!current) return null;
    const merged: RecoveryPolicy = {
      ...current,
      ...patch,
      offers: patch.offers ?? current.offers,
      updated_at: new Date().toISOString(),
    };
    getDb().prepare(
      "UPDATE recovery_policies SET label = ?, enabled = ?, offers = ?, updated_at = ? WHERE trigger = ?",
    ).run(merged.label, merged.enabled ? 1 : 0, JSON.stringify(merged.offers), merged.updated_at, trigger);
    return merged;
  },

  resetPolicies(): void {
    const d = getDb();
    d.prepare("DELETE FROM recovery_policies").run();
    d.prepare("DELETE FROM discounts").run();
    initPolicies(d);
  },

  // ── Discounts ──
  listDiscounts(): Discount[] {
    const rows = getDb().prepare("SELECT * FROM discounts ORDER BY created_at DESC").all() as Record<string, unknown>[];
    return rows.map(rowToDiscount);
  },

  upsertDiscount(d: Discount): Discount {
    getDb().prepare(`
      INSERT OR REPLACE INTO discounts
        (id, product, percent_off, code, min_cart_paise, valid_hours, trigger, enabled, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      d.id, d.product, d.percent_off, d.code, d.min_cart_paise,
      d.valid_hours, d.trigger, d.enabled ? 1 : 0, d.created_at,
    );
    return d;
  },

  deleteDiscount(id: string): void {
    getDb().prepare("DELETE FROM discounts WHERE id = ?").run(id);
  },
};

function rowToPolicy(r: Record<string, unknown>): RecoveryPolicy {
  let offers: PolicyOffer[] = [];
  try { offers = JSON.parse(String(r.offers ?? "[]")) as PolicyOffer[]; } catch { offers = []; }
  return {
    trigger: String(r.trigger) as RecoveryPolicy["trigger"],
    label: String(r.label),
    enabled: Boolean(r.enabled),
    offers,
    updated_at: String(r.updated_at),
  };
}

function rowToDiscount(r: Record<string, unknown>): Discount {
  return {
    id: String(r.id),
    product: String(r.product),
    percent_off: Number(r.percent_off),
    code: String(r.code),
    min_cart_paise: Number(r.min_cart_paise),
    valid_hours: Number(r.valid_hours),
    trigger: r.trigger as Discount["trigger"],
    enabled: Boolean(r.enabled),
    created_at: String(r.created_at),
  };
}

function rowToPromise(r: Record<string, unknown>): PromiseToPay {
  return {
    ptp_id: String(r.ptp_id),
    event_id: (r.event_id as string) ?? null,
    customer_name: String(r.customer_name),
    transcript: String(r.transcript),
    intent: r.intent as PromiseToPay["intent"],
    promised_date: (r.promised_date as string) ?? null,
    promised_amount_paise: (r.promised_amount_paise as number) ?? null,
    hardship: Boolean(r.hardship),
    do_not_call_until: (r.do_not_call_until as string) ?? null,
    dispute_language: Boolean(r.dispute_language),
    confidence: Number(r.confidence),
    source: r.source as PromiseToPay["source"],
    status: r.status as PromiseToPay["status"],
    created_at: String(r.created_at),
  };
}

function rowToSession(r: Record<string, unknown>): CallSession {
  let turns: CallTurn[] = [];
  try { turns = JSON.parse(String(r.turns ?? "[]")) as CallTurn[]; } catch { turns = []; }
  return {
    session_id: String(r.session_id),
    event_id: (r.event_id as string) ?? null,
    customer_name: String(r.customer_name),
    scenario: String(r.scenario),
    live_llm: Boolean(r.live_llm),
    status: r.status as CallSession["status"],
    outcome: (r.outcome as string) ?? null,
    turns,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

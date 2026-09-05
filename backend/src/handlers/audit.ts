import type { Hono } from "hono";
import { db } from "@/lib/db";

export function mountAudit(app: Hono) {
  app.get("/api/audit", c => {
    const q = new URL(c.req.url).searchParams;
    const event_id = q.get("event_id") ?? undefined;
    const outcome = q.get("outcome") ?? undefined;
    const limit = parseInt(q.get("limit") ?? "100");
    const offset = parseInt(q.get("offset") ?? "0");
    return c.json({
      logs: db.listAuditLogs({ event_id, outcome, limit, offset }),
      counts: db.countAuditLogs(),
      limit,
      offset,
    });
  });

  app.get("/api/audit/verify", c => {
    const result = db.verifyAuditChain();
    const logs = db.listAuditOldestFirst();
    return c.json({
      ...result,
      head: logs.length ? logs[logs.length - 1]?.hash : null,
      genesis: logs[0]?.prev_hash ?? null,
    });
  });

  app.post("/api/audit/verify", async c => {
    const body = await c.req.json().catch(() => ({})) as { log_id?: string };
    const logs = db.listAuditLogs({ limit: 1 });
    const target = body.log_id ?? logs[0]?.log_id;
    if (!target) return c.json({ error: "No audit rows to tamper" }, 400);
    const ok = db.tamperAuditLog(target);
    return c.json({ tampered: ok, log_id: target, verify: db.verifyAuditChain() });
  });
}

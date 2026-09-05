import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const result = db.verifyAuditChain();
  const logs = db.listAuditOldestFirst();
  return NextResponse.json({
    ...result,
    head: logs.length ? logs[logs.length - 1]?.hash : null,
    genesis: logs[0]?.prev_hash ?? null,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { log_id?: string };
  const logs = db.listAuditLogs({ limit: 1 });
  const target = body.log_id ?? logs[0]?.log_id;
  if (!target) {
    return NextResponse.json({ error: "No audit rows to tamper" }, { status: 400 });
  }
  const ok = db.tamperAuditLog(target);
  const verify = db.verifyAuditChain();
  return NextResponse.json({
    tampered: ok,
    log_id: target,
    verify,
  });
}

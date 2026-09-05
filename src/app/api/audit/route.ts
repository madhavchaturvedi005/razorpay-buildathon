import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/audit?event_id=...&outcome=...&limit=...&offset=...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const event_id = searchParams.get("event_id") ?? undefined;
  const outcome = searchParams.get("outcome") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "100");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const logs = db.listAuditLogs({ event_id, outcome, limit, offset });
  const counts = db.countAuditLogs();

  return NextResponse.json({ logs, counts, limit, offset });
}

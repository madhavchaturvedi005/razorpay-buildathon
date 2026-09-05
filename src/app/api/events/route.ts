import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/events?type=...&status=...&limit=...&offset=...
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const type = searchParams.get("type") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const events = db.listEvents({ type, status, limit, offset });
  const counts = db.countEvents();

  return NextResponse.json({ events, counts, limit, offset });
}

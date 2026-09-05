import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSyntheticBatch, generateDemoEvents } from "@/lib/data/generator";

// POST /api/seed — generate and load the synthetic batch
// Query param: ?demo=true for demo-specific events only
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const demoOnly = searchParams.get("demo") === "true";

    // Clear existing data first
    db.clearEvents();

    const events = demoOnly ? generateDemoEvents() : [
      ...generateDemoEvents(),    // demo events first (for easy demo access)
      ...generateSyntheticBatch(),
    ];

    let inserted = 0;
    for (const event of events) {
      db.insertEvent(event);
      inserted++;
    }

    const demoCount = events.filter(e => e.event_id.startsWith("demo_")).length;

    return NextResponse.json({
      success: true,
      inserted,
      message: demoOnly
        ? `Seeded ${inserted} demo events`
        : `Seeded ${inserted} events (${demoCount} demo + ${inserted - demoCount} synthetic)`,
    });
  } catch (err) {
    console.error("Seed error:", err);
    return NextResponse.json(
      { error: "Seed failed", detail: String(err) },
      { status: 500 },
    );
  }
}

// GET /api/seed — return seed status
export async function GET() {
  const counts = db.countEvents();
  return NextResponse.json({ seeded: counts.total > 0, counts });
}

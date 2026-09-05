import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { measure } from "@/lib/engine/measurement";

function persist(result: ReturnType<typeof measure>) {
  try {
    const dir = path.join(process.cwd(), "eval");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "results.json"),
      JSON.stringify({ generated_at: new Date().toISOString(), ...result }, null, 2),
    );
  } catch {
    // eval write is best-effort (read-only deploys)
  }
}

export async function POST() {
  const events = db.listEvents({ limit: 550 });

  if (events.length === 0) {
    return NextResponse.json(
      { error: "No events seeded. Call POST /api/seed first." },
      { status: 400 },
    );
  }

  const result = measure(events);
  persist(result);

  return NextResponse.json({
    ...result,
    calibration_sources: [
      "Recurflux SaaS Payment Failure Report 2026",
      "RetentionLens State of Involuntary Churn 2026",
      "Slicker 2025 Lift Evaluation Protocol",
      "Razorpay UPI Autopay Guide 2026 (1 original + 3 NPCI retries)",
      "RBI Responsible Business Conduct 4th Amendment, 6 Aug 2026",
    ],
    measurement_note:
      "[SIMULATED, seed=42]. Four arms on the same batch. " +
      "Do-nothing vs naive retry vs playbook vs playbook+EV. " +
      "Mandate-revoked retries count as violations on the naive arm only.",
  });
}

export async function GET() {
  const events = db.listEvents({ limit: 550 });
  if (events.length === 0) {
    return NextResponse.json({ seeded: false });
  }
  const result = measure(events);
  return NextResponse.json({ seeded: true, ...result });
}

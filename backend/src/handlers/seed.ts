import type { Hono } from "hono";
import { db } from "@/lib/db";
import { generateSyntheticBatch, generateDemoEvents } from "@/lib/data/generator";
import { measure } from "@/lib/engine/measurement";
import fs from "fs";
import path from "path";

export function mountSeed(app: Hono) {
  app.get("/api/seed", c => {
    const counts = db.countEvents();
    return c.json({ seeded: counts.total > 0, counts });
  });

  app.post("/api/seed", async c => {
    try {
      const demoOnly = new URL(c.req.url).searchParams.get("demo") === "true";
      db.clearEvents();
      const events = demoOnly ? generateDemoEvents() : [...generateDemoEvents(), ...generateSyntheticBatch()];
      for (const event of events) db.insertEvent(event);
      const demoCount = events.filter(e => e.event_id.startsWith("demo_")).length;
      return c.json({
        success: true,
        inserted: events.length,
        message: demoOnly
          ? `Seeded ${events.length} demo events`
          : `Seeded ${events.length} events (${demoCount} demo + ${events.length - demoCount} synthetic)`,
      });
    } catch (err) {
      console.error("Seed error:", err);
      return c.json({ error: "Seed failed", detail: String(err) }, 500);
    }
  });

  app.get("/api/batch/run", c => {
    const events = db.listEvents({ limit: 550 });
    if (events.length === 0) return c.json({ seeded: false });
    return c.json({ seeded: true, ...measure(events) });
  });

  app.post("/api/batch/run", c => {
    const events = db.listEvents({ limit: 550 });
    if (events.length === 0) {
      return c.json({ error: "No events seeded. Call POST /api/seed first." }, 400);
    }
    const result = measure(events);
    try {
      const dir = path.join(process.cwd(), "eval");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "results.json"),
        JSON.stringify({ generated_at: new Date().toISOString(), ...result }, null, 2),
      );
    } catch { /* read-only deploys */ }
    return c.json({
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
  });
}

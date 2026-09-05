import type { Hono } from "hono";
import { db } from "@/lib/db";
import { geminiConfigured } from "@/lib/engine/gemini";
import { callMinutes } from "@/lib/engine/agent-line";

export function mountAgentLine(app: Hono) {
  app.get("/api/agent-line", c => {
    const config = db.getAgentLine();
    const calls = db.listCallSessions(80);
    const liveMinutes = calls
      .filter(x => !x.session_id.startsWith("mock_call_"))
      .reduce((sum, x) => sum + callMinutes(x), 0);
    const mockMinutes = calls
      .filter(x => x.session_id.startsWith("mock_call_"))
      .reduce((sum, x) => sum + callMinutes(x), 0);
    const minutes_used = Math.min(config.minutes_included, 168 + liveMinutes + mockMinutes);
    const calls_used = calls.length;
    const targets = db.listEvents({ status: "pending", limit: 40 });
    return c.json({
      config,
      subscription: {
        status: "active",
        plan: config.plan_label,
        renews_on: config.renews_on,
        price_paise: config.price_paise,
        minutes_included: config.minutes_included,
        minutes_used,
        minutes_remaining: Math.max(0, config.minutes_included - minutes_used),
        calls_included: config.calls_included,
        calls_used,
        calls_remaining: Math.max(0, config.calls_included - calls_used),
      },
      live_voice: geminiConfigured(),
      calls,
      targets: targets.map(e => ({
        event_id: e.event_id,
        customer_name: e.customer_name,
        customer_phone: e.customer_phone,
        amount: e.amount,
        type: e.type,
        decline_code: e.decline_code,
        scenario: e.decline_code ?? e.abandonment_reason ?? e.type,
      })),
    });
  });

  app.patch("/api/agent-line", async c => {
    const body = await c.req.json().catch(() => ({})) as {
      caller_name?: string;
      caller_number?: string;
      caller_display?: string;
      sip_enabled?: boolean;
    };
    const config = db.updateAgentLine({
      ...(typeof body.caller_name === "string" ? { caller_name: body.caller_name.trim() } : {}),
      ...(typeof body.caller_number === "string" ? { caller_number: body.caller_number.trim() } : {}),
      ...(typeof body.caller_display === "string" ? { caller_display: body.caller_display.trim() } : {}),
      ...(typeof body.sip_enabled === "boolean" ? { sip_enabled: body.sip_enabled } : {}),
    });
    return c.json({ config });
  });
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountAnalytics } from "./handlers/analytics";
import { mountAudit } from "./handlers/audit";
import { mountEvents } from "./handlers/events";
import { mountGuardrails } from "./handlers/guardrails";
import { mountPay } from "./handlers/pay";
import { mountPolicies } from "./handlers/policies";
import { mountSeed } from "./handlers/seed";
import { mountVoice } from "./handlers/voice";
import { mountWebhooks } from "./handlers/webhooks";
import { mountAgentLine } from "./handlers/agent-line";

export function createApp() {
  const app = new Hono();

  app.use("/api/*", cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",").map(s => s.trim()) || "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-razorpay-signature"],
  }));

  app.get("/health", c => c.json({
    ok: true,
    service: "recovery-os-backend",
    sqlite: true,
  }));

  app.get("/", c => c.json({
    service: "Recovery OS API",
    health: "/health",
    api: "/api",
  }));

  mountAnalytics(app);
  mountSeed(app);
  mountEvents(app);
  mountAudit(app);
  mountGuardrails(app);
  mountVoice(app);
  mountPay(app);
  mountPolicies(app);
  mountWebhooks(app);
  mountAgentLine(app);

  app.notFound(c => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal error", detail: String(err) }, 500);
  });

  return app;
}

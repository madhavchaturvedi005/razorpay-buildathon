import type { Hono } from "hono";
import { db } from "@/lib/db";
import { OFFER_META } from "@/lib/engine/policies";
import type { Discount, PolicyOffer } from "@/lib/types";

export function mountPolicies(app: Hono) {
  // ── Recovery policies (offers the agent may make per failure reason) ─────────
  app.get("/api/policies", c => c.json({
    policies: db.listPolicies(),
    discounts: db.listDiscounts(),
    discount_cap_pct: db.getGuardrailConfig().discount_cap_pct,
    offer_meta: OFFER_META,
  }));

  app.patch("/api/policies", async c => {
    const body = await c.req.json().catch(() => ({})) as {
      trigger?: string;
      enabled?: boolean;
      offers?: PolicyOffer[];
      label?: string;
    };
    if (!body.trigger) return c.json({ error: "trigger required" }, 400);
    const patch: { enabled?: boolean; offers?: PolicyOffer[]; label?: string } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (Array.isArray(body.offers)) patch.offers = body.offers;
    if (typeof body.label === "string") patch.label = body.label;
    const updated = db.updatePolicy(body.trigger, patch);
    if (!updated) return c.json({ error: "unknown trigger" }, 404);
    return c.json({ policy: updated });
  });

  app.post("/api/policies/reset", c => {
    db.resetPolicies();
    return c.json({ ok: true, policies: db.listPolicies(), discounts: db.listDiscounts() });
  });

  // ── Discounts catalog ────────────────────────────────────────────────────────
  app.get("/api/discounts", c => c.json({
    discounts: db.listDiscounts(),
    discount_cap_pct: db.getGuardrailConfig().discount_cap_pct,
  }));

  app.post("/api/discounts", async c => {
    const body = await c.req.json().catch(() => ({})) as Partial<Discount>;
    const now = new Date().toISOString();
    const discount: Discount = {
      id: body.id?.trim() || `disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      product: body.product?.trim() || "*",
      percent_off: Math.max(0, Math.min(100, Number(body.percent_off ?? 0))),
      code: (body.code?.trim() || `SAVE${Math.floor(Math.random() * 90 + 10)}`).toUpperCase(),
      min_cart_paise: Math.max(0, Number(body.min_cart_paise ?? 0)),
      valid_hours: Math.max(1, Number(body.valid_hours ?? 24)),
      trigger: (body.trigger as Discount["trigger"]) || "abandoned_cart",
      enabled: body.enabled ?? true,
      created_at: now,
    };
    db.upsertDiscount(discount);
    const cap = db.getGuardrailConfig().discount_cap_pct;
    return c.json({
      discount,
      over_cap: discount.percent_off > cap,
      discount_cap_pct: cap,
      discounts: db.listDiscounts(),
    });
  });

  app.delete("/api/discounts", async c => {
    const id = c.req.query("id");
    if (!id) return c.json({ error: "id required" }, 400);
    db.deleteDiscount(id);
    return c.json({ ok: true, discounts: db.listDiscounts() });
  });
}

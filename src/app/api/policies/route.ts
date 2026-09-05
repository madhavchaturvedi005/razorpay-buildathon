import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { OFFER_META } from "@/lib/engine/policies";
import type { PolicyOffer } from "@/lib/types";

// GET /api/policies — policies + discount catalog + offer metadata
export async function GET() {
  return NextResponse.json({
    policies: db.listPolicies(),
    discounts: db.listDiscounts(),
    discount_cap_pct: db.getGuardrailConfig().discount_cap_pct,
    offer_meta: OFFER_META,
  });
}

// PATCH /api/policies — update one policy (enable / offers / label)
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    trigger?: string;
    enabled?: boolean;
    offers?: PolicyOffer[];
    label?: string;
  };
  if (!body.trigger) return NextResponse.json({ error: "trigger required" }, { status: 400 });
  const patch: { enabled?: boolean; offers?: PolicyOffer[]; label?: string } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Array.isArray(body.offers)) patch.offers = body.offers;
  if (typeof body.label === "string") patch.label = body.label;
  const updated = db.updatePolicy(body.trigger, patch);
  if (!updated) return NextResponse.json({ error: "unknown trigger" }, { status: 404 });
  return NextResponse.json({ policy: updated });
}

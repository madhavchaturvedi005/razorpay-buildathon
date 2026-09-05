import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Discount } from "@/lib/types";

// GET /api/discounts — discount catalog
export async function GET() {
  return NextResponse.json({
    discounts: db.listDiscounts(),
    discount_cap_pct: db.getGuardrailConfig().discount_cap_pct,
  });
}

// POST /api/discounts — create or update a discount
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Partial<Discount>;
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
  return NextResponse.json({
    discount,
    over_cap: discount.percent_off > cap,
    discount_cap_pct: cap,
    discounts: db.listDiscounts(),
  });
}

// DELETE /api/discounts?id=... — remove a discount
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  db.deleteDiscount(id);
  return NextResponse.json({ ok: true, discounts: db.listDiscounts() });
}

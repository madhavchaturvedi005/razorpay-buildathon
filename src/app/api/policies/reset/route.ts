import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/policies/reset — restore default policies + discounts
export async function POST() {
  db.resetPolicies();
  return NextResponse.json({
    ok: true,
    policies: db.listPolicies(),
    discounts: db.listDiscounts(),
  });
}

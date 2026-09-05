import { NextResponse } from "next/server";
import { continueCall, openCall } from "@/lib/engine/apply-call";
import type { OfferType } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    session_id?: string;
    event_id?: string;
    scenario?: string;
    amount_paise?: number;
    customer_name?: string;
    utterance?: string;
    offer_id?: OfferType;
  };

  const utterance = body.utterance?.trim() ?? "";
  // A plain open call has neither an utterance nor an offer tap.
  if (!utterance && !body.offer_id) {
    const opened = await openCall(body);
    return NextResponse.json(opened);
  }

  const turned = await continueCall({
    ...body,
    utterance: utterance || `[offer:${body.offer_id}]`,
  });
  return NextResponse.json(turned);
}

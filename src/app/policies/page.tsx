"use client";

import { useEffect, useState } from "react";
import { Tag, Percent, Plus, Trash2, RotateCcw, AlertTriangle, Check } from "lucide-react";
import type { Discount, OfferType, PolicyOffer, RecoveryPolicy } from "@/lib/types";

interface PoliciesPayload {
  policies: RecoveryPolicy[];
  discounts: Discount[];
  discount_cap_pct: number;
  offer_meta: Record<OfferType, { title: string; blurb: string }>;
}

const TRIGGER_HELP: Record<string, string> = {
  insufficient_funds: "Card declined for low balance. The agent can offer a UPI link (pay from any account), split into EMI, or take a partial payment.",
  expired_card: "Saved card is dead. Retrying never works — push a UPI link or a card-update portal.",
  hard_decline: "Issuer hard-declined. Route to UPI or a different card.",
  gateway_timeout: "Bank timed out — not the customer's fault. Retry silently, no contact.",
  abandoned_cart_price: "Reached the payment page, then left over cost. Offer a discount from the catalog or EMI to close it.",
  abandoned_cart_signup: "Bounced at a forced signup. Send a guest-checkout link — no account needed.",
  overdue_invoice: "B2B invoice overdue. Reminder + link first, then an early-settlement discount or a 50/50 split.",
  subscription_cancelled: "UPI mandate revoked. Debiting again is unauthorised — do not push. Only a fresh opt-in mandate if they ask.",
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default function PoliciesPage() {
  const [data, setData] = useState<PoliciesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTrigger, setSavingTrigger] = useState<string | null>(null);
  const [savedTrigger, setSavedTrigger] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch("/api/policies")
      .then(r => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(String(e?.message ?? e)));
  }
  useEffect(load, []);

  async function savePolicy(p: RecoveryPolicy, patch: Partial<RecoveryPolicy>) {
    setSavingTrigger(p.trigger);
    const res = await fetch("/api/policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: p.trigger, ...patch }),
    });
    const out = await res.json();
    setData(prev => prev ? { ...prev, policies: prev.policies.map(x => x.trigger === p.trigger ? out.policy : x) } : prev);
    setSavingTrigger(null);
    setSavedTrigger(p.trigger);
    window.setTimeout(() => setSavedTrigger(s => s === p.trigger ? null : s), 1500);
  }

  function patchOffer(p: RecoveryPolicy, idx: number, patch: Partial<PolicyOffer>) {
    const offers = p.offers.map((o, i) => i === idx ? { ...o, ...patch } : o);
    savePolicy(p, { offers });
  }

  async function resetAll() {
    await fetch("/api/policies/reset", { method: "POST" });
    load();
  }

  if (error) {
    return (
      <div className="max-w-lg rounded-xl border border-red-800 bg-red-950/40 p-5">
        <div className="text-sm font-semibold text-red-400">Couldn’t load policies</div>
        <p className="mt-1 text-xs text-gray-400">{error}</p>
        <p className="mt-2 text-[11px] text-gray-500">
          Make sure the API is running. If you run the servers separately, restart the backend so the new routes load, or use <span className="font-mono text-gray-300">npm run dev</span>.
        </p>
        <button onClick={load} className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/15">
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-gray-500">Loading policies…</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Tag className="h-5 w-5 text-indigo-400" /> Policies &amp; Discounts
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            This is what the AI agent is <span className="text-gray-200">allowed</span> to offer on a call. Toggle an offer off and the agent will never mention it. Money actions (UPI link, EMI, discount code) are executed deterministically and logged to the audit trail — the model only narrates them in Hinglish.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Discounts above your guardrail cap of <span className="font-mono text-amber-300">{data.discount_cap_pct}%</span> can’t be auto-applied on a call — they’re blocked and queued for human approval.
          </p>
        </div>
        <button
          onClick={resetAll}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
        </button>
      </div>

      {/* ── Recovery policies ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Recovery playbook — offer per reason</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.policies.map(p => (
            <div key={p.trigger} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{p.label}</span>
                    {savingTrigger === p.trigger && <span className="text-[10px] text-gray-500">saving…</span>}
                    {savedTrigger === p.trigger && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{TRIGGER_HELP[p.trigger]}</p>
                </div>
                <Toggle
                  on={p.enabled}
                  onChange={v => savePolicy(p, { enabled: v })}
                />
              </div>

              <div className="mt-4 space-y-2">
                {p.offers.map((o, i) => (
                  <div
                    key={`${o.type}-${i}`}
                    className={`rounded-lg border p-3 transition-colors ${
                      o.enabled ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-transparent opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-gray-200">{data.offer_meta[o.type]?.title ?? o.type}</div>
                        <div className="text-[11px] text-gray-500">{data.offer_meta[o.type]?.blurb}</div>
                      </div>
                      <Toggle on={o.enabled} onChange={v => patchOffer(p, i, { enabled: v })} small />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        Press key
                        <input
                          type="number"
                          min={0}
                          max={9}
                          value={o.press_key ?? ""}
                          placeholder="—"
                          onChange={e => patchOffer(p, i, { press_key: e.target.value === "" ? null : Number(e.target.value) })}
                          className="w-12 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-center text-gray-200 outline-none"
                        />
                      </label>
                      {o.type === "emi" && (
                        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                          EMI months
                          <input
                            type="number"
                            min={2}
                            max={24}
                            value={o.emi_months ?? 3}
                            onChange={e => patchOffer(p, i, { emi_months: Number(e.target.value) })}
                            className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-center text-gray-200 outline-none"
                          />
                        </label>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] italic text-gray-500">“{o.say}”</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Discounts catalog ─────────────────────────────────────────────── */}
      <DiscountCatalog
        discounts={data.discounts}
        cap={data.discount_cap_pct}
        onChange={load}
      />
    </div>
  );
}

function Toggle({ on, onChange, small }: { on: boolean; onChange: (v: boolean) => void; small?: boolean }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors ${small ? "h-4 w-7" : "h-5 w-9"} ${
        on ? "bg-emerald-500" : "bg-white/15"
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
          small ? "h-3 w-3" : "h-4 w-4"
        } ${on ? (small ? "translate-x-3" : "translate-x-4") : "translate-x-0"}`}
      />
    </button>
  );
}

function DiscountCatalog({ discounts, cap, onChange }: { discounts: Discount[]; cap: number; onChange: () => void }) {
  const [form, setForm] = useState({
    product: "",
    percent_off: 10,
    code: "",
    min_cart: 0,
    valid_hours: 48,
    trigger: "abandoned_cart" as Discount["trigger"],
  });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: form.product || "*",
        percent_off: form.percent_off,
        code: form.code,
        min_cart_paise: Math.round(form.min_cart * 100),
        valid_hours: form.valid_hours,
        trigger: form.trigger,
      }),
    });
    setForm(f => ({ ...f, product: "", code: "" }));
    setBusy(false);
    onChange();
  }

  async function toggle(d: Discount) {
    await fetch("/api/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...d, min_cart_paise: d.min_cart_paise, enabled: !d.enabled }),
    });
    onChange();
  }

  async function remove(id: string) {
    await fetch(`/api/discounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
        <Percent className="h-4 w-4" /> Discount catalog
      </h2>

      <div className="overflow-hidden rounded-xl border border-white/[0.06]">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-4 py-2.5 font-medium">Off</th>
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Min cart</th>
              <th className="px-4 py-2.5 font-medium">Valid</th>
              <th className="px-4 py-2.5 font-medium">For</th>
              <th className="px-4 py-2.5 font-medium">On</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {discounts.map(d => {
              const overCap = d.percent_off > cap;
              return (
                <tr key={d.id} className="border-t border-white/[0.05]">
                  <td className="px-4 py-2.5 text-gray-200">{d.product === "*" ? "Any cart" : d.product}</td>
                  <td className="px-4 py-2.5">
                    <span className={overCap ? "text-amber-300" : "text-gray-200"}>{d.percent_off}%</span>
                    {overCap && (
                      <span title={`Over ${cap}% cap — needs human approval`}>
                        <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-indigo-300">{d.code}</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.min_cart_paise ? rupees(d.min_cart_paise) : "—"}</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.valid_hours}h</td>
                  <td className="px-4 py-2.5 text-gray-400">{d.trigger.replace("_", " ")}</td>
                  <td className="px-4 py-2.5">
                    <Toggle on={d.enabled} onChange={() => toggle(d)} small />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => remove(d.id)} className="text-gray-500 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {discounts.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">No discounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Add a discount</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input
            value={form.product}
            onChange={e => setForm(f => ({ ...f, product: e.target.value }))}
            placeholder="Product (blank = any)"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 lg:col-span-2"
          />
          <input
            type="number" min={0} max={100}
            value={form.percent_off}
            onChange={e => setForm(f => ({ ...f, percent_off: Number(e.target.value) }))}
            placeholder="% off"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-gray-200 outline-none"
          />
          <input
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="CODE (auto)"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-gray-200 outline-none placeholder:text-gray-600"
          />
          <input
            type="number" min={0}
            value={form.min_cart}
            onChange={e => setForm(f => ({ ...f, min_cart: Number(e.target.value) }))}
            placeholder="Min cart ₹"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-gray-200 outline-none"
          />
          <select
            value={form.trigger}
            onChange={e => setForm(f => ({ ...f, trigger: e.target.value as Discount["trigger"] }))}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-gray-200 outline-none"
          >
            <option value="abandoned_cart">Abandoned cart</option>
            <option value="overdue_invoice">Overdue invoice</option>
            <option value="any">Any</option>
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
            Valid
            <input
              type="number" min={1}
              value={form.valid_hours}
              onChange={e => setForm(f => ({ ...f, valid_hours: Number(e.target.value) }))}
              className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-center text-gray-200 outline-none"
            />
            hours
          </label>
          {form.percent_off > cap && (
            <span className="flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle className="h-3 w-3" /> Above {cap}% cap — will need human approval on calls
            </span>
          )}
          <button
            onClick={add}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add discount
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Home, CreditCard, FileText, ShoppingBag, Landmark, Search,
  Bell, ChevronDown, Plus, Wallet, Sparkles, AlertTriangle,
  CheckCircle2, XCircle, Clock, Shield, Smartphone, RefreshCw,
  ArrowRight, Info, X, Phone,
} from "lucide-react";
import { PerspectiveSwitch } from "../_components/PerspectiveSwitch";
import { IncomingCall } from "../_components/IncomingCall";
import { inr } from "@/lib/ui/format";
import {
  DEMO_CUSTOMER, DEMO_MERCHANT, PAST_TXNS, SCENARIOS, getScenario,
  type DemoScenario, type DemoTxn, type ScenarioDef,
} from "@/lib/demo/razorpay-account";

type PayMethod = "upi" | "card";
type CheckoutPhase = "closed" | "open" | "processing" | "failed" | "success";

const EVENT_FOR: Record<DemoScenario, string> = {
  insufficient_funds: "demo_001",
  expired_card: "demo_002",
  gateway_timeout: "demo_003",
  overdue_invoice: "demo_006",
  abandoned_cart: "demo_001",
};

export default function CustomerRazorpayDashboard() {
  const [scenarioId, setScenarioId] = useState<DemoScenario>("insufficient_funds");
  const scenario = getScenario(scenarioId);

  const [nav, setNav] = useState<ScenarioDef["nav"]>(scenario.nav);
  const [wallet, setWallet] = useState(scenario.wallet);
  const [txns, setTxns] = useState<DemoTxn[]>(PAST_TXNS);
  const [phase, setPhase] = useState<CheckoutPhase>("closed");
  const [method, setMethod] = useState<PayMethod>("upi");
  const [failReason, setFailReason] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paidId, setPaidId] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [coupon, setCoupon] = useState<{ code: string; percent: number; new_amount: number; valid_hours: number } | null>(null);

  useEffect(() => {
    const s = getScenario(scenarioId);
    setNav(s.nav);
    setWallet(s.wallet);
    setTxns(PAST_TXNS);
    setPhase("closed");
    setFailReason(null);
    setPaidId(null);
    setAddOpen(false);
    setMethod("card");
    setCallOpen(false);
    setCoupon(null);
  }, [scenarioId]);

  // Abandoned cart → recovery IVR rings automatically
  useEffect(() => {
    if (scenarioId !== "abandoned_cart" || paidId) return;
    const t = window.setTimeout(() => setCallOpen(true), 1600);
    return () => window.clearTimeout(t);
  }, [scenarioId, paidId]);

  useEffect(() => {
    if (scenarioId === "abandoned_cart") return;
    if (phase !== "failed" || paidId) return;
    if (scenario.id === "gateway_timeout") return;
    const t = window.setTimeout(() => setCallOpen(true), 1600);
    return () => window.clearTimeout(t);
  }, [phase, scenario.id, paidId, scenarioId]);

  const payable = coupon?.new_amount ?? scenario.due;
  const canCover = wallet >= payable;
  const shortfall = Math.max(0, payable - wallet);

  function attemptPay() {
    setPhase("processing");
    window.setTimeout(() => {
      if (scenario.id === "expired_card" && method === "card") {
        setFailReason("Your card has expired. Try UPI or update the card.");
        setPhase("failed");
        return;
      }
      if (scenario.id === "gateway_timeout") {
        setFailReason("Bank did not respond in time. We’re retrying silently — you don’t need to do anything.");
        setPhase("failed");
        return;
      }
      if (!canCover && method === "card") {
        setFailReason(`Insufficient funds. Available ${inr(wallet)}, required ${inr(payable)}.`);
        setPhase("failed");
        return;
      }
      completePay();
    }, 1100);
  }

  async function completePay() {
    const paymentId = `pay_${Math.random().toString(36).slice(2, 10)}`;
    // UPI can pull from another account — don't drain this HDFC wallet in that case
    const debitWallet = method === "card";
    if (debitWallet) setWallet(w => Math.max(0, w - payable));
    setTxns(prev => [{
      id: paymentId,
      amount: payable,
      status: "captured",
      method: method === "upi" ? "UPI" : "Card",
      note: scenario.id === "overdue_invoice" ? "INV-2048" : DEMO_MERCHANT.name,
      time: "Just now",
    }, ...prev]);
    setPaidId(paymentId);
    setPhase("success");
    try {
      await fetch(`/api/pay/${EVENT_FOR[scenario.id]}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulated: true, razorpay_payment_id: paymentId }),
      });
    } catch { /* demo still succeeds locally */ }
  }

  function addMoney(amount: number) {
    setWallet(w => w + amount);
    setAddOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#F4F6F8] text-[#1A1A1A] flex flex-col">
      <div className="z-50 flex flex-wrap items-center gap-3 bg-[#0D111C] px-4 py-2 text-white">
        <span className="rounded bg-[#F5A623] px-2 py-0.5 text-[10px] font-bold tracking-wide text-black">TEST MODE</span>
        <span className="hidden sm:inline text-[11px] text-white/50">Demo account · no real money</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              onClick={() => setScenarioId(s.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                scenarioId === s.id ? "bg-white text-[#0D111C]" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto"><PerspectiveSwitch light /></div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden md:flex w-[220px] shrink-0 flex-col bg-[#02042B] text-white">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <RzpMark />
            <span className="text-[15px] font-semibold tracking-tight">Razorpay</span>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            <SideItem icon={Home} label="Home" active={nav === "home"} onClick={() => setNav("home")} />
            <SideItem icon={CreditCard} label="Payments" active={nav === "payments"} onClick={() => setNav("payments")} />
            <SideItem icon={FileText} label="Invoices" active={nav === "invoices"} onClick={() => setNav("invoices")} badge={scenario.id === "overdue_invoice" && !paidId ? "1" : undefined} />
            <SideItem icon={ShoppingBag} label="Checkout" active={nav === "checkout"} onClick={() => setNav("checkout")} badge={scenario.id === "abandoned_cart" && !paidId ? "3" : undefined} />
            <SideItem icon={Landmark} label="Settlements" muted />
          </nav>
          <div className="border-t border-white/10 px-4 py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2B84EA] text-xs font-bold">AS</div>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{DEMO_CUSTOMER.name}</div>
                <div className="truncate text-[10px] text-white/40">{DEMO_CUSTOMER.email}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-6">
            <div className="relative hidden sm:block flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input placeholder="Search payments, invoices…" className="w-full rounded-md border border-slate-200 bg-[#F4F6F8] py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[#2B84EA]" />
            </div>
            <button className="relative ml-auto text-slate-500 hover:text-slate-800">
              <Bell className="h-5 w-5" />
              {!paidId && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#E51A3A]" />}
            </button>
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-sm">
              <span className="hidden sm:inline text-slate-600">{DEMO_CUSTOMER.firstName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-6xl grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
              <div className="space-y-5 min-w-0">
                {nav === "home" && (
                  <HomePane wallet={wallet} scenario={scenario} paid={!!paidId} onAdd={() => setAddOpen(true)} onPay={() => setPhase("open")} />
                )}
                {nav === "payments" && (
                  <PaymentsPane wallet={wallet} scenario={scenario} txns={txns} paid={!!paidId} onPay={() => setPhase("open")} onAdd={() => setAddOpen(true)} />
                )}
                {nav === "invoices" && (
                  <InvoicePane scenario={scenario} paid={!!paidId} onPay={() => setPhase("open")} />
                )}
                {nav === "checkout" && (
                  <CartPane
                    scenario={scenario}
                    paid={!!paidId}
                    coupon={coupon}
                    calling={callOpen && scenario.id === "abandoned_cart"}
                    onPay={() => setPhase("open")}
                  />
                )}
              </div>
                  <AiPanel scenario={scenario} wallet={wallet} paid={!!paidId} shortfall={shortfall} onCall={() => setCallOpen(true)} />
            </div>
          </main>
        </div>
      </div>

      {phase !== "closed" && (
        <CheckoutModal
          scenario={scenario}
          amount={payable}
          wallet={wallet}
          method={method}
          setMethod={setMethod}
          phase={phase}
          failReason={failReason}
          paidId={paidId}
          canCover={canCover}
          onClose={() => setPhase("closed")}
          onPay={attemptPay}
          onAdd={() => { setPhase("closed"); setAddOpen(true); }}
          onSwitchUpi={() => { setMethod("upi"); setPhase("open"); setFailReason(null); }}
        />
      )}

      {addOpen && (
        <AddMoneyModal shortfall={shortfall} onClose={() => setAddOpen(false)} onAdd={addMoney} />
      )}

      {callOpen && (
        <IncomingCall
          scenario={scenario.id}
          amountPaise={scenario.due}
          eventId={EVENT_FOR[scenario.id]}
          customerName={DEMO_CUSTOMER.name}
          onClose={() => setCallOpen(false)}
          onCouponApplied={c => setCoupon(c)}
        />
      )}
    </div>
  );
}

function RzpMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2B84EA] text-[15px] font-black italic leading-none">
      R
    </div>
  );
}

function SideItem({
  icon: Icon, label, active, onClick, badge, muted,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; active?: boolean; onClick?: () => void; badge?: string; muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={muted}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium ${
        muted ? "cursor-default text-white/25"
        : active ? "bg-white/10 text-white"
        : "text-white/65 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-left">{label}</span>
      {badge && <span className="rounded-full bg-[#E51A3A] px-1.5 text-[10px] font-bold">{badge}</span>}
    </button>
  );
}

function HomePane({
  wallet, scenario, paid, onAdd, onPay,
}: {
  wallet: number; scenario: ScenarioDef; paid: boolean;
  onAdd: () => void; onPay: () => void;
}) {
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Account balance</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{inr(wallet, { decimals: true })}</div>
          <div className="mt-1 text-xs text-slate-500">{DEMO_CUSTOMER.bank} ····{DEMO_CUSTOMER.accountLast4} · {DEMO_CUSTOMER.upi}</div>
        </div>
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-md bg-[#2B84EA] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#1f74d6]">
          <Plus className="h-4 w-4" /> Add money
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="This month spent" value={inr(234800, { compact: true })} />
        <MiniStat label="Captured" value="11" />
        <MiniStat label="Failed" value={paid ? "0" : "1"} warn={!paid} />
      </div>
      {!paid && <IssueBanner scenario={scenario} onPay={onPay} onAdd={onAdd} wallet={wallet} />}
      {paid && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <div className="text-sm font-semibold text-emerald-900">You’re all clear</div>
            <p className="text-sm text-emerald-800/80">The outstanding payment is captured. Wallet updated.</p>
          </div>
        </div>
      )}
    </>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${warn ? "text-[#E51A3A]" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function IssueBanner({ scenario, onPay, onAdd, wallet }: { scenario: ScenarioDef; onPay: () => void; onAdd: () => void; wallet: number }) {
  const needTopup = wallet < scenario.due && scenario.id === "insufficient_funds";
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-950">{scenario.description}</div>
          <p className="mt-0.5 text-sm text-amber-900/70">Amount due {inr(scenario.due)} · Wallet {inr(wallet)}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={onPay} className="rounded-md bg-[#2B84EA] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1f74d6]">Pay now</button>
            {needTopup && (
              <button onClick={onAdd} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">Add money first</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentsPane({
  wallet, scenario, txns, paid, onPay, onAdd,
}: {
  wallet: number; scenario: ScenarioDef; txns: DemoTxn[]; paid: boolean;
  onPay: () => void; onAdd: () => void;
}) {
  const failedRow: DemoTxn | null = paid || !scenario.decline ? null : {
    id: "pay_failed_live",
    amount: scenario.due,
    status: "failed",
    method: "Card",
    note: scenario.decline.replace(/_/g, " "),
    time: "Today, 9:41 PM",
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500">Live test-mode ledger for this demo account</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-400">Wallet</div>
          <div className="text-sm font-semibold tabular-nums">{inr(wallet)}</div>
        </div>
      </div>
      {!paid && <IssueBanner scenario={scenario} onPay={onPay} onAdd={onAdd} wallet={wallet} />}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-[#FAFBFC] text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5 font-medium">Payment ID</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Method</th>
              <th className="px-4 py-2.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {failedRow && <TxnRow t={failedRow} />}
            {txns.map(t => <TxnRow key={t.id} t={t} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TxnRow({ t }: { t: DemoTxn }) {
  const tone =
    t.status === "captured" ? "bg-emerald-50 text-emerald-700" :
    t.status === "failed" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600";
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-4 py-3 font-mono text-xs text-[#2B84EA]">{t.id}</td>
      <td className="px-4 py-3 font-medium tabular-nums">{inr(t.amount)}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone}`}>{t.status}</span>
        {t.status === "failed" && <span className="ml-2 text-[11px] text-slate-400">{t.note}</span>}
      </td>
      <td className="px-4 py-3 text-slate-600">{t.method}</td>
      <td className="px-4 py-3 text-slate-500">{t.time}</td>
    </tr>
  );
}

function InvoicePane({ scenario, paid, onPay }: { scenario: ScenarioDef; paid: boolean; onPay: () => void }) {
  const inv = scenario.invoice;
  if (scenario.id !== "overdue_invoice" || !inv) {
    return <EmptyState title="No open invoices" body="Switch the issue toggle to “Overdue invoice” to open INV-2048." />;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <RzpMark />
          <div>
            <div className="text-sm font-semibold">{DEMO_MERCHANT.legal}</div>
            <div className="text-[11px] text-slate-400">GSTIN {DEMO_MERCHANT.gstin}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Invoice</div>
          <div className="font-mono text-sm font-semibold">{inv.number}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-5 text-sm">
        <div>
          <div className="text-[11px] uppercase text-slate-400">Billed to</div>
          <div className="mt-1 font-medium">{DEMO_CUSTOMER.name}</div>
          <div className="text-slate-500">{DEMO_CUSTOMER.email}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase text-slate-400">Dates</div>
          <div className="mt-1">Issued {inv.issued}</div>
          <div className="text-[#E51A3A] font-medium">Due {inv.dueDate} · {inv.daysOverdue} days overdue</div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-100 bg-[#FAFBFC] text-left text-[11px] uppercase text-slate-400">
            <th className="px-6 py-2 font-medium">Item</th>
            <th className="px-6 py-2 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-6 py-3">Professional services — August 2026</td>
            <td className="px-6 py-3 text-right tabular-nums">{inr(scenario.due)}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center justify-between px-6 py-5">
        <div className="text-xs text-slate-500">Late fee not applied yet · grace window</div>
        {paid ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Paid
          </span>
        ) : (
          <button onClick={onPay} className="rounded-md bg-[#2B84EA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f74d6]">
            Pay {inr(scenario.due)}
          </button>
        )}
      </div>
    </div>
  );
}

function CartPane({
  scenario, paid, coupon, calling, onPay,
}: {
  scenario: ScenarioDef;
  paid: boolean;
  coupon: { code: string; percent: number; new_amount: number; valid_hours: number } | null;
  calling: boolean;
  onPay: () => void;
}) {
  const cart = scenario.cart;
  if (scenario.id !== "abandoned_cart" || !cart) {
    return <EmptyState title="Cart is empty" body="Switch the issue toggle to “Abandoned cart” to open Lumen Store checkout. The recovery agent will call with a coupon." />;
  }
  const sub = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const total = coupon?.new_amount ?? scenario.due;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between bg-slate-900 px-5 py-3 text-white">
        <div className="text-sm font-semibold">{DEMO_MERCHANT.name}</div>
        <div className="text-[11px] text-white/50">Guest checkout · powered by Razorpay</div>
      </div>
      {calling && !coupon && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          <Phone className="h-3.5 w-3.5" />
          You left this cart. Lumen Store is calling with a coupon — Answer, then press 1.
        </div>
      )}
      {coupon && (
        <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-800">
          <span className="font-semibold">{coupon.code} applied · {coupon.percent}% off</span>
          <span>{coupon.valid_hours}h left</span>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {cart.map(item => (
          <div key={item.name} className="flex items-center gap-3 px-5 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-lg">{item.img}</div>
            <div className="flex-1">
              <div className="text-sm font-medium">{item.name}</div>
              <div className="text-xs text-slate-400">Qty {item.qty}</div>
            </div>
            <div className="text-sm font-medium tabular-nums">{inr(item.price)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm">
        <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular-nums">{inr(sub)}</span></div>
        {coupon && (
          <div className="flex justify-between text-emerald-700">
            <span>{coupon.code}</span>
            <span className="tabular-nums">− {inr(sub - total)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span className="tabular-nums">{inr(total)}</span></div>
        {!coupon && <p className="pt-1 text-xs text-amber-700">Shipping is already in the total. Answer the call and press 1 for 10% off.</p>}
      </div>
      <div className="px-5 pb-5">
        {paid ? (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Order placed. Payment captured.</div>
        ) : (
          <button onClick={onPay} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#2B84EA] py-2.5 text-sm font-semibold text-white hover:bg-[#1f74d6]">
            Pay {inr(total)} with Razorpay <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function AiPanel({
  scenario, wallet, paid, shortfall, onCall,
}: {
  scenario: ScenarioDef; wallet: number; paid: boolean; shortfall: number;
  onCall: () => void;
}) {
  return (
    <aside className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-[#2B84EA]/20 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-[#F0F7FF] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-[#2B84EA]" />
          <span className="text-xs font-bold uppercase tracking-wide text-[#2B84EA]">AI Recovery</span>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[11px] uppercase text-slate-400">Diagnosis</div>
            <div className="text-sm font-semibold text-slate-900">{scenario.ai.diagnosis}</div>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-600">{scenario.ai.why}</p>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>Recoverability</span>
              <span className="font-semibold text-slate-700">{scenario.ai.confidence}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#2B84EA]" style={{ width: `${scenario.ai.confidence}%` }} />
            </div>
          </div>
          <ol className="space-y-1.5">
            {scenario.ai.actions.map((a, i) => (
              <li key={a} className="flex gap-2 text-[13px] text-slate-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0F7FF] text-[10px] font-bold text-[#2B84EA]">{i + 1}</span>
                {a}
              </li>
            ))}
          </ol>
          {paid ? (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">Customer completed payment. Event marked recovered on the merchant side.</div>
          ) : scenario.id === "insufficient_funds" && shortfall > 0 ? (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Wallet is short {inr(shortfall)}. Add money or pick EMI — retrying the card will bounce again.
            </div>
          ) : null}
          {!paid && (
            <button
              onClick={onCall}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#02042B] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#0c1233]"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-400" />
              {scenario.id === "gateway_timeout" ? "Why we don’t call" : "AI agent is calling"}
            </button>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Wallet className="h-4 w-4" /> Demo wallet
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{inr(wallet, { decimals: true })}</div>
        <div className="mt-1 text-[11px] text-slate-400">HDFC ····{DEMO_CUSTOMER.accountLast4}</div>
      </div>
    </aside>
  );
}

function CheckoutModal({
  scenario, amount, wallet, method, setMethod, phase, failReason, paidId, canCover,
  onClose, onPay, onAdd, onSwitchUpi,
}: {
  scenario: ScenarioDef;
  amount: number;
  wallet: number;
  method: PayMethod;
  setMethod: (m: PayMethod) => void;
  phase: CheckoutPhase;
  failReason: string | null;
  paidId: string | null;
  canCover: boolean;
  onClose: () => void;
  onPay: () => void;
  onAdd: () => void;
  onSwitchUpi: () => void;
}) {
  const emi = Math.round(amount / 3);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#02042B] px-5 py-3 text-white">
          <div className="flex items-center gap-2">
            <RzpMark />
            <div>
              <div className="text-sm font-semibold">{DEMO_MERCHANT.name}</div>
              <div className="text-[11px] text-white/50">Secured by Razorpay</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {phase === "success" ? (
          <div className="px-6 py-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <div className="mt-3 text-lg font-semibold">Payment successful</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{inr(amount)}</div>
            <div className="mt-2 font-mono text-xs text-slate-400">{paidId}</div>
            <button onClick={onClose} className="mt-6 w-full rounded-md bg-[#2B84EA] py-2.5 text-sm font-semibold text-white">Done</button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex items-end justify-between">
              <div className="text-xs text-slate-400">Amount payable</div>
              <div className="text-xl font-semibold tabular-nums">{inr(amount)}</div>
            </div>

            {phase === "failed" && failReason && (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {failReason}
              </div>
            )}

            {scenario.id === "insufficient_funds" && !canCover && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Card/wallet available <span className="font-semibold">{inr(wallet)}</span> · shortfall {inr(amount - wallet)}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <PayTab active={method === "upi"} onClick={() => setMethod("upi")} icon={Smartphone} title="UPI" sub={DEMO_CUSTOMER.upi} />
              <PayTab active={method === "card"} onClick={() => setMethod("card")} icon={CreditCard} title="Card" sub={scenario.card ? `${scenario.card.brand} ····${scenario.card.last4}` : "Visa / Mastercard"} />
            </div>

            {method === "card" && scenario.card && (
              <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span>{scenario.card.brand} ···· {scenario.card.last4}</span>
                  <span className={`text-xs ${scenario.id === "expired_card" ? "text-red-600" : "text-slate-400"}`}>
                    Exp {scenario.card.expiry}
                  </span>
                </div>
              </div>
            )}

            {phase === "failed" && scenario.id === "insufficient_funds" && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onAdd} className="rounded-md border border-slate-200 py-2 text-xs font-semibold hover:bg-slate-50">Add money</button>
                <button onClick={onSwitchUpi} className="rounded-md border border-slate-200 py-2 text-xs font-semibold hover:bg-slate-50">Try UPI instead</button>
              </div>
            )}

            {phase === "failed" && scenario.id === "expired_card" && (
              <button onClick={onSwitchUpi} className="w-full rounded-md border border-slate-200 py-2 text-xs font-semibold hover:bg-slate-50">
                Pay with UPI · {DEMO_CUSTOMER.upi}
              </button>
            )}

            {phase === "failed" && scenario.id === "gateway_timeout" && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-4 w-4" /> Agent will silent-retry. No customer ping.
              </div>
            )}

            {scenario.id === "insufficient_funds" && (
              <p className="text-[11px] text-slate-400">Or split into 3 × {inr(emi)} no-cost EMI — recommended by the recovery agent.</p>
            )}

            <button
              onClick={onPay}
              disabled={phase === "processing"}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#2B84EA] py-2.5 text-sm font-semibold text-white hover:bg-[#1f74d6] disabled:opacity-60"
            >
              {phase === "processing" ? <><RefreshCw className="h-4 w-4 animate-spin" /> Processing…</> : <>Pay {inr(amount)}</>}
            </button>
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Shield className="h-3.5 w-3.5" /> 256-bit SSL · Test Mode
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PayTab({
  active, onClick, icon: Icon, title, sub,
}: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string; sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left ${
        active ? "border-[#2B84EA] bg-[#F0F7FF]" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <Icon className={`h-4 w-4 ${active ? "text-[#2B84EA]" : "text-slate-400"}`} />
      <div>
        <div className="text-xs font-semibold">{title}</div>
        <div className="max-w-[110px] truncate text-[10px] text-slate-400">{sub}</div>
      </div>
    </button>
  );
}

function AddMoneyModal({
  shortfall, onClose, onAdd,
}: {
  shortfall: number; onClose: () => void; onAdd: (n: number) => void;
}) {
  const chips = [200000, 500000, 1000000, Math.max(shortfall, 100000)].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-sm font-semibold">Add money · HDFC ****4412</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-500">Test-mode top-up. Pick an amount — it credits this demo wallet instantly.</p>
          {shortfall > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Info className="h-4 w-4 shrink-0" /> Need at least {inr(shortfall)} more to clear the failed charge.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {chips.map(c => (
              <button
                key={c}
                onClick={() => onAdd(c)}
                className="rounded-md border border-slate-200 py-2.5 text-sm font-semibold hover:border-[#2B84EA] hover:text-[#2B84EA]"
              >
                + {inr(c)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Wallet, TrendingUp, AlertTriangle, Target, ArrowUpRight,
  Sparkles, Zap, RefreshCw, Database, ChevronRight, Clock, Phone,
} from "lucide-react";
import { inr, EVENT_TYPE_LABELS, DECLINE_LABELS, INTERVENTION_LABELS, label } from "@/lib/ui/format";
import { RecoverModal } from "./_components/RecoverModal";
import type { RecoveryEvent } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Analytics {
  seeded: boolean;
  kpis: {
    total_outstanding: number;
    recovered_amount: number;
    at_risk_amount: number;
    at_risk_accounts: number;
    recovered_count: number;
    blocked_count: number;
    total_events: number;
    success_rate: number;
  };
  aging: { bucket: string; count: number; amount: number }[];
  failure_reasons: { code: string; count: number }[];
  by_type: { type: string; count: number; amount: number }[];
  by_status: Record<string, number>;
  trend: { date: string; label: string; recovered: number; at_risk: number }[];
  queue: QueueItem[];
  live?: {
    open_promises: number;
    disputes_from_calls: number;
    calls: {
      session_id: string;
      customer_name: string;
      event_id: string | null;
      scenario: string;
      outcome: string | null;
      live_llm: boolean;
      status: string;
      updated_at: string;
      last_line: string | null;
    }[];
    recent_promises: {
      ptp_id: string;
      customer_name: string;
      event_id: string | null;
      intent: string;
      promised_date: string | null;
      status: string;
      created_at: string;
    }[];
  };
}
interface QueueItem {
  event_id: string;
  customer_name: string;
  customer_email: string;
  type: string;
  amount: number;
  days_overdue: number;
  decline_code: string | null;
  dispute_flag: boolean;
  status: string;
  diagnosis: string;
  recommended_action: string;
  priority: number;
}
interface Measurement {
  seeded?: boolean;
  baseline_rate: number;
  orchestrated_rate: number;
  lift: number;
  attempted: number;
  orchestrated_recovered: number;
  seed?: number;
  simulated?: boolean;
  orchestrated_recovered_paise?: number;
  baseline_recovered_paise?: number;
  arms?: {
    id: string;
    label: string;
    recovered_count: number;
    recovered_paise: number;
    rate: number;
    cost_per_100_recovered: number;
    violations: number;
  }[];
}

const DONUT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#38bdf8", "#a78bfa", "#f472b6"];

export default function OverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [measure, setMeasure] = useState<Measurement | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [recoverEvent, setRecoverEvent] = useState<RecoveryEvent | null>(null);

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([
      fetch("/api/analytics").then(r => r.json()),
      fetch("/api/batch/run").then(r => r.json()).catch(() => null),
    ]);
    setData(a);
    if (m?.seeded) setMeasure(m);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  async function seed() {
    setSeeding(true);
    await fetch("/api/seed", { method: "POST" });
    await fetch("/api/batch/run", { method: "POST" }).then(r => r.json()).then(m => setMeasure(m)).catch(() => {});
    await load();
    setSeeding(false);
  }

  async function runRecovery(id: string) {
    setRunningId(id);
    try {
      const res = await fetch(`/api/events/${id}`);
      const data = await res.json();
      if (data.event) setRecoverEvent(data.event as RecoveryEvent);
    } finally {
      setRunningId(null);
    }
  }

  if (loading) return <DashboardSkeleton />;

  if (!data?.seeded) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="card max-w-md p-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-white/10">
            <Database className="h-6 w-6 text-indigo-400" />
          </div>
          <h1 className="text-xl font-semibold text-white">No data yet</h1>
          <p className="mt-2 text-sm text-gray-400">
            Seed a calibrated dataset of ~550 failed payments, abandoned checkouts, and overdue invoices to populate the command center.
          </p>
          <button onClick={seed} disabled={seeding} className="btn-primary mt-6 w-full">
            {seeding ? <><RefreshCw className="h-4 w-4 animate-spin" />Seeding…</> : <><Sparkles className="h-4 w-4" />Seed Dataset</>}
          </button>
        </div>
      </div>
    );
  }

  const k = data.kpis;
  const recoveredPie = data.by_type.map(t => ({ name: EVENT_TYPE_LABELS[t.type] ?? t.type, value: t.count }));
  const reasonData = data.failure_reasons.slice(0, 6).map(r => ({
    name: label(DECLINE_LABELS, r.code), value: r.count,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Recovery Command Center</h1>
          <p className="mt-1 text-sm text-gray-400">
            Real-time view of at-risk revenue and the agent&apos;s recovery performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost">
            <RefreshCw className="h-4 w-4" />Refresh
          </button>
          <button onClick={seed} disabled={seeding} className="btn-ghost">
            {seeding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Re-seed
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          tone="indigo"
          label="Total Outstanding"
          value={inr(k.total_outstanding, { compact: true })}
          sub={`${k.at_risk_accounts + (data.by_status?.escalated ?? 0)} open accounts`}
        />
        <KpiCard
          icon={TrendingUp}
          tone="emerald"
          label="Recovered"
          value={inr(k.recovered_amount, { compact: true })}
          sub={`${k.recovered_count} payments recovered`}
          delta={measure ? `+${measure.lift}pp vs baseline` : undefined}
        />
        <KpiCard
          icon={AlertTriangle}
          tone="amber"
          label="At-Risk Accounts"
          value={String(k.at_risk_accounts)}
          sub={`${inr(k.at_risk_amount, { compact: true })} recoverable`}
        />
        <KpiCard
          icon={Target}
          tone="sky"
          label="Success Rate"
          value={`${k.success_rate}%`}
          sub={measure ? `Baseline ${measure.baseline_rate}%` : "recovered ÷ attempted"}
          delta={measure ? `${measure.orchestrated_rate}% orchestrated` : undefined}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Collection velocity */}
        <ChartCard
          className="lg:col-span-2"
          title="Collection Velocity"
          subtitle="Recovered vs at-risk revenue over the last 14 days"
          icon={Zap}
        >
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.trend} margin={{ left: -8, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gRisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} interval={1} />
              <YAxis tickFormatter={(v) => inr(Number(v), { compact: true })} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
              <Tooltip content={<VelocityTooltip />} />
              <Area type="monotone" dataKey="at_risk" name="At-risk" stroke="#6366f1" strokeWidth={2} fill="url(#gRisk)" />
              <Area type="monotone" dataKey="recovered" name="Recovered" stroke="#10b981" strokeWidth={2} fill="url(#gRec)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Failure reasons donut */}
        <ChartCard title="Failure Reasons" subtitle="Why payments fail" icon={AlertTriangle}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={reasonData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
                {reasonData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<SimpleTooltip suffix=" events" />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1.5">
            {reasonData.slice(0, 4).map((r, i) => (
              <div key={r.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-gray-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  {r.name}
                </span>
                <span className="font-medium text-gray-300 tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Aging */}
        <ChartCard title="Receivables Aging" subtitle="Overdue amount by age bucket" icon={Clock}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.aging} margin={{ left: -8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v) => inr(Number(v), { compact: true })} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
              <Tooltip content={<SimpleTooltip isAmount />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {data.aging.map((_, i) => (
                  <Cell key={i} fill={["#10b981", "#f59e0b", "#fb923c", "#f43f5e"][i] ?? "#6366f1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Baseline vs orchestrated */}
        <ChartCard
          className="lg:col-span-2"
          title="Agent Impact"
          subtitle="Four-arm seeded eval [SIMULATED, seed=42] · ₹ recovered, not just a percentage"
          icon={Target}
          action={!measure ? (
            <button
              onClick={async () => {
                const m = await fetch("/api/batch/run", { method: "POST" }).then(r => r.json());
                setMeasure(m);
              }}
              className="btn-ghost !py-1.5 !px-3 text-xs"
            >
              Run Measurement
            </button>
          ) : undefined}
        >
          {measure ? (
            <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={(measure.arms ?? [
                    { label: "Baseline", rate: measure.baseline_rate },
                    { label: "Agent", rate: measure.orchestrated_rate },
                  ]).map(a => ({ name: a.label.split(" ")[0], rate: a.rate }))}
                  margin={{ left: -12, top: 8 }}
                  barSize={36}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 80]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#6b7280", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<SimpleTooltip suffix="%" />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="rate" radius={[6, 6, 0, 0]} fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500">Orchestrated recovery rate</div>
                  <div className="text-3xl font-semibold text-emerald-400 tabular-nums">{measure.orchestrated_rate}%</div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
                  <ArrowUpRight className="h-4 w-4" />
                  +{measure.lift} pp over naive retry
                </div>
                {measure.orchestrated_recovered_paise != null && (
                  <p className="text-xs text-gray-400">
                    Recovered {inr(measure.orchestrated_recovered_paise, { compact: true })} vs {inr(measure.baseline_recovered_paise ?? 0, { compact: true })} naive.
                    Mandate-revoked retries are violations on the naive arm only.
                  </p>
                )}
                <p className="text-xs leading-relaxed text-gray-500">
                  Seed {measure.seed ?? 42} · simulated. Same batch, four arms.
                  Denominator is attempted events.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-gray-500">
              Run measurement to compare baseline vs the agent.
            </div>
          )}
        </ChartCard>
      </div>

      {data.live && (data.live.calls.length > 0 || data.live.recent_promises.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Phone className="h-4 w-4 text-emerald-400" />
              Live calls
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Updates from Customer View. {data.live.open_promises} open promises · {data.live.disputes_from_calls} dispute kills.
            </p>
            <div className="mt-3 space-y-2">
              {data.live.calls.length === 0 ? (
                <p className="text-xs text-gray-500">No calls yet — answer the popup on Customer View.</p>
              ) : data.live.calls.map(c => (
                <div key={c.session_id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">{c.customer_name}</span>
                    <span className="text-gray-500">{c.live_llm ? "live OpenAI" : "rules"} · {c.status}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    {c.outcome ?? c.scenario}{c.event_id ? ` · ${c.event_id}` : ""}
                  </div>
                  {c.last_line && <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">{c.last_line}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-white">Promises from calls</h2>
            <p className="mt-0.5 text-xs text-gray-500">Written to the same ledger Recover reads. Inside the PTP window they hold further nags.</p>
            <div className="mt-3 space-y-2">
              {data.live.recent_promises.length === 0 ? (
                <p className="text-xs text-gray-500">No promises captured yet.</p>
              ) : data.live.recent_promises.map(p => (
                <div key={p.ptp_id} className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-white">{p.customer_name}</div>
                    <div className="text-gray-500">{p.intent}{p.promised_date ? ` · ${p.promised_date}` : ""}</div>
                  </div>
                  <span className="text-gray-400">{p.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Prioritized recovery queue */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Zap className="h-4 w-4 text-indigo-400" />
              Prioritized Recovery Queue
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Highest-value at-risk accounts, ranked by recoverable revenue.</p>
          </div>
          <button onClick={() => router.push("/events")} className="btn-ghost !py-1.5 !px-3 text-xs">
            View all <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="divide-y divide-white/[0.04]">
          {data.queue.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-500">
              🎉 No at-risk accounts — everything has been actioned.
            </div>
          ) : (
            data.queue.map(item => (
              <QueueRow
                key={item.event_id}
                item={item}
                running={runningId === item.event_id}
                onRun={() => runRecovery(item.event_id)}
                onPreview={() => router.push(`/pay/${item.event_id}`)}
              />
            ))
          )}
        </div>
      </div>

      {recoverEvent && (
        <RecoverModal
          event={recoverEvent}
          onClose={() => setRecoverEvent(null)}
          onComplete={() => { load(); }}
        />
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const TONE_MAP: Record<string, { bg: string; text: string; ring: string }> = {
  indigo:  { bg: "bg-indigo-500/10",  text: "text-indigo-400",  ring: "border-indigo-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", ring: "border-emerald-500/20" },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-400",   ring: "border-amber-500/20" },
  sky:     { bg: "bg-sky-500/10",     text: "text-sky-400",     ring: "border-sky-500/20" },
};

function KpiCard({
  icon: Icon, tone, label, value, sub, delta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE_MAP;
  label: string; value: string; sub: string; delta?: string;
}) {
  const t = TONE_MAP[tone];
  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${t.bg} ${t.ring}`}>
          <Icon className={`h-5 w-5 ${t.text}`} />
        </div>
        {delta && (
          <span className="chip border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
            <ArrowUpRight className="h-3 w-3" />{delta}
          </span>
        )}
      </div>
      <div className="mt-4 stat-value">{value}</div>
      <div className="mt-1 text-sm font-medium text-gray-300">{label}</div>
      <div className="mt-0.5 text-xs text-gray-500">{sub}</div>
    </div>
  );
}

// ─── Chart Card ───────────────────────────────────────────────────────────────
function ChartCard({
  title, subtitle, icon: Icon, children, className = "", action,
}: {
  title: string; subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Icon className="h-4 w-4 text-indigo-400" />{title}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Queue Row ────────────────────────────────────────────────────────────────
function QueueRow({
  item, running, onRun, onPreview,
}: {
  item: QueueItem; running: boolean; onRun: () => void; onPreview: () => void;
}) {
  const initials = item.customer_name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-xs font-semibold text-gray-300">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{item.customer_name}</span>
          {item.dispute_flag && (
            <span className="chip border border-rose-500/20 bg-rose-500/10 text-rose-300">Dispute</span>
          )}
        </div>
        <div className="truncate text-xs text-gray-500">
          {EVENT_TYPE_LABELS[item.type] ?? item.type}
          {item.decline_code && ` · ${label(DECLINE_LABELS, item.decline_code)}`}
          {item.days_overdue > 0 && ` · ${item.days_overdue}d overdue`}
        </div>
      </div>
      <div className="hidden md:block">
        <div className="text-xs text-gray-500">Recommended</div>
        <div className="text-xs font-medium text-indigo-300">{label(INTERVENTION_LABELS, item.recommended_action)}</div>
      </div>
      <div className="w-28 text-right">
        <div className="text-sm font-semibold text-white tabular-nums">{inr(item.amount, { compact: true })}</div>
        <div className="text-xs text-gray-500">at risk</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button onClick={onPreview} className="btn-ghost !py-1.5 !px-3 text-xs">Preview</button>
        <button onClick={onRun} disabled={running} className="btn-primary !py-1.5 !px-3 text-xs">
          {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {running ? "Opening" : "Recover"}
        </button>
      </div>
    </div>
  );
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────
function VelocityTooltip({ active, payload, label: lbl }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#12141b] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-gray-300">{lbl}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-gray-400">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-gray-200">{inr(Number(p.value), { compact: true })}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleTooltip({ active, payload, isAmount, suffix = "" }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-white/10 bg-[#12141b] px-3 py-2 text-xs shadow-xl">
      <span className="text-gray-400">{payload[0].name ?? payload[0].payload?.name}: </span>
      <span className="font-medium text-gray-100">
        {isAmount ? inr(Number(v), { compact: true }) : `${v}${suffix}`}
      </span>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="h-8 w-72 animate-pulse rounded-lg bg-white/[0.05]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-2xl bg-white/[0.04] lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-2xl bg-white/[0.04]" />
      </div>
    </div>
  );
}

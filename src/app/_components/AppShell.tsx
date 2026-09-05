"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, ListChecks, ScrollText, ShieldCheck,
  Sparkles, CircleDot, Phone, Tag,
} from "lucide-react";
import { PerspectiveSwitch } from "./PerspectiveSwitch";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/events", label: "Recovery Queue", icon: ListChecks },
  { href: "/voice", label: "Voice + PTP", icon: Phone },
  { href: "/policies", label: "Policies & Discounts", icon: Tag },
  { href: "/audit", label: "Audit Trail", icon: ScrollText },
  { href: "/guardrails", label: "Guardrails", icon: ShieldCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Customer + pay flows render full-bleed (they simulate the customer's own screen)
  const isCustomerFlow = pathname.startsWith("/customer") || pathname.startsWith("/pay");
  if (isCustomerFlow) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0b0f]/60 px-4 py-5">
        <Link href="/" className="flex items-center gap-2.5 px-2 mb-7">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-emerald-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Recovery OS</div>
            <div className="text-[11px] text-gray-500">AI Revenue Agent</div>
          </div>
        </Link>

        <nav className="space-y-1">
          {NAV.map(item => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-indigo-400" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <CircleDot className="h-3.5 w-3.5 text-amber-400" />
              Razorpay Test Mode
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
              No real money moves. All payments are simulated.
            </p>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-white/[0.06] bg-[#08090c]/80 px-6 backdrop-blur-xl">
          <div className="lg:hidden flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-emerald-500">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Recovery OS</span>
          </div>
          <div className="ml-auto">
            <PerspectiveSwitch />
          </div>
        </header>

        <main className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-7xl animate-fade-up">{children}</div>
        </main>
      </div>
    </div>
  );
}

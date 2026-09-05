"use client";

import { useRouter, usePathname } from "next/navigation";
import { Building2, User } from "lucide-react";

// Segmented control to switch between the Business Owner and Customer perspectives.
export function PerspectiveSwitch({ light = false }: { light?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const isCustomer = pathname.startsWith("/customer") || pathname.startsWith("/pay");

  return (
    <div className={`inline-flex items-center rounded-lg p-0.5 ${
      light ? "border border-slate-200 bg-white" : "border border-white/10 bg-white/[0.03]"
    }`}>
      <button
        onClick={() => router.push("/")}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
          !isCustomer
            ? light ? "bg-slate-900 text-white" : "bg-white/10 text-white shadow-sm"
            : light ? "text-slate-500 hover:text-slate-800" : "text-gray-400 hover:text-gray-200"
        }`}
      >
        <Building2 className="h-3.5 w-3.5" />
        Business Owner
      </button>
      <button
        onClick={() => router.push("/customer")}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
          isCustomer
            ? light ? "bg-slate-900 text-white" : "bg-white/10 text-white shadow-sm"
            : light ? "text-slate-500 hover:text-slate-800" : "text-gray-400 hover:text-gray-200"
        }`}
      >
        <User className="h-3.5 w-3.5" />
        Customer View
      </button>
    </div>
  );
}

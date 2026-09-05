"use client";

import { useEffect, useState } from "react";
import type { GuardrailConfig } from "@/lib/types";

interface BreakItResult {
  scenario: string;
  message: string;
  guardrail_result: {
    allow: boolean;
    reason_code: string;
    bound_checked: string;
  };
}

export default function GuardrailsPage() {
  const [config, setConfig] = useState<GuardrailConfig | null>(null);
  const [lastBreak, setLastBreak] = useState<BreakItResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/guardrails").then(r => r.json()).then(setConfig);
  }, []);

  async function tryBreakIt(scenario: string, eventId = "demo_001") {
    setLoading(scenario);
    setLastBreak(null);
    const res = await fetch("/api/guardrails/break-it", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario, event_id: eventId }),
    });
    const data = await res.json();
    setLastBreak(data);
    setLoading(null);
  }

  async function saveConfig(patch: Partial<GuardrailConfig>) {
    setSaving(true);
    const res = await fetch("/api/guardrails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    setConfig(updated);
    setSaving(false);
  }

  async function resetConfig() {
    const res = await fetch("/api/guardrails", { method: "POST" });
    const data = await res.json();
    setConfig(data.config);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Guardrail Control Panel</h1>
        <p className="text-sm text-gray-400 mt-1">
          These are live gates. Recover, Payment Links, and voice promises all call the same <span className="font-mono text-gray-300">check()</span> / PTP window. Break-it is not a toy — it writes a real blocked audit row (and dispute actually flags the event).
        </p>
        <p className="text-xs text-gray-500 mt-2 max-w-3xl">
          Promise-to-pay window: if a customer promises a date inside 5 / 10 / 15 days, we capture it and stop nagging until that day. Outside the window the agent refuses — that is what “Break PTP window” demonstrates. Contact window, attempt cap, discount cap, and dispute are the other hard stops.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Modelled on RBI Responsible Business Conduct 4th Amendment Directions (Aug 6 2026 · eff. Jan 1 2027)
        </p>
      </div>

      {/* Last break-it result */}
      {lastBreak && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-red-400">Guardrail Blocked</div>
              <div className="text-sm text-gray-300 mt-1">{lastBreak.message}</div>
            </div>
            <button
              onClick={() => setLastBreak(null)}
              className="text-gray-500 hover:text-gray-300 text-xs"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-gray-500 mb-0.5">Reason Code</div>
              <div className="font-mono text-red-400">{lastBreak.guardrail_result.reason_code}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-0.5">Allow</div>
              <div className="font-mono text-red-400">false</div>
            </div>
          </div>
          <div className="font-mono text-xs bg-gray-900/60 rounded p-3 text-gray-400">
            {lastBreak.guardrail_result.bound_checked}
          </div>
          <div className="text-xs text-gray-500">Audit log entry written → check the Audit Log page</div>
        </div>
      )}

      {/* Break-it scenarios */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Break-It Scenarios</h2>
        <div className="grid lg:grid-cols-2 gap-4">
          <BreakCard
            title="Contact Window Violation"
            description="Try to send a customer nudge at 21:00 — outside the allowed 08:00–19:00 window."
            rbi="RBI §32.1O — contact outside hours requires borrower consent"
            reasonCode="CONTACT_WINDOW_BLOCKED"
            scenario="out_of_window"
            onTry={tryBreakIt}
            loading={loading === "out_of_window"}
          />
          <BreakCard
            title="Attempt Cap Exceeded"
            description="Try to make a 6th automated contact on the same event. Hard stop — no override."
            rbi="TRAI TCCCPR + RBI fair-practice spirit (agent-modelled cap)"
            reasonCode="ATTEMPT_CAP_EXCEEDED"
            scenario="attempt_cap"
            onTry={tryBreakIt}
            loading={loading === "attempt_cap"}
          />
          <BreakCard
            title="Discount Cap Exceeded"
            description="Agent tries to offer 20% discount. Policy cap is 5%. Human approval required."
            rbi="Internal policy guardrail — agent cannot exceed discount cap autonomously"
            reasonCode="DISCOUNT_CAP_EXCEEDED"
            scenario="discount_cap"
            onTry={tryBreakIt}
            loading={loading === "discount_cap"}
          />
          <BreakCard
            title="Dispute Kill-Switch"
            description="Flag a dispute mid-sequence. All automated contact stops immediately. No exceptions. This actually sets dispute_flag on the event."
            rbi="RBI §454Z — continued contact post-complaint = deemed harsh practice"
            reasonCode="DISPUTE_KILL_SWITCH"
            scenario="dispute_flag"
            onTry={tryBreakIt}
            loading={loading === "dispute_flag"}
            dangerous
          />
          <BreakCard
            title="Promise-to-pay window"
            description="Customer promises a date past your 5/10/15-day policy. Same gate the live call uses — promise is not captured."
            rbi="Merchant collections policy — agent cannot extend tenure"
            reasonCode="PTP_OUTSIDE_POLICY"
            scenario="ptp_window"
            onTry={tryBreakIt}
            loading={loading === "ptp_window"}
          />
        </div>
      </div>

      {/* Config panel */}
      {config && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Active Guardrail Configuration</h2>
            <button
              onClick={resetConfig}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Reset to defaults
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
            <ConfigField
              label="Contact Window Start"
              value={config.contact_window_start}
              type="time"
              onChange={v => saveConfig({ contact_window_start: v })}
              saving={saving}
              hint="RBI §32.1O"
            />
            <ConfigField
              label="Contact Window End"
              value={config.contact_window_end}
              type="time"
              onChange={v => saveConfig({ contact_window_end: v })}
              saving={saving}
              hint="RBI §32.1O"
            />
            <ConfigField
              label="Attempt Cap"
              value={String(config.attempt_cap)}
              type="number"
              onChange={v => saveConfig({ attempt_cap: parseInt(v) })}
              saving={saving}
              hint="Hard stop per event"
            />
            <ConfigField
              label="Discount Cap (%)"
              value={String(config.discount_cap_pct)}
              type="number"
              onChange={v => saveConfig({ discount_cap_pct: parseFloat(v) })}
              saving={saving}
              hint="Max agent can offer"
            />
            <ConfigField
              label="Human Handoff Day"
              value={String(config.human_handoff_day)}
              type="number"
              onChange={v => saveConfig({ human_handoff_day: parseInt(v) })}
              saving={saving}
              hint="Invoice overdue threshold"
            />
            <ConfigField
              label="Silent Retry Cap"
              value={String(config.silent_retry_cap)}
              type="number"
              onChange={v => saveConfig({ silent_retry_cap: parseInt(v) })}
              saving={saving}
              hint="Gateway timeout retries"
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-400">Promise-to-pay window</div>
            <p className="text-xs text-gray-500">
              If the customer promises a date inside this window, the agent captures it. Outside it, the agent refuses and asks for a date the policy allows.
            </p>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15].map(days => (
                <button
                  key={days}
                  disabled={saving}
                  onClick={() => saveConfig({ ptp_max_days: days })}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    config.ptp_max_days === days
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  {days} days
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-600">Active: customer must pay within {config.ptp_max_days} days of the call</div>
          </div>

          <div className="text-xs text-gray-600 border-t border-gray-800 pt-4">
            Changes take effect immediately — the guardrail.check() function reads this config on every execution.
            Try adjusting the contact window to a future time, then run "out of window" scenario above.
          </div>
        </div>
      )}

      {/* RBI citations */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Regulatory Basis</h3>
        <div className="space-y-2 text-xs text-gray-500">
          <p><span className="text-gray-300 font-mono">RBI §32.1O</span> — Contact/visit permitted only between 08:00–19:00. Earlier/later requires borrower's express authorisation.</p>
          <p><span className="text-gray-300 font-mono">RBI §454Z</span> — Continued contact post-complaint is a deemed harsh practice. Any dispute flag = immediate stop.</p>
          <p><span className="text-gray-300 font-mono">RBI §32.1D</span> — Graded escalation matrix required. Agent may only recommend past threshold — human must approve next contact.</p>
          <p><span className="text-gray-300 font-mono">Source</span> — RBI Responsible Business Conduct 4th Amendment Directions, Aug 6 2026 (RBI/2026-2027/228), effective Jan 1 2027.</p>
          <p><span className="text-gray-300 font-mono">Note</span> — Attempt cap of 5 is modelled on TRAI TCCCPR + fair-practice spirit. RBI has no numerical cap. State this clearly if asked.</p>
        </div>
      </div>
    </div>
  );
}

function BreakCard({
  title, description, rbi, reasonCode, scenario, onTry, loading, dangerous = false,
}: {
  title: string;
  description: string;
  rbi: string;
  reasonCode: string;
  scenario: string;
  onTry: (scenario: string) => void;
  loading: boolean;
  dangerous?: boolean;
}) {
  return (
    <div className={`border rounded-xl p-5 space-y-3 ${
      dangerous
        ? "bg-red-950/20 border-red-900"
        : "bg-gray-900 border-gray-800"
    }`}>
      <div>
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        <p className="text-xs text-gray-400 mt-1">{description}</p>
      </div>
      <div>
        <div className="text-xs text-gray-600 font-mono">{reasonCode}</div>
        <div className="text-xs text-gray-600 mt-0.5">{rbi}</div>
      </div>
      <button
        onClick={() => onTry(scenario)}
        disabled={loading}
        className={`w-full py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
          dangerous
            ? "bg-red-900/60 hover:bg-red-900 border border-red-800 text-red-300"
            : "bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300"
        }`}
      >
        {loading ? "Trying…" : `Try: "${scenario.replace("_", " ")}"`}
      </button>
    </div>
  );
}

function ConfigField({
  label, value, type, onChange, saving, hint,
}: {
  label: string;
  value: string;
  type: string;
  onChange: (v: string) => void;
  saving: boolean;
  hint: string;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <input
        type={type}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onChange(local)}
        disabled={saving}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-emerald-600 focus:outline-none transition-colors"
        step={type === "number" ? "1" : undefined}
        min={type === "number" ? "1" : undefined}
      />
      <div className="text-xs text-gray-600">{hint}</div>
    </div>
  );
}

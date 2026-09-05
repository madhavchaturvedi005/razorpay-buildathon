import type { ArmResult, MeasurementResult, RecoveryEvent } from "../types";
import { CALIBRATION } from "../data/calibration";
import { diagnose } from "./diagnosis";
import { decide } from "./decision";
import { interventionCost } from "./ev";

// Four-arm comparison (Recoup). Seeded RNG so a rerun on the same batch matches.
// Labelled [SIMULATED]. Outcomes are Bernoulli draws; the comparison is the claim.

const EVAL_SEED = 42;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ArmAcc {
  recovered_count: number;
  recovered_paise: number;
  attempted: number;
  contact_cost_paise: number;
  actions: number;
  violations: number;
}

function emptyAcc(): ArmAcc {
  return {
    recovered_count: 0,
    recovered_paise: 0,
    attempted: 0,
    contact_cost_paise: 0,
    actions: 0,
    violations: 0,
  };
}

function toArm(id: string, label: string, acc: ArmAcc): ArmResult {
  const rate = acc.attempted > 0 ? (acc.recovered_count / acc.attempted) * 100 : 0;
  const recoveredRupees = acc.recovered_paise / 100;
  const costRupees = acc.contact_cost_paise / 100;
  const cost_per_100_recovered = recoveredRupees > 0
    ? Math.round((costRupees / recoveredRupees) * 10000) / 100
    : 0;
  return {
    id,
    label,
    recovered_count: acc.recovered_count,
    recovered_paise: acc.recovered_paise,
    attempted: acc.attempted,
    rate: Math.round(rate * 10) / 10,
    contact_cost_paise: acc.contact_cost_paise,
    cost_per_100_recovered,
    actions: acc.actions,
    violations: acc.violations,
  };
}

function organicRecover(event: RecoveryEvent, rand: () => number): boolean {
  return event.ground_truth_recoverable && rand() < 0.047;
}

function naiveRetry(event: RecoveryEvent, rand: () => number): boolean {
  // Blind retry — including expired cards and revoked mandates (wrong, but what merchants run)
  if (event.dispute_flag) return false;
  return event.ground_truth_recoverable && rand() < CALIBRATION.baseline_recovery_rate;
}

function runRules(
  event: RecoveryEvent,
  rand: () => number,
  useEv: boolean,
): { recovered: boolean; cost: number; skipped: boolean; violation: boolean } {
  if (event.dispute_flag) {
    return { recovered: false, cost: 0, skipped: true, violation: false };
  }
  const diagnosis = diagnose(event);
  const plan = decide(diagnosis, 0, useEv ? event.amount : 0);

  if (plan.primary === "human_handoff") {
    return { recovered: false, cost: 0, skipped: true, violation: false };
  }
  if (plan.primary === "mandate_stop" || plan.primary === "dispute_stop") {
    return { recovered: false, cost: 0, skipped: true, violation: false };
  }
  if (plan.skipped_negative_ev) {
    return { recovered: false, cost: 0, skipped: true, violation: false };
  }

  const cost = interventionCost(plan.primary);
  if (!event.ground_truth_recoverable) {
    return { recovered: false, cost, skipped: false, violation: false };
  }
  const rate = CALIBRATION.intervention_success_rates[
    plan.primary as keyof typeof CALIBRATION.intervention_success_rates
  ] ?? 0.3;
  return { recovered: rand() < rate, cost, skipped: false, violation: false };
}

export function measure(events: RecoveryEvent[], seed = EVAL_SEED): MeasurementResult {
  if (events.length === 0) {
    return {
      total_events: 0,
      attempted: 0,
      baseline_recovered: 0,
      orchestrated_recovered: 0,
      baseline_rate: 0,
      orchestrated_rate: 0,
      lift: 0,
      seed,
      simulated: true,
      arms: [],
      orchestrated_recovered_paise: 0,
      baseline_recovered_paise: 0,
    };
  }

  const batchSize = Math.min(events.length, 300);
  const batch = events.slice(0, batchSize);
  const rand = mulberry32(seed);

  const noAction = emptyAcc();
  const fixed = emptyAcc();
  const rules = emptyAcc();
  const orch = emptyAcc();

  for (const event of batch) {
    // B0 — do nothing (organic self-cure only)
    noAction.attempted++;
    if (organicRecover(event, rand)) {
      noAction.recovered_count++;
      noAction.recovered_paise += event.amount;
    }

    // B1 — naive single retry on everything
    fixed.attempted++;
    fixed.actions++;
    if (naiveRetry(event, rand)) {
      fixed.recovered_count++;
      fixed.recovered_paise += event.amount;
    }
    if (event.decline_code === "upi_mandate_cancelled") {
      // Merchant retries a revoked mandate — that's the violation Recoup calls out
      fixed.violations++;
    }

    // Rules playbook, no EV
    const r = runRules(event, rand, false);
    if (!r.skipped) {
      rules.attempted++;
      rules.actions++;
      rules.contact_cost_paise += r.cost;
      if (r.recovered) {
        rules.recovered_count++;
        rules.recovered_paise += event.amount;
      }
    }

    // Orchestrated = rules + EV + mandate stop (already in decide)
    const o = runRules(event, rand, true);
    if (!o.skipped) {
      orch.attempted++;
      orch.actions++;
      orch.contact_cost_paise += o.cost;
      if (o.recovered) {
        orch.recovered_count++;
        orch.recovered_paise += event.amount;
      }
    }
  }

  const arms = [
    toArm("no_action", "Do nothing", noAction),
    toArm("fixed_retry", "Naive retry (what merchants run)", fixed),
    toArm("rule_based", "Playbook only", rules),
    toArm("orchestrated", "Playbook + EV + mandate stop", orch),
  ];

  const baseline = arms[1];
  const orchestrated = arms[3];

  return {
    total_events: batchSize,
    attempted: orchestrated.attempted,
    baseline_recovered: baseline.recovered_count,
    orchestrated_recovered: orchestrated.recovered_count,
    baseline_rate: baseline.rate,
    orchestrated_rate: orchestrated.rate,
    lift: Math.round((orchestrated.rate - baseline.rate) * 10) / 10,
    seed,
    simulated: true,
    arms,
    orchestrated_recovered_paise: orchestrated.recovered_paise,
    baseline_recovered_paise: baseline.recovered_paise,
  };
}

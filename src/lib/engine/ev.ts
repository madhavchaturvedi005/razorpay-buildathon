import type { EvCandidate, InterventionPlan, InterventionType } from "../types";
import { CALIBRATION } from "../data/calibration";
import { contactTier } from "./tier";

// Recoup / RecoverAI: EV = P(recover) × amount − cost − annoyance.
// Rank among the playbook's allowed actions. Negative EV ⇒ stop.

export function interventionCost(intervention: InterventionType | "stop"): number {
  if (intervention === "stop") return 0;
  return CALIBRATION.intervention_costs_paise[intervention] ?? 35;
}

export function annoyanceCost(intervention: InterventionType | "stop"): number {
  const tier = contactTier(intervention);
  return CALIBRATION.annoyance_paise[tier] ?? 0;
}

export function successRate(intervention: InterventionType | "stop"): number {
  if (intervention === "stop") return 0;
  return CALIBRATION.intervention_success_rates[
    intervention as keyof typeof CALIBRATION.intervention_success_rates
  ] ?? 0.3;
}

export function scoreEv(
  intervention: InterventionType | "stop",
  amountPaise: number,
): Omit<EvCandidate, "selected"> {
  const p = successRate(intervention);
  const cost = interventionCost(intervention);
  const annoyance = annoyanceCost(intervention);
  return {
    intervention,
    p_recover: p,
    amount: amountPaise,
    cost_paise: cost,
    annoyance_paise: annoyance,
    ev_paise: Math.round(p * amountPaise - cost - annoyance),
  };
}

export function rankPlan(plan: InterventionPlan, amountPaise: number): {
  plan: InterventionPlan;
  candidates: EvCandidate[];
} {
  const raw: (InterventionType | "stop")[] = [plan.primary];
  if (plan.secondary) raw.push(plan.secondary);
  raw.push("stop");

  const scored = raw.map((iv, i) => ({ ...scoreEv(iv, amountPaise), selected: false, _i: i }));
  scored.sort((a, b) => b.ev_paise - a.ev_paise || a._i - b._i);

  const best = scored[0];
  const candidates: EvCandidate[] = scored.map(({ _i, ...rest }) => ({
    ...rest,
    selected: rest.intervention === best.intervention,
  }));

  if (best.intervention === "stop" || best.ev_paise < 0) {
    return {
      plan: { ...plan, skipped_negative_ev: true },
      candidates,
    };
  }

  if (best.intervention !== plan.primary) {
    return {
      plan: {
        primary: best.intervention as InterventionType,
        secondary: plan.primary,
        discount_pct: plan.discount_pct,
      },
      candidates,
    };
  }

  return { plan, candidates };
}

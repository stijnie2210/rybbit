import { compareToControl, sampleRatioMismatch, type VariantStats } from "@rybbit/shared";
import { DateTime } from "luxon";

import type { Experiment, ExperimentStatus, ExperimentVariantResult } from "@/api/analytics/endpoints";

export type ExperimentFormState = {
  name: string;
  description: string;
  hypothesis: string;
  featureFlagId: string;
  primaryGoalId: string;
  status: ExperimentStatus;
};

export const STATUS_OPTIONS: ExperimentStatus[] = ["draft", "running", "paused", "completed"];

export const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

export function getVariantKeys(experiment: Experiment) {
  const keys: string[] = [];

  for (const conditionSet of experiment.featureFlag.conditionSets || []) {
    for (const variant of conditionSet.variants || []) {
      if (!keys.includes(variant.key)) keys.push(variant.key);
    }
  }

  for (const variant of experiment.featureFlag.variants || []) {
    if (!keys.includes(variant.key)) keys.push(variant.key);
  }

  return keys;
}

export function toFormState(experiment?: Experiment, fallbackFlagId?: number): ExperimentFormState {
  return {
    name: experiment?.name || "",
    description: experiment?.description || "",
    hypothesis: experiment?.hypothesis || "",
    featureFlagId: String(experiment?.featureFlagId ?? fallbackFlagId ?? ""),
    primaryGoalId: experiment?.primaryGoalId ? String(experiment.primaryGoalId) : "none",
    status: experiment?.status || "draft",
  };
}

export function statusLabel(status: ExperimentStatus) {
  const labels: Record<ExperimentStatus, string> = {
    draft: "Draft",
    running: "Running",
    paused: "Paused",
    completed: "Completed",
  };
  return labels[status];
}

export function formatCompactNumber(value: number): string {
  if (value < 1000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toRelative() : null;
}

export function getControlResult(results: ExperimentVariantResult[]): ExperimentVariantResult | undefined {
  return results.find(result => result.isControl) || results[0];
}

// Bayesian comparison of a variant against control (Beta(1,1) prior per arm).
export function getVariantStats(
  control: ExperimentVariantResult | undefined,
  variant: ExperimentVariantResult
): VariantStats | null {
  if (!control || control.variant === variant.variant) return null;
  return compareToControl(
    { units: control.units, conversions: control.conversions },
    { units: variant.units, conversions: variant.conversions }
  );
}

// The configured split per variant, or null when condition sets split traffic
// differently: then no single expected ratio exists to test against.
export function getVariantWeights(experiment: Experiment): Record<string, number> | null {
  const splits = (experiment.featureFlag.conditionSets || [])
    .map(conditionSet => conditionSet.variants || [])
    .filter(variants => variants.length > 0);
  if (splits.length === 0 && experiment.featureFlag.variants?.length) splits.push(experiment.featureFlag.variants);
  if (splits.length === 0) return null;

  const toWeights = (variants: { key: string; rolloutPercentage: number }[]) =>
    Object.fromEntries(variants.map(variant => [variant.key, Number(variant.rolloutPercentage) || 0]));
  const [first, ...rest] = splits.map(toWeights);
  const sameSplit = rest.every(
    weights =>
      Object.keys(weights).length === Object.keys(first).length &&
      Object.entries(weights).every(([key, weight]) => first[key] === weight)
  );
  return sameSplit ? first : null;
}

/**
 * Everything the results panel and the completion dialog judge an experiment
 * by: per-variant stats against control, the split check, and the arm that is
 * ahead (a winning variant, or control when every variant loses). A broken
 * split invalidates the comparison, so then nothing is ahead.
 */
export function getExperimentVerdict(experiment: Experiment, results: ExperimentVariantResult[]) {
  const control = getControlResult(results);
  const statsByVariant = new Map(results.map(result => [result.variant, getVariantStats(control, result)]));
  const comparisons = results.flatMap(result => {
    const stats = statsByVariant.get(result.variant);
    return stats ? [{ result, stats }] : [];
  });
  const winning = comparisons
    .filter(comparison => comparison.stats.decision === "winning")
    .sort((a, b) => b.stats.chanceToBeatControl - a.stats.chanceToBeatControl)[0];
  const controlWinning =
    !!control && comparisons.length > 0 && comparisons.every(comparison => comparison.stats.decision === "losing");

  const weights = getVariantWeights(experiment);
  const srm = weights
    ? sampleRatioMismatch(
        results.map(result => result.units),
        results.map(result => weights[result.variant] ?? 0)
      )
    : null;
  const leader = srm?.mismatch ? undefined : (winning?.result ?? (controlWinning ? control : undefined));

  return { control, statsByVariant, comparisons, weights, srm, leader };
}

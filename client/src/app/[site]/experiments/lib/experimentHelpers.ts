import { compareToControl, type VariantStats } from "@rybbit/shared";
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

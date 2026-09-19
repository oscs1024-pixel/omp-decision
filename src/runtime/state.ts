import type { LoadedDecisionConfig } from "../config/types.js";

export interface DecisionRuntimeState {
  enabled: boolean;
  loaded: LoadedDecisionConfig;
}

export function createRuntimeState(loaded: LoadedDecisionConfig): DecisionRuntimeState {
  return { enabled: loaded.config.enabled, loaded };
}

export function reloadRuntimeState(state: DecisionRuntimeState, loaded: LoadedDecisionConfig): void {
  state.loaded = loaded;
  state.enabled = loaded.config.enabled;
}

export function setRuntimeEnabled(state: DecisionRuntimeState, enabled: boolean): void {
  state.enabled = enabled;
}

export function formatRuntimeStatus(state: DecisionRuntimeState): string {
  const { config, sources, warnings } = state.loaded;
  return [
    "omp-decision",
    `status: ${state.enabled ? "enabled" : "disabled"}`,
    `review: ${config.review.enabled ? "enabled" : "disabled"}`,
    `jev: ${config.providers.jev.enabled ? "enabled" : "disabled"}`,
    `config: ${sources.length ? sources.join(", ") : "defaults"}`,
    `warnings: ${warnings.length}`,
  ].join("\n");
}

export type ProgressThrottleState = {
  lastPhase: string | undefined;
  lastPublishedAt: number;
};

const PROGRESS_UPDATE_INTERVAL_MS = 100;

export function createProgressThrottleState(): ProgressThrottleState {
  return {
    lastPhase: undefined,
    lastPublishedAt: Number.NEGATIVE_INFINITY
  };
}

export function shouldPublishProgress(
  state: ProgressThrottleState,
  phase: string,
  terminal: boolean,
  now = performance.now()
): boolean {
  if (
    !terminal &&
    state.lastPhase === phase &&
    now - state.lastPublishedAt < PROGRESS_UPDATE_INTERVAL_MS
  ) {
    return false;
  }
  state.lastPhase = phase;
  state.lastPublishedAt = now;
  return true;
}

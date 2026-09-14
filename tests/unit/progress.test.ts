import { describe, expect, it } from "vitest";
import {
  createProgressThrottleState,
  shouldPublishProgress
} from "../../src/infrastructure/browser/progress";

describe("progress throttling", () => {
  it("publishes phase changes and terminal updates immediately", () => {
    const state = createProgressThrottleState();

    expect(shouldPublishProgress(state, "reading-stops", false, 0)).toBe(true);
    expect(shouldPublishProgress(state, "reading-stops", false, 50)).toBe(
      false
    );
    expect(shouldPublishProgress(state, "reading-stops", false, 100)).toBe(
      true
    );
    expect(shouldPublishProgress(state, "validating", false, 101)).toBe(true);
    expect(shouldPublishProgress(state, "validating", true, 102)).toBe(true);
  });
});

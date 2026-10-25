import { afterEach, describe, expect, it, vi } from "vitest";
import { createEligibleStop, type EligibleStop } from "../../src/domain/gtfs";
import type {
  MatchingWorkerMessage,
  MatchingWorkerRequest
} from "../../src/workers/protocol";

function makeStop(index: number): EligibleStop {
  const result = createEligibleStop("US-WA-KCM", "King County Metro", {
    rowNumber: index + 2,
    fields: {
      stop_id: `KCM-${index}`,
      stop_name: `Stop ${index}`,
      stop_lat: "47.6100",
      stop_lon: "-122.3350",
      location_type: "0"
    }
  });
  if (!("stop" in result)) {
    throw new Error("fixture stop is invalid");
  }
  return result.stop;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("matching worker", () => {
  it("throttles progress messages and always publishes terminal progress", async () => {
    const postedMessages: MatchingWorkerMessage[] = [];
    let messageListener:
      ((event: MessageEvent<MatchingWorkerRequest>) => void) | undefined;
    const workerScope = {
      addEventListener: (
        _type: string,
        listener: (event: MessageEvent<MatchingWorkerRequest>) => void
      ) => {
        messageListener = listener;
      },
      postMessage: (message: MatchingWorkerMessage) => {
        postedMessages.push(message);
      }
    };
    vi.stubGlobal("self", workerScope);
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.resetModules();

    await import("../../src/workers/matching.worker");

    if (messageListener === undefined) {
      throw new Error("matching worker did not register a message listener");
    }
    const request: MatchingWorkerRequest = {
      type: "match",
      requestId: "test-request",
      stops: [makeStop(0), makeStop(1), makeStop(2)],
      nodes: [],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    };
    messageListener({ data: request } as MessageEvent<MatchingWorkerRequest>);

    const progressMessages = postedMessages.filter(
      (
        message
      ): message is Extract<
        MatchingWorkerMessage,
        { type: "match-progress" }
      > => message.type === "match-progress"
    );
    expect(progressMessages.map((message) => message.processed)).toEqual([
      1, 3
    ]);
    expect(progressMessages.map((message) => message.total)).toEqual([3, 3]);
    expect(postedMessages.at(-1)).toMatchObject({
      type: "match-complete",
      requestId: "test-request"
    });
  });
});

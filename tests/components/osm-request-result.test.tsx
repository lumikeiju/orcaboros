import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  OsmRequestResult,
  type OsmRequestResultState
} from "../../src/components/OsmRequestResult";

afterEach(() => cleanup());

describe("OsmRequestResult", () => {
  it.each([
    {
      result: {
        kind: "success",
        nodeCount: 12,
        requestCount: 2
      },
      role: "status",
      heading: "Overpass request complete",
      detail: "Retrieved 12 OSM candidate nodes from 2 Overpass requests."
    },
    {
      result: {
        kind: "empty",
        requestCount: 1
      },
      role: "status",
      heading: "Overpass request complete",
      detail: "No OSM candidate nodes were returned after 1 Overpass request."
    },
    {
      result: {
        kind: "failed",
        message: "The Overpass request was blocked by CORS"
      },
      role: "alert",
      heading: "Overpass request failed",
      detail: "The Overpass request was blocked by CORS"
    },
    {
      result: { kind: "cancelled" },
      role: "status",
      heading: "Overpass request cancelled",
      detail: "The request was cancelled before candidate retrieval completed."
    }
  ] satisfies readonly {
    result: OsmRequestResultState;
    role: "status" | "alert";
    heading: string;
    detail: string;
  }[])(
    "describes a $result.kind request",
    ({ result, role, heading, detail }) => {
      render(<OsmRequestResult result={result} />);

      const status = screen.getByRole(role);
      expect(status).toHaveTextContent(heading);
      expect(status).toHaveTextContent(detail);
    }
  );
});

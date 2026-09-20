import { type ReactElement } from "react";

export type OsmRequestResultState =
  | {
      kind: "success";
      nodeCount: number;
      requestCount: number;
    }
  | {
      kind: "empty";
      requestCount: number;
    }
  | {
      kind: "failed";
      message: string;
    }
  | {
      kind: "cancelled";
    };

type OsmRequestResultProps = {
  result: OsmRequestResultState;
};

function requestCountLabel(requestCount: number): string {
  return `${requestCount} Overpass request${requestCount === 1 ? "" : "s"}`;
}

export function OsmRequestResult({
  result
}: OsmRequestResultProps): ReactElement {
  let heading: string;
  let detail: string;

  switch (result.kind) {
    case "success":
      heading = "Overpass request complete";
      detail = `Retrieved ${result.nodeCount.toLocaleString()} OSM candidate node${
        result.nodeCount === 1 ? "" : "s"
      } from ${requestCountLabel(result.requestCount)}.`;
      break;
    case "empty":
      heading = "Overpass request complete";
      detail = `No OSM candidate nodes were returned after ${requestCountLabel(
        result.requestCount
      )}.`;
      break;
    case "failed":
      heading = "Overpass request failed";
      detail = result.message;
      break;
    case "cancelled":
      heading = "Overpass request cancelled";
      detail =
        "The request was cancelled before candidate retrieval completed.";
      break;
  }

  return (
    <div
      className={`osm-query-result is-${result.kind}`}
      role={result.kind === "failed" ? "alert" : "status"}
    >
      <strong>{heading}</strong>
      <span>{detail}</span>
    </div>
  );
}

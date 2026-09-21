import {
  isOsmWay,
  OsmElement,
  OsmNode,
  toOsmNode,
  toOsmWay
} from "../../domain/osm";
import {
  buildOverpassRequest,
  OVERPASS_CLIENT_TIMEOUT_MS,
  OVERPASS_MAX_ELEMENTS,
  OVERPASS_MAX_RESPONSE_BYTES,
  OverpassRequestError,
  sanitizeOverpassError,
  validateOverpassEndpoint
} from "./query";

type OverpassResponse = {
  elements?: readonly unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeElement(value: unknown): value is {
  type: "node";
  id: number;
  version: number;
  lat: number;
  lon: number;
  tags?: Readonly<Record<string, string>>;
} {
  if (!isRecord(value) || value.type !== "node") {
    return false;
  }
  if (
    typeof value.id !== "number" ||
    typeof value.version !== "number" ||
    typeof value.lat !== "number" ||
    typeof value.lon !== "number"
  ) {
    return false;
  }
  if (value.tags !== undefined) {
    if (!isRecord(value.tags)) {
      return false;
    }
    if (
      Object.values(value.tags).some((tagValue) => typeof tagValue !== "string")
    ) {
      return false;
    }
  }
  return true;
}

function isWayElement(value: unknown): value is {
  type: "way";
  id: number;
  version: number;
  center: { lat: number; lon: number };
  nodes: readonly number[];
  tags?: Readonly<Record<string, string>>;
} {
  if (!isRecord(value) || value.type !== "way") {
    return false;
  }
  if (
    typeof value.id !== "number" ||
    typeof value.version !== "number" ||
    !isRecord(value.center) ||
    typeof value.center.lat !== "number" ||
    typeof value.center.lon !== "number" ||
    !Array.isArray(value.nodes) ||
    value.nodes.some((nodeId) => typeof nodeId !== "number")
  ) {
    return false;
  }
  if (value.tags !== undefined) {
    if (!isRecord(value.tags)) {
      return false;
    }
    if (
      Object.values(value.tags).some((tagValue) => typeof tagValue !== "string")
    ) {
      return false;
    }
  }
  return true;
}

async function readBoundedResponse(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  if (response.body === null) {
    throw new OverpassRequestError(
      "malformed-data",
      "The Overpass response had no body"
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException(
          "The Overpass request was cancelled",
          "AbortError"
        );
      }
      const result = await reader.read();
      if (result.done) {
        parts.push(decoder.decode());
        return parts.join("");
      }
      bytes += result.value.byteLength;
      if (bytes > OVERPASS_MAX_RESPONSE_BYTES) {
        throw new OverpassRequestError(
          "size-limit",
          "The Overpass response exceeded the 25 MiB limit"
        );
      }
      parts.push(decoder.decode(result.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

function parseElements(text: string): readonly OsmElement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    void error;
    throw new OverpassRequestError(
      "malformed-data",
      "The Overpass response was not valid JSON"
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) {
    throw new OverpassRequestError(
      "malformed-data",
      "The Overpass response had no elements"
    );
  }
  if (parsed.elements.length > OVERPASS_MAX_ELEMENTS) {
    throw new OverpassRequestError(
      "node-limit",
      "The Overpass response contained too many elements"
    );
  }
  const elements: OsmElement[] = [];
  for (const element of parsed.elements) {
    if (isNodeElement(element)) {
      elements.push(
        toOsmNode({
          type: "node",
          id: element.id,
          version: element.version,
          lat: element.lat,
          lon: element.lon,
          tags: element.tags
        })
      );
    } else if (isWayElement(element)) {
      elements.push(
        toOsmWay({
          type: "way",
          id: element.id,
          version: element.version,
          center: element.center,
          nodes: element.nodes,
          tags: element.tags
        })
      );
    }
  }
  return elements;
}

export async function retrieveOverpassElements(
  endpoint: string,
  query: string,
  userSignal?: AbortSignal
): Promise<readonly OsmElement[]> {
  const url = validateOverpassEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    OVERPASS_CLIENT_TIMEOUT_MS
  );
  const cancel = () => controller.abort();
  userSignal?.addEventListener("abort", cancel, { once: true });
  try {
    const request = buildOverpassRequest(query);
    const response = await fetch(url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      cache: "no-store",
      referrerPolicy: "strict-origin-when-cross-origin",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new OverpassRequestError(
        "http",
        `The Overpass request failed with HTTP ${response.status}`,
        response.status
      );
    }
    const body = await readBoundedResponse(response, controller.signal);
    return parseElements(body);
  } catch (error) {
    if (error instanceof OverpassRequestError) {
      throw error;
    }
    if (controller.signal.aborted && !userSignal?.aborted) {
      throw new OverpassRequestError(
        "timeout",
        "The Overpass request timed out"
      );
    }
    throw sanitizeOverpassError(error);
  } finally {
    clearTimeout(timeout);
    userSignal?.removeEventListener("abort", cancel);
  }
}

export async function retrieveOverpassNodes(
  endpoint: string,
  query: string,
  userSignal?: AbortSignal
): Promise<readonly OsmNode[]> {
  const elements = await retrieveOverpassElements(endpoint, query, userSignal);
  return elements.filter((element): element is OsmNode => !isOsmWay(element));
}

export function parseOverpassNodesForTest(text: string): readonly OsmNode[] {
  return parseElements(text).filter(
    (element): element is OsmNode => !("type" in element)
  );
}

export function parseOverpassElementsForTest(
  text: string
): readonly OsmElement[] {
  return parseElements(text);
}

export type OsmTag = {
  key: string;
  value: string;
};

export type OsmTagSet = Readonly<Record<string, string>>;

export type OsmNode = {
  id: number;
  version: number;
  latitude: number;
  longitude: number;
  tags: OsmTagSet;
};

export type OsmWay = {
  type: "way";
  id: number;
  version: number;
  latitude: number;
  longitude: number;
  nodeRefs: readonly number[];
  tags: OsmTagSet;
};

export type OsmElement = OsmNode | OsmWay;

export type OsmElementRef = {
  type: "node" | "way";
  id: number;
};

export type BoundingBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type OSMNodeElement = {
  type: "node";
  id: number;
  version?: number;
  lat: number;
  lon: number;
  tags?: Readonly<Record<string, string>>;
};

export type OSMWayElement = {
  type: "way";
  id: number;
  version?: number;
  center: {
    lat: number;
    lon: number;
  };
  nodes: readonly number[];
  tags?: Readonly<Record<string, string>>;
};

export function isOsmWay(element: OsmElement): element is OsmWay {
  return "type" in element && element.type === "way";
}

export function osmElementRef(element: OsmElement): OsmElementRef {
  return {
    type: isOsmWay(element) ? "way" : "node",
    id: element.id
  };
}

export function osmElementKey(element: OsmElement | OsmElementRef): string {
  const type = "type" in element ? element.type : "node";
  return `${type}:${element.id}`;
}

export const elementKey = osmElementKey;

export function tagArrayToRecord(tags: readonly OsmTag[]): OsmTagSet {
  const keys = new Set<string>();
  for (const tag of tags) {
    validateOsmTag(tag);
    if (keys.has(tag.key)) {
      throw new Error(`Duplicate OSM tag key: ${tag.key}`);
    }
    keys.add(tag.key);
  }
  return Object.fromEntries(tags.map((tag) => [tag.key, tag.value]));
}

export function recordToTagArray(tags: OsmTagSet): OsmTag[] {
  return Object.entries(tags)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => ({ key, value }));
}

export function toOsmNode(element: OSMNodeElement): OsmNode {
  const version = element.version;
  if (
    !Number.isSafeInteger(element.id) ||
    element.id <= 0 ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !Number.isFinite(element.lat) ||
    !Number.isFinite(element.lon) ||
    element.lat < -90 ||
    element.lat > 90 ||
    element.lon < -180 ||
    element.lon > 180
  ) {
    throw new Error("Invalid OSM node element");
  }

  return {
    id: element.id,
    version,
    latitude: element.lat,
    longitude: element.lon,
    tags: element.tags ?? {}
  };
}

export function toOsmWay(element: OSMWayElement): OsmWay {
  const version = element.version;
  if (
    !Number.isSafeInteger(element.id) ||
    element.id <= 0 ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !Number.isFinite(element.center.lat) ||
    !Number.isFinite(element.center.lon) ||
    element.center.lat < -90 ||
    element.center.lat > 90 ||
    element.center.lon < -180 ||
    element.center.lon > 180 ||
    element.nodes.length < 2 ||
    element.nodes.some((nodeId) => !Number.isSafeInteger(nodeId) || nodeId <= 0)
  ) {
    throw new Error("Invalid OSM way element");
  }

  return {
    type: "way",
    id: element.id,
    version,
    latitude: element.center.lat,
    longitude: element.center.lon,
    nodeRefs: [...element.nodes],
    tags: element.tags ?? {}
  };
}

export function isValidOsmKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 255 &&
    !/[\u0000-\u001f\u007f\ufffe\uffff\p{Surrogate}]/u.test(key)
  );
}

export function isValidOsmValue(value: string): boolean {
  return (
    value.length <= 255 &&
    !/[\u0000-\u001f\u007f\ufffe\uffff\p{Surrogate}]/u.test(value)
  );
}

export function validateOsmTag(tag: OsmTag): void {
  if (!isValidOsmKey(tag.key)) {
    throw new Error(`Invalid OSM tag key: ${tag.key}`);
  }
  if (!isValidOsmValue(tag.value)) {
    throw new Error(`Invalid OSM tag value for ${tag.key}`);
  }
}

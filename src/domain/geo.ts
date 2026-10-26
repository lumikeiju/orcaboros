import { BoundingBox } from "./osm";

export const WEB_MERCATOR_LATITUDE_LIMIT = 85.05112878;
const EARTH_RADIUS_METERS = 6_371_008.8;

export function haversineDistanceMeters(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(secondLatitude - firstLatitude);
  const longitudeDelta = toRadians(secondLongitude - firstLongitude);
  const first = toRadians(firstLatitude);
  const second = toRadians(secondLatitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(first) * Math.cos(second) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

function longitudeDeltaForRadius(
  latitude: number,
  radiusMeters: number
): number {
  const metersPerDegree =
    111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  return radiusMeters / metersPerDegree;
}

export function boundsFromCoordinates(
  coordinates: readonly { latitude: number; longitude: number }[],
  radiusMeters: number
): BoundingBox {
  if (coordinates.length === 0) {
    throw new Error("Cannot derive an OSM extent without eligible stops");
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new Error("Extent radius must be a non-negative finite number");
  }

  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;
  let longitudePadding = 0;
  for (const { latitude, longitude } of coordinates) {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("Extent coordinates must be finite WGS84 values");
    }
    minimumLatitude = Math.min(minimumLatitude, latitude);
    maximumLatitude = Math.max(maximumLatitude, latitude);
    longitudePadding = Math.max(
      longitudePadding,
      longitudeDeltaForRadius(latitude, radiusMeters)
    );
  }
  const longitudes = coordinates.map((coordinate) =>
    normalizeLongitude(coordinate.longitude)
  );
  const south = Math.max(
    -WEB_MERCATOR_LATITUDE_LIMIT,
    minimumLatitude - radiusMeters / 111_320
  );
  const north = Math.min(
    WEB_MERCATOR_LATITUDE_LIMIT,
    maximumLatitude + radiusMeters / 111_320
  );

  const sorted = [...longitudes].sort((left, right) => left - right);
  let west = sorted[0];
  let east = sorted[sorted.length - 1];
  if (sorted.length > 1) {
    let largestGap = -1;
    let gapIndex = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const next = sorted[(index + 1) % sorted.length];
      const gap = (next - sorted[index] + 360) % 360;
      if (gap > largestGap) {
        largestGap = gap;
        gapIndex = index;
      }
    }
    west = sorted[(gapIndex + 1) % sorted.length];
    east = sorted[gapIndex];
  }

  west = normalizeLongitude(west - longitudePadding);
  east = normalizeLongitude(east + longitudePadding);
  return { south, west, north, east };
}

export function validateBounds(bounds: BoundingBox): void {
  if (
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.north) ||
    !Number.isFinite(bounds.east) ||
    bounds.south < -WEB_MERCATOR_LATITUDE_LIMIT ||
    bounds.north > WEB_MERCATOR_LATITUDE_LIMIT ||
    bounds.south > bounds.north ||
    bounds.west < -180 ||
    bounds.west > 180 ||
    bounds.east < -180 ||
    bounds.east > 180
  ) {
    throw new Error("Invalid OSM extent");
  }
}

export function splitAntimeridianBounds(
  bounds: BoundingBox
): readonly BoundingBox[] {
  validateBounds(bounds);
  if (bounds.west <= bounds.east) {
    if (bounds.west === bounds.east) {
      throw new Error("OSM extent has no longitude width");
    }
    return [bounds];
  }
  return [
    { south: bounds.south, west: bounds.west, north: bounds.north, east: 180 },
    { south: bounds.south, west: -180, north: bounds.north, east: bounds.east }
  ];
}

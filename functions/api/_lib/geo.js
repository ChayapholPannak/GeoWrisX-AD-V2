/** Geofence math shared by the device gateway and the track API. */

const R = 6371; // Earth radius, km

/** Great-circle distance between two WGS-84 points, in metres. */
export function haversineM(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))) * 1000;
}

/** Ray-casting point-in-polygon. poly: [[lat, lng], ...] */
export function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [latI, lngI] = poly[i];
    const [latJ, lngJ] = poly[j];
    const intersect = (lngI > lng) !== (lngJ > lng)
      && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Classic hysteresis gate for a circular fence:
 *   inside  <= radius          (state resets)
 *   edge    < radius * 1.15    (state holds — GPS bounce does not retrigger)
 *   outside >= radius * 1.15   (counts toward a breach)
 * The breach itself additionally needs 2 consecutive outside points and 60 s.
 */
export const GEOFENCE_MARGIN = 1.15;
export const GEOFENCE_MIN_STREAK = 2;
export const GEOFENCE_MIN_DURATION_MS = 60_000;

export function circularGateState(fence, distance) {
  const radius = Number(fence.radius_m) || 0;
  if (distance <= radius) return 'inside';
  if (distance < radius * GEOFENCE_MARGIN) return 'edge';
  return 'outside';
}

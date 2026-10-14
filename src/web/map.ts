import L from 'leaflet';

/**
 * OpenStreetMap tiles. OSM's free tile servers refuse requests that don't say which site they come
 * from, and SiteRoll's pages otherwise send no referrer (so login links never leak). These tiles
 * send just the site's address (origin), never the page path.
 */
export function osmTiles(maxZoom = 19) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom,
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

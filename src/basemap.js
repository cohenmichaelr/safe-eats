'use strict';

/**
 * Which basemap the map draws on — D-014.
 *
 * WHY THIS IS CONFIGURATION AND NOT A URL IN app.js
 *
 * v2 shipped on `services.arcgisonline.com`, Esri's keyless legacy tile
 * endpoint, and D-014 recorded the reason that could not stand at launch: the
 * terms for unauthenticated production use had never been read. They still do
 * not permit it plainly. Esri's current documentation says basemap services
 * require an ArcGIS account or API key and bill per tile returned, so a public
 * site drawing on the keyless endpoint is relying on something nobody has
 * licensed. That is a third party's decision to make about us, which is exactly
 * the dependency this project keeps out of the request path everywhere else.
 *
 * So the provider is chosen by configuration:
 *
 *   SAFE_EATS_BASEMAP_KEY set  →  CARTO, licensed. A free key, no account
 *                                 needed, 5,000,000 tiles a month. This is the
 *                                 fallback D-014 named, and it is what
 *                                 production runs on.
 *   not set                    →  OpenStreetMap's own tiles, under the OSMF
 *                                 Tile Usage Policy. Correct for a laptop and
 *                                 for tests; the policy asks that production
 *                                 traffic not lean on a donated service, which
 *                                 is why the key exists.
 *
 * THE KEY IS PUBLIC, AND THAT IS NOT AUD F3
 *
 * A basemap key travels to the browser by definition — the browser is what
 * fetches the tiles. AUD F3 was v1 serving its **Google Maps** key from
 * /config, a key with billing attached to geocoding and Places. That key is
 * still server-side only (src/geocode.js, tier 2) and never reaches a page.
 * The distinction is the scope of what the key can spend, not whether a key is
 * visible.
 */

const PROVIDERS = {
  carto: (key, style = process.env.SAFE_EATS_BASEMAP_STYLE || 'voyager') => ({
    provider: `CARTO ${style}`,
    // {r} is Leaflet's retina suffix; CARTO serves @2x for it.
    url: `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png?api_key=${key}`,
    // A concrete tile for the canary to fetch — same z/x/y the reference uses.
    tile: (z, x, y) => `https://basemaps.cartocdn.com/rastertiles/${style}/${z}/${x}/${y}.png?api_key=${key}`,
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
    licensed: true,
  }),

  osm: () => ({
    provider: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tile: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    licensed: false,
  }),
};

function basemap() {
  const key = process.env.SAFE_EATS_BASEMAP_KEY;
  return key ? PROVIDERS.carto(key) : PROVIDERS.osm();
}

/**
 * The same thing minus the key, for anything that leaves the machine — logs,
 * the canary's recorded reference, a bug report. The key is public to a browser
 * fetching tiles; that is not a reason to write it into a committed artefact.
 */
function describe(config = basemap()) {
  return {
    provider: config.provider,
    attribution: config.attribution,
    maxZoom: config.maxZoom,
    licensed: config.licensed,
  };
}

module.exports = { basemap, describe, PROVIDERS };

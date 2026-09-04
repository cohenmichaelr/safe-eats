'use strict';

/**
 * Which basemap the map draws on — D-014.
 *
 * The provider is a licence decision expressed as configuration, so the tests
 * are about the licence: production must land on the keyed, licensed provider,
 * and the key must not leak into anything that gets committed or logged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { basemap, describe: describeBasemap, PROVIDERS } = require('../src/basemap');

function withKey(key, fn) {
  const previous = process.env.SAFE_EATS_BASEMAP_KEY;
  if (key === null) delete process.env.SAFE_EATS_BASEMAP_KEY;
  else process.env.SAFE_EATS_BASEMAP_KEY = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SAFE_EATS_BASEMAP_KEY;
    else process.env.SAFE_EATS_BASEMAP_KEY = previous;
  }
}

test('basemap provider', async (t) => {
  await t.test('a key selects the licensed provider', () => {
    const config = withKey('test-key-123', basemap);
    assert.match(config.provider, /CARTO/);
    assert.equal(config.licensed, true);
    assert.match(config.url, /api_key=test-key-123/);
  });

  await t.test('no key falls back to OpenStreetMap, and says it is not licensed', () => {
    // Correct for a laptop; `licensed: false` is what stops it being mistaken
    // for a production posture. OSMF's policy asks that production traffic not
    // lean on a donated service.
    const config = withKey(null, basemap);
    assert.equal(config.provider, 'OpenStreetMap');
    assert.equal(config.licensed, false);
    assert.ok(!config.url.includes('api_key'));
  });

  await t.test('the key never appears in what gets written down', () => {
    // describe() feeds the pinned canary reference and any log line. A key in a
    // committed artefact is a key in the repository.
    const described = withKey('secret-key-456', () => describeBasemap(basemap()));
    assert.ok(!JSON.stringify(described).includes('secret-key-456'));
    assert.match(described.provider, /CARTO/);
  });

  await t.test('the canary asks for the same tile whatever the provider', () => {
    // Esri paths are {z}/{y}/{x} and the rest are {z}/{x}/{y}; the tile helper
    // exists so a provider swap cannot silently start checking a tile in the
    // ocean.
    assert.match(PROVIDERS.osm().tile(12, 1130, 1731), /\/12\/1130\/1731\.png$/);
    assert.match(PROVIDERS.carto('k').tile(12, 1130, 1731), /\/12\/1130\/1731\.png\?api_key=k$/);
  });
});

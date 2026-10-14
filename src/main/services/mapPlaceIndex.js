// Builds an offline, in-memory gazetteer (place name -> lon/lat) straight
// from a .pmtiles archive's own "places" vector layer — no network lookup,
// matching the Maps tab's fully-offline design. This reads the raw archive
// directly with a local-file Source (not through MapLibre/the browser), so
// coverage isn't limited to whatever's been scrolled into view; it's driven
// entirely by which tiles this module chooses to read.
//
// A named place, once it appears in the tile pyramid at some zoom, keeps
// appearing at every deeper zoom too — so reading a single sufficiently deep
// zoom level captures every place up to that zoom's level of detail, without
// needing to re-read multiple zooms. The tricky part is that tile count
// grows ~4x per zoom level, so "sufficiently deep" has to be balanced against
// how long a scan should reasonably take — see chooseIndexZoom below.
const fs = require('fs');
const { PMTiles } = require('pmtiles');
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');

// Keeps overall scan time to roughly a few seconds even on a slow (USB)
// drive. Small regional extracts comfortably reach their own native max
// zoom under this cap (full detail); country/world-sized archives get
// capped to a shallower zoom (still every city and most towns) rather than
// trying to enumerate hundreds of thousands of tiles.
const TILE_COUNT_CAP = 3000;

class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, 'r');
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }

  close() {
    try { fs.closeSync(this.fd); } catch { /* already closed */ }
  }
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function tileRangeAtZoom(header, z) {
  const min = lonLatToTile(header.minLon, header.maxLat, z);
  const max = lonLatToTile(header.maxLon, header.minLat, z);
  return { minX: min.x, maxX: max.x, minY: min.y, maxY: max.y, count: (max.x - min.x + 1) * (max.y - min.y + 1) };
}

function chooseIndexZoom(header) {
  let z = header.maxZoom;
  while (z > header.minZoom && tileRangeAtZoom(header, z).count > TILE_COUNT_CAP) z--;
  return z;
}

async function buildPlaceIndex(filePath) {
  const source = new NodeFileSource(filePath);
  try {
    const pmtiles = new PMTiles(source);
    const header = await pmtiles.getHeader();
    const zoom = chooseIndexZoom(header);
    const range = tileRangeAtZoom(header, zoom);

    const seen = new Set();
    const places = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const resp = await pmtiles.getZxy(zoom, x, y);
        if (!resp) continue;
        let tile;
        try {
          tile = new VectorTile(new Pbf(Buffer.from(resp.data)));
        } catch {
          continue; // corrupt/unexpected tile — skip rather than fail the whole scan
        }
        const layer = tile.layers.places;
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          // Prefer the English name (matches the map's own label rendering,
          // see the place-labels layer in renderer.js) so search input/output
          // stay in English too; fall back to the local name if there isn't one.
          const name = feature.properties?.['name:en'] || feature.properties?.name;
          if (!name) continue;
          const geo = feature.toGeoJSON(x, y, zoom);
          const [lon, lat] = geo.geometry?.coordinates || [];
          if (typeof lon !== 'number' || typeof lat !== 'number') continue;
          const key = `${name.toLowerCase()}|${lon.toFixed(3)},${lat.toFixed(3)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          places.push({ name, lon, lat });
        }
      }
    }
    return { zoom, tileCount: range.count, places };
  } finally {
    source.close();
  }
}

module.exports = { buildPlaceIndex };

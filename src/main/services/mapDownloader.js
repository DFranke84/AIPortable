const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const EventEmitter = require('events');

// Downloads map regions listed in data/maps-catalog.json by cutting them out
// of Protomaps' daily world build with the bundled pmtiles CLI ("pmtiles
// extract" fetches only the tiles inside the region over HTTP range requests,
// never the ~120 GB planet file). Same event shape as ZimDownloader
// (progress / complete / error) so the Tools tab can show it the same way.

function readCatalog(catalogPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return { catalog: { source: raw.source, groups: raw.groups || {}, regions: raw.regions || {} }, error: null };
  } catch (err) {
    return { catalog: { groups: {}, regions: {} }, error: err.message };
  }
}

// resources/maps/tools/pmtiles(.exe). The Windows zip that ships next to it
// is unpacked on first use, like DOWNLOAD-MAPS.ps1 does.
function findPmtiles(resourcesDir) {
  const toolsDir = path.join(resourcesDir, 'maps', 'tools');
  const exe = path.join(toolsDir, process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');
  if (fs.existsSync(exe)) return exe;
  if (process.platform === 'win32') {
    const zip = fs.existsSync(toolsDir) && fs.readdirSync(toolsDir).find((f) => /^go-pmtiles_.*Windows_x86_64\.zip$/i.test(f));
    if (zip) {
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(toolsDir, zip)}' -DestinationPath '${toolsDir}' -Force`], { windowsHide: true });
      } catch { /* reported below as "not found" */ }
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

function buildDates() {
  // Today's build can lag a few hours behind; Protomaps keeps about a week online.
  const out = [];
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.now() - back * 86400000);
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

const UNITS = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 };
const toBytes = (n, u) => Math.round(parseFloat(n) * (UNITS[u.toUpperCase()] || 1));

class MapDownloader extends EventEmitter {
  constructor() {
    super();
    this.active = new Map(); // key -> { proc, progress, downloaded, total, speed, cancelled }
  }

  getStatus() {
    const out = {};
    for (const [key, a] of this.active) out[key] = { progress: a.progress, downloaded: a.downloaded, total: a.total, speed: a.speed, status: 'downloading' };
    return out;
  }

  // Resolves { success, error? } when the file is in place (or failed).
  async download(key, entry, mapsDir, pmtilesExe, source) {
    if (this.active.has(key)) return { success: false, error: 'Already downloading.' };
    const dest = path.join(mapsDir, `${key}.pmtiles`);
    if (fs.existsSync(dest)) return { success: false, error: 'Already downloaded.' };
    fs.mkdirSync(mapsDir, { recursive: true });
    const part = `${dest}.part`;
    const state = { proc: null, progress: 0, downloaded: 0, total: 0, speed: 0, cancelled: false, lastEmit: 0 };
    this.active.set(key, state);

    let lastError = '';
    for (const date of buildDates()) {
      if (state.cancelled) break;
      try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
      const args = ['extract', (source || 'https://build.protomaps.com/{date}.pmtiles').replace('{date}', date), part];
      if (entry.bbox) args.push(`--bbox=${entry.bbox}`);
      if (entry.maxzoom != null) args.push(`--maxzoom=${entry.maxzoom}`);
      const result = await this.run(key, state, pmtilesExe, args);
      if (result.ok && fs.existsSync(part)) {
        fs.renameSync(part, dest);
        this.active.delete(key);
        this.emit('complete', { id: key });
        return { success: true };
      }
      lastError = result.error;
      // A missing build ("404"/"not found") is worth retrying with an older date;
      // anything else (no internet, disk full, cancelled) is not.
      if (!/404|not found|NoSuchKey/i.test(result.error || '')) break;
    }
    try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
    this.active.delete(key);
    if (state.cancelled) return { success: false, error: 'Cancelled' };
    const error = lastError || 'The map tool stopped without making a file.';
    this.emit('error', { id: key, error });
    return { success: false, error };
  }

  run(key, state, exe, args) {
    return new Promise((resolve) => {
      let tail = '';
      let proc;
      try {
        proc = spawn(exe, args, { windowsHide: true });
      } catch (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      state.proc = proc;
      // pmtiles logs to stderr; its progress bar redraws with \r, e.g.
      //  " 45% |#########          | (180/402 MB, 20 MB/s)". "archive size of
      //  383 MB" in the plan line gives the total before the bar starts.
      const onData = (chunk) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4000);
        const total = /archive size of ([\d.]+)\s*([KMGT]?i?B)/i.exec(text);
        if (total) state.total = toBytes(total[1], total[2]);
        const pcts = [...text.matchAll(/(\d{1,3})%/g)];
        if (pcts.length) state.progress = Math.min(100, parseInt(pcts[pcts.length - 1][1], 10));
        const amounts = [...text.matchAll(/\(([\d.]+)\/([\d.]+)\s*([KMGT]?i?B)(?:,\s*([\d.]+)\s*([KMGT]?i?B)\/s)?/gi)];
        const a = amounts[amounts.length - 1];
        if (a) {
          state.downloaded = toBytes(a[1], a[3]);
          state.total = toBytes(a[2], a[3]);
          if (a[4]) state.speed = toBytes(a[4], a[5]);
          if (!pcts.length && state.total) state.progress = Math.min(100, Math.floor((state.downloaded / state.total) * 100));
        }
        const now = Date.now();
        if (now - state.lastEmit > 200) {
          state.lastEmit = now;
          this.emit('progress', { id: key, progress: state.progress, downloaded: state.downloaded, total: state.total, speed: state.speed, status: 'downloading' });
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (err) => resolve({ ok: false, error: err.message }));
      proc.on('close', (code) => {
        state.proc = null;
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: state.cancelled ? 'Cancelled' : (tail.trim().split(/\r?\n/).filter(Boolean).pop() || `pmtiles exited with code ${code}`) });
      });
    });
  }

  cancel(key) {
    const state = this.active.get(key);
    if (!state) return false;
    state.cancelled = true;
    state.proc?.kill();
    return true;
  }

  cancelAll() {
    for (const key of this.active.keys()) this.cancel(key);
  }
}

module.exports = { MapDownloader, readCatalog, findPmtiles };

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
// How long to wait for *any* activity (a redirect, response headers, or the
// next body chunk) before treating the connection as dead. A JS-level timer
// we arm/re-arm ourselves, deliberately not relying on Node's http `timeout`
// option / socket 'timeout' event — a real download that hit exactly this
// stalled-mirror scenario sat at 0 bytes for minutes without that built-in
// mechanism ever firing, so this is the belt-and-suspenders version: plain
// setTimeout/clearTimeout has no dependency on socket-level semantics that
// can behave differently across platforms/network stacks.
const STALL_MS = 20000;

// Catalog lives at data/wikipedia-catalog.json — a single plain JSON file
// (unlike the model catalog's GPU-size tiers, ZIM recommendations don't vary
// by hardware), re-read on every call so hand-edits show up without a
// restart, same reasoning as ModelDownloader's tier files.
function readCatalog(catalogPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return {
      catalog: {
        categories: raw.categories && typeof raw.categories === 'object' ? raw.categories : {},
        zims: raw.zims && typeof raw.zims === 'object' ? raw.zims : {},
      },
      error: null,
    };
  } catch (err) {
    return { catalog: { categories: {}, zims: {} }, error: err.message };
  }
}

// Downloads ZIM files by plain HTTPS GET, unlike ModelDownloader which pulls
// through Ollama's own /api/pull — kiwix's download hosts (download.kiwix.org
// et al) 301/302 through a load-balancer to whichever mirror is closest, so
// redirects have to be followed manually; Node's http/https client doesn't
// do this itself.
class ZimDownloader {
  constructor() {
    this.downloads = new Map(); // id -> state, see download() for its shape
    this.emitter = new EventEmitter();
  }

  on(event, cb) { this.emitter.on(event, cb); }

  getStatus() {
    const out = {};
    for (const [id, s] of this.downloads) {
      out[id] = { status: s.status, progress: s.progress, downloaded: s.downloaded, total: s.total, speed: s.speed, error: s.error };
    }
    return out;
  }

  // destPath is the final filename inside the effective wikipedia folder;
  // written to a .part sibling first and renamed on success so a half-finished
  // download never shows up as a usable ZIM in the "downloaded" list.
  download(id, url, destPath) {
    if (this.downloads.has(id)) return Promise.resolve({ success: false, error: 'Already downloading' });

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const state = {
      url, destPath, tmpPath: destPath + '.part',
      status: 'downloading', progress: 0, downloaded: 0, total: 0, speed: 0,
      req: null, file: null, watchdog: null, settled: false, resolve: null,
      startTime: Date.now(),
    };
    this.downloads.set(id, state);

    return new Promise((resolve) => {
      state.resolve = resolve; // let cancel()/pause() drive this same promise instead of leaving it pending forever
      this._transfer(id, state, url, MAX_REDIRECTS, false);
    });
  }

  // Stops network activity without discarding progress. state.status flips
  // to 'paused' *before* destroy() so the in-flight handlers that destroy()
  // trips asynchronously (req/res/file 'error' events) recognize it as
  // deliberate, the same idea as state.settled for cancel().
  //
  // The resume point is only set once file.end()'s callback confirms
  // everything is actually flushed to disk — file.bytesWritten (bytes this
  // stream instance has durably written, not the file's total size, since a
  // resumed session's stream is freshly opened in append mode) is the source
  // of truth for that, not state.downloaded's running count of bytes merely
  // *received* off the socket. Lining resume() up with a count that could be
  // a few KB ahead of what's actually on disk would silently corrupt the
  // file with a gap.
  pause(id) {
    const state = this.downloads.get(id);
    if (!state || state.status !== 'downloading') return false;
    clearTimeout(state.watchdog);
    state.status = 'paused';
    state.speed = 0;
    state.req?.destroy();
    const file = state.file;
    if (!file) {
      this.emitter.emit('progress', { id, ...state });
      return true;
    }
    file.end(() => {
      state.downloaded = state.sessionStartOffset + file.bytesWritten;
      this.emitter.emit('progress', { id, ...state });
    });
    return true;
  }

  // Re-arms the same download from where pause() left it — a Range request
  // appended to the same .part file — rather than creating a new one:
  // nothing about pausing ever settled the original download()'s promise,
  // it just stopped the transfer, so completing (or cancelling, or failing)
  // from here still resolves that same promise the caller has been holding.
  resume(id) {
    const state = this.downloads.get(id);
    if (!state || state.status !== 'paused') return false;
    state.status = 'downloading';
    state.startTime = Date.now(); // speed reflects the resumed session, not time spent paused
    this._transfer(id, state, state.url, MAX_REDIRECTS, true);
    return true;
  }

  cancel(id) {
    const state = this.downloads.get(id);
    if (!state || state.settled) return false;
    state.settled = true;
    clearTimeout(state.watchdog);
    state.req?.destroy();
    state.file?.destroy();
    this.downloads.delete(id);
    try { fs.unlinkSync(state.tmpPath); } catch { /* nothing to clean up */ }
    state.resolve?.({ success: false, error: 'Cancelled' });
    return true;
  }

  // Shared by download() and resume() — the redirect chain, stall watchdog,
  // throttled progress events, and completion/failure handling. isResume
  // sends a Range header for whatever's already in state.downloaded and
  // appends to the existing .part file instead of truncating it.
  _transfer(id, state, url, redirectsLeft, isResume) {
    // A download can reach a terminal state through more than one path at
    // once — e.g. the watchdog firing calls req.destroy(), which itself
    // then trips the request's own 'error' handler ("socket hang up") a
    // moment later. Without this guard that second path would still run
    // fail()'s full cleanup again: a duplicate public 'error' event (the
    // renderer would show the failure alert twice) and, on a cancel
    // specifically, a misleading "Cancelled" download reported as failed.
    // Every terminal path (fail/cancel/success) checks and sets this before
    // doing anything else, so only the first one to arrive has any effect.
    const fail = (error) => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(state.watchdog);
      try { fs.unlinkSync(state.tmpPath); } catch { /* nothing to clean up, or still locked */ }
      state.status = 'error';
      state.error = error;
      this.emitter.emit('error', { id, error });
      this.downloads.delete(id);
      state.resolve?.({ success: false, error });
    };

    // pause() already destroyed the request/file and flipped status to
    // 'paused' by the time any of these async handlers actually fire —
    // checking that (rather than a separate flag) is enough to tell "this
    // destroy was deliberate" from "this destroy is a real failure".
    const isPaused = () => state.status === 'paused';

    // Re-armed on every redirect hop and every body chunk — see the
    // STALL_MS comment above for why this doesn't lean on Node's built-in
    // socket timeout.
    const armWatchdog = () => {
      clearTimeout(state.watchdog);
      state.watchdog = setTimeout(() => {
        state.req?.destroy();
        fail(`Stalled — no response for ${STALL_MS / 1000}s. Try again; a retry may land on a different mirror.`);
      }, STALL_MS);
    };

    const requestOne = (u, redirects) => {
      armWatchdog();
      const mod = u.startsWith('http:') ? http : https;
      // Some kiwix mirrors (e.g. Wikimedia's own dumps host) 403 a request
      // with no User-Agent at all — Node's http/https client sends none by
      // default, unlike curl or a browser.
      const headers = { 'User-Agent': 'AIPortable/1.0' };
      if (isResume) headers.Range = `bytes=${state.downloaded}-`;
      const req = mod.get(u, { headers }, (res) => {
        if (REDIRECT_CODES.has(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          requestOne(new URL(res.headers.location, u).toString(), redirects - 1);
          return;
        }

        const resuming = isResume && res.statusCode === 206;
        if (isResume && res.statusCode === 200) {
          // The mirror ignored the Range request (some don't honor it, or a
          // retry landed on a different mirror that only knows how to serve
          // from byte 0) — safest is to discard what we had rather than risk
          // corrupting the file with a byte offset that no longer lines up.
          state.downloaded = 0;
        } else if (!resuming && res.statusCode !== 200) {
          res.resume();
          fail(`Server responded ${res.statusCode}`);
          return;
        }

        if (!resuming) state.total = parseInt(res.headers['content-length'] || '0', 10) + state.downloaded;
        // Recorded so a later pause() can compute the true on-disk byte
        // count as sessionStartOffset + file.bytesWritten — this stream
        // instance's own bytesWritten only covers what it personally wrote,
        // not the file's total size when appending to bytes already on disk
        // from an earlier session.
        state.sessionStartOffset = state.downloaded;
        const file = fs.createWriteStream(state.tmpPath, resuming ? { flags: 'a' } : { flags: 'w' });
        state.file = file;

        // 'data' fires once per TCP chunk — tens of thousands of times for
        // a multi-GB file. state.downloaded/progress track every byte, but
        // the public 'progress' event (which drives an IPC send + DOM
        // update in the renderer) is throttled to a few times a second, or
        // an unthrottled flood floods the renderer instead of showing
        // progress.
        let lastEmit = 0;
        res.on('data', (chunk) => {
          armWatchdog();
          state.downloaded += chunk.length;
          state.speed = state.downloaded / Math.max(0.001, (Date.now() - state.startTime) / 1000);
          // One decimal place, not a whole number — these archives run into
          // the GB range, where 1% alone is tens of MB. A whole-number
          // percent can sit at "0%" for a long time on a slow connection
          // even though real progress is happening, which reads as frozen.
          state.progress = state.total > 0 ? Math.min(100, Math.round((state.downloaded / state.total) * 1000) / 10) : 0;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            lastEmit = now;
            this.emitter.emit('progress', { id, ...state });
          }
        });
        res.on('error', (err) => { if (!isPaused()) { file.destroy(); fail(err.message); } });
        res.pipe(file);

        file.on('finish', () => {
          clearTimeout(state.watchdog);
          file.close(() => {
            if (state.settled || isPaused()) return;
            try {
              fs.renameSync(state.tmpPath, state.destPath);
            } catch (err) {
              fail(err.message);
              return;
            }
            state.settled = true;
            state.status = 'completed';
            state.progress = 100;
            this.emitter.emit('complete', { id });
            this.downloads.delete(id);
            state.resolve?.({ success: true });
          });
        });
        file.on('error', (err) => { if (!isPaused()) fail(err.message); });
      });
      req.on('error', (err) => { if (!isPaused()) fail(err.message); });
      state.req = req;
    };

    requestOne(url, redirectsLeft);
  }
}

module.exports = { ZimDownloader, readCatalog };

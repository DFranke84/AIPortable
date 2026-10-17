const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { killPid, pidsListeningOn } = require('./zimSearch');

const HOST = '127.0.0.1';
// Fixed local port, distinct from Ollama's 11434 and the mobile/voice servers
// — kiwix-serve only ever needs to answer this app's own <webview>, never a
// remote client, so there's no reason to make it configurable.
const PORT = 8098;

// Owns the kiwix-serve child process end-to-end (spawn/poll/stop), unlike
// ollama.js which is a pure HTTP client for a process main.js spawns itself —
// kiwix-serve has no chat-style API to wrap, just a health check and a
// viewer URL, so it made more sense to keep the whole lifecycle in one place.
class KiwixManager {
  constructor() {
    this.process = null;
    this.zimPath = null;
    this.log = '';
  }

  findBundled(resourcesDir) {
    const platDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const exe = process.platform === 'win32' ? 'kiwix-serve.exe' : 'kiwix-serve';
    const candidate = path.join(resourcesDir, 'kiwix', platDir, exe);
    return fs.existsSync(candidate) ? candidate : null;
  }

  isReady() {
    return new Promise((resolve) => {
      const req = http.get({ hostname: HOST, port: PORT, path: '/', timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  appendLog(chunk) {
    this.log += chunk.toString();
    if (this.log.length > 100_000) this.log = this.log.slice(this.log.length - 100_000);
  }

  // Spawns kiwix-serve pointed at zimPath and polls until it answers. A
  // cheap no-op if it's already serving this exact file; switching to a
  // different ZIM stops the old process first since kiwix-serve only takes
  // its book list at startup.
  async ensureRunning(zimPath, resourcesDir) {
    if (this.process && this.zimPath === zimPath && (await this.isReady())) return true;
    if (this.process) await this.stop();

    const bin = this.findBundled(resourcesDir);
    if (!bin || !fs.existsSync(zimPath)) return false;

    if (await this.spawnAndWait(bin, zimPath)) return true;

    // Our spawn died without ever becoming ready (see spawnAndWait) — most
    // likely something else already holds the port: an orphaned
    // kiwix-serve.exe from an earlier crash or force-kill, confirmed
    // reproducible by killing the app's process by image name rather than by
    // PID/tree, which orphans a child kiwix-serve.exe instead of terminating
    // it. That orphan keeps answering health checks with whatever it was
    // started with, so every subsequent "switch" looked like it succeeded
    // while silently continuing to serve the old file forever. One recovery
    // attempt: stop whatever holds the viewer's port and try once more
    // before actually giving up.
    await this.killStrayProcesses();
    await new Promise((r) => setTimeout(r, 500));
    return this.spawnAndWait(bin, zimPath);
  }

  spawnAndWait(bin, zimPath) {
    this.zimPath = zimPath;
    try {
      // --address keeps it off the local network — only this app's viewer needs it.
      const proc = spawn(bin, [`--address=${HOST}`, `--port=${PORT}`, zimPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      proc.stdout.on('data', (c) => this.appendLog(c));
      proc.stderr.on('data', (c) => this.appendLog(c));
      proc.on('error', (err) => console.error('Failed to spawn kiwix-serve:', err.message));
      // Only forget the process this exit belongs to — an old one exiting
      // late must not wipe out the reference to its replacement.
      proc.on('exit', () => { if (this.process === proc) this.process = null; });
      this.process = proc;
    } catch (err) {
      console.error('Could not start kiwix-serve:', err.message);
      return Promise.resolve(false);
    }

    return (async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 300));
        // isReady() only checks that *something* answers on the port — if
        // our own process already died (e.g. failed to bind because the
        // port was taken), this.process is already null via the 'exit'
        // handler above, but whatever else is on the port could still
        // answer and fool isReady() into reporting success for a process
        // that isn't ours.
        if (!this.process) return false;
        if (await this.isReady()) return true;
      }
      return false;
    })();
  }

  // Only whatever holds the viewer's port — not every kiwix-serve.exe by
  // name, which would also take down the chat's ZIM search server (8099).
  async killStrayProcesses() {
    for (const pid of await pidsListeningOn(PORT)) killPid(pid);
  }

  // Returns once the process has actually exited (or after a timeout, in
  // case 'exit' never fires for some reason) rather than just firing the
  // kill signal and moving on — switching ZIMs calls stop() immediately
  // before respawning on the same port, and kill() only requests
  // termination; it doesn't wait for Windows to actually tear the process
  // down and release that port. Racing the respawn against that teardown
  // was why switching archives worked "most of the time" but not always:
  // the new kiwix-serve would occasionally fail to bind and exit immediately,
  // with nothing to distinguish that from a slow-starting one until the
  // whole 6s poll in ensureRunning() timed out.
  stop() {
    return new Promise((resolve) => {
      const proc = this.process;
      // Cleared now, not when it exits: by then a replacement may already be
      // in this.process (the cause of an orphaned kiwix-serve after a switch).
      this.process = null;
      this.zimPath = null;
      if (!proc || proc.exitCode !== null) { resolve(); return; }
      let finished = false;
      const done = () => { if (!finished) { finished = true; resolve(); } };
      proc.once('exit', done);
      proc.kill();
      setTimeout(() => { killPid(proc.pid); setTimeout(done, 500); }, 2000); // didn't exit: force it
    });
  }

  // Resolves to the loaded book's own /viewer deep link, not kiwix-serve's
  // root library/catalog page — with our own source dropdown in the renderer
  // now handling "which archive", that multi-book catalog page is redundant,
  // and its own book-listing UI has shown rendering issues in practice.
  // /viewer (unlike /content, which serves the raw ZIM page with none of
  // kiwix's own chrome) keeps kiwix's built-in top bar — Xapian full-text
  // search, language picker — just scoped to one specific book via the #id/
  // hash instead of showing kiwix's own book picker.
  //
  // Retries resolveContentId() for a few seconds rather than trying once:
  // isReady() only confirms kiwix-serve's HTTP listener is up (GET / returns
  // 200), but for a large archive its catalog/index subsystem can still take
  // a moment longer to come online — calling this the instant isReady() goes
  // true was hitting that gap and silently falling back to the root page,
  // permanently (nothing re-resolves the URL afterward), with no visible
  // error.
  async getViewerUrl() {
    for (let i = 0; i < 10; i++) {
      const id = await this.resolveContentId();
      if (id) return `http://${HOST}:${PORT}/viewer#${id}/`;
      await new Promise((r) => setTimeout(r, 300));
    }
    return `http://${HOST}:${PORT}/`;
  }

  // Reads the OPDS catalog feed kiwix-serve exposes for whatever it's
  // currently serving. We only ever run it with exactly one ZIM, so its
  // <link type="text/html" href="/content/<id>"> is unambiguous — no need to
  // parse the fuller feed structure.
  resolveContentId() {
    return new Promise((resolve) => {
      const req = http.get({ hostname: HOST, port: PORT, path: '/catalog/v2/entries?count=1', timeout: 2000 }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          const match = /<link\s+type="text\/html"\s+href="\/content\/([^"]+)"/.exec(buf);
          resolve(match ? match[1] : null);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }
}

module.exports = { KiwixManager, HOST, PORT };

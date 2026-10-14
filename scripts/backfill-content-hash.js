// One-time backfill: computes content_hash for every existing library_docs
// row (the imported corpus, PDFs, and any pre-existing uploads) so
// Library.uploadDoc()'s duplicate check has something to compare new
// uploads against. Safe to re-run — only touches rows with content_hash
// still NULL.
//
// Run the same way as the other scripts in here:
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\backfill-content-hash.js

const crypto = require('crypto');
const path = require('path');
const { initDb } = require('../src/main/db');

function hashBody(body) {
  return crypto.createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

function main() {
  const ROOT = path.resolve(__dirname, '..');
  const db = initDb(path.join(ROOT, 'data', 'chats.db'), path.join(ROOT, 'data', 'library.db'));

  const rows = db
    .prepare(`
      SELECT d.id, f.body
      FROM library_docs d
      JOIN library_docs_fts f ON f.doc_id = d.id
      WHERE d.content_hash IS NULL
    `)
    .all();
  console.log(`[backfill] ${rows.length} docs missing content_hash.`);

  const setHash = db.prepare('UPDATE library_docs SET content_hash = ? WHERE id = ?');
  let hashed = 0, emptySkipped = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (!r.body || !r.body.trim()) { emptySkipped++; continue; }
      setHash.run(hashBody(r.body), r.id);
      hashed++;
    }
  });
  tx(rows);

  console.log(`[backfill] hashed: ${hashed}, skipped (empty body): ${emptySkipped}`);

  const dupes = db.prepare(`
    SELECT content_hash, COUNT(*) c FROM library_docs
    WHERE content_hash IS NOT NULL GROUP BY content_hash HAVING c > 1
  `).all();
  if (dupes.length) {
    console.log(`[backfill] note: ${dupes.length} content_hash value(s) are shared by more than one doc already in the library (pre-existing, not caused by this backfill) — the duplicate-on-upload check will point at whichever one it finds first.`);
  }
  console.log('[backfill] done.');
}

main();

// One-time migration: the initial scripts/import-library.js run put each
// doc's extracted images under data/library/images/<doc_id>/ (e.g.
// "libdb_133/img_0.jpg") — opaque and meaningless if you ever browse that
// folder outside the app. This renames each folder to a human-readable
// slug of the doc's title (e.g. "Prickly Pear/img_0.jpg") and records that
// name in library_docs.asset_dir, which is what the app now uses to build
// libimg:// URLs (see Library.getDoc() in src/main/services/library.js).
//
// Run the same way as the other scripts in here:
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\rename-image-assets.js

const fs = require('fs');
const path = require('path');
const { initDb } = require('../src/main/db');
const { slugify, dedupeName } = require('./lib/slug');

const ROOT = path.resolve(__dirname, '..');
const imagesRoot = path.join(ROOT, 'data', 'library', 'images');

function main() {
  const db = initDb(path.join(ROOT, 'data', 'chats.db'), path.join(ROOT, 'data', 'library.db'));

  const docs = db
    .prepare(`
      SELECT DISTINCT d.id, d.title, d.asset_dir
      FROM library_docs d
      JOIN library_doc_images i ON i.doc_id = d.id
    `)
    .all();
  console.log(`[rename] ${docs.length} docs have images to check.`);

  const used = new Set();
  // Pre-seed with any asset_dir already assigned in an earlier partial run,
  // so re-running this script is idempotent rather than double-suffixing.
  for (const row of db.prepare("SELECT asset_dir FROM library_docs WHERE asset_dir IS NOT NULL").all()) {
    used.add(row.asset_dir.toLowerCase());
  }

  const setAssetDir = db.prepare('UPDATE library_docs SET asset_dir = ? WHERE id = ?');
  let renamed = 0, alreadyDone = 0, missing = 0;

  for (const doc of docs) {
    const oldDir = path.join(imagesRoot, doc.id);
    if (doc.asset_dir) {
      // Already migrated (possibly a prior partial run) — just confirm the
      // folder under the new name actually exists.
      if (fs.existsSync(path.join(imagesRoot, doc.asset_dir))) { alreadyDone++; continue; }
    }
    if (!fs.existsSync(oldDir)) { missing++; console.warn(`[rename] expected folder missing: ${oldDir}`); continue; }

    const slug = dedupeName(slugify(doc.title), used);
    const newDir = path.join(imagesRoot, slug);
    fs.renameSync(oldDir, newDir);
    setAssetDir.run(slug, doc.id);
    renamed++;
    if (renamed % 100 === 0) console.log(`[rename] ${renamed}/${docs.length}...`);
  }

  console.log(`[rename] done. renamed: ${renamed}, already done: ${alreadyDone}, missing folders: ${missing}`);
}

main();

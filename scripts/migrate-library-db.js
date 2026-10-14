// One-time migration: moves every library_* table's data out of the old
// single-file chats.db (where it lived before this split) into a new,
// separate data/library.db, then drops those tables from chats.db and
// reclaims the space with VACUUM. Safe to run only once — it checks for the
// old tables in chats.db's main schema first and does nothing if they're
// already gone (e.g. a fresh install that never had them there).
//
// Run the same way as scripts/import-library.js:
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\migrate-library-db.js
//   mac/Linux: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/migrate-library-db.js

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const dataDir = path.join(ROOT, 'data');
const chatsDbPath = path.join(dataDir, 'chats.db');
const libraryDbPath = path.join(dataDir, 'library.db');

const TABLES = [
  { name: 'library_docs', cols: 'id, title, filename, ext, size, created_at, category, source, source_url, license, word_count, external_id' },
  { name: 'library_docs_fts', cols: 'doc_id, title, body' },
  { name: 'library_chunks', cols: 'id, doc_id, chunk_index, text' },
  { name: 'library_chunks_fts', cols: 'chunk_id, doc_id, text' },
  { name: 'library_chunk_embeddings', cols: 'chunk_id, vector, dims' },
  { name: 'library_doc_embeddings', cols: 'doc_id, vector, dims' },
  { name: 'library_doc_images', cols: 'id, doc_id, filename, ext' },
];

function main() {
  if (!fs.existsSync(chatsDbPath)) {
    console.log('[migrate] no chats.db found — nothing to migrate.');
    return;
  }

  const db = new Database(chatsDbPath);
  const hasOldTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='library_docs'").get();
  if (!hasOldTable) {
    console.log('[migrate] chats.db has no library_docs table in its main schema — already split, or nothing imported yet. Nothing to do.');
    db.close();
    return;
  }

  const sizeBefore = fs.statSync(chatsDbPath).size;
  console.log(`[migrate] chats.db is ${(sizeBefore / 1e6).toFixed(1)} MB before migration.`);

  // Set up the new split schema (creates chats/messages in main if missing,
  // ATTACHes library.db as "lib", creates all library_* tables there).
  // Requiring db.js here (rather than duplicating its schema) keeps this
  // script from drifting out of sync with the real schema definition.
  db.close();
  const { initDb } = require('../src/main/db');
  const liveDb = initDb(chatsDbPath, libraryDbPath);

  const rowCountBefore = liveDb.prepare('SELECT COUNT(*) c FROM main.library_docs').get().c;
  console.log(`[migrate] copying ${rowCountBefore} docs (and related chunks/embeddings/images) into library.db...`);

  const copyAndDrop = liveDb.transaction(() => {
    for (const t of TABLES) {
      liveDb.exec(`INSERT INTO lib.${t.name} (${t.cols}) SELECT ${t.cols} FROM main.${t.name}`);
    }
    // Children before parents, though SQLite's default (foreign_keys OFF)
    // means order isn't actually load-bearing here — just tidy.
    liveDb.exec('DROP TABLE main.library_chunks_fts');
    liveDb.exec('DROP TABLE main.library_docs_fts');
    liveDb.exec('DROP TABLE main.library_chunk_embeddings');
    liveDb.exec('DROP TABLE main.library_doc_embeddings');
    liveDb.exec('DROP TABLE main.library_doc_images');
    liveDb.exec('DROP TABLE main.library_chunks');
    liveDb.exec('DROP TABLE main.library_docs');
  });
  copyAndDrop();

  const rowCountAfter = liveDb.prepare('SELECT COUNT(*) c FROM lib.library_docs').get().c;
  console.log(`[migrate] verified ${rowCountAfter} docs now in library.db.`);
  if (rowCountAfter !== rowCountBefore) {
    console.error(`[migrate] MISMATCH: expected ${rowCountBefore}, got ${rowCountAfter} — not vacuuming, please investigate before proceeding.`);
    process.exit(1);
  }

  console.log('[migrate] reclaiming space in chats.db (VACUUM)...');
  liveDb.exec('VACUUM main'); // must run outside the transaction above — VACUUM can't run inside one
  liveDb.close();

  const sizeAfterChats = fs.statSync(chatsDbPath).size;
  const sizeAfterLib = fs.statSync(libraryDbPath).size;
  console.log(`[migrate] done. chats.db: ${(sizeAfterChats / 1e6).toFixed(1)} MB (was ${(sizeBefore / 1e6).toFixed(1)} MB). library.db: ${(sizeAfterLib / 1e6).toFixed(1)} MB.`);
}

main();

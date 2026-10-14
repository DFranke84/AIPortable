// One-off: removes documents from the imported reference corpus that don't
// serve the library's offline-survival-reference purpose — content that
// slipped in via the original library.db's broad scraping (conspiracy
// pamphlets, occult/esoteric texts, novels, unrelated hacker-conference
// talks, retro computer magazines) or that has no usable extracted text at
// all (0 words, or OCR that only captured report-cover boilerplate).
// Reviewed and approved doc-by-doc with the user before running — see the
// "Group A / Group B" list in the conversation this came from.
//
// Removes the library_docs row plus everything that references it: the FTS
// row, any chunks/chunk-embeddings, doc-level embedding, doc-image rows
// (none exist for this particular set, but handled generically), and the
// copied PDF file under data/library/pdfs/ if one exists (pdf_filename set).
//
// Run the same way as scripts/recategorize-library.js:
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\prune-offtopic-library.js [--dry-run]
//   mac/Linux: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/prune-offtopic-library.js [--dry-run]
//
// Flags:
//   --dry-run   Print what would happen without deleting anything.
//   --ids <path>  JSON array of doc ids. Defaults to
//                 prune-offtopic-library.ids.json next to this script.

const fs = require('fs');
const path = require('path');
const { initDb } = require('../src/main/db');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { dryRun: false, ids: path.join(__dirname, 'prune-offtopic-library.ids.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--ids') args.ids = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = JSON.parse(fs.readFileSync(args.ids, 'utf8'));
  console.log(`[prune] loaded ${ids.length} doc ids from ${args.ids}`);
  console.log(`[prune] mode: ${args.dryRun ? 'DRY RUN (no writes/deletes)' : 'LIVE'}`);

  const dataDir = path.join(ROOT, 'data');
  const db = initDb(path.join(dataDir, 'chats.db'), path.join(dataDir, 'library.db'));
  const pdfsDir = path.join(dataDir, 'library', 'pdfs');
  const imagesDir = path.join(dataDir, 'library', 'images');

  const getDoc = db.prepare('SELECT title, pdf_filename, asset_dir FROM library_docs WHERE id = ?');
  const delDoc = db.prepare('DELETE FROM library_docs WHERE id = ?');
  const delFts = db.prepare('DELETE FROM library_docs_fts WHERE doc_id = ?');
  const delChunkEmb = db.prepare(`DELETE FROM library_chunk_embeddings WHERE chunk_id IN (SELECT id FROM library_chunks WHERE doc_id = ?)`);
  const delChunksFts = db.prepare(`DELETE FROM library_chunks_fts WHERE doc_id = ?`);
  const delChunks = db.prepare('DELETE FROM library_chunks WHERE doc_id = ?');
  const delDocEmb = db.prepare('DELETE FROM library_doc_embeddings WHERE doc_id = ?');
  const delDocImages = db.prepare('DELETE FROM library_doc_images WHERE doc_id = ?');

  let removed = 0, missing = 0, pdfsDeleted = 0, imageDirsDeleted = 0;
  const filesToDelete = []; // collected during the tx, applied after commit

  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = getDoc.get(id);
      if (!row) { missing++; continue; }
      if (row.pdf_filename) filesToDelete.push({ type: 'pdf', p: path.join(pdfsDir, row.pdf_filename) });
      if (row.asset_dir) filesToDelete.push({ type: 'dir', p: path.join(imagesDir, row.asset_dir) });

      if (!args.dryRun) {
        delChunkEmb.run(id);
        delChunksFts.run(id);
        delChunks.run(id);
        delDocEmb.run(id);
        delDocImages.run(id);
        delFts.run(id);
        delDoc.run(id);
      }
      removed++;
      console.log(`  ${args.dryRun ? '[would remove]' : 'removed'}: ${row.title}`);
    }
  });
  tx();

  if (!args.dryRun) {
    for (const f of filesToDelete) {
      try {
        if (f.type === 'pdf') { fs.unlinkSync(f.p); pdfsDeleted++; }
        else { fs.rmSync(f.p, { recursive: true, force: true }); imageDirsDeleted++; }
      } catch (err) {
        console.warn(`  WARN: could not delete ${f.p}: ${err.message}`);
      }
    }
  } else {
    pdfsDeleted = filesToDelete.filter((f) => f.type === 'pdf').length;
    imageDirsDeleted = filesToDelete.filter((f) => f.type === 'dir').length;
  }

  console.log('\n[prune] ==== summary ====');
  console.log(`  docs removed:        ${removed}`);
  console.log(`  missing (not found): ${missing}`);
  console.log(`  PDF files ${args.dryRun ? 'that would be ' : ''}deleted: ${pdfsDeleted}`);
  console.log(`  image dirs ${args.dryRun ? 'that would be ' : ''}deleted: ${imageDirsDeleted}`);
  console.log('[prune] done.');
}

main();

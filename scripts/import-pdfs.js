// One-off: copies original PDF scans from the external library folder into
// this app's own data/library/pdfs/, so the Library Browser can offer
// "open original scan" for docs where OCR'd text lost diagrams/tables/
// photos. Two things happen here:
//
//   1. For the ~680 PDFs whose filename matches a doc_id already imported
//      by scripts/import-library.js, the PDF is copied (renamed to a slug
//      of the doc's *title*, not its original filename — some original
//      filenames are themselves cryptic, e.g. a bare GUID) and that doc's
//      `pdf_filename` column is set to point at it.
//   2. For the ~157 PDFs that don't correspond to anything already
//      imported, the PDF is imported as a brand-new doc: text extracted via
//      the app's own textExtract() (same code path user uploads go
//      through), inserted into library_docs/library_docs_fts, embedded via
//      Ollama (skipped if no text — e.g. a scanned/image-only PDF), and the
//      PDF itself copied alongside under a slug of its derived title.
//
// Filenames throughout are human-readable on purpose (same reasoning as
// scripts/rename-image-assets.js for the image folders) — you should be
// able to tell what a file is from Explorer alone, without the app running.
//
// Run the same way as scripts/import-library.js:
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\import-pdfs.js
//   mac/Linux: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/import-pdfs.js
//
// Flags:
//   --pdfs-dir <path>   Folder of source PDFs (default: E:/AI_Programs/library/pdfs)
//   --source-db <path>  The external library.db, for doc_id matching (default: E:/AI_Programs/library/library.db)
//   --limit N           Only process the first N orphan PDFs (matched-PDF
//                        copying always runs in full — it's just a file
//                        copy + one UPDATE, not worth limiting).
//   --embed-model <name> Ollama embedding model for orphan docs. Default 'nomic-embed-text'.
//   --skip-copy          Do everything except the actual file copy (metadata/
//                        extraction only) — for a quick dry run given the
//                        matched set alone is 14GB.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initDb } = require('../src/main/db');
const { extractText } = require('../src/main/services/textExtract');
const { OllamaManager } = require('../src/main/services/ollama');
const { slugify, dedupeName } = require('./lib/slug');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    pdfsDir: 'E:/AI_Programs/library/pdfs',
    sourceDb: 'E:/AI_Programs/library/library.db',
    limit: null,
    embedModel: 'nomic-embed-text',
    skipCopy: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdfs-dir') args.pdfsDir = argv[++i];
    else if (a === '--source-db') args.sourceDb = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--embed-model') args.embedModel = argv[++i];
    else if (a === '--skip-copy') args.skipCopy = true;
  }
  return args;
}

function titleFromFilename(name) {
  return name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 80);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.pdfsDir)) { console.error(`PDFs dir not found: ${args.pdfsDir}`); process.exit(1); }
  if (!fs.existsSync(args.sourceDb)) { console.error(`Source db not found: ${args.sourceDb}`); process.exit(1); }

  const dataDir = path.join(ROOT, 'data');
  const appDb = initDb(path.join(dataDir, 'chats.db'), path.join(dataDir, 'library.db'));
  const destDir = path.join(dataDir, 'library', 'pdfs');
  fs.mkdirSync(destDir, { recursive: true });

  const srcDb = new Database(args.sourceDb, { readonly: true });
  const docIdToSourceId = new Map();
  for (const r of srcDb.prepare('SELECT id, doc_id FROM docs').all()) {
    if (r.doc_id) docIdToSourceId.set(r.doc_id.toLowerCase(), r.id);
  }

  const pdfFiles = fs.readdirSync(args.pdfsDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const matched = [];
  const orphans = [];
  for (const f of pdfFiles) {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    if (docIdToSourceId.has(base)) matched.push({ file: f, sourceId: docIdToSourceId.get(base) });
    else orphans.push(f);
  }
  console.log(`[pdfs] ${pdfFiles.length} PDFs total: ${matched.length} matched to imported docs, ${orphans.length} orphans`);

  // Dedupe namespace for on-disk PDF filenames (title-derived, so two
  // different docs can easily produce the same slug) — seeded with
  // whatever's already assigned, so re-running this script is idempotent
  // rather than progressively appending more " (2)"/" (3)" suffixes.
  const usedNames = new Set();
  for (const row of appDb.prepare("SELECT pdf_filename FROM library_docs WHERE pdf_filename IS NOT NULL").all()) {
    usedNames.add(path.basename(row.pdf_filename, '.pdf').toLowerCase());
  }

  // ---- part 1: attach matched PDFs to their existing imported doc --------
  const findDoc = appDb.prepare('SELECT id, title, pdf_filename FROM library_docs WHERE id = ?');
  const setPdf = appDb.prepare('UPDATE library_docs SET pdf_filename = ? WHERE id = ?');
  let attached = 0, alreadyAttached = 0, deduped = 0;
  for (const { file, sourceId } of matched) {
    const externalId = `libdb_${sourceId}`;
    const doc = findDoc.get(externalId);
    if (!doc) { deduped++; continue; } // this source row was dropped as a duplicate during scripts/import-library.js

    if (doc.pdf_filename && fs.existsSync(path.join(destDir, doc.pdf_filename))) { alreadyAttached++; continue; }

    const destName = `${dedupeName(slugify(doc.title), usedNames)}.pdf`;
    if (!args.skipCopy) fs.copyFileSync(path.join(args.pdfsDir, file), path.join(destDir, destName));
    setPdf.run(destName, externalId);
    attached++;
    if (attached % 100 === 0) console.log(`[pdfs] attached ${attached}/${matched.length} matched PDFs...`);
  }
  console.log(`[pdfs] matched: ${attached} attached, ${alreadyAttached} already done, ${deduped} skipped (deduped away during earlier import)`);

  // ---- part 2: import orphan PDFs as brand-new docs -----------------------
  const orphanList = args.limit ? orphans.slice(0, args.limit) : orphans;
  const existingExternalIds = new Set(appDb.prepare("SELECT external_id FROM library_docs WHERE external_id LIKE 'pdf_%'").all().map((r) => r.external_id));
  const insertDoc = appDb.prepare(`
    INSERT INTO library_docs (id, title, filename, ext, size, created_at, category, source, source_url, license, word_count, external_id, pdf_filename)
    VALUES (@id, @title, @filename, @ext, @size, @created_at, @category, @source, @source_url, @license, @word_count, @external_id, @pdf_filename)
  `);
  const insertFts = appDb.prepare('INSERT INTO library_docs_fts (doc_id, title, body) VALUES (?,?,?)');
  const insertDocEmbedding = appDb.prepare('INSERT OR REPLACE INTO library_doc_embeddings (doc_id, vector, dims) VALUES (?,?,?)');

  const ollama = new OllamaManager();
  let imported = 0, skippedExisting = 0, noText = 0, embedFailures = 0;
  for (const file of orphanList) {
    // Kept opaque on purpose — this is the DB primary key, not something
    // anyone browses; the human-readable name is pdf_filename, below.
    const externalId = `pdf_${sanitizeId(path.basename(file, path.extname(file)))}`;
    if (existingExternalIds.has(externalId)) { skippedExisting++; continue; }

    const srcPath = path.join(args.pdfsDir, file);
    const buf = fs.readFileSync(srcPath);
    const { text: body, warning } = await extractText(buf, '.pdf');
    if (warning) console.log(`[pdfs] ${file}: ${warning}`);
    if (!body) noText++;

    const title = titleFromFilename(path.basename(file, path.extname(file)));
    const destName = `${dedupeName(slugify(title), usedNames)}.pdf`;
    if (!args.skipCopy) fs.copyFileSync(srcPath, path.join(destDir, destName));

    let embedding = null;
    if (body) {
      try {
        const vec = await ollama.embed(args.embedModel, body);
        if (vec) embedding = { buffer: Buffer.from(new Float32Array(vec).buffer), dims: vec.length };
        else embedFailures++;
      } catch { embedFailures++; }
    }

    const tx = appDb.transaction(() => {
      insertDoc.run({
        id: externalId,
        title,
        filename: '',
        ext: '.pdf',
        size: buf.length,
        created_at: new Date().toISOString(),
        category: null,
        source: 'local-pdf',
        source_url: null,
        license: null,
        word_count: body ? body.split(/\s+/).filter(Boolean).length : 0,
        external_id: externalId,
        pdf_filename: destName,
      });
      insertFts.run(externalId, title, body || '');
      if (embedding) insertDocEmbedding.run(externalId, embedding.buffer, embedding.dims);
    });
    tx();
    imported++;
    if (imported % 25 === 0) console.log(`[pdfs] imported ${imported}/${orphanList.length} orphan PDFs...`);
  }

  console.log('\n[pdfs] ==== summary ====');
  console.log(`  matched PDFs attached:       ${attached}`);
  console.log(`  orphan PDFs imported:        ${imported}`);
  console.log(`  orphan PDFs skipped (re-run):${skippedExisting}`);
  console.log(`  orphan PDFs with no text:    ${noText} (scanned/image-only — still browsable/openable, just not searchable)`);
  if (embedFailures) console.log(`  embed failures:              ${embedFailures} (is Ollama running with --embed-model pulled?)`);
  const pdfsDirSize = fs.readdirSync(destDir).reduce((s, f) => s + fs.statSync(path.join(destDir, f)).size, 0);
  console.log(`  data/library/pdfs/ size now: ${(pdfsDirSize / 1e9).toFixed(2)} GB`);
  console.log('[pdfs] done.');
}

main().catch((err) => {
  console.error('[pdfs] fatal:', err);
  process.exit(1);
});

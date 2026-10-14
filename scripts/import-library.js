// One-off importer: pulls the ~18,003-document reference corpus from an
// external `library.db` (built by a separate tool, not part of this repo)
// into this app's own data/library.db, at the schema AIPortable's Library/RAG
// feature actually understands (data/chats.db holds only chats/messages —
// kept separate so resetting chat history never touches the imported
// corpus). See the implementation plan this came from
// for the full design rationale — short version:
//
//   - Dedupes ~71 (title, word_count) groups down to one row each, verified
//     by content hash after cleaning (see below), not just title+word_count.
//   - Strips embedded base64 images out of the body text (they're ~36% of
//     the corpus's bytes and would otherwise pollute FTS/chunking/
//     embeddings) and writes them out as real files under
//     data/library/images/<external_id>/, referenced from the cleaned body
//     via a short markdown image link so the Library Browser can still show
//     them.
//   - Copies the source db's precomputed whole-doc embeddings verbatim for
//     docs untouched by image-stripping; re-embeds (via Ollama) only the
//     ~946 docs whose body actually had images removed, since their
//     precomputed vector may have been computed over image-poisoned text.
//   - Leaves library_chunks/library_chunk_embeddings empty — chunking is
//     lazy, done on demand by Library.search() only for docs an actual
//     query shortlists (see src/main/services/library.js).
//
// IMPORTANT — how to run this:
//   better-sqlite3 in this project's node_modules is compiled against
//   Electron's bundled Node ABI (via the postinstall `electron-builder
//   install-app-deps` step), not your system Node. Plain `node
//   scripts/import-library.js` will fail to load it. Run it as Electron
//   acting as a plain Node process instead, from the project root:
//
//     Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\import-library.js [flags]
//     mac/Linux: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/import-library.js [flags]
//
// Flags:
//   --source <path>     Path to the external library.db (required unless
//                        it's at the default location below).
//   --limit N            Only process the first N source rows (after
//                        category filtering, if given) — for a dry run.
//   --category <name>    Only process rows whose category matches exactly.
//   --verify-only         Run the whole pipeline (dedupe grouping, image
//                        extraction, hashing) with ZERO writes to library.db
//                        or disk — just prints a summary. Run this over the
//                        full corpus first.
//   --embed-model <name>  Ollama embedding model for the ~946 re-embeds.
//                        Defaults to 'nomic-embed-text' (matches the
//                        dimensionality of the source db's own vectors).
//
// Requires an already-running Ollama instance (default 127.0.0.1:11434,
// same as the app) with --embed-model pulled, for the image-bearing docs'
// re-embedding step. Everything else works without Ollama running.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { initDb } = require('../src/main/db');
const { OllamaManager } = require('../src/main/services/ollama');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = 'E:/AI_Programs/library/library.db';

function parseArgs(argv) {
  const args = { limit: null, category: null, verifyOnly: false, embedModel: 'nomic-embed-text', source: DEFAULT_SOURCE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--embed-model') args.embedModel = argv[++i];
    else if (a === '--source') args.source = argv[++i];
  }
  return args;
}

const IMAGE_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const EXT_BY_MIME = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', 'svg+xml': 'svg' };

// Pulls every base64 image out of `body`, returning the cleaned text (each
// image replaced by a short markdown reference) plus the decoded image
// buffers to write to disk. Pure function — no I/O — so --verify-only can
// exercise the exact same logic without touching the filesystem.
function extractImages(body) {
  const images = [];
  let n = 0;
  const cleaned = body.replace(IMAGE_RE, (match, mime, b64) => {
    const ext = EXT_BY_MIME[mime.toLowerCase()] || 'bin';
    const filename = `img_${n++}.${ext}`;
    images.push({ filename, ext, buffer: Buffer.from(b64, 'base64') });
    return `![](images/__DOC_ID__/${filename})`;
  });
  return { cleaned, images };
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.source)) {
    console.error(`Source db not found: ${args.source} (pass --source <path>)`);
    process.exit(1);
  }

  console.log(`[import] source: ${args.source}`);
  console.log(`[import] mode: ${args.verifyOnly ? 'VERIFY-ONLY (no writes)' : 'LIVE'}`);

  const srcDb = new Database(args.source, { readonly: true });

  // ---- pass 1: cheap grouping to find dedupe candidates -------------------
  let rowQuery = 'SELECT id, title, category, word_count FROM docs';
  const rowParams = [];
  if (args.category) { rowQuery += ' WHERE category = ?'; rowParams.push(args.category); }
  rowQuery += ' ORDER BY id';
  const allRows = srcDb.prepare(rowQuery).all(...rowParams);
  const limited = args.limit ? allRows.slice(0, args.limit) : allRows;

  const groups = new Map(); // "title\u0000word_count" -> [ids]
  for (const r of limited) {
    const key = `${r.title}\u0000${r.word_count}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.id);
  }
  const dupGroups = [...groups.values()].filter((ids) => ids.length > 1);
  console.log(`[import] ${limited.length} rows in scope, ${dupGroups.length} duplicate (title, word_count) groups`);

  // For each dup group, fetch bodies and decide which id(s) survive:
  // prefer whichever copy has embedded images (so extraction has something
  // to work with); if bodies differ after cleaning even then, keep all
  // distinct cleaned-hash variants rather than silently dropping content.
  const skipIds = new Set();
  const getBodyStmt = srcDb.prepare('SELECT body FROM docs WHERE id = ?');
  let collapsedCount = 0;
  for (const ids of dupGroups) {
    const variants = ids.map((id) => {
      const body = getBodyStmt.get(id).body || '';
      const hasImages = IMAGE_RE.test(body);
      IMAGE_RE.lastIndex = 0; // .test() with a /g regex advances lastIndex — reset for reuse
      // Hash with images fully removed (not replaced by a placeholder) —
      // two copies of the same article, one illustrated and one not, are
      // "the same content" for dedup purposes; a placeholder marker would
      // itself count as a text difference and defeat the comparison (this
      // was verified against real data: a manual byte-diff of one such pair
      // showed the *only* difference was the embedded image blocks).
      const hashBody = body.replace(IMAGE_RE, '').trim();
      return { id, hasImages, hash: sha256(hashBody) };
    });
    const distinctHashes = new Set(variants.map((v) => v.hash));
    if (distinctHashes.size === 1) {
      // True duplicates once cleaned — keep the one with images if any has
      // them (nothing to extract from the others either way), else the first.
      const keeper = variants.find((v) => v.hasImages) || variants[0];
      for (const v of variants) if (v.id !== keeper.id) skipIds.add(v.id);
      collapsedCount++;
    } else {
      // Cleaned bodies genuinely differ — not the case we verified ahead of
      // time (71 groups, all collapse once cleaned), so be conservative and
      // keep every distinct variant rather than guessing which to drop.
      console.warn(`[import] group "${ids.join(',')}" has ${distinctHashes.size} distinct cleaned bodies — keeping all, not deduping`);
    }
  }
  console.log(`[import] collapsed ${collapsedCount}/${dupGroups.length} dup groups; ${skipIds.size} rows will be skipped as duplicates`);

  // ---- pass 2: full pipeline over surviving rows ---------------------------
  let appDb = null;
  let ollama = null;
  let existingExternalIds = new Set();
  if (!args.verifyOnly) {
    const dataDir = path.join(ROOT, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    appDb = initDb(path.join(dataDir, 'chats.db'), path.join(dataDir, 'library.db'));
    existingExternalIds = new Set(appDb.prepare('SELECT external_id FROM library_docs WHERE external_id IS NOT NULL').all().map((r) => r.external_id));
    ollama = new OllamaManager();
  }

  const imagesRoot = path.join(ROOT, 'data', 'library', 'images');
  const getFullRowStmt = srcDb.prepare('SELECT * FROM docs WHERE id = ?');

  const insertDoc = appDb && appDb.prepare(`
    INSERT INTO library_docs (id, title, filename, ext, size, created_at, category, source, source_url, license, word_count, external_id)
    VALUES (@id, @title, @filename, @ext, @size, @created_at, @category, @source, @source_url, @license, @word_count, @external_id)
  `);
  const insertFts = appDb && appDb.prepare('INSERT INTO library_docs_fts (doc_id, title, body) VALUES (?,?,?)');
  const insertImage = appDb && appDb.prepare('INSERT INTO library_doc_images (id, doc_id, filename, ext) VALUES (?,?,?,?)');
  const insertDocEmbedding = appDb && appDb.prepare('INSERT OR REPLACE INTO library_doc_embeddings (doc_id, vector, dims) VALUES (?,?,?)');

  let imported = 0, skippedDup = 0, skippedExisting = 0, imageDocs = 0, totalImages = 0, totalImageBytes = 0, reEmbedded = 0, embedFailures = 0;
  let batch = [];

  const flushBatch = () => {
    if (!appDb || batch.length === 0) return;
    const tx = appDb.transaction((items) => {
      for (const item of items) {
        insertDoc.run(item.docParams);
        insertFts.run(item.id, item.docParams.title, item.cleanedBody);
        for (const img of item.images) insertImage.run(`${item.id}_${img.filename}`, item.id, img.filename, img.ext);
        if (item.embedding) insertDocEmbedding.run(item.id, item.embedding.buffer, item.embedding.dims);
      }
    });
    tx(batch);
    batch = [];
  };

  for (const { id: srcId } of limited) {
    if (skipIds.has(srcId)) { skippedDup++; continue; }
    const externalId = `libdb_${srcId}`; // no ':' — used as a Windows dir name and as a libimg:// URL host segment
    if (existingExternalIds.has(externalId)) { skippedExisting++; continue; }

    const row = getFullRowStmt.get(srcId);
    const { cleaned, images } = extractImages(row.body || '');
    const cleanedBody = cleaned.replace(/__DOC_ID__/g, externalId);

    if (images.length) {
      imageDocs++;
      totalImages += images.length;
      totalImageBytes += images.reduce((s, im) => s + im.buffer.length, 0);
    }

    if (args.verifyOnly) {
      imported++;
      continue;
    }

    const docId = externalId; // stable, unique (verified against source docs.id), human-legible
    if (images.length) {
      const dir = path.join(imagesRoot, docId);
      fs.mkdirSync(dir, { recursive: true });
      for (const img of images) fs.writeFileSync(path.join(dir, img.filename), img.buffer);
    }

    let embedding = null;
    if (images.length) {
      // Precomputed vector may have been computed over image-poisoned text
      // (and/or truncated by the embedding model's context window before
      // reaching real article text) — redo it from the cleaned body.
      try {
        const vec = await ollama.embed(args.embedModel, cleanedBody);
        if (vec) { embedding = { buffer: Buffer.from(new Float32Array(vec).buffer), dims: vec.length }; reEmbedded++; }
        else embedFailures++;
      } catch { embedFailures++; }
    } else if (row.embedding) {
      embedding = { buffer: row.embedding, dims: row.embedding.length / 4 };
    }

    batch.push({
      id: docId,
      cleanedBody,
      images,
      embedding,
      docParams: {
        id: docId,
        title: row.title,
        filename: '', // no uploaded file on disk for imported docs
        ext: '.md',
        size: Buffer.byteLength(cleanedBody, 'utf8'),
        created_at: new Date().toISOString(),
        category: row.category,
        source: row.source,
        source_url: row.source_url,
        license: row.license,
        word_count: row.word_count,
        external_id: docId,
      },
    });
    imported++;

    if (batch.length >= 500) {
      flushBatch();
      console.log(`[import] progress: ${imported} imported, ${skippedDup} dup-skipped, ${skippedExisting} already-present, ${imageDocs} with images`);
    }
  }
  flushBatch();

  console.log('\n[import] ==== summary ====');
  console.log(`  rows in scope:        ${limited.length}`);
  console.log(`  imported:             ${imported}`);
  console.log(`  skipped (duplicate):  ${skippedDup}`);
  console.log(`  skipped (re-run, already present): ${skippedExisting}`);
  console.log(`  docs with images:     ${imageDocs}`);
  console.log(`  images extracted:     ${totalImages} (${(totalImageBytes / 1e6).toFixed(1)} MB)`);
  if (!args.verifyOnly) {
    console.log(`  re-embedded (image docs): ${reEmbedded}`);
    if (embedFailures) console.log(`  embed failures:       ${embedFailures} (is Ollama running with --embed-model pulled?)`);
    const sizeAfter = fs.statSync(path.join(ROOT, 'data', 'library.db')).size;
    console.log(`  library.db size now:  ${(sizeAfter / 1e6).toFixed(1)} MB`);
  }
  console.log('[import] done.');
}

main().catch((err) => {
  console.error('[import] fatal:', err);
  process.exit(1);
});

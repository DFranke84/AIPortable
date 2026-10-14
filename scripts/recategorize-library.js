// One-off: fixes systemic category mistakes in the imported reference
// corpus (see scripts/import-library.js). The source library.db assigned
// `category` in bulk per import batch, not per document, so whole clusters
// ended up in the wrong bucket — e.g. every `inaturalist` species page got
// scattered across disaster/medical/home-vehicle instead of off-grid, and
// 213 `nchfp` food-preservation instructions sat in home-vehicle. Proven via
// duplicate-title collisions: the same plant/animal imported twice (once
// from inaturalist, once from team-species) landing in two different
// categories is direct evidence one of them is wrong, not a judgment call.
//
// Also introduces one new category, "security" (physical/digital security,
// OPSEC — content that was previously jammed into defense/legal-finance/
// off-grid for lack of a better bucket), and leaves a documented list of
// docs deliberately NOT touched (off-topic-looking content status quo'd
// pending a human decision — see the --list-review-needed flag).
//
// Run the same way as scripts/import-library.js (needs Electron's Node ABI
// for better-sqlite3):
//   Windows:  set ELECTRON_RUN_AS_NODE=1 && node_modules\.bin\electron.cmd scripts\recategorize-library.js [--dry-run]
//   mac/Linux: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/recategorize-library.js [--dry-run]
//
// Flags:
//   --dry-run   Compute and print the summary without writing anything.
//   --fixes <path>  JSON file of { doc_id: new_category }. Defaults to
//                   fixes.json next to this script (generated once during
//                   the analysis that produced this script; kept here so
//                   the exact mapping is reviewable and re-runnable).

const fs = require('fs');
const path = require('path');
const { initDb } = require('../src/main/db');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { dryRun: false, fixes: path.join(__dirname, 'recategorize-library.fixes.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--fixes') args.fixes = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixes = JSON.parse(fs.readFileSync(args.fixes, 'utf8'));
  const ids = Object.keys(fixes);
  console.log(`[recategorize] loaded ${ids.length} fixes from ${args.fixes}`);
  console.log(`[recategorize] mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const dataDir = path.join(ROOT, 'data');
  const db = initDb(path.join(dataDir, 'chats.db'), path.join(dataDir, 'library.db'));

  const getStmt = db.prepare('SELECT category FROM library_docs WHERE id = ?');
  const updateStmt = db.prepare('UPDATE library_docs SET category = ? WHERE id = ?');

  const byTransition = new Map(); // "old -> new" -> count
  let applied = 0, missing = 0, noop = 0;

  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = getStmt.get(id);
      if (!row) { missing++; continue; }
      const oldCat = row.category;
      const newCat = fixes[id];
      if (oldCat === newCat) { noop++; continue; }
      const key = `${oldCat} -> ${newCat}`;
      byTransition.set(key, (byTransition.get(key) || 0) + 1);
      if (!args.dryRun) updateStmt.run(newCat, id);
      applied++;
    }
  });
  tx();

  console.log('\n[recategorize] ==== summary ====');
  for (const [key, n] of [...byTransition.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(28)} : ${n}`);
  }
  console.log(`\n  applied:  ${applied}`);
  console.log(`  no-op (already correct): ${noop}`);
  if (missing) console.log(`  missing (id not found — source db may have changed): ${missing}`);
  console.log('[recategorize] done.');
}

main();

// Turns a doc title into a filesystem-safe, human-readable name — used for
// image folders (data/library/images/<slug>/) where there's no original
// filename to fall back on. PDFs don't need this: they already have a
// descriptive original filename, which is kept as-is (see import-pdfs.js).
function slugify(title, maxLen = 80) {
  let s = (title || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ') // forbidden on Windows filenames
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // trailing dot/space is also invalid on Windows
  if (!s) s = 'untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

// Appends " (2)", " (3)", etc. until `candidate` isn't in `used` (case-
// insensitive, since Windows filenames are case-insensitive) — then
// reserves it in `used` before returning.
function dedupeName(candidate, used) {
  let name = candidate;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${candidate} (${n})`;
    n++;
  }
  used.add(name.toLowerCase());
  return name;
}

module.exports = { slugify, dedupeName };

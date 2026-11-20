// Sorting by author: by the first author's last name, the way a library
// shelves books. "Ursula K. Le Guin" files under L ("Le Guin"),
// "Martin Luther King Jr." under K, and "Austen, Jane" under A.
// A group's name ("Center for Creative Leadership") files under its last word.

const SUFFIX = /^(jr|sr|ii|iii|iv|phd|ph\.d|md|esq)\.?$/i;
// Small words that belong to the last name when they come right before it.
const PARTICLES = new Set(["de", "da", "di", "du", "del", "della", "der", "den", "van", "von", "le", "la"]);

export function authorKey(name) {
  const n = String(name || "")
    .replace(/\([^)]*\)/g, " ") // roles like (Editor) or (Translator)
    .replace(/\s+with\s+.*$/i, "") // "Kwame Alexander with Mary Rand Hess" files under Alexander
    .trim().replace(/\s+/g, " ");
  if (!n) return "";
  const comma = n.indexOf(",");
  if (comma > 0) {
    const after = n.slice(comma + 1).trim();
    // "Last, First" (but not "First Last, Jr.")
    if (after && !SUFFIX.test(after)) return `${n.slice(0, comma)} ${after}`.toLowerCase();
  }
  const parts = n.replace(/,/g, "").split(" ");
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  let start = parts.length - 1;
  while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  const last = parts.slice(start).join(" ");
  const first = parts.slice(0, start).join(" ");
  return `${last} ${first}`.trim().toLowerCase();
}

// Sorts in place. Books with no author go last; ties keep the order they came in.
export function sortByAuthor(items) {
  const keyed = items.map((it, i) => ({ it, i, k: authorKey(it.authors?.[0]) }));
  keyed.sort((a, b) => {
    if (!a.k !== !b.k) return a.k ? -1 : 1;
    return a.k.localeCompare(b.k) || a.i - b.i;
  });
  keyed.forEach((x, i) => { items[i] = x.it; });
  return items;
}

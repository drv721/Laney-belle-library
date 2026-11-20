// Tags in the app: typed as one line with commas between, and offered as
// tap-to-add suggestions from the tags she already uses, so "Fantasy" isn't
// typed three different ways.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const SUGGEST_MAX = 12;

export const cleanTag = (name) => String(name ?? "").replace(/\s+/g, " ").trim();

// "Fantasy, signed ,  fantasy" -> ["Fantasy", "signed"]. Same rules as the server.
export function parseTags(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? "").split(",")) {
    const t = cleanTag(raw);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

export const sameTags = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The tags she uses most that this book doesn't have yet.
export function suggestions(allTags, current) {
  const have = new Set(current.map((t) => t.toLowerCase()));
  return [...allTags]
    .filter((t) => !have.has(t.name.toLowerCase()))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SUGGEST_MAX)
    .map((t) => t.name);
}

export function suggestionsHtml(names) {
  return names.map((n) => `<button type="button" class="tag-chip" data-tag="${esc(n)}">+ ${esc(n)}</button>`).join("");
}

// Wires a tags box and its suggestion row: a tap adds that tag to the box.
export function wireTagBox(input, row, getAllTags) {
  const refresh = () => { row.innerHTML = suggestionsHtml(suggestions(getAllTags(), parseTags(input.value))); };
  row.addEventListener("click", (e) => {
    const name = e.target.closest("[data-tag]")?.dataset.tag;
    if (!name) return;
    input.value = [...parseTags(input.value), name].join(", ");
    refresh();
  });
  input.addEventListener("change", refresh);
  return refresh;
}

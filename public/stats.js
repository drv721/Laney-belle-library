// The Stats screen (Settings, then Library stats): counts across her library.
// A row she taps shows those books in the library, with that menu set, so a
// count like "Not set yet: 349" is one tap from sorting them.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (x) => Number(x || 0).toLocaleString("en-US");
const plural = (count, one, many) => `${n(count)} ${count === 1 ? one : many}`;

// Books added (or finished) this month and this year, on her own clock.
export function periodCounts(byMonth, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const year = String(now.getFullYear());
  let thisMonth = 0;
  let thisYear = 0;
  for (const r of byMonth) {
    if (r.month === month) thisMonth += r.count;
    if (r.month.startsWith(`${year}-`)) thisYear += r.count;
  }
  return { thisMonth, thisYear };
}

// The big numbers at the top.
export function headline(s) {
  const out = [
    ["Books", n(s.books)],
    ["Authors", n(s.authors)],
  ];
  if (s.copies !== s.books) out.push(["Copies", n(s.copies)]);
  if (s.with_pages) out.push(["Pages", n(s.pages)]);
  return out;
}

// One group of rows. filter names the library menu a tap sets (or "q" for a search).
// Rows with no books are kept for her own locations and subcategories, so an
// empty bookcase shows as 0; elsewhere they're left out.
export function groupRows(items, { keepEmpty = false, noneLabel = "Not set yet", nameOf = (i) => i.name } = {}) {
  return items
    .filter((i) => keepEmpty || i.count > 0)
    .filter((i) => !(i.id === "none" && !i.count))
    .map((i) => ({ id: i.id, label: i.id === "none" ? noneLabel : nameOf(i), count: i.count }));
}

// Share of the library, never "0%" for a book that's there.
export function share(count, total) {
  const pct = Math.round((count / total) * 100);
  return pct === 0 && count > 0 ? "under 1%" : `${pct}%`;
}

function groupHtml(title, rows, filter, total, note = "") {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<section class="stats-group">
    <h3>${esc(title)}</h3>${note ? `<p class="muted">${esc(note)}</p>` : ""}
    <ul class="stats-rows">${rows.map((r) => `<li>
      <button type="button" class="stats-row" data-filter="${esc(filter)}" data-value="${esc(r.id)}"${r.count ? "" : " disabled"}>
        <span class="stats-label">${esc(r.label)}</span>
        <span class="stats-count">${n(r.count)}${total && r.count ? `<span class="muted"> ${share(r.count, total)}</span>` : ""}</span>
        <span class="stats-bar" style="width:${Math.round((r.count / max) * 100)}%"></span>
      </button></li>`).join("")}</ul>
  </section>`;
}

export function statsHtml(s, now = new Date()) {
  const added = periodCounts(s.added_by_month, now);
  const finished = periodCounts(s.finished_by_month, now);
  const several = s.collections.length > 1;
  const colName = (id) => s.collections.find((c) => c.id === id)?.name ?? "";
  const tiles = headline(s).map(([k, v]) => `<div class="stats-tile"><span class="stats-big">${esc(v)}</span><span class="muted">${esc(k)}</span></div>`).join("");
  const lines = [
    `Added this month: ${plural(added.thisMonth, "book", "books")}. This year: ${plural(added.thisYear, "book", "books")}.`,
    `Finished this year: ${plural(finished.thisYear, "book", "books")}.`,
  ];
  if (s.with_pages && s.with_pages < s.books) lines.push(`Pages count the ${n(s.with_pages)} books that list them.`);
  return `<div class="stats-tiles">${tiles}</div>
    ${lines.map((l) => `<p class="muted stats-line">${esc(l)}</p>`).join("")}
    ${groupHtml("Status", groupRows(s.statuses), "status", s.books)}
    ${groupHtml("List", groupRows(s.lists), "list", s.books)}
    ${several ? groupHtml("Collection", groupRows(s.collections), "collection", s.books) : ""}
    ${groupHtml("Location", groupRows(s.locations, { keepEmpty: true }), "location", s.books)}
    ${groupHtml("Subcategory", groupRows(s.subcategories, { keepEmpty: true, nameOf: (i) => (several ? `${i.name} (${colName(i.collection_id)})` : i.name) }), "subcategory", s.books)}
    ${groupHtml("Most used tags", groupRows(s.tags), "tag", 0)}
    ${groupHtml("Most books by", groupRows(s.top_authors.map((a) => ({ ...a, id: a.name }))), "q", 0, "A tap searches for the name. An author spelled two ways on the books shows twice.")}`;
}

export function wireStats({ api, onFilter }) {
  $("#stats-close").addEventListener("click", () => close());
  $("#stats-body").addEventListener("click", (e) => {
    const row = e.target.closest("[data-filter]");
    if (!row || row.disabled) return;
    close();
    onFilter(row.dataset.filter, row.dataset.value);
  });
  function close() {
    $("#stats-view").hidden = true;
    $("#library-view").hidden = false;
  }
  return {
    async open() {
      $("#library-view").hidden = true;
      $("#stats-view").hidden = false;
      $("#stats-body").innerHTML = `<p class="muted">Counting...</p>`;
      try {
        $("#stats-body").innerHTML = statsHtml(await api("/api/stats"));
      } catch (err) {
        $("#stats-body").innerHTML = `<p class="flag">${esc(err.message)}</p>`;
      }
      window.scrollTo?.(0, 0);
    },
  };
}

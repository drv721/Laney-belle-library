// Bookcases: each place drawn as a case, with its books standing in their
// spots, row by row. Cases with glass doors open when the case is shown.
// Tapping a spine opens that book's page.
//
// It reads the same rows the shelf scan saves (location, row and spot), so
// nothing here changes a book. Books in a place with no row yet are listed
// under the case.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- pure helpers (tested in test/cases.test.mjs) ----------

// Spine colors, picked by the book so a book keeps its color.
export const SPINES = ["#7a2e2e", "#2f4a6b", "#3d5c3a", "#6b4f2a", "#4a3b5c", "#8a6d3b", "#2e5a5a", "#5c2e45", "#3b3f46", "#9a8f7a"];

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s ?? "")) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

// A spine's look: its color, how tall it stands (a share of the row) and how
// wide it is. Width follows the page count when the book has one.
export function spineLook(book) {
  const h = hash(book.book_id || book.id);
  const pages = Number(book.pages);
  const width = Number.isFinite(pages) && pages > 0 ? Math.round(Math.min(44, Math.max(16, 14 + pages / 18))) : 24 + (h % 9);
  return { color: SPINES[h % SPINES.length], height: 78 + ((h >>> 8) % 20), width };
}

// One place's books by row, left to right. A book with no row, or a row the
// place doesn't have, goes in `loose`.
export function layoutPlace(place, books, rowCount) {
  const rows = Array.from({ length: rowCount }, () => []);
  const loose = [];
  for (const b of books) {
    if (b.location_id !== place.id) continue;
    const r = Number(b.shelf_row);
    if (Number.isInteger(r) && r >= 1 && r <= rowCount) rows[r - 1].push(b);
    else loose.push(b);
  }
  const bySpot = (a, b) => (a.shelf_pos ?? 1e9) - (b.shelf_pos ?? 1e9) || String(a.title).localeCompare(String(b.title));
  for (const r of rows) r.sort(bySpot);
  loose.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return { rows, loose };
}

// Places grouped by room, in her order. Places with no room come last.
export function byRoom(places) {
  const groups = new Map();
  for (const p of places) {
    const room = p.room || "";
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room).push(p);
  }
  return [...groups].sort(([a], [b]) => (a === "") - (b === "")).map(([room, list]) => ({ room, places: list }));
}

const PLURAL = { Row: "rows", Cubby: "cubbies", Shelf: "shelves" };

export function countLine(place, layout, word) {
  const onRows = layout.rows.reduce((n, r) => n + r.length, 0);
  const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;
  const plural = (n) => (n === 1 ? word.toLowerCase() : PLURAL[word] || `${word.toLowerCase()}s`);
  const head = `${books(onRows)} on ${layout.rows.length} ${plural(layout.rows.length)}`;
  return layout.loose.length ? `${head}, and ${books(layout.loose.length)} here with no ${word.toLowerCase()} yet.` : `${head}.`;
}

// ---------- the screen ----------

let api, getSettings, openBook;
const view = { place: "", library: [], highlight: "", doorsOpen: false, back: null };

// In the picker's order: by room, then her order within a room.
const places = () => byRoom(getSettings().locations).flatMap((g) => g.places);
const current = () => places().find((p) => p.id === view.place);
const rowWord = (p) => p?.shelf_word || "Row";
const rowCount = (p) => p?.shelf_count || 6;
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function fillPicker() {
  const list = places();
  if (!list.some((p) => p.id === view.place)) view.place = list[0]?.id || "";
  $("#cases-place").innerHTML = byRoom(getSettings().locations).map(({ room, places: ps }) => {
    const opts = ps.map((p) => `<option value="${esc(p.id)}" ${p.id === view.place ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    return room ? `<optgroup label="${esc(room)}">${opts}</optgroup>` : opts;
  }).join("");
  const i = list.findIndex((p) => p.id === view.place);
  $("#cases-prev").disabled = i <= 0;
  $("#cases-next").disabled = i < 0 || i >= list.length - 1;
}

function spineHtml(b, word) {
  const look = spineLook(b);
  const where = `${word} ${b.shelf_row}, spot ${b.shelf_pos ?? "?"}`;
  const label = `${b.title}${b.authors?.length ? ` by ${b.authors.join(", ")}` : ""}, ${where}`;
  return `<button type="button" class="spine${b.id === view.highlight ? " found" : ""}" data-book="${esc(b.id)}"
    style="--spine:${look.color};--tall:${look.height}%;--wide:${look.width}px" aria-label="${esc(label)}"><span>${esc(b.title)}</span></button>`;
}

function render() {
  const p = current();
  const stage = $("#cases-stage");
  if (!p) {
    $("#cases-count").textContent = "Add a location in Settings first.";
    stage.innerHTML = "";
    $("#cases-loose").innerHTML = "";
    return;
  }
  const word = rowWord(p);
  const layout = layoutPlace(p, view.library, rowCount(p));
  const glass = p.doors === "glass";
  $("#cases-count").textContent = `${p.room ? `${p.room}. ` : ""}${countLine(p, layout, word)}`;
  stage.innerHTML = `
    <div class="case${glass ? " has-doors" : ""}${glass && view.doorsOpen ? " open" : ""}">
      <div class="case-rows">
        ${layout.rows.map((row, i) => `
          <div class="case-row" role="group" aria-label="${esc(word)} ${i + 1}${i === 0 ? " (top)" : ""}, ${row.length} ${row.length === 1 ? "book" : "books"}">
            <span class="row-tag" aria-hidden="true">${i + 1}</span>
            ${row.length ? row.map((b) => spineHtml(b, word)).join("") : `<span class="row-empty muted">Nothing here yet</span>`}
          </div>`).join("")}
      </div>
      ${glass ? `<button type="button" class="door left" data-doors aria-label="Open the doors"></button><button type="button" class="door right" data-doors aria-label="Open the doors" tabindex="-1"></button>` : ""}
    </div>`;
  $("#cases-doors").hidden = !glass;
  $("#cases-doors").textContent = view.doorsOpen ? "Close doors" : "Open doors";
  $("#cases-loose").innerHTML = layout.loose.length
    ? `<h3>Here, with no ${esc(word.toLowerCase())} yet</h3><ul class="books list">${layout.loose.map((b) =>
        `<li><button type="button" class="link-book" data-book="${esc(b.id)}"><span class="title">${esc(b.title)}</span>
          <span class="author">${esc(b.authors.join(", "))}</span></button></li>`).join("")}</ul>`
    : "";
}

function setDoors(open) {
  view.doorsOpen = open;
  const el = $("#cases-stage .case");
  el?.classList.toggle("open", open);
  $("#cases-doors").textContent = open ? "Close doors" : "Open doors";
}

// Shows the place, then swings its doors open so she sees them move.
function show({ animate = true } = {}) {
  view.doorsOpen = !animate || reduceMotion();
  fillPicker();
  render();
  if (!view.doorsOpen) requestAnimationFrame(() => requestAnimationFrame(() => setDoors(true)));
  const found = view.highlight && [...document.querySelectorAll("#cases-stage .spine")].find((el) => el.dataset.book === view.highlight);
  if (found?.scrollIntoView) found.scrollIntoView({ block: "center", inline: "center", behavior: reduceMotion() ? "auto" : "smooth" });
}

async function loadLibrary() {
  view.library = await api("/api/books?sort=location");
}

// Opens the bookcases. With a book, opens that book's place and points to it.
export async function openCases(book) {
  if ($("#cases-view").hidden) {
    // What to show again on Back (the library or the hub).
    view.back = { top: $("#main-top").hidden, library: $("#library-view").hidden, hub: $("#hub-view").hidden };
  }
  $("#main-top").hidden = true;
  $("#library-view").hidden = true;
  $("#hub-view").hidden = true;
  $("#cases-view").hidden = false;
  view.highlight = book?.id || "";
  if (book?.location_id) view.place = book.location_id;
  $("#cases-count").textContent = "Loading the library...";
  try {
    await loadLibrary();
  } catch (err) {
    $("#cases-count").textContent = err.message;
    return;
  }
  show();
}

export function wireCases(deps) {
  ({ api, getSettings, openBook } = deps);
  const go = (id) => {
    view.place = id;
    view.highlight = "";
    show();
  };
  $("#cases-place").addEventListener("change", (e) => go(e.target.value));
  const step = (by) => {
    const list = places();
    const i = list.findIndex((p) => p.id === view.place);
    if (list[i + by]) go(list[i + by].id);
  };
  $("#cases-prev").addEventListener("click", () => step(-1));
  $("#cases-next").addEventListener("click", () => step(1));
  $("#cases-doors").addEventListener("click", () => setDoors(!view.doorsOpen));

  const onTap = (e) => {
    if (e.target.closest("[data-doors]")) { setDoors(true); return; }
    const id = e.target.closest("[data-book]")?.dataset.book;
    const b = id && view.library.find((x) => x.id === id);
    if (b) openBook(b, getSettings());
  };
  $("#cases-stage").addEventListener("click", onTap);
  $("#cases-loose").addEventListener("click", onTap);

  // A change on the book page (a new spot, a new title) shows up here.
  $("#book-dialog").addEventListener("close", async () => {
    if ($("#cases-view").hidden) return;
    try {
      await loadLibrary();
      fillPicker();
      render();
    } catch { /* keep what's drawn */ }
  });

  $("#cases-close").addEventListener("click", () => {
    $("#cases-view").hidden = true;
    const back = view.back || { top: false, library: false, hub: true };
    $("#main-top").hidden = back.top;
    $("#library-view").hidden = back.library;
    $("#hub-view").hidden = back.hub;
  });
}

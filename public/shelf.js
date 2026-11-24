// Shelf scan: she picks a place and a row, then scans that row's books left
// to right. The order she scans in becomes each book's spot on the row.
//
// Books with no barcode are found by title and added with one tap. A list of
// lines (an ISBN or a title on each, left to right) can be pasted in too, for
// rows read from a photo. Nothing is saved until she taps Save row, and the
// save can be undone. The row in progress is kept on this device, so leaving
// the screen or a reload doesn't lose it.

import { attachScanBox } from "./scanbox.js";
import { attachCamera } from "./camera.js";
import { readScan } from "./isbn.js";
import { spotLine } from "./hub.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE_KEY = "shelfScan";
const SPOTS_MAX = 200; // same as src/shelf.js
const FIND_MAX = 8;

// ---------- pure helpers (tested in test/shelf.test.mjs) ----------

export const rowWord = (place) => place?.shelf_word || "Row";
export const rowCount = (place) => place?.shelf_count || 6;


// Titles compared without case, accents, punctuation or a leading The/A/An.
export function normTitle(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an) /, "");
}
const normAuthor = (s) => normTitle(s).split(" ").pop() || ""; // last name

// One pasted line: an ISBN, or a title with an optional author after
// " by ", " - ", " / " or a tab. Returns { kind: "one" | "many" | "none", books }.
export function matchLine(line, books) {
  const text = String(line ?? "").trim().replace(/^\d+[.)]\s+/, ""); // "3. Dune" or "3) Dune"
  if (!text) return { kind: "skip", books: [] };
  const read = readScan(text);
  if (read.kind === "isbn") {
    const hit = books.filter((b) => b.isbn13 === read.isbn13 || (read.isbn10 && b.isbn10 === read.isbn10));
    return { kind: hit.length ? "one" : "none", books: hit, text };
  }
  const [title, author] = text.split(/\s+by\s+|\s+[-–—/]\s+|\t/i);
  const t = normTitle(title);
  if (!t) return { kind: "none", books: [], text };
  let hit = books.filter((b) => normTitle(b.title) === t);
  if (!hit.length) hit = books.filter((b) => normTitle(b.title).startsWith(t) || normTitle(`${b.title} ${b.subtitle || ""}`) === t);
  if (hit.length > 1 && author) {
    // The full name first, then the last name alone ("Baum" for L. Frank Baum).
    const full = normTitle(author);
    let byAuthor = hit.filter((b) => b.authors.some((x) => normTitle(x) === full));
    if (!byAuthor.length) byAuthor = hit.filter((b) => b.authors.some((x) => normAuthor(x) === normAuthor(author)));
    if (byAuthor.length) hit = byAuthor;
  }
  // Two copies of the same book are one match: the row takes whichever copy is free.
  const sameBook = hit.length > 1 && hit.every((b) => b.book_id === hit[0].book_id);
  return { kind: hit.length === 1 || sameBook ? "one" : hit.length ? "many" : "none", books: hit, text };
}

// The copy to put on the row: the first one that isn't on it already.
export function freeCopy(copies, onRow) {
  return copies.find((b) => !onRow.includes(b.id)) ?? null;
}

// What Save row sends: every book on the row gets its spot in order, and a
// book that was on this row before but isn't now stays in the place with no row.
export function rowSpots(placeId, row, ids, wasOnRow) {
  const spots = ids.map((id, i) => ({ id, location_id: placeId, shelf_row: row, shelf_pos: i + 1 }));
  for (const id of wasOnRow) {
    if (!ids.includes(id)) spots.push({ id, location_id: placeId, shelf_row: null, shelf_pos: null });
  }
  return spots;
}

export function chunks(list, size = SPOTS_MAX) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------- the screen ----------

let api, onChange, toast, getSettings;
const draft = { place: "", row: 1, ids: [], saved: [] }; // saved: what was on the row when it was opened
let library = []; // every book, for scans and title matches
let loadedFor = "";

const places = () => getSettings().locations;
const place = () => places().find((p) => p.id === draft.place);
const byId = (id) => library.find((b) => b.id === id);
const msg = (t) => ($("#shelf-msg").textContent = t || "");

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(draft)); } catch { /* storage blocked: kept in memory */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (d && Array.isArray(d.ids)) Object.assign(draft, d);
  } catch { /* nothing saved */ }
}
const changed = () => JSON.stringify(draft.ids) !== JSON.stringify(draft.saved);

function fillPickers() {
  const list = places();
  if (!list.some((p) => p.id === draft.place)) draft.place = list[0]?.id || "";
  $("#shelf-place").innerHTML = list.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === draft.place ? "selected" : ""}>${esc(p.room ? `${p.name} (${p.room})` : p.name)}</option>`).join("");
  const n = rowCount(place());
  if (draft.row > n) draft.row = 1;
  $("#shelf-row").innerHTML = Array.from({ length: n }, (_, i) =>
    `<option value="${i + 1}" ${i + 1 === draft.row ? "selected" : ""}>${esc(rowWord(place()))} ${i + 1}${i === 0 ? " (top)" : ""}</option>`).join("");
  $("#shelf-row-label").firstChild.textContent = `${rowWord(place())} `;
}

function render() {
  const p = place();
  const word = rowWord(p).toLowerCase();
  $("#shelf-save").disabled = !changed();
  $("#shelf-reset").disabled = !changed();
  $("#shelf-count").textContent = p
    ? `${draft.ids.length} ${draft.ids.length === 1 ? "book" : "books"} on ${rowWord(p)} ${draft.row} of ${p.name}, left to right${changed() ? ". Not saved yet." : "."}`
    : "Add a location in Settings first.";
  $("#shelf-items").innerHTML = draft.ids.map((id, i) => {
    const b = byId(id);
    if (!b) return "";
    const elsewhere = b.location_id && (b.location_id !== draft.place || b.shelf_row !== draft.row) && !draft.saved.includes(id)
      ? `<div class="meta">Now: ${esc(spotLine(b))}</div>` : "";
    return `<li>
      <span class="spot-num">${i + 1}</span>
      <div><div class="title">${esc(b.title)}</div><div class="author">${esc(b.authors.join(", "))}</div>${elsewhere}</div>
      <div class="row-actions">
        <button class="ghost" data-move="${i}" data-by="-1" aria-label="Move ${esc(b.title)} left" ${i === 0 ? "disabled" : ""}>Left</button>
        <button class="ghost" data-move="${i}" data-by="1" aria-label="Move ${esc(b.title)} right" ${i === draft.ids.length - 1 ? "disabled" : ""}>Right</button>
        <button class="ghost" data-drop="${i}" aria-label="Take ${esc(b.title)} off this ${word}">Take off</button>
      </div>
    </li>`;
  }).join("");
}

async function loadLibrary() {
  library = await api("/api/books?sort=location");
}

// Opens the chosen row as it's saved now, unless an unsaved row for it is waiting.
async function openRow({ keepDraft = false } = {}) {
  const key = `${draft.place}|${draft.row}`;
  const saved = library
    .filter((b) => b.location_id === draft.place && b.shelf_row === draft.row)
    .sort((a, b) => (a.shelf_pos ?? 1e9) - (b.shelf_pos ?? 1e9))
    .map((b) => b.id);
  draft.saved = saved;
  if (!keepDraft || loadedFor !== key) draft.ids = [...saved];
  draft.ids = draft.ids.filter((id) => byId(id)); // a book removed meanwhile drops out
  loadedFor = key;
  save();
  render();
}

function add(copies, what) {
  const b = freeCopy(copies, draft.ids);
  if (!b) { msg(`${what} is already on this ${rowWord(place()).toLowerCase()}.`); return false; }
  draft.ids.push(b.id);
  save();
  render();
  msg(`Added ${b.title} as number ${draft.ids.length}.`);
  return true;
}

function onScan(read, raw) {
  if (read.kind === "partial") { msg(raw.trim() ? "Type the whole ISBN, 10 or 13 digits." : ""); return; }
  if (read.kind !== "isbn") { msg(read.message); return; }
  const copies = library.filter((b) => b.isbn13 === read.isbn13 || (read.isbn10 && b.isbn10 === read.isbn10));
  if (!copies.length) { msg("That book isn't in the library yet. Add it with Add book, then scan it here."); return; }
  add(copies, copies[0].title);
}

function findByTitle() {
  const q = normTitle($("#shelf-find").value);
  const out = $("#shelf-found");
  if (!q) { out.innerHTML = ""; return; }
  const hits = library.filter((b) => normTitle(`${b.title} ${b.authors.join(" ")}`).includes(q)).slice(0, FIND_MAX);
  out.innerHTML = hits.length
    ? hits.map((b) => `<li><div><div class="title">${esc(b.title)}</div><div class="author">${esc(b.authors.join(", "))}${b.location ? ` · ${esc(spotLine(b))}` : ""}</div></div>
        <div class="row-actions"><button data-pick="${esc(b.id)}" ${draft.ids.includes(b.id) ? "disabled" : ""}>${draft.ids.includes(b.id) ? "On the row" : "Add"}</button></div></li>`).join("")
    : `<li class="muted">No book with that title. Try fewer words.</li>`;
}

// A pasted list, left to right: matched lines join the row in order; the
// rest are listed so she can find them by title or pick the right one.
function addList() {
  const lines = $("#shelf-paste").value.split(/\r?\n/);
  const left = [];
  let added = 0;
  for (const line of lines) {
    const m = matchLine(line, library);
    if (m.kind === "skip") continue;
    if (m.kind === "one") {
      if (add(m.books, m.books[0].title)) added++;
      else left.push({ text: m.text, why: "already on the row" });
    } else {
      left.push({ text: m.text, why: m.kind === "many" ? `${m.books.length} books match, find it by title below` : "not found in the library" });
    }
  }
  $("#shelf-paste").value = left.map((l) => l.text).join("\n");
  $("#shelf-paste-left").innerHTML = left.map((l) => `<li>${esc(l.text)} <span class="muted">(${esc(l.why)})</span></li>`).join("");
  msg(`Added ${added} from the list.${left.length ? ` ${left.length} left to sort out, shown below.` : ""}`);
}

async function saveRow() {
  const p = place();
  if (!p || !changed()) return;
  const spots = rowSpots(draft.place, draft.row, draft.ids, draft.saved);
  const btn = $("#shelf-save");
  btn.disabled = true;
  btn.textContent = "Saving...";
  const before = [];
  try {
    for (const part of chunks(spots)) {
      const r = await api("/api/books/spots", { method: "POST", body: { items: part } });
      before.push(...r.before);
    }
  } catch (err) {
    msg(before.length ? `Saved part of the row, then stopped: ${err.message}` : `Couldn't save: ${err.message}`);
  } finally {
    btn.textContent = "Save row";
  }
  const label = `${rowWord(p)} ${draft.row} of ${p.name}`;
  await refreshAll();
  if (!before.length) return;
  toast(`Saved ${label}: ${draft.ids.length} ${draft.ids.length === 1 ? "book" : "books"}`, async () => {
    try {
      for (const part of chunks(before)) await api("/api/books/spots", { method: "POST", body: { items: part } });
      toast(`Put ${label} back as it was`);
    } catch (err) {
      toast(`Couldn't undo all of it: ${err.message}`);
    }
    await refreshAll();
  });
}

async function refreshAll() {
  await loadLibrary();
  await openRow();
  findByTitle();
  await onChange();
}

export async function openShelf() {
  $("#library-view").hidden = true;
  $("#shelf-view").hidden = false;
  msg("Loading the library...");
  fillPickers();
  try {
    await loadLibrary();
    msg("");
  } catch (err) {
    msg(err.message);
  }
  await openRow({ keepDraft: true });
}

export function wireShelf(deps) {
  ({ api, onChange, toast, getSettings } = deps);
  load();
  if (draft.ids.length) loadedFor = `${draft.place}|${draft.row}`;

  attachScanBox($("#shelf-scan"), onScan);
  const camera = attachCamera({ button: $("#shelf-cam"), panel: $("#shelf-cam-panel"), onScan, continuous: true });

  const switchTo = async (next) => {
    if (changed() && !confirm(`${rowWord(place())} ${draft.row} has changes that aren't saved. Leave them?`)) { fillPickers(); return; }
    Object.assign(draft, next);
    fillPickers();
    await openRow();
    findByTitle();
    msg("");
  };
  $("#shelf-place").addEventListener("change", (e) => switchTo({ place: e.target.value, row: 1 }));
  $("#shelf-row").addEventListener("change", (e) => switchTo({ row: Number(e.target.value) }));

  $("#shelf-items").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.drop) draft.ids.splice(Number(btn.dataset.drop), 1);
    else if (btn.dataset.move) {
      const i = Number(btn.dataset.move);
      const j = i + Number(btn.dataset.by);
      [draft.ids[i], draft.ids[j]] = [draft.ids[j], draft.ids[i]];
    }
    save();
    render();
    findByTitle();
  });
  $("#shelf-find").addEventListener("input", findByTitle);
  $("#shelf-find").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  $("#shelf-found").addEventListener("click", (e) => {
    const id = e.target.closest("button")?.dataset.pick;
    const b = id && byId(id);
    if (b && add([b], b.title)) findByTitle();
  });
  $("#shelf-paste-go").addEventListener("click", addList);
  $("#shelf-save").addEventListener("click", saveRow);
  $("#shelf-reset").addEventListener("click", () => {
    if (!confirm("Put this row back the way it's saved?")) return;
    draft.ids = [...draft.saved];
    save();
    render();
    msg("");
  });
  $("#shelf-close").addEventListener("click", () => {
    camera.stop();
    $("#shelf-view").hidden = true;
    $("#library-view").hidden = false;
    onChange();
  });
}

// Bulk scan: she scans a pile of books, then reviews them all at once.
//
// While she scans, each book is only looked up (one lookup a second, Open
// Library's pace), never saved, and no warnings interrupt her. When she taps
// Done scanning, the list shows what needs a look: books already in the
// library, books scanned twice, and books Open Library doesn't have (she types
// those titles in the list). Duplicates stay ticked unless she unticks them or
// taps Skip duplicates, the same as the Libib import. Nothing is saved until
// she taps Add, and the whole pile can be undone afterwards.
//
// The pile is kept in this device's storage, so leaving the screen, the iPad
// going to sleep or a reload doesn't lose any scans.

import { attachScanBox } from "./scanbox.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOOKUP_PAUSE_MS = 1100;
const STORE_KEY = "bulkScan";

let api, onChange, settings;
const pile = { items: [], list: null, status: null, shelf: "", step: "scan", lastAdded: [] };
let running = false;
let nextId = 1;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && Array.isArray(saved.items)) {
      Object.assign(pile, saved, { lastAdded: [] });
      nextId = Math.max(0, ...pile.items.map((i) => i.id)) + 1;
      // A lookup cut off by a reload starts again.
      for (const i of pile.items) if (i.state === "looking") i.state = "pending";
    }
  } catch { /* storage blocked: the pile lives in memory only */ }
}
function save() {
  try {
    const { lastAdded, ...keep } = pile;
    localStorage.setItem(STORE_KEY, JSON.stringify(keep));
  } catch { /* storage blocked or full */ }
  updateOpenButton();
}
function updateOpenButton() {
  const n = pile.items.length;
  $("#bulk-open").textContent = n ? `Bulk scan (${n} waiting)` : "Bulk scan";
}

const msg = (t) => ($("#bulk-msg").textContent = t || "");

// ---------- lookups, one at a time ----------
async function runLookups() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      // Oldest scan first (the pile is kept newest first).
      const oldestFirst = [...pile.items].reverse();
      const item = oldestFirst.find((i) => i.state === "pending" && !i.retried)
        ?? oldestFirst.find((i) => i.state === "pending");
      if (!item) break;
      item.state = "looking";
      render();
      try {
        const r = await api(`/api/lookup?isbn=${item.isbn13}`);
        item.isbn10 = r.isbn10;
        item.book = r.book;
        item.in_library = r.in_library;
        item.state = r.book ? "found" : r.lookup_failed ? "failed" : "notfound";
      } catch {
        item.state = "failed";
      }
      // A failed lookup gets one more try, after the rest of the pile.
      if (item.state === "failed" && !item.retried) {
        item.retried = true;
        item.state = "pending";
      }
      if (!pile.items.includes(item)) continue; // removed while looking
      if (item.book) {
        item.title = item.book.title;
        item.author = item.book.authors.join(", ");
      }
      save();
      render();
      await sleep(LOOKUP_PAUSE_MS);
    }
  } finally {
    running = false;
  }
  if (pile.step === "waiting") showReview();
}

// ---------- scanning ----------
function onScan(read, raw) {
  if (read.kind === "partial") { msg(raw.trim() ? "Type the whole ISBN, 10 or 13 digits." : ""); return; }
  if (read.kind !== "isbn") { msg(read.message); return; }
  pile.items.unshift({ id: nextId++, isbn13: read.isbn13, isbn10: read.isbn10, state: "pending", book: null, in_library: [], title: "", author: "", keep: true });
  msg(`${pile.items.length} scanned.`);
  save();
  render();
  runLookups();
}

// ---------- review ----------
// Marks what needs her eye. Called each time the list is shown for review.
function flag() {
  const seen = new Map();
  const ordered = [...pile.items].reverse(); // oldest first, so "the same as #2" points back
  ordered.forEach((item, n) => {
    item.num = n + 1;
    item.twiceOf = seen.get(item.isbn13) ?? null;
    if (!seen.has(item.isbn13)) seen.set(item.isbn13, item.num);
  });
}
const isDuplicate = (i) => i.in_library?.length > 0 || i.twiceOf !== null;
const canAdd = (i) => i.title.trim() !== "";

function showReview() {
  pile.step = "review";
  flag();
  save();
  render();
}

function reviewSummary() {
  const items = pile.items;
  const dupes = items.filter(isDuplicate).length;
  const missing = items.filter((i) => !canAdd(i)).length;
  const adding = items.filter((i) => i.keep && canAdd(i)).length;
  const parts = [`${items.length} scanned.`];
  if (dupes) parts.push(`${dupes} ${dupes === 1 ? "is a duplicate" : "are duplicates"}.`);
  if (missing) parts.push(`${missing} ${missing === 1 ? "needs a title" : "need titles"} before ${missing === 1 ? "it" : "they"} can be added.`);
  $("#bulk-summary").textContent = parts.join(" ");
  $("#bulk-add").textContent = `Add ${adding} ${adding === 1 ? "book" : "books"}`;
  $("#bulk-add").disabled = adding === 0;
  $("#bulk-skip-dupes").hidden = dupes === 0;
}

// ---------- drawing ----------
function coverHtml(i) {
  return i.book?.cover_url
    ? `<img class="cover" src="${esc(i.book.cover_url)}" alt="" loading="lazy">`
    : `<div class="cover" aria-hidden="true"></div>`;
}

function rowHtml(i) {
  const review = pile.step === "review";
  const lookingText = { pending: "Waiting to look up", looking: "Looking up...", failed: "Couldn't look this up", notfound: "Not found on Open Library" }[i.state];
  let main;
  if (review && !i.book) {
    main = `<div class="flag">${esc(lookingText)}. Type the title to add it.</div>
      <input data-title="${i.id}" value="${esc(i.title)}" placeholder="Title" autocomplete="off">
      <input data-author="${i.id}" value="${esc(i.author)}" placeholder="Author" autocomplete="off">
      <div class="muted">ISBN ${esc(i.isbn13)}</div>`;
  } else {
    main = `<div class="title">${esc(i.title || lookingText)}</div>
      <div class="author">${esc(i.author || `ISBN ${i.isbn13}`)}</div>`;
  }
  const flags = [];
  if (review && i.in_library?.length) flags.push(`Already in the library: ${i.in_library.map((c) => `${c.list}, ${c.status}`).join("; ")}`);
  if (review && i.twiceOf !== null) flags.push(`Scanned twice, same as #${i.twiceOf}`);
  const action = review
    ? `<label class="keep"><input type="checkbox" data-keep="${i.id}" ${i.keep && canAdd(i) ? "checked" : ""} ${canAdd(i) ? "" : "disabled"}> Add</label>`
    : `<button class="status-btn ghost" data-drop="${i.id}" aria-label="Remove this scan">Remove</button>`;
  return `<li class="${review && !i.keep ? "skipped" : ""}">
    ${coverHtml(i)}
    <div>${review ? `<span class="muted">#${i.num}</span> ` : ""}${main}${flags.map((f) => `<div class="flag">${esc(f)}</div>`).join("")}</div>
    <div class="row-actions">${action}</div>
  </li>`;
}

function render() {
  const review = pile.step === "review";
  const waiting = pile.step === "waiting";
  $("#bulk-scan-step").hidden = review;
  $("#bulk-review-step").hidden = !review;
  const items = review ? [...pile.items].reverse() : pile.items;
  // In review, typing a title re-renders nothing, so the focus stays put.
  $("#bulk-items").innerHTML = items.map(rowHtml).join("");
  if (review) reviewSummary();
  if (waiting) {
    const left = pile.items.filter((i) => i.state === "pending" || i.state === "looking").length;
    msg(`Finishing the last lookups, ${left} to go.`);
  }
  $("#bulk-done").disabled = pile.items.length === 0 || waiting;
}

function fillSelect(sel, items, current) {
  sel.innerHTML = items
    .map((i) => `<option value="${esc(i.code)}" ${(current ? i.code === current : i.is_default) ? "selected" : ""}>${esc(i.label)}</option>`)
    .join("");
}

// ---------- adding ----------
async function addPile() {
  const toAdd = [...pile.items].reverse().filter((i) => i.keep && canAdd(i));
  if (!toAdd.length) return;
  const bar = $("#bulk-progress");
  bar.hidden = false;
  bar.max = toAdd.length;
  bar.value = 0;
  $("#bulk-add").disabled = true;
  const added = [];
  const failed = [];
  for (const i of toAdd) {
    const body = {
      title: i.title.trim(),
      authors: i.author.split(",").map((s) => s.trim()).filter(Boolean),
      isbn13: i.isbn13,
      list_code: pile.list,
      status_code: pile.status,
      shelf_location: pile.shelf.trim() || null,
    };
    if (i.isbn10) body.isbn10 = i.isbn10;
    if (i.book) {
      for (const k of ["subtitle", "publisher", "publish_date", "pages", "cover_url"]) if (i.book[k]) body[k] = i.book[k];
      body.source = "openlibrary";
    }
    try {
      const saved = await api("/api/books", { method: "POST", body });
      added.push(saved.id);
      pile.items = pile.items.filter((x) => x !== i); // saved, so it leaves the pile
      save();
    } catch (err) {
      i.error = err.message;
      failed.push(i);
    }
    bar.value++;
  }
  bar.hidden = true;
  pile.lastAdded = added;
  // What she unticked is done with. Failed saves and books still waiting for a title stay.
  pile.items = pile.items.filter((i) => failed.includes(i) || (i.keep && !canAdd(i)));
  save();
  await onChange();
  if (!pile.items.length) {
    pile.step = "scan";
    save();
    render();
    msg("");
  } else {
    render();
  }
  const leftOver = pile.items.length;
  $("#bulk-done-note")?.remove();
  const note = document.createElement("p");
  note.id = "bulk-done-note";
  note.innerHTML = `<span>Added ${added.length} ${added.length === 1 ? "book" : "books"}.${failed.length ? ` ${failed.length} didn't save: ${esc(failed[0].error)}` : ""}${leftOver - failed.length > 0 ? ` ${leftOver - failed.length} still ${leftOver - failed.length === 1 ? "needs a title" : "need titles"}.` : ""}</span> ${added.length ? `<button id="bulk-undo" class="ghost">Undo all</button>` : ""}`;
  $("#bulk-view .top").after(note);
}

async function undoAll() {
  const ids = pile.lastAdded;
  pile.lastAdded = [];
  let n = 0;
  for (const id of ids) {
    try { await api(`/api/books/${id}`, { method: "DELETE" }); n++; } catch { /* keep going */ }
  }
  await onChange();
  $("#bulk-done-note").innerHTML = `<span>Undone. ${n} ${n === 1 ? "book is" : "books are"} in Recently removed.</span>`;
}

// ---------- wiring ----------
export function openBulk(currentSettings) {
  settings = currentSettings;
  fillSelect($("#bulk-list"), settings.lists, pile.list);
  fillSelect($("#bulk-status"), settings.statuses, pile.status);
  pile.list = $("#bulk-list").value;
  pile.status = $("#bulk-status").value;
  $("#bulk-shelf").value = pile.shelf;
  $("#bulk-done-note")?.remove();
  $("#library-view").hidden = true;
  $("#import-view").hidden = true;
  $("#bulk-view").hidden = false;
  msg(pile.items.length ? `${pile.items.length} scanned so far.` : "");
  if (pile.step === "waiting") pile.step = "scan";
  if (pile.step === "review") flag();
  render();
  runLookups();
  if (pile.step === "scan") $("#bulk-scan").focus();
}

export function wireBulk(deps) {
  ({ api, onChange } = deps);
  load();
  updateOpenButton();

  attachScanBox($("#bulk-scan"), onScan);
  $("#bulk-list").addEventListener("change", (e) => { pile.list = e.target.value; save(); });
  $("#bulk-status").addEventListener("change", (e) => { pile.status = e.target.value; save(); });
  $("#bulk-shelf").addEventListener("input", (e) => { pile.shelf = e.target.value; save(); });

  $("#bulk-items").addEventListener("click", (e) => {
    const drop = e.target.dataset.drop;
    if (!drop) return;
    pile.items = pile.items.filter((i) => String(i.id) !== drop);
    msg(`${pile.items.length} scanned.`);
    save();
    render();
    $("#bulk-scan").focus();
  });
  $("#bulk-items").addEventListener("change", (e) => {
    const id = e.target.dataset.keep;
    if (!id) return;
    const item = pile.items.find((i) => String(i.id) === id);
    item.keep = e.target.checked;
    e.target.closest("li").classList.toggle("skipped", !item.keep);
    save();
    reviewSummary();
  });
  $("#bulk-items").addEventListener("input", (e) => {
    const id = e.target.dataset.title || e.target.dataset.author;
    if (!id) return;
    const item = pile.items.find((i) => String(i.id) === id);
    if (e.target.dataset.title) {
      const had = canAdd(item);
      item.title = e.target.value;
      if (!had && canAdd(item)) item.keep = true;
      const box = e.target.closest("li").querySelector("[data-keep]");
      box.disabled = !canAdd(item);
      box.checked = item.keep && canAdd(item);
    } else {
      item.author = e.target.value;
    }
    save();
    reviewSummary();
  });

  $("#bulk-done").addEventListener("click", () => {
    $("#bulk-done-note")?.remove();
    if (pile.items.some((i) => i.state === "pending" || i.state === "looking")) {
      pile.step = "waiting";
      render();
      runLookups();
    } else {
      showReview();
    }
  });
  $("#bulk-back").addEventListener("click", () => {
    pile.step = "scan";
    save();
    render();
    msg(`${pile.items.length} scanned so far.`);
    $("#bulk-scan").focus();
  });
  $("#bulk-skip-dupes").addEventListener("click", () => {
    for (const i of pile.items) if (isDuplicate(i)) i.keep = false;
    save();
    render();
  });
  $("#bulk-add").addEventListener("click", addPile);
  $("#bulk-clear").addEventListener("click", () => {
    if (pile.items.length && !confirm(`Clear all ${pile.items.length} scans? Nothing has been saved from them.`)) return;
    pile.items = [];
    pile.step = "scan";
    save();
    render();
    msg("");
    $("#bulk-scan").focus();
  });
  document.addEventListener("click", (e) => { if (e.target.id === "bulk-undo") undoAll(); });
  $("#bulk-close").addEventListener("click", () => {
    if (pile.step === "waiting") pile.step = "scan";
    save();
    $("#bulk-view").hidden = true;
    $("#library-view").hidden = false;
  });
}

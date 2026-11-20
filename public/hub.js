// The library hub: a screen for the iPad that lives by the shelves.
//
// Find is the default. She types a title or author and the matching covers
// show with each book's spot under it; a tap shows where the book lives.
// Scanning works without a tap first: the Inateck scanner types into the find
// box even when nothing has focus, and a scanned ISBN is looked up in the
// library. A book she has shows where it is; a book she doesn't have opens
// Add a book with its details looked up. The camera does the same for a
// device with no scanner.
//
// The hub is on for this device only (saved in the browser), so her phone
// keeps the full library. Opening the app with ?hub at the end of the address
// turns it on too, for a Home Screen bookmark on the iPad.

import { attachScanBox } from "./scanbox.js";
import { attachCamera } from "./camera.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const NEWEST_MAX = 24; // books shown before she searches
export const RESULTS_MAX = 60; // a search shows this many covers at most
export const IDLE_MS = 3 * 60 * 1000; // back to a clean screen after 3 quiet minutes

// The one line under a cover: where the book is.
export function spotLine(book) {
  return [book.location, book.shelf_location].filter(Boolean).join(" · ");
}

// The details on the Where it is panel, in the order she'd look for them.
export function spotDetails(book, statusLabel = (c) => c, listLabel = (c) => c) {
  return [
    ["Shelf", book.shelf_location],
    ["Subcategory", book.subcategory],
    ["Status", book.status_code ? statusLabel(book.status_code) : ""],
    ["List", book.list_code ? listLabel(book.list_code) : ""],
  ].filter(([, v]) => v);
}

// What the count line says above the covers.
export function countLine(q, total) {
  if (!q) return total ? "Newest added" : "No books yet. Tap Add book or scan one to start.";
  if (!total) return "No books match. Try fewer words, or scan the book.";
  if (total > RESULTS_MAX) return `Showing ${RESULTS_MAX} of ${total} books. Keep typing to narrow it down.`;
  return `${total} ${total === 1 ? "book matches" : "books match"}`;
}

export function whereHeading(copies, scanned) {
  if (!scanned) return "";
  return copies.length === 1 ? "You have this one" : `You have ${copies.length} copies`;
}

// A key the scanner typed while nothing had focus: true when it belongs in the find box.
export function isScanKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === "Enter" || /^[0-9Xx]$/.test(e.key);
}

const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function wireHub({ api, openBook, openAdd, getSettings, onLeave }) {
  const view = $("#hub-view");
  const box = $("#hub-search");
  const grid = $("#hub-books");
  const where = $("#where-dialog");
  const hub = { on: false, q: "", books: [], seq: 0, idle: null };

  const msg = (t) => ($("#hub-msg").textContent = t || "");
  const settings = () => getSettings();
  const statusLabel = (c) => settings().statuses.find((s) => s.code === c)?.label ?? c;
  const listLabel = (c) => settings().lists.find((l) => l.code === c)?.label ?? c;

  async function load() {
    const seq = ++hub.seq;
    const p = new URLSearchParams(hub.q ? { q: hub.q } : { sort: "added" });
    let books;
    try {
      books = await api(`/api/books?${p}`);
    } catch (err) {
      if (seq === hub.seq) $("#hub-count").textContent = err.message;
      return;
    }
    if (seq !== hub.seq) return; // a newer search came in meanwhile
    hub.books = books;
    $("#hub-count").textContent = countLine(hub.q, books.length);
    const shown = books.slice(0, hub.q ? RESULTS_MAX : NEWEST_MAX);
    grid.innerHTML = shown.map((b) => {
      const spot = spotLine(b);
      return `<li><button class="hub-book" data-where="${esc(b.id)}" aria-label="Where is ${esc(b.title)}">
        ${b.cover_url ? `<img class="cover" src="${esc(b.cover_url)}" alt="" loading="lazy">` : `<div class="cover" aria-hidden="true">${esc(b.title.slice(0, 40))}</div>`}
        <span class="title">${esc(b.title)}</span>
        <span class="author">${esc(b.authors.join(", "))}</span>
        <span class="hub-spot">${esc(spot || "No spot set yet")}</span>
      </button></li>`;
    }).join("");
  }

  function showWhere(copies, scanned) {
    $("#where-head").textContent = whereHeading(copies, scanned);
    $("#where-head").hidden = !scanned;
    $("#where-body").innerHTML = copies.map((b) => `<div class="where-copy">
        <div class="where-book">
          ${b.cover_url ? `<img class="cover" src="${esc(b.cover_url)}" alt="">` : `<div class="cover" aria-hidden="true">No cover</div>`}
          <div><div class="title">${esc(b.title)}</div><div class="author">${esc(b.authors.join(", "))}</div></div>
        </div>
        <p class="where-spot">${esc(b.location || "No location set yet")}</p>
        <dl class="where-details">${spotDetails(b, statusLabel, listLabel).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        <button type="button" class="ghost" data-open-book="${esc(b.id)}">Open book page</button>
      </div>`).join("");
    if (!where.open) where.showModal();
  }

  // A scanned ISBN: show where she has it, or start adding it.
  async function onScan(read) {
    if (read.kind === "partial") return; // Enter after typing words: the covers already show
    if (read.kind !== "isbn") { msg(read.message); return; }
    clearTimeout(load.t);
    hub.q = "";
    box.value = "";
    load(); // the screen behind goes back to newest
    msg("Looking for it...");
    const seq = ++onScan.seq;
    try {
      let copies = await api(`/api/books?q=${read.isbn13}`);
      if (!copies.length && read.isbn10) copies = await api(`/api/books?q=${read.isbn10}`);
      if (seq !== onScan.seq) return;
      if (copies.length) {
        msg("");
        showWhere(copies, true);
      } else {
        msg("That one isn't in the library yet.");
        if (where.open) where.close();
        openAdd(read.isbn13);
      }
    } catch (err) {
      if (seq === onScan.seq) msg(err.message);
    }
  }
  onScan.seq = 0;

  box.addEventListener("input", () => {
    msg("");
    hub.q = box.value.trim();
    clearTimeout(load.t);
    load.t = setTimeout(load, 200);
  });
  attachScanBox(box, onScan);
  const camera = attachCamera({ button: $("#hub-cam"), panel: $("#hub-cam-panel"), onScan });

  grid.addEventListener("click", (e) => {
    const id = e.target.closest("[data-where]")?.dataset.where;
    const book = id && hub.books.find((b) => b.id === id);
    if (book) showWhere([book], false);
  });
  $("#where-body").addEventListener("click", async (e) => {
    const id = e.target.closest("[data-open-book]")?.dataset.openBook;
    if (!id) return;
    try {
      const book = await api(`/api/books/${id}`);
      where.close();
      openBook(book, settings());
    } catch (err) {
      msg(err.message);
    }
  });
  $("#hub-add").addEventListener("click", () => openAdd(""));
  $("#hub-leave").addEventListener("click", () => { leave(); onLeave(); });

  // The scanner types like a keyboard. When nothing has focus (she just
  // closed a book, or tapped the background), its digits still land in the find box.
  // So the hub never moves focus to the box by itself, which would bring up
  // the on-screen keyboard on an iPad with no scanner paired.
  document.addEventListener("keydown", (e) => {
    if (!hub.on || !isScanKey(e) || editable(document.activeElement)) return;
    const other = [...document.querySelectorAll("dialog[open]")].some((d) => d !== where);
    if (other) return; // Add a book and the book page have their own boxes
    if (where.open && e.key !== "Enter") where.close();
    e.preventDefault();
    box.focus({ preventScroll: true });
    if (e.key === "Enter") box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else {
      box.value = e.key; // a scan starts fresh, whatever was typed before
      hub.q = "";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // After a few quiet minutes the hub clears itself, ready for the next person.
  function rest() {
    clearTimeout(hub.idle);
    hub.idle = setTimeout(() => {
      if (!hub.on) return;
      const busy = [...document.querySelectorAll("dialog[open]")].some((d) => d !== where);
      if (busy) { rest(); return; } // never close a book she's in the middle of
      if (where.open) where.close();
      camera.stop();
      box.value = "";
      hub.q = "";
      msg("");
      load();
    }, IDLE_MS);
  }
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => { if (hub.on) rest(); }, true);

  function enter() {
    hub.on = true;
    document.body.classList.add("hub");
    view.hidden = false;
    rest();
    load();
  }
  function leave() {
    hub.on = false;
    document.body.classList.remove("hub");
    view.hidden = true;
    clearTimeout(hub.idle);
    camera.stop();
    if (where.open) where.close();
  }
  return { enter, leave, refresh: () => hub.on && load(), get on() { return hub.on; } };
}

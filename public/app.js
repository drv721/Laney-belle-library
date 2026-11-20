// Library app front end. Plain JS, no build step.
// Everything it shows comes from /api, so every device sees the same library.

import { openImport, wireImport } from "./import.js";
import { wireAdd } from "./add.js";
import { openBulk, wireBulk } from "./bulk.js";
import { openBook, wireBook } from "./book.js";

const $ = (sel) => document.querySelector(sel);
const state = {
  settings: { statuses: [], lists: [], collections: [] },
  books: [],
  status: "",
  q: "",
  showDeleted: false,
  view: readPref("view", "list"),
};

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: fine */ }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const statusLabel = (code) => state.settings.statuses.find((s) => s.code === code)?.label ?? code;
function nextStatus(code) {
  const list = state.settings.statuses;
  const i = list.findIndex((s) => s.code === code);
  return list[(i + 1) % list.length].code;
}

async function loadBooks() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.status) p.set("status", state.status);
  if (state.showDeleted) p.set("deleted", "1");
  state.books = await api(`/api/books?${p}`);
  render();
}

function renderChips() {
  const chips = [{ code: "", label: "All" }, ...state.settings.statuses];
  $("#status-chips").innerHTML = chips
    .map((c) => `<button class="chip" data-code="${esc(c.code)}" aria-pressed="${state.status === c.code}">${esc(c.label)}</button>`)
    .join("");
}

function coverHtml(b) {
  return b.cover_url
    ? `<img class="cover" src="${esc(b.cover_url)}" alt="" loading="lazy">`
    : `<div class="cover" aria-hidden="true">${esc(b.title.slice(0, 40))}</div>`;
}

function render() {
  const ul = $("#books");
  ul.className = `books ${state.view}`;
  $("#view-toggle").textContent = state.view === "list" ? "Covers" : "List";
  $("#show-deleted").textContent = state.showDeleted ? "Back to library" : "Recently removed";
  const n = state.books.length;
  $("#count").textContent = state.showDeleted
    ? `${n} removed ${n === 1 ? "book" : "books"}. Restore any of them here.`
    : `${n} ${n === 1 ? "book" : "books"}`;
  $("#empty").hidden = n > 0 || state.showDeleted;

  ul.innerHTML = state.books
    .map((b) => {
      const authors = b.authors.join(", ");
      const actions = state.showDeleted
        ? `<button class="status-btn" data-restore="${b.id}">Restore</button>`
        : `<button class="status-btn ${esc(b.status_code)}" data-cycle="${b.id}" title="Tap to change">${esc(statusLabel(b.status_code))}</button>
           <button class="status-btn ghost" data-remove="${b.id}" aria-label="Remove ${esc(b.title)}">Remove</button>`;
      const name = `<div class="title">${esc(b.title)}</div><div class="author">${esc(authors)}</div>`;
      return `<li${state.showDeleted ? "" : ` data-open="${b.id}"`}>
        ${coverHtml(b)}
        <div>${state.showDeleted ? name : `<button class="open-book" data-open="${b.id}" aria-label="Open ${esc(b.title)}">${name}</button>`}</div>
        <div class="row-actions">${actions}</div>
      </li>`;
    })
    .join("");
}

let toastTimer;
function toast(text, undo) {
  $("#toast-text").textContent = text;
  const btn = $("#toast-undo");
  btn.hidden = !undo;
  btn.onclick = async () => { $("#toast").hidden = true; await undo(); };
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6000);
}

function fillSelect(sel, items, valueKey) {
  sel.innerHTML = items
    .map((i) => `<option value="${esc(i[valueKey])}" ${i.is_default ? "selected" : ""}>${esc(i.label)}</option>`)
    .join("");
}

function wire() {
  $("#search").addEventListener("input", (e) => {
    state.q = e.target.value.trim();
    clearTimeout(wire.t);
    wire.t = setTimeout(loadBooks, 200);
  });
  $("#status-chips").addEventListener("click", (e) => {
    const code = e.target.closest(".chip")?.dataset.code;
    if (code === undefined) return;
    state.status = code;
    renderChips();
    loadBooks();
  });
  $("#view-toggle").addEventListener("click", () => {
    state.view = state.view === "list" ? "grid" : "list";
    savePref("view", state.view);
    render();
  });
  $("#show-deleted").addEventListener("click", () => {
    state.showDeleted = !state.showDeleted;
    loadBooks();
  });

  $("#books").addEventListener("click", async (e) => {
    const t = e.target;
    try {
      if (t.dataset.cycle) {
        const book = state.books.find((b) => b.id === t.dataset.cycle);
        const from = book.status_code;
        await api(`/api/books/${book.id}`, { method: "PATCH", body: { status_code: nextStatus(from) } });
        await loadBooks();
      } else if (t.dataset.remove) {
        const id = t.dataset.remove;
        const book = state.books.find((b) => b.id === id);
        await api(`/api/books/${id}`, { method: "DELETE" });
        await loadBooks();
        toast(`Removed ${book.title}`, async () => {
          await api(`/api/books/${id}/restore`, { method: "POST" });
          await loadBooks();
        });
      } else if (t.dataset.restore) {
        await api(`/api/books/${t.dataset.restore}/restore`, { method: "POST" });
        await loadBooks();
        toast("Back on the shelf");
      } else {
        // Anywhere else on a row opens the book page. Buttons on the row keep their own jobs.
        const row = t.closest("[data-open]");
        if (!row || (t.closest("button") && !t.closest(".open-book"))) return;
        const book = state.books.find((b) => b.id === row.dataset.open);
        if (book) openBook(book, state.settings);
      }
    } catch (err) {
      toast(err.message);
    }
  });

  wireImport();
  $("#import-open").addEventListener("click", () => openImport(state.settings, loadBooks));

  wireAdd({ api, toast, fillSelects, onChange: loadBooks });
  wireBulk({ api, onChange: loadBooks });
  wireBook({ api, toast, onChange: loadBooks });
  $("#bulk-open").addEventListener("click", () => openBulk(state.settings));
}

function fillSelects() {
  fillSelect($("#add-status"), state.settings.statuses, "code");
  fillSelect($("#add-list"), state.settings.lists, "code");
}

async function start() {
  wire();
  try {
    const [me, settings] = await Promise.all([api("/api/me"), api("/api/settings")]);
    state.settings = settings;
    $("#who").textContent = `Signed in as ${me.email}`;
    renderChips();
    await loadBooks();
  } catch (err) {
    $("#count").textContent = err.message;
  }
}
start();

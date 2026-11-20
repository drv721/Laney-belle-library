// Library app front end. Plain JS, no build step.
// Everything it shows comes from /api, so every device sees the same library.

import { openImport, wireImport } from "./import.js";
import { wireAdd } from "./add.js";
import { openBulk, wireBulk } from "./bulk.js";
import { openBook, wireBook } from "./book.js";
import { openSections, wireSections } from "./sections.js";
import { KEEP, bulkChanges, applyBulk, undoBulk, summary } from "./select.js";

const $ = (sel) => document.querySelector(sel);
const state = {
  settings: { statuses: [], lists: [], collections: [], tags: [], subcategories: [], locations: [] },
  books: [],
  status: "",
  list: "",
  collection: "",
  tag: "",
  subcategory: "",
  location: "",
  sort: readPref("sort", "title"),
  q: "",
  showDeleted: false,
  selecting: false,
  picked: new Set(),
  bulkSub: "__keep",
  bulkLoc: "__keep",
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

const filtering = () => Boolean(state.q || state.status || FILTERS.some((k) => state[k]));

async function loadBooks() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.status) p.set("status", state.status);
  for (const k of FILTERS) if (state[k]) p.set(k, state[k]);
  if (state.sort !== "title") p.set("sort", state.sort);
  if (state.showDeleted) p.set("deleted", "1");
  // Quick taps on the menus send several requests; only the latest one is shown.
  const ticket = (loadBooks.ticket = (loadBooks.ticket || 0) + 1);
  const books = await api(`/api/books?${p}`);
  if (ticket !== loadBooks.ticket) return;
  state.books = books;
  // Only books on screen stay ticked, so Set never touches a book she can't see.
  const shown = new Set(books.map((b) => b.id));
  for (const id of state.picked) if (!shown.has(id)) state.picked.delete(id);
  render();
}

function renderChips() {
  const chips = [{ code: "", label: "All" }, ...state.settings.statuses];
  $("#status-chips").innerHTML = chips
    .map((c) => `<button class="chip" data-code="${esc(c.code)}" aria-pressed="${state.status === c.code}">${esc(c.label)}</button>`)
    .join("");
}

const SORTS = ["title", "author", "added", "status", "subcategory", "location"];
const FILTERS = ["list", "collection", "subcategory", "location", "tag"];

// The filter menus. A menu with nothing to choose (one collection, no tags
// yet) stays hidden, so the screen stays short. Subcategory and Location also
// offer "Not set yet", to find the books still to sort.
function filterMenus(settings, collection) {
  const several = settings.collections.length > 1;
  const collectionName = (id) => settings.collections.find((c) => c.id === id)?.name ?? "";
  const subs = settings.subcategories.filter((s) => !collection || s.collection_id === collection);
  return {
    list: { all: "All lists", min: 2, items: settings.lists.map((l) => [l.code, l.label]) },
    collection: { all: "All collections", min: 2, items: settings.collections.map((c) => [c.id, c.name]) },
    subcategory: {
      all: "All subcategories", min: 1, none: "Not set yet",
      items: subs.map((s) => [s.id, several && !collection ? `${s.name} (${collectionName(s.collection_id)})` : s.name]),
    },
    location: { all: "All locations", min: 1, none: "Not set yet", items: settings.locations.map((l) => [l.id, l.name]) },
    tag: { all: "All tags", min: 2, items: settings.tags.map((t) => [t.name, `${t.name} (${t.count})`]) },
  };
}

function renderFilters() {
  $("#sort").value = state.sort;
  const menus = filterMenus(state.settings, state.collection);
  for (const [key, menu] of Object.entries(menus)) {
    const choices = [["", menu.all], ...menu.items, ...(menu.none ? [["none", menu.none]] : [])];
    // A filter that no longer exists (one she removed) falls back to All.
    if (state[key] && !choices.some(([v]) => v === state[key])) state[key] = "";
    $(`#${key}-filter`).innerHTML = choices
      .map(([v, label]) => `<option value="${esc(v)}" ${v === state[key] ? "selected" : ""}>${esc(label)}</option>`)
      .join("");
    $(`#${key}-filter-wrap`).hidden = menu.items.length < menu.min && !state[key];
  }
  // The menus fold away on a phone; the label says when any of them is in use.
  const on = FILTERS.filter((k) => state[k]).length;
  const sortName = $("#sort").selectedOptions[0]?.text ?? "Title";
  $("#more-filters-label").textContent =
    `Sort and filter${state.sort !== "title" ? `: ${sortName}` : ""}${on ? ` (${on} ${on === 1 ? "filter" : "filters"} on)` : ""}`;
}

function coverHtml(b) {
  return b.cover_url
    ? `<img class="cover" src="${esc(b.cover_url)}" alt="" loading="lazy">`
    : `<div class="cover" aria-hidden="true">${esc(b.title.slice(0, 40))}</div>`;
}

function render() {
  const ul = $("#books");
  ul.className = `books ${state.view}${state.selecting ? " picking" : ""}`;
  $("#view-toggle").textContent = state.view === "list" ? "Covers" : "List";
  $("#deleted-back").hidden = !state.showDeleted;
  const n = state.books.length;
  $("#count").textContent = state.showDeleted
    ? `${n} removed ${n === 1 ? "book" : "books"}. Restore any of them here.`
    : `${n} ${n === 1 ? "book" : "books"}`;
  $("#empty").hidden = n > 0 || state.showDeleted;
  $("#empty").textContent = filtering()
    ? "No books match. Try another search, or set a menu back to All."
    : "No books yet. Tap Add book to put the first one on the shelf.";

  ul.innerHTML = state.books
    .map((b) => {
      const authors = b.authors.join(", ");
      const picked = state.picked.has(b.id);
      const actions = state.selecting
        ? `<input type="checkbox" class="pick" tabindex="-1" aria-hidden="true" ${picked ? "checked" : ""}>`
        : state.showDeleted
        ? `<button class="status-btn" data-restore="${b.id}">Restore</button>`
        : `<button class="status-btn ${esc(b.status_code)}" data-cycle="${b.id}" title="Tap to change">${esc(statusLabel(b.status_code))}</button>
           <button class="status-btn ghost" data-remove="${b.id}" aria-label="Remove ${esc(b.title)}">Remove</button>`;
      const where = [b.subcategory, b.location].filter(Boolean).join(" · ");
      const name = `<div class="title">${esc(b.title)}</div><div class="author">${esc(authors)}</div>${where ? `<div class="meta">${esc(where)}</div>` : ""}`;
      if (state.selecting) {
        return `<li data-pick="${b.id}" class="${picked ? "picked" : ""}" role="checkbox" aria-checked="${picked}" tabindex="0">
          ${coverHtml(b)}
          <div>${name}</div>
          <div class="row-actions">${actions}</div>
        </li>`;
      }
      return `<li${state.showDeleted ? "" : ` data-open="${b.id}"`}>
        ${coverHtml(b)}
        <div>${state.showDeleted ? name : `<button class="open-book" data-open="${b.id}" aria-label="Open ${esc(b.title)}">${name}</button>`}</div>
        <div class="row-actions">${actions}</div>
      </li>`;
    })
    .join("");
  renderSelectBar();
}

// ---------- select mode ----------
function renderSelectBar() {
  document.body.classList.toggle("selecting", state.selecting);
  $("#select-bar").hidden = !state.selecting;
  $("#select-toggle").hidden = state.showDeleted;
  $("#select-toggle").textContent = state.selecting ? "Done" : "Select";
  if (!state.selecting) return;
  const n = state.picked.size;
  $("#select-count").textContent = `${n} selected`;
  $("#select-all").disabled = n === state.books.length;
  $("#select-clear").disabled = n === 0;

  // A subcategory belongs to one collection, so it can only be set when the
  // ticked books all share one.
  const picked = state.books.filter((b) => state.picked.has(b.id));
  const cols = new Set(picked.map((b) => b.collection_id));
  const sub = $("#bulk-subcategory");
  const subs = cols.size === 1 ? state.settings.subcategories.filter((s) => cols.has(s.collection_id)) : [];
  sub.innerHTML = [[KEEP, "Leave as is"], ...(cols.size === 1 ? [["", "None"]] : []), ...subs.map((s) => [s.id, s.name])]
    .map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
  if (![...sub.options].some((o) => o.value === state.bulkSub)) state.bulkSub = KEEP;
  sub.value = state.bulkSub;
  const loc = $("#bulk-location");
  loc.innerHTML = [[KEEP, "Leave as is"], ["", "None"], ...state.settings.locations.map((l) => [l.id, l.name])]
    .map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
  if (![...loc.options].some((o) => o.value === state.bulkLoc)) state.bulkLoc = KEEP;
  loc.value = state.bulkLoc;
  $("#select-msg").textContent = cols.size > 1 ? "These books are in different collections, so only Location can be set on them together." : "";

  const changes = bulkChanges(sub.value, loc.value);
  const apply = $("#select-apply");
  apply.textContent = `Set on ${n} ${n === 1 ? "book" : "books"}`;
  apply.disabled = n === 0 || !Object.keys(changes).length;
}

function setSelecting(on) {
  state.selecting = on;
  state.picked.clear();
  state.bulkSub = state.bulkLoc = KEEP;
  render();
}

async function applySelection() {
  const ids = [...state.picked];
  const changes = bulkChanges($("#bulk-subcategory").value, $("#bulk-location").value);
  if (!ids.length || !Object.keys(changes).length) return;
  const names = {
    subcategory: $("#bulk-subcategory").selectedOptions[0]?.text,
    location: $("#bulk-location").selectedOptions[0]?.text,
  };
  const apply = $("#select-apply");
  apply.disabled = true;
  apply.textContent = "Saving...";
  const fields = Object.keys(changes);
  const r = await applyBulk(api, ids, changes);
  state.picked.clear();
  await reloadSettings(); // counts on the Subcategories and locations screen
  const undo = r.done
    ? async () => {
        try {
          await undoBulk(api, r.before, fields);
          toast(`Put ${r.done} ${r.done === 1 ? "book" : "books"} back as they were`);
        } catch (err) {
          toast(`Couldn't undo all of it: ${err.message}`);
        }
        await reloadSettings();
      }
    : null;
  if (r.error) {
    toast(r.done ? `${summary(changes, names, r.done)}, then stopped: ${r.error}` : `Couldn't save: ${r.error}`, undo);
  } else {
    toast(summary(changes, names, r.done), undo);
  }
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
  $("#sort").addEventListener("change", (e) => {
    state.sort = SORTS.includes(e.target.value) ? e.target.value : "title";
    savePref("sort", state.sort);
    renderFilters();
    loadBooks();
  });
  for (const key of FILTERS) {
    $(`#${key}-filter`).addEventListener("change", (e) => {
      state[key] = e.target.value;
      renderFilters(); // the label, and a collection's own subcategories
      loadBooks();
    });
  }
  $("#view-toggle").addEventListener("click", () => {
    state.view = state.view === "list" ? "grid" : "list";
    savePref("view", state.view);
    render();
  });
  // Settings holds what she sets up once or uses now and then. Each item
  // closes it first, so she lands on the screen she picked.
  const settingsDlg = $("#settings-dialog");
  const fromSettings = (fn) => () => { settingsDlg.close(); fn(); };
  $("#settings-open").addEventListener("click", () => settingsDlg.showModal());
  const showRemoved = (on) => {
    state.showDeleted = on;
    state.selecting = false;
    state.picked.clear();
    loadBooks();
  };
  $("#show-deleted").addEventListener("click", fromSettings(() => showRemoved(true)));
  $("#deleted-back").addEventListener("click", () => showRemoved(false));
  $("#export").addEventListener("click", () => settingsDlg.close());

  $("#select-toggle").addEventListener("click", () => setSelecting(!state.selecting));
  $("#select-done").addEventListener("click", () => setSelecting(false));
  $("#select-all").addEventListener("click", () => { for (const b of state.books) state.picked.add(b.id); render(); });
  $("#select-clear").addEventListener("click", () => { state.picked.clear(); render(); });
  $("#bulk-subcategory").addEventListener("change", (e) => { state.bulkSub = e.target.value; renderSelectBar(); });
  $("#bulk-location").addEventListener("change", (e) => { state.bulkLoc = e.target.value; renderSelectBar(); });
  $("#select-apply").addEventListener("click", applySelection);
  $("#books").addEventListener("keydown", (e) => {
    if (!state.selecting || (e.key !== " " && e.key !== "Enter")) return;
    const row = e.target.closest("[data-pick]");
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  $("#books").addEventListener("click", async (e) => {
    const t = e.target;
    const pickRow = state.selecting && t.closest("[data-pick]");
    if (pickRow) {
      const id = pickRow.dataset.pick;
      if (state.picked.has(id)) state.picked.delete(id); else state.picked.add(id);
      render();
      if (e.detail === 0) $(`[data-pick="${id}"]`)?.focus(); // keyboard: keep her place
      return;
    }
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
  $("#import-open").addEventListener("click", fromSettings(() => openImport(state.settings, loadBooks)));

  wireAdd({ api, toast, fillSelects, onChange: loadBooks });
  wireBulk({ api, onChange: loadBooks });
  wireBook({ api, toast, onChange: loadBooks });
  wireSections({ api, toast, getSettings: () => state.settings, onChange: reloadSettings });
  $("#sections-open").addEventListener("click", fromSettings(openSections));
  $("#add-collection").addEventListener("change", fillAddSubcategories);
  $("#bulk-open").addEventListener("click", () => openBulk(state.settings));
}

// After she changes subcategories or locations: new menus, and the list
// again so names and counts on every book are current.
async function reloadSettings() {
  state.settings = await api("/api/settings");
  renderFilters();
  await loadBooks();
}

function fillSelects() {
  fillSelect($("#add-status"), state.settings.statuses, "code");
  fillSelect($("#add-list"), state.settings.lists, "code");
  // Collection shows only when there's more than one. New books go in the
  // one with the most books unless she picks another.
  const cols = state.settings.collections;
  const main = [...cols].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
  $("#add-collection").innerHTML = cols
    .map((c) => `<option value="${esc(c.id)}" ${c.id === main?.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#add-collection-wrap").hidden = cols.length < 2;
  fillAddSubcategories();
  $("#add-location").innerHTML = noneOptions(state.settings.locations);
}

const noneOptions = (items) =>
  `<option value="">None</option>${items.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}`;
function fillAddSubcategories() {
  const col = $("#add-collection").value;
  $("#add-subcategory").innerHTML = noneOptions(state.settings.subcategories.filter((s) => s.collection_id === col));
}

async function start() {
  wire();
  try {
    const [me, settings] = await Promise.all([api("/api/me"), api("/api/settings")]);
    state.settings = settings;
    $("#who").textContent = `Signed in as ${me.email}`;
    if (!SORTS.includes(state.sort)) state.sort = "title";
    renderChips();
    renderFilters();
    await loadBooks();
  } catch (err) {
    $("#count").textContent = err.message;
  }
}
start();

// The import screen. She picks one or more Libib files, sees every book with
// its cover, decides what to do with duplicates, and only then taps Import.

import { mapLibibCsv, duplicateKey, titleKey, mightBeSame } from "./libib-map.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COVER_BATCH = 25;      // the Worker takes 25 ISBNs per call
const COVER_PAUSE_MS = 1100; // Open Library asks for about one request a second
const ROWS_PER_CALL = 50;

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

// Guess which list a file belongs to from its name; she can change it.
function guessList(fileName) {
  const n = fileName.toLowerCase();
  if (/wish/.test(n)) return "wish";
  if (/borrow|loan/.test(n)) return "borrowed";
  if (/previous|sold|gave|donat/.test(n)) return "previously_owned";
  return "owned";
}

const imp = { settings: null, files: [], coverRun: 0, onDone: null };

export function openImport(settings, onDone) {
  imp.settings = settings;
  imp.onDone = onDone;
  imp.files = [];
  $("#import-files").value = "";
  $("#import-review").innerHTML = "";
  $("#import-summary").textContent = "";
  $("#import-go").hidden = true;
  $("#import-progress").hidden = true;
  $("#library-view").hidden = true;
  $("#import-view").hidden = false;
  loadPastImports();
  window.scrollTo(0, 0);
}

function closeImport() {
  imp.coverRun++; // stops any cover lookups still going
  $("#import-view").hidden = true;
  $("#library-view").hidden = false;
  imp.onDone?.();
}

async function readFiles(fileList) {
  imp.files = [];
  for (const f of fileList) {
    const text = await f.text();
    const mapped = mapLibibCsv(text, { fileName: f.name });
    for (const r of mapped.rows) {
      r.include = Boolean(r.book.title);
      r.cover_url = null;
      r.flags = [];
    }
    imp.files.push({
      fileName: f.name,
      listCode: guessList(f.name),
      collectionName: "Library",
      ...mapped,
    });
  }
  await markDuplicates();
  render();
  findCovers();
}

async function markDuplicates() {
  let existing = [];
  try {
    existing = await api("/api/import/keys");
  } catch (err) {
    $("#import-summary").textContent = `Couldn't check your library for duplicates: ${err.message}`;
  }
  const listLabel = (code) => imp.settings.lists.find((l) => l.code === code)?.label ?? code;
  const inLibrary = new Map();
  for (const e of existing) {
    const k = duplicateKey({ isbn13: e.isbn13, title: e.title, authors: e.authors });
    if (!inLibrary.has(k)) inLibrary.set(k, new Set());
    inLibrary.get(k).add(listLabel(e.list_code));
  }
  const seen = new Map(); // key -> [{file, row}]
  for (const file of imp.files) {
    for (const r of file.rows) {
      if (!r.book.title) continue;
      const k = duplicateKey(r.book);
      r.key = k;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push({ file, r });
    }
  }
  const byTitle = new Map(); // title -> [{file, row}]
  for (const [, list] of seen) for (const o of list) {
    const t = titleKey(o.r.book);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(o);
  }
  for (const file of imp.files) {
    for (const r of file.rows) {
      r.flags = [];
      if (!r.book.title) { r.flags.push("No title, so it can't be imported"); continue; }
      if (inLibrary.has(r.key)) r.flags.push(`Already in your library (${[...inLibrary.get(r.key)].join(", ")})`);
      const others = seen.get(r.key).filter((o) => o.r !== r);
      for (const o of others) {
        r.flags.push(o.file === file ? `Same book as row ${o.r.rowNumber}` : `Also in ${o.file.fileName}, row ${o.r.rowNumber}`);
      }
      // Same title with a missing ISBN or author: shown for her to decide.
      // Skip duplicates leaves these alone, since the keys differ.
      if (!inLibrary.has(r.key) && existing.some((e) => mightBeSame(r.book, e))) {
        r.flags.push("Might already be in your library, check the edition");
      }
      for (const o of byTitle.get(titleKey(r.book)) || []) {
        if (o.r === r || o.r.key === r.key || !mightBeSame(r.book, o.r.book)) continue;
        r.flags.push(o.file === file ? `Might be the same book as row ${o.r.rowNumber}` : `Might be the same as ${o.file.fileName}, row ${o.r.rowNumber}`);
      }
      r.duplicate = r.flags.length > 0;
    }
  }
}

function counts() {
  let total = 0, chosen = 0, dupes = 0, warnings = 0;
  for (const f of imp.files) for (const r of f.rows) {
    total++;
    if (r.include) chosen++;
    if (r.duplicate) dupes++;
    if (r.warnings.length) warnings++;
  }
  return { total, chosen, dupes, warnings };
}

function renderSummary() {
  const c = counts();
  const parts = [`${c.total} ${c.total === 1 ? "book" : "books"} in ${imp.files.length} ${imp.files.length === 1 ? "file" : "files"}`];
  if (c.dupes) parts.push(`${c.dupes} ${c.dupes === 1 ? "looks like a duplicate" : "look like duplicates"}`);
  if (c.warnings) parts.push(`${c.warnings} ${c.warnings === 1 ? "has" : "have"} something to check`);
  $("#import-summary").textContent = parts.join(". ") + ".";
  const go = $("#import-go");
  go.hidden = c.chosen === 0;
  go.textContent = `Import ${c.chosen} ${c.chosen === 1 ? "book" : "books"}`;
  $("#import-skip-dupes").hidden = c.dupes === 0;
}

function coverHtml(r) {
  return r.cover_url
    ? `<img class="cover" src="${esc(r.cover_url)}" alt="" loading="lazy">`
    : `<div class="cover" aria-hidden="true">${esc((r.book.title || "?").slice(0, 30))}</div>`;
}

// Swaps in covers as they arrive without redrawing the list, so a box she's
// typing in keeps its place.
function showCovers() {
  imp.files.forEach((f, fi) => {
    for (const r of f.rows) {
      if (!r.cover_url) continue;
      const li = document.querySelector(`li[data-key="${fi}-${r.rowNumber}"]`);
      const el = li?.querySelector(".cover");
      if (el && el.tagName !== "IMG") el.outerHTML = coverHtml(r);
    }
  });
}

function rowHtml(fi, r) {
  const cover = coverHtml(r);
  const status = imp.settings.statuses.find((s) => s.code === r.item.status_code)?.label ?? "";
  const notes = [...r.flags, ...r.warnings].map((n) => `<div class="flag">${esc(n)}</div>`).join("");
  return `<li data-key="${fi}-${r.rowNumber}" class="${r.include ? "" : "skipped"}">
    ${cover}
    <div>
      <div class="title">${esc(r.book.title || "(no title)")}</div>
      <div class="author">${esc(r.book.authors.join(", "))}${status ? ` · ${esc(status)}` : ""}</div>
      ${notes}
    </div>
    <label class="keep"><input type="checkbox" data-file="${fi}" data-row="${r.rowNumber}" ${r.include ? "checked" : ""} ${r.book.title ? "" : "disabled"}> Import</label>
  </li>`;
}

function render() {
  const lists = imp.settings.lists;
  $("#import-review").innerHTML = imp.files.map((f, fi) => `
    <section class="import-file">
      <h2>${esc(f.fileName)}</h2>
      <div class="import-options">
        <label>Goes on this list
          <select data-list="${fi}">${lists.map((l) => `<option value="${esc(l.code)}" ${l.code === f.listCode ? "selected" : ""}>${esc(l.label)}</option>`).join("")}</select>
        </label>
        <label>Collection <input data-collection="${fi}" value="${esc(f.collectionName)}" autocomplete="off"></label>
      </div>
      ${f.unknownHeaders.length ? `<p class="flag">Columns this app doesn't use yet, kept with each book's original row: ${esc(f.unknownHeaders.join(", "))}</p>` : ""}
      <ul class="books list import-rows">${f.rows.map((r) => rowHtml(fi, r)).join("")}</ul>
    </section>`).join("");
  renderSummary();
}

async function findCovers() {
  const run = ++imp.coverRun;
  const rows = imp.files.flatMap((f) => f.rows).filter((r) => r.book.isbn13 && !r.cover_url);
  const isbns = [...new Set(rows.map((r) => r.book.isbn13))];
  const status = $("#import-covers");
  let found = 0;
  for (let i = 0; i < isbns.length; i += COVER_BATCH) {
    if (run !== imp.coverRun) return;
    status.textContent = `Finding covers: ${Math.min(i + COVER_BATCH, isbns.length)} of ${isbns.length}`;
    try {
      const got = await api(`/api/covers?isbn=${isbns.slice(i, i + COVER_BATCH).join(",")}`);
      for (const r of rows) if (!r.cover_url && got[r.book.isbn13]) { r.cover_url = got[r.book.isbn13]; found++; }
      showCovers();
    } catch (err) {
      status.textContent = `${err.message} Found ${found} so far.`;
      return;
    }
    await sleep(COVER_PAUSE_MS);
  }
  if (run === imp.coverRun) {
    const missing = rows.length - found;
    status.textContent = isbns.length
      ? `Found covers for ${found} ${found === 1 ? "book" : "books"}.${missing > 0 ? ` ${missing} had none on Open Library.` : ""}`
      : "";
  }
}

async function runImport() {
  imp.coverRun++; // covers found so far go in; the rest can be filled later
  const go = $("#import-go");
  go.disabled = true;
  const bar = $("#import-progress");
  bar.hidden = false;
  const todo = imp.files.map((f) => ({ f, rows: f.rows.filter((r) => r.include) })).filter((x) => x.rows.length);
  const total = todo.reduce((n, x) => n + x.rows.length, 0);
  let done = 0;
  const results = [];
  try {
    for (const { f, rows } of todo) {
      const start = await api("/api/import/start", {
        method: "POST",
        body: { file_name: f.fileName, list_code: f.listCode, collection_name: f.collectionName, row_count: rows.length },
      });
      let saved = 0;
      for (let i = 0; i < rows.length; i += ROWS_PER_CALL) {
        const chunk = rows.slice(i, i + ROWS_PER_CALL).map((r) => ({
          rowNumber: r.rowNumber, book: r.book, item: r.item, tags: r.tags, group: r.group, raw: r.raw, cover_url: r.cover_url,
        }));
        const res = await api("/api/import/rows", {
          method: "POST",
          body: { batch_id: start.batch_id, list_code: start.list_code, collection_id: start.collection_id, rows: chunk },
        });
        saved += res.saved;
        done += chunk.length;
        bar.value = done;
        bar.max = total;
      }
      results.push(`${saved} from ${f.fileName}`);
    }
    $("#import-summary").textContent = `Imported ${results.join(", ")}. You can undo any import below.`;
    imp.files = [];
    $("#import-review").innerHTML = "";
    go.hidden = true;
    $("#import-skip-dupes").hidden = true;
  } catch (err) {
    $("#import-summary").textContent =
      `The import stopped: ${err.message} ${done} of ${total} books were saved. Each import below can be undone, so nothing is lost by trying again.`;
  } finally {
    go.disabled = false;
    bar.hidden = true;
    loadPastImports();
  }
}

async function loadPastImports() {
  const ul = $("#import-past");
  try {
    const past = await api("/api/imports");
    $("#import-past-head").hidden = past.length === 0;
    ul.innerHTML = past.map((p) => `<li>
      <div><div class="title">${esc(p.file_name)}</div>
      <div class="author">${esc(new Date(p.imported_at).toLocaleString())} · ${p.on_shelf ?? 0} of ${p.saved} still on the shelf</div></div>
      ${p.on_shelf ? `<button class="status-btn ghost" data-undo="${esc(p.id)}">Undo</button>` : ""}
    </li>`).join("");
  } catch {
    ul.innerHTML = "";
  }
}

export function wireImport() {
  $("#import-files").addEventListener("change", (e) => {
    if (e.target.files.length) readFiles([...e.target.files]);
  });
  $("#import-close").addEventListener("click", closeImport);
  $("#import-go").addEventListener("click", runImport);
  $("#import-skip-dupes").addEventListener("click", () => {
    // Keeps the first copy of each duplicate and skips the rest, and skips
    // anything already in the library. She can tick any of them back.
    const kept = new Set();
    for (const f of imp.files) for (const r of f.rows) {
      if (!r.duplicate) continue;
      const inLib = r.flags.some((x) => x.startsWith("Already in your library"));
      if (inLib || kept.has(r.key)) r.include = false;
      else kept.add(r.key);
    }
    render();
  });
  $("#import-review").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.list !== undefined) imp.files[t.dataset.list].listCode = t.value;
    if (t.dataset.file !== undefined) {
      const r = imp.files[t.dataset.file].rows.find((x) => String(x.rowNumber) === t.dataset.row);
      r.include = t.checked;
      t.closest("li").classList.toggle("skipped", !t.checked);
      renderSummary();
    }
  });
  $("#import-review").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.collection !== undefined) imp.files[t.dataset.collection].collectionName = t.value;
  });
  $("#import-past").addEventListener("click", async (e) => {
    const id = e.target.dataset.undo;
    if (!id) return;
    e.target.disabled = true;
    try {
      const r = await api(`/api/imports/${id}/undo`, { method: "POST" });
      $("#import-summary").textContent = `${r.removed} ${r.removed === 1 ? "book" : "books"} moved to Recently removed. You can restore any of them there.`;
    } catch (err) {
      $("#import-summary").textContent = err.message;
    }
    loadPastImports();
  });
}

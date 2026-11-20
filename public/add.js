// Adding a book: by hand, or by scanning (or typing) its ISBN.
//
// A Bluetooth scanner in keyboard mode types the barcode's digits into the
// focused box, usually followed by Enter. So the scan box reacts to Enter,
// and also to a full, valid 13-digit ISBN arriving without one.
// A scan looks the book up (Open Library, through the Worker) and fills the
// form for her to check. For a pile of books, Bulk scan (public/bulk.js)
// collects the scans and shows duplicates once she's done.
// A book with no barcode can be found by title instead (Find by title).

import { readScan } from "./isbn.js";
import { attachScanBox } from "./scanbox.js";
import { attachCamera } from "./camera.js";
import { parseTags } from "./tags.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function wireAdd({ api, toast, fillSelects, onChange }) {
  const dlg = $("#add-dialog");
  const form = $("#add-form");
  const scan = $("#scan");
  const add = { found: null, picked: null, seq: 0 };

  const msg = (text) => ($("#scan-msg").textContent = text || "");

  function preview(book, note) {
    const box = $("#scan-preview");
    if (!book) { box.hidden = true; box.innerHTML = ""; return; }
    const bits = note ?? [book.publisher, book.publish_date, book.pages ? `${book.pages} pages` : null].filter(Boolean).join(" · ");
    box.innerHTML = `${book.cover_url ? `<img class="cover" src="${esc(book.cover_url)}" alt="">` : `<div class="cover" aria-hidden="true">No cover</div>`}
      <div><div class="title">${esc(book.title)}</div><div class="author">${esc(book.authors.join(", "))}</div>
      <div class="muted">${esc(bits)}</div></div>`;
    box.hidden = false;
  }

  function log(text, undoId) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(text)}</span>${undoId ? `<button type="button" class="status-btn ghost" data-undo="${esc(undoId)}">Undo</button>` : ""}`;
    $("#scan-log").prepend(li);
    while ($("#scan-log").children.length > 20) $("#scan-log").lastElementChild.remove();
  }

  // Clears the book fields, keeps her status, list and shelf picks for the next one.
  function clearBook() {
    for (const name of ["title", "author", "isbn"]) form.elements[name].value = "";
    add.found = null;
    add.picked = null;
    preview(null);
    clearResults();
  }

  const yearNote = (b) => [b.first_year ? `First published ${b.first_year}` : null, b.cover_url ? "cover may be another edition" : null].filter(Boolean).join(" · ");
  const copiesNote = (list) =>
    list.length ? `Already in the library: ${list.map((c) => `${c.title} (${c.list}, ${c.status})`).join("; ")}. Save adds another copy.` : "";

  function clearResults() {
    $("#title-results").innerHTML = "";
    $("#title-results").hidden = true;
    $("#title-msg").textContent = "";
    add.results = [];
  }

  function bodyFromForm() {
    const f = new FormData(form);
    const isbnRead = readScan(f.get("isbn"));
    const body = {
      title: String(f.get("title") || "").trim(),
      authors: String(f.get("author") || "").split(",").map((s) => s.trim()).filter(Boolean),
      status_code: f.get("status_code"),
      list_code: f.get("list_code"),
      shelf_location: String(f.get("shelf_location") || "").trim() || null,
    };
    for (const k of ["collection_id", "subcategory_id", "location_id"]) if (f.get(k)) body[k] = f.get(k);
    const tags = parseTags(f.get("tags"));
    if (tags.length) body.tags = tags;
    if (isbnRead.kind === "isbn") {
      body.isbn13 = isbnRead.isbn13;
      if (isbnRead.isbn10) body.isbn10 = isbnRead.isbn10;
      // The looked-up details ride along only while the ISBN is still the scanned one.
      const found = add.found;
      if (found?.book && found.isbn13 === isbnRead.isbn13) {
        for (const k of ["subtitle", "publisher", "publish_date", "pages", "cover_url"]) if (found.book[k]) body[k] = found.book[k];
        body.source = "openlibrary";
      }
    }
    // A book picked from Find by title brings its subtitle and cover, while the title is still the picked one.
    const picked = add.picked;
    if (picked && !body.source && body.title === picked.title) {
      for (const k of ["subtitle", "cover_url"]) if (picked[k]) body[k] = picked[k];
      body.source = "openlibrary";
    }
    return body;
  }

  async function save(body) {
    const saved = await api("/api/books", { method: "POST", body });
    await onChange();
    return saved;
  }

  async function handleScan(read, raw) {
    if (read.kind === "partial") { msg(raw.trim() ? "Type the whole ISBN, 10 or 13 digits." : ""); return; }
    if (read.kind !== "isbn") { msg(read.message); return; }

    const seq = ++add.seq;
    msg("Looking it up...");
    let r;
    try {
      r = await api(`/api/lookup?isbn=${read.isbn13}`);
    } catch (err) {
      if (seq === add.seq) msg(err.message);
      return;
    }
    if (seq !== add.seq) return; // a newer scan came in meanwhile

    clearBook();
    add.found = r;
    form.elements.isbn.value = r.isbn13;
    const already = r.in_library.length
      ? `Already in the library: ${r.in_library.map((c) => `${c.title} (${c.list}, ${c.status})`).join("; ")}. Save adds another copy.`
      : "";

    if (!r.book) {
      const why = r.lookup_failed
        ? "Couldn't reach the book lookup just now."
        : "Open Library doesn't have this one.";
      msg(`${why} Type the title and author, then Save.${already ? " " + already : ""}`);
      form.elements.title.focus();
      return;
    }
    form.elements.title.value = r.book.title;
    form.elements.author.value = r.book.authors.join(", ");
    preview(r.book);
    msg(already || "Check the details, then Save.");
  }

  attachScanBox(scan, handleScan);

  // ---- Find by title ----
  async function findByTitle() {
    const title = form.elements.title.value.trim();
    const author = form.elements.author.value.split(",")[0].trim();
    const note = (t) => ($("#title-msg").textContent = t);
    if (title.length < 2) { note("Type at least part of the title first."); form.elements.title.focus(); return; }
    const seq = ++add.seq;
    $("#title-results").hidden = true;
    note("Searching Open Library...");
    let r;
    try {
      r = await api(`/api/search?${new URLSearchParams({ title, author })}`);
    } catch (err) {
      if (seq === add.seq) note(err.message);
      return;
    }
    if (seq !== add.seq) return;
    add.results = r.results;
    const typed = copiesNote(r.typed_in_library);
    if (r.search_failed) { note(`Couldn't reach the book search just now. You can still Save what you typed.${typed ? " " + typed : ""}`); return; }
    if (!r.results.length) {
      note(`No matches on Open Library${author ? " for that title and author" : ""}. Check the spelling, try fewer words, or Save what you typed.${typed ? " " + typed : ""}`);
      return;
    }
    note(`${r.results.length === 1 ? "1 match" : `${r.results.length} matches`}. Tap the right one, or keep what you typed.`);
    $("#title-results").innerHTML = r.results.map((b, i) => `<li>
        ${b.cover_url ? `<img class="cover" src="${esc(b.cover_url)}" alt="" loading="lazy">` : `<div class="cover" aria-hidden="true">No cover</div>`}
        <div><div class="title">${esc(b.title)}${b.subtitle ? `<span class="muted">: ${esc(b.subtitle)}</span>` : ""}</div>
        <div class="author">${esc(b.authors.join(", "))}</div>
        <div class="muted">${esc([b.first_year ? `First published ${b.first_year}` : null, b.in_library.length ? "Already in the library" : null].filter(Boolean).join(" · "))}</div></div>
        <button type="button" class="ghost" data-pick="${i}">Use this</button>
      </li>`).join("");
    $("#title-results").hidden = false;
  }

  $("#title-find").addEventListener("click", findByTitle);
  // Enter in Title or Author runs the search. Saving takes a tap on a Save button,
  // so a half-typed title never goes in by accident.
  for (const name of ["title", "author"]) {
    form.elements[name].addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      findByTitle();
    });
  }
  $("#title-results").addEventListener("click", (e) => {
    const i = e.target.dataset.pick;
    if (i === undefined) return;
    const b = add.results[Number(i)];
    if (!b) return;
    form.elements.title.value = b.title;
    if (b.authors.length) form.elements.author.value = b.authors.join(", ");
    add.picked = b;
    $("#title-results").innerHTML = "";
    $("#title-results").hidden = true;
    $("#title-msg").textContent = "";
    preview(b, yearNote(b));
    msg(copiesNote(b.in_library) || "Check the details, then Save.");
  });
  // The camera closes after each book. If she used it, Save and scan next opens it again.
  let usedCamera = false;
  const camera = attachCamera({
    button: $("#scan-cam"),
    panel: $("#scan-cam-panel"),
    onScan: (read, raw) => { usedCamera = true; handleScan(read, raw); },
  });
  dlg.addEventListener("close", () => camera.stop());

  $("#scan-log").addEventListener("click", async (e) => {
    const id = e.target.dataset.undo;
    if (!id) return;
    try {
      await api(`/api/books/${id}`, { method: "DELETE" });
      await onChange();
      e.target.closest("li").querySelector("span").textContent += " (undone, it's in Recently removed)";
      e.target.remove();
    } catch (err) {
      msg(err.message);
    }
    scan.focus();
  });

  $("#add-open").addEventListener("click", () => {
    form.reset();
    clearBook();
    msg("");
    $("#scan-log").innerHTML = "";
    usedCamera = false;
    fillSelects();
    dlg.showModal();
    scan.focus();
  });
  $("#add-cancel").addEventListener("click", () => dlg.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = e.submitter?.value === "next";
    try {
      const saved = await save(bodyFromForm());
      if (next) {
        log(`Added ${saved.title}`, saved.id);
        msg(`Added ${saved.title}. Ready for the next one.`);
        clearBook();
        if (usedCamera) camera.start();
        else scan.focus();
      } else {
        dlg.close();
        toast(`Added ${saved.title}`);
      }
    } catch (err) {
      msg(err.message);
    }
  });
}

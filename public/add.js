// Adding a book: by hand, or by scanning (or typing) its ISBN.
//
// A Bluetooth scanner in keyboard mode types the barcode's digits into the
// focused box, usually followed by Enter. So the scan box reacts to Enter,
// and also to a full, valid 13-digit ISBN arriving without one.
// A scan looks the book up (Open Library, through the Worker) and fills the
// form for her to check. For a pile of books, Bulk scan (public/bulk.js)
// collects the scans and shows duplicates once she's done.

import { readScan } from "./isbn.js";
import { attachScanBox } from "./scanbox.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function wireAdd({ api, toast, fillSelects, onChange }) {
  const dlg = $("#add-dialog");
  const form = $("#add-form");
  const scan = $("#scan");
  const add = { found: null, seq: 0 };

  const msg = (text) => ($("#scan-msg").textContent = text || "");

  function preview(book) {
    const box = $("#scan-preview");
    if (!book) { box.hidden = true; box.innerHTML = ""; return; }
    const bits = [book.publisher, book.publish_date, book.pages ? `${book.pages} pages` : null].filter(Boolean).join(" · ");
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
    preview(null);
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
        scan.focus();
      } else {
        dlg.close();
        toast(`Added ${saved.title}`);
      }
    } catch (err) {
      msg(err.message);
    }
  });
}

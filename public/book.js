// The book page: tap a book in the list to see every detail and fix any of it.
//
// It saves through PATCH /api/books/{id} and sends only the fields she
// changed, so the change log shows exactly what moved. Book details (title,
// authors, ISBN, publisher...) are shared by every copy of the same book;
// shelf details (status, list, shelf, dates, notes...) belong to this copy.

import { isbn13Valid, isbn10Valid, isbn10To13, isbn13To10 } from "./isbn.js";
import { parseTags, sameTags, wireTagBox } from "./tags.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Field name -> how it's read from the form. Every field on the page is here.
const TEXT = ["title", "subtitle", "publisher", "publish_date", "description", "shelf_location", "condition",
  "purchase_place", "review", "notes"];
const DATES = ["began_date", "completed_date", "review_date", "purchase_date", "added_date"];
const SELECTS = ["status_code", "list_code", "collection_id", "subcategory_id", "location_id"];

const page = { item: null, settings: null };

function options(items, valueKey, labelKey, current) {
  return items.map((i) => `<option value="${esc(i[valueKey])}" ${i[valueKey] === current ? "selected" : ""}>${esc(i[labelKey])}</option>`).join("");
}

// A date box. A date Libib kept in another shape (like 03/04/2024) shows as
// plain text, because a date picker would show it empty and Save would erase it.
function dateBox(it, name, label) {
  const v = it[name] ?? "";
  const iso = !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  return `<label>${label} <input ${iso ? 'type="date"' : 'autocomplete="off"'} name="${name}" value="${esc(v)}"></label>`;
}

// A menu where "None" is a real choice. A book can be in no subcategory or location.
function noneOptions(items, current) {
  return `<option value="">None</option>${options(items, "id", "name", current)}`;
}
// Her own fields, in the order she added them. Each box is named cf-<field id>.
export function customFieldsHtml(fields, custom) {
  if (!fields.length) return "";
  const box = (f) => {
    const name = `cf-${f.id}`;
    const v = esc(custom[f.id] ?? "");
    if (f.field_type === "yesno") {
      const opt = (val, label) => `<option value="${val}" ${(custom[f.id] ?? "") === val ? "selected" : ""}>${label}</option>`;
      return `<label>${esc(f.name)} <select name="${name}">${opt("", "Not set")}${opt("yes", "Yes")}${opt("no", "No")}</select></label>`;
    }
    if (f.field_type === "date") return `<label>${esc(f.name)} <input type="date" name="${name}" value="${v}"></label>`;
    if (f.field_type === "number") return `<label>${esc(f.name)} <input name="${name}" inputmode="decimal" value="${v}" autocomplete="off"></label>`;
    return `<label>${esc(f.name)} <input name="${name}" value="${v}" autocomplete="off" maxlength="1000"></label>`;
  };
  return `<h3>More details</h3>${fields.map(box).join("")}`;
}

// The fields she changed, as { field id: value } (null clears one), or { error }.
export function readCustom(form, fields, custom) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[`cf-${f.id}`];
    if (!el) continue;
    let v = String(el.value ?? "").trim();
    if (f.field_type === "number" && v) {
      const n = Number(v.replace(/^\$/, ""));
      if (!Number.isFinite(n)) return { error: `${f.name} needs to be a number.` };
      v = String(n);
    }
    if ((custom[f.id] ?? "") !== v) out[f.id] = v || null;
  }
  return { custom: out };
}

const subsFor = (s, collectionId) => (s.subcategories || []).filter((x) => x.collection_id === collectionId);

function coverBox(b) {
  return b.cover_url
    ? `<img class="cover" src="${esc(b.cover_url)}" alt="">`
    : `<div class="cover" aria-hidden="true">No cover</div>`;
}

function render() {
  const it = page.item;
  const s = page.settings;
  const v = (k) => esc(it[k] ?? "");
  $("#book-cover").innerHTML = coverBox(it);
  $("#book-cover-find").hidden = Boolean(it.cover_url);
  $("#book-cover-msg").textContent = "";
  $("#book-msg").textContent = "";
  $("#book-fields").innerHTML = `
    <label>Title <input name="title" required value="${v("title")}" autocomplete="off"></label>
    <label>Subtitle <input name="subtitle" value="${v("subtitle")}" autocomplete="off"></label>
    <label>Authors <textarea name="authors" rows="${Math.max(2, it.authors.length)}" placeholder="One author per line">${esc(it.authors.join("\n"))}</textarea></label>
    <div class="pair">
      <label>ISBN-13 <input name="isbn13" inputmode="numeric" value="${v("isbn13")}" autocomplete="off"></label>
      <label>ISBN-10 <input name="isbn10" value="${v("isbn10")}" autocomplete="off"></label>
    </div>
    <label>Publisher <input name="publisher" value="${v("publisher")}" autocomplete="off"></label>
    <div class="pair">
      <label>Published <input name="publish_date" value="${v("publish_date")}" placeholder="2017 or 2017-10-03" autocomplete="off"></label>
      <label>Pages <input name="pages" inputmode="numeric" value="${v("pages")}" autocomplete="off"></label>
    </div>
    <label>Description <textarea name="description" rows="4">${v("description")}</textarea></label>

    <h3>On the shelf</h3>
    <div class="pair">
      <label>Status <select name="status_code">${options(s.statuses, "code", "label", it.status_code)}</select></label>
      <label>List <select name="list_code">${options(s.lists, "code", "label", it.list_code)}</select></label>
    </div>
    <div class="pair">
      <label>Collection <select name="collection_id">${options(s.collections, "id", "name", it.collection_id)}</select></label>
      <label>Subcategory <select name="subcategory_id">${noneOptions(subsFor(s, it.collection_id), it.subcategory_id)}</select></label>
    </div>
    <div class="pair">
      <label>Location <select name="location_id">${noneOptions(s.locations || [], it.location_id)}</select></label>
      <label>Shelf <input name="shelf_location" value="${v("shelf_location")}" placeholder="Top shelf, left" autocomplete="off"></label>
    </div>
    <div class="pair">
      <label>Copies <input name="copies" inputmode="numeric" value="${v("copies")}" autocomplete="off"></label>
      <label>Condition <input name="condition" value="${v("condition")}" autocomplete="off"></label>
    </div>
    ${dateBox(it, "added_date", "Added")}
    <label>Tags <input name="tags" value="${esc(it.tags.join(", "))}" placeholder="Separate tags with commas" autocomplete="off"></label>
    <div id="book-tag-suggest" class="tag-suggest" aria-label="Tags you already use"></div>

    <h3>Reading</h3>
    <div class="pair">
      ${dateBox(it, "began_date", "Began")}
      ${dateBox(it, "completed_date", "Finished")}
    </div>
    <div class="pair">
      <label>Rating (0 to 5) <input name="rating" inputmode="decimal" value="${v("rating")}" autocomplete="off"></label>
      ${dateBox(it, "review_date", "Review date")}
    </div>
    <label>Review <textarea name="review" rows="3">${v("review")}</textarea></label>
    <label>Notes <textarea name="notes" rows="3">${v("notes")}</textarea></label>

    <h3>Bought</h3>
    <label>Where <input name="purchase_place" value="${v("purchase_place")}" autocomplete="off"></label>
    <div class="pair">
      ${dateBox(it, "purchase_date", "When")}
      <label>Price <input name="purchase_price" inputmode="decimal" value="${v("purchase_price")}" autocomplete="off"></label>
    </div>
    ${customFieldsHtml(s.custom_fields || [], it.custom || {})}`;
  wireTagBox($("#book-form").elements.tags, $("#book-tag-suggest"), () => s.tags || [])();
}

// Reads the form, checks it, and returns only what changed, or { error }.
export function readChanges(form, item, fields = []) {
  const val = (n) => String(form.elements[n].value ?? "").trim();
  const out = {};
  const errors = [];
  const set = (k, v) => { if ((item[k] ?? null) !== v) out[k] = v; };

  for (const k of [...TEXT, ...DATES, ...SELECTS]) set(k, val(k) || null);
  if (!val("title")) errors.push("A title is needed.");

  const authors = form.elements.authors.value.split("\n").map((a) => a.trim()).filter(Boolean);
  if (JSON.stringify(authors) !== JSON.stringify(item.authors)) out.authors = authors;
  const tags = parseTags(form.elements.tags.value);
  if (!sameTags(tags, item.tags || [])) out.tags = tags;

  // ISBNs: checked, never guessed. A valid ISBN-10 fills an empty ISBN-13 and the other way round.
  let i13 = val("isbn13").replace(/[^0-9]/g, "");
  let i10 = val("isbn10").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (i13 && !isbn13Valid(i13)) errors.push("That ISBN-13 isn't valid. Check the digits.");
  if (i10 && !isbn10Valid(i10)) errors.push("That ISBN-10 isn't valid. Check the digits.");
  if (!errors.length) {
    if (i10 && !i13) i13 = isbn10To13(i10);
    if (i13 && !i10) i10 = isbn13To10(i13) || "";
  }
  set("isbn13", i13 || null);
  set("isbn10", i10 || null);

  const number = (k, label, { whole = false, min = 0, max = Infinity } = {}) => {
    const t = val(k).replace(/^\$/, "");
    if (!t) return set(k, null);
    const n = Number(t);
    if (!Number.isFinite(n) || (whole && !Number.isInteger(n)) || n < min || n > max) {
      errors.push(`${label} needs to be ${whole ? "a whole number" : "a number"}${max < Infinity ? ` from ${min} to ${max}` : ""}.`);
      return;
    }
    set(k, n);
  };
  number("pages", "Pages", { whole: true, min: 1 });
  number("copies", "Copies", { whole: true, min: 1 });
  number("rating", "Rating", { max: 5 });
  number("purchase_price", "Price");
  if (!val("copies")) delete out.copies; // copies can't be empty; leaving it blank keeps what's there

  const c = readCustom(form, fields, item.custom || {});
  if (c.error) errors.push(c.error);
  else if (Object.keys(c.custom).length) out.custom = c.custom;

  if (errors.length) return { error: errors.join(" ") };
  return { changes: out };
}

export function openBook(item, settings) {
  page.item = item;
  page.settings = settings;
  render();
  $("#book-dialog").showModal();
  $("#book-dialog").scrollTop = 0;
}

export function wireBook({ api, toast, onChange }) {
  const dlg = $("#book-dialog");
  const form = $("#book-form");

  // Enter in a one-line box shouldn't save the whole page by surprise.
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && !e.isComposing) e.preventDefault();
  });

  $("#book-cancel").addEventListener("click", () => dlg.close());

  // Each collection has its own subcategories, so the menu follows the collection.
  form.addEventListener("change", (e) => {
    if (e.target.name !== "collection_id") return;
    const sub = form.elements.subcategory_id;
    const keep = sub.value;
    const subs = subsFor(page.settings, e.target.value);
    sub.innerHTML = noneOptions(subs, subs.some((x) => x.id === keep) ? keep : "");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error, changes } = readChanges(form, page.item, page.settings.custom_fields || []);
    if (error) { $("#book-msg").textContent = error; return; }
    if (!Object.keys(changes).length) { dlg.close(); return; }
    const btn = $("#book-save");
    btn.disabled = true;
    $("#book-msg").textContent = "Saving...";
    try {
      page.item = await api(`/api/books/${page.item.id}`, { method: "PATCH", body: changes });
      dlg.close();
      toast(`Saved ${page.item.title}`);
      await onChange();
    } catch (err) {
      $("#book-msg").textContent = `Couldn't save: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  $("#book-remove").addEventListener("click", async () => {
    const { id, title } = page.item;
    try {
      await api(`/api/books/${id}`, { method: "DELETE" });
      dlg.close();
      await onChange();
      toast(`Removed ${title}`, async () => {
        await api(`/api/books/${id}/restore`, { method: "POST" });
        await onChange();
      });
    } catch (err) {
      $("#book-msg").textContent = `Couldn't remove: ${err.message}`;
    }
  });

  // Cover from Open Library by ISBN. Uses what's typed in the ISBN boxes, so
  // she can add an ISBN and find the cover in one go; both save with Save.
  $("#book-cover-find").addEventListener("click", async () => {
    const msg = $("#book-cover-msg");
    let i13 = form.elements.isbn13.value.replace(/[^0-9]/g, "");
    const i10 = form.elements.isbn10.value.replace(/[^0-9Xx]/g, "").toUpperCase();
    if (!isbn13Valid(i13) && isbn10Valid(i10)) i13 = isbn10To13(i10);
    if (!isbn13Valid(i13)) { msg.textContent = "Add a valid ISBN first, then find the cover."; return; }
    msg.textContent = "Looking on Open Library...";
    try {
      const got = await api(`/api/covers?isbn=${i13}`);
      if (!got[i13]) { msg.textContent = "Open Library has no cover for that ISBN."; return; }
      const saved = await api(`/api/books/${page.item.id}`, { method: "PATCH", body: { cover_url: got[i13] } });
      page.item.cover_url = saved.cover_url;
      $("#book-cover").innerHTML = coverBox(saved);
      $("#book-cover-find").hidden = true;
      const typed = i13 !== (page.item.isbn13 || "");
      msg.textContent = typed ? "Cover saved. Tap Save to keep the ISBN too." : "Cover saved.";
      await onChange();
    } catch (err) {
      msg.textContent = `Couldn't get a cover just now: ${err.message}`;
    }
  });
}

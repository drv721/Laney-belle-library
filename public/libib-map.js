// Turns one Libib collection export (CSV text) into rows the app can import.
// It runs in the browser, so a big file never costs the Worker any time.
// It writes nothing. Weekend 2's import screen calls it, shows her the result,
// and only saves after she approves.
//
// The column names below come from Melanie's real Libib export (Nov 2026),
// plus the older names in Libib's published import template. Any header not
// listed here is kept in the raw row and reported.

import { isbn13Valid, isbn10Valid, isbn10To13 } from "./isbn.js";

const STATUS_BY_LABEL = {
  "not begun": "not_begun",
  "in progress": "in_progress",
  "completed": "completed",
  "abandoned": "abandoned",
};

// Libib header -> what we do with it.
const COLUMNS = {
  title: "book.title",
  creators: "book.authors",
  ean_isbn13: "book.isbn13",
  upc_isbn10: "book.isbn10",
  publisher: "book.publisher",
  publish_date: "book.publish_date",
  description: "book.description",
  length: "book.pages",
  length_of: "book.pages",
  status: "item.status_code",
  rating: "item.rating",
  review: "item.review",
  review_date: "item.review_date",
  notes: "item.notes",
  began: "item.began_date",
  completed: "item.completed_date",
  began_date: "item.began_date",
  completed_date: "item.completed_date",
  added: "item.added_date",
  copies: "item.copies",
  price: "item.purchase_price",
  tags: "tags",
  group: "group",
  // Kept in the raw row only. first_name and last_name repeat the first
  // author; collection is Libib's own collection name.
  id: "raw",
  item_type: "raw",
  first_name: "raw",
  last_name: "raw",
  collection: "raw",
  // Video, music and game fields.
  number_of_discs: "raw",
  number_of_players: "raw",
  age_group: "raw",
  ensemble: "raw",
  aspect_ratio: "raw",
  esrb: "raw",
};

// The two names a column can go by; the first one present in the file wins.
const ALIASES = { length: "length_of", began: "began_date", completed: "completed_date" };

export function normalizeHeader(h) {
  return String(h).replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// Keeps YYYY-MM-DD, YYYY-MM or YYYY as they are; anything else is kept
// as written and flagged, so nothing is guessed.
function cleanDate(v, field, warnings) {
  const t = v.trim();
  if (!t) return null;
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(t)) return t;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T]/);
  if (m) return m[1];
  warnings.push(`${field}: kept "${t}" as written`);
  return t;
}

function num(v, field, warnings, { int = false } = {}) {
  const t = v.trim().replace(/^\$/, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) {
    warnings.push(`${field}: "${v}" isn't a number, left empty`);
    return null;
  }
  return n;
}

function splitList(v, sep) {
  return v.split(sep).map((s) => s.trim()).filter(Boolean);
}

// Libib's export puts several authors in one cell as "First Last, First Last".
// A part like "PhD" or "Jr." belongs to the name before it. When the cell is
// exactly "Last, First" for the author in first_name and last_name, it's one
// person. A cell with a semicolon, or a part that starts in lower case, was
// jumbled in Libib, so it's split as well as it can be and flagged.
const SUFFIX = /^(ph\.?\s?d\.?|m\.?d\.?|jr\.?|sr\.?|ii|iii|iv|esq\.?|psy\.?d\.?|ed\.?d\.?|lcsw|lmft|rn)$/i;
export function splitAuthors(cell, first = "", last = "", warnings = []) {
  const v = cell.trim();
  if (!v) return [];
  if (first.trim() && last.trim() && v === `${last.trim()}, ${first.trim()}`) return [`${first.trim()} ${last.trim()}`];
  const names = [];
  for (const part of splitList(v, v.includes(";") ? ";" : ",")) {
    if (names.length && SUFFIX.test(part)) names[names.length - 1] += `, ${part}`;
    else names.push(part);
  }
  if (v.includes(";") || names.some((n) => /^\p{Ll}/u.test(n))) {
    warnings.push(`creators: "${v}" looks jumbled in Libib, check the authors after import`);
  }
  return names.slice(0, 20);
}

export function duplicateKey(book) {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  const t = (book.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = (book.authors[0] || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `title:${t}|${a}`;
}

// Looser than duplicateKey: the same title where one copy has no ISBN or no
// author, or both have the same first author. Two copies with different
// ISBNs are two editions and don't match. The screen shows these as
// "might be the same book" for her to decide; nothing is skipped for them.
export function titleKey(book) {
  return (book.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function mightBeSame(a, b) {
  if (!titleKey(a) || titleKey(a) !== titleKey(b)) return false;
  if (a.isbn13 && b.isbn13) return false;
  const first = (x) => (x.authors?.[0] || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return !first(a) || !first(b) || first(a) === first(b);
}

export function mapLibibCsv(text, { fileName = "" } = {}) {
  const table = parseCsv(text);
  if (!table.length) return { fileName, rows: [], unknownHeaders: [], missingHeaders: Object.keys(COLUMNS), duplicates: [] };

  const headers = table[0].map(normalizeHeader);
  const unknownHeaders = headers.filter((h) => h && !(h in COLUMNS));
  const older = new Set(Object.values(ALIASES));
  const missingHeaders = Object.keys(COLUMNS)
    .filter((h) => !older.has(h) && !headers.includes(h) && !headers.includes(ALIASES[h]));

  const rows = table.slice(1).map((cells, i) => {
    const raw = {};
    headers.forEach((h, j) => { raw[table[0][j].trim() || `column_${j + 1}`] = cells[j] ?? ""; });
    const get = (h) => {
      let j = headers.indexOf(h);
      if (j < 0 && ALIASES[h]) j = headers.indexOf(ALIASES[h]);
      return j < 0 ? "" : (cells[j] ?? "");
    };
    const warnings = [];

    const book = { title: get("title").trim(), authors: [], isbn13: null, isbn10: null, publisher: null, publish_date: null, description: null, pages: null, source: "libib" };
    const item = { status_code: "not_begun", rating: null, review: null, review_date: null, notes: null, began_date: null, completed_date: null, added_date: null, copies: 1, purchase_price: null };

    book.authors = splitAuthors(get("creators"), get("first_name"), get("last_name"), warnings);

    const e13 = get("ean_isbn13").replace(/[^0-9]/g, "");
    const u10 = get("upc_isbn10").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (e13) {
      if (isbn13Valid(e13)) book.isbn13 = e13;
      // Libib sometimes holds an ISBN-10 in the ISBN-13 column.
      else if (e13.length === 10 && isbn10Valid(e13)) { book.isbn10 = e13; book.isbn13 = isbn10To13(e13); }
      else warnings.push(`ean_isbn13: "${get("ean_isbn13")}" isn't a valid ISBN`);
    }
    if (u10 && u10 !== book.isbn10) {
      if (isbn10Valid(u10)) {
        book.isbn10 = u10;
        if (!book.isbn13) book.isbn13 = isbn10To13(u10);
      } else warnings.push(`upc_isbn10: "${get("upc_isbn10")}" isn't a valid ISBN-10, kept in the original row only`);
    }

    book.publisher = get("publisher").trim() || null;
    book.publish_date = cleanDate(get("publish_date"), "publish_date", warnings);
    book.description = get("description").trim() || null;
    book.pages = num(get("length"), "length", warnings, { int: true });

    const st = get("status").trim();
    if (st) {
      const code = STATUS_BY_LABEL[st.toLowerCase()];
      if (code) item.status_code = code;
      else warnings.push(`status: "${st}" isn't one of Libib's four, set to Not begun`);
    }
    item.rating = num(get("rating"), "rating", warnings);
    item.review = get("review").trim() || null;
    item.review_date = cleanDate(get("review_date"), "review_date", warnings);
    item.notes = get("notes").trim() || null;
    item.began_date = cleanDate(get("began"), "began", warnings);
    item.completed_date = cleanDate(get("completed"), "completed", warnings);
    item.added_date = cleanDate(get("added"), "added", warnings);
    const copies = num(get("copies"), "copies", warnings, { int: true });
    if (copies && copies > 0) item.copies = copies;
    item.purchase_price = num(get("price"), "price", warnings);

    const tags = get("tags").trim() ? splitList(get("tags"), ",") : [];
    const group = get("group").trim() || null;

    if (!book.title) warnings.push("title: empty, this row needs a look before import");

    return { rowNumber: i + 2, book, item, tags, group, raw, warnings };
  });

  const byKey = new Map();
  for (const r of rows) {
    const k = duplicateKey(r.book);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r.rowNumber);
  }
  const duplicates = [...byKey.entries()].filter(([, n]) => n.length > 1).map(([key, rowNumbers]) => ({ key, rowNumbers }));

  return { fileName, rows, unknownHeaders, missingHeaders, duplicates };
}

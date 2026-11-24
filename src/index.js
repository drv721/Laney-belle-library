// Melanie's library: one Worker that serves the app and its /api.
// Data lives in D1. The phone, iPad and desktop only show what D1 holds.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { backupToR2 } from "./backup.js";
import { lookupCovers, lookupBook, searchBooks, isCoverUrl, MAX_ISBNS_PER_CALL } from "./covers.js";
import { readScan } from "../public/isbn.js";
import { libraryKeys, startImport, importRows, listImports, undoImport } from "./import.js";
import { sortByAuthor } from "./sort.js";
import { KINDS, listStatement, createSection, renameSection, setSectionDeleted, checkSections, bulkSet } from "./sections.js";
import { cleanTags, setTagStatements, bulkTag } from "./tags.js";
import { libraryStats } from "./stats.js";
import { setSpots } from "./shelf.js";
import { addPictures, getPicture } from "./pictures.js";
import {
  fieldsStatement, createField, renameField, setFieldDeleted, customValueStatements,
  statusesStatement, createStatus, renameStatus, setStatusDeleted, statusIsLive,
} from "./fields.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (status, message) => json({ error: message }, status);
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

// ---------- sign-in ----------
// Cloudflare Access sits in front of the whole Worker. With static assets the
// Worker doesn't get ctx.access, so it checks Access's signed token itself,
// then checks the email is one of the two allowed.

let jwks;
async function whoIsThis(request, env) {
  const host = new URL(request.url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (env.AUTH_MODE === "dev" && isLocal) return env.DEV_EMAIL || "dev@localhost";

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.POLICY_AUD || !env.TEAM_DOMAIN) return null;
  try {
    jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isAllowed(email, env) {
  const allowed = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(email);
}

// ---------- change log ----------
function logChange(env, by, entity, entityId, action, before, after) {
  return env.DB.prepare(
    `INSERT INTO change_log (by_email, entity, entity_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    by,
    entity,
    entityId,
    action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null
  );
}

// ---------- reading ----------
const ITEM_SELECT = `
  SELECT s.*, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
         b.publish_date, b.pages, b.cover_url, b.description, b.source,
         b.spine_url, b.spine_ratio, b.spine_tall,
         (SELECT json_group_array(t.name) FROM shelf_item_tags st
            JOIN tags t ON t.id = st.tag_id WHERE st.shelf_item_id = s.id) AS tags,
         (SELECT json_group_object(cv.field_id, cv.value) FROM custom_values cv
            JOIN custom_fields cf ON cf.id = cv.field_id AND cf.deleted_at IS NULL
           WHERE cv.shelf_item_id = s.id) AS custom,
         sc.name AS subcategory, lo.name AS location, lo.shelf_word AS shelf_word
  FROM shelf_items s JOIN books b ON b.id = s.book_id
  LEFT JOIN subcategories sc ON sc.id = s.subcategory_id AND sc.deleted_at IS NULL
  LEFT JOIN locations lo ON lo.id = s.location_id AND lo.deleted_at IS NULL`;

function shapeItem(row) {
  if (!row) return row;
  return {
    ...row,
    authors: safeParse(row.authors, []),
    tags: safeParse(row.tags, []),
    // Her own fields: { field id: value }, only the ones with something in them.
    custom: safeParse(row.custom, {}) || {},
    // A removed subcategory or location reads as none until Undo brings it back.
    subcategory_id: row.subcategory ? row.subcategory_id : null,
    location_id: row.location ? row.location_id : null,
  };
}
function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function getItem(env, id) {
  const row = await env.DB.prepare(`${ITEM_SELECT} WHERE s.id = ?`).bind(id).first();
  return shapeItem(row);
}

// Sort choices for the list. Only these strings ever reach ORDER BY.
// Author is sorted after the query, by last name (see authorKey).
const SORTS = {
  title: "b.title COLLATE NOCASE, s.id",
  added: "(s.added_date IS NULL), s.added_date DESC, s.created_at DESC, s.id",
  status: "(SELECT sort_order FROM statuses WHERE code = s.status_code), b.title COLLATE NOCASE, s.id",
  // Books with none set go last.
  subcategory: "(sc.name IS NULL), sc.sort_order, sc.name COLLATE NOCASE, b.title COLLATE NOCASE, s.id",
  // Then by row and spot, so a sort by location reads like the shelves do.
  location: "(lo.name IS NULL), lo.sort_order, lo.name COLLATE NOCASE, (s.shelf_row IS NULL), s.shelf_row, (s.shelf_pos IS NULL), s.shelf_pos, b.title COLLATE NOCASE, s.id",
};

async function listItems(env, url) {
  const showDeleted = url.searchParams.get("deleted") === "1";
  const q = (url.searchParams.get("q") || "").trim();
  const where = [showDeleted ? "s.deleted_at IS NOT NULL" : "s.deleted_at IS NULL"];
  const binds = [];
  if (q) {
    where.push("(b.title LIKE ? OR b.authors LIKE ? OR b.isbn13 = ? OR b.isbn10 = ?)");
    binds.push(`%${q}%`, `%${q}%`, q, q);
  }
  for (const [param, col] of [
    ["status", "s.status_code"],
    ["list", "s.list_code"],
    ["collection", "s.collection_id"],
  ]) {
    const v = url.searchParams.get(param);
    if (v) {
      where.push(`${col} = ?`);
      binds.push(v);
    }
  }
  // Subcategory and location: an id, or "none" for books not given one yet.
  for (const [param, k] of [["subcategory", KINDS.subcategories], ["location", KINDS.locations]]) {
    const v = url.searchParams.get(param);
    if (v === "none") {
      where.push(`NOT EXISTS (SELECT 1 FROM ${k.table} x WHERE x.id = s.${k.column} AND x.deleted_at IS NULL)`);
    } else if (v) {
      where.push(`s.${k.column} = ?`);
      binds.push(v);
    }
  }
  const tag = (url.searchParams.get("tag") || "").trim();
  if (tag) {
    where.push(
      "EXISTS (SELECT 1 FROM shelf_item_tags st JOIN tags t ON t.id = st.tag_id WHERE st.shelf_item_id = s.id AND t.name = ? COLLATE NOCASE)"
    );
    binds.push(tag);
  }
  const order = SORTS[url.searchParams.get("sort")] || SORTS.title;
  const { results } = await env.DB.prepare(
    `${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order}`
  )
    .bind(...binds)
    .all();
  const items = results.map(shapeItem);
  if (url.searchParams.get("sort") === "author") sortByAuthor(items);
  return items;
}

// ---------- writing ----------
const BOOK_FIELDS = [
  "isbn13", "isbn10", "title", "subtitle", "authors", "publisher",
  "publish_date", "pages", "cover_url", "description",
];
const ITEM_FIELDS = [
  "collection_id", "list_code", "status_code", "rating", "review", "review_date",
  "notes", "began_date", "completed_date", "added_date", "copies", "shelf_location",
  "condition", "purchase_place", "purchase_date", "purchase_price",
  "subcategory_id", "location_id",
];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (f in obj) out[f] = obj[f];
  if ("authors" in out && Array.isArray(out.authors)) out.authors = JSON.stringify(out.authors);
  return out;
}

async function addBook(env, by, body) {
  const book = pick(body, BOOK_FIELDS);
  if (!book.title || !String(book.title).trim()) return fail(400, "A title is needed.");
  book.title = String(book.title).trim();
  if (!book.authors) book.authors = "[]";
  // Only Open Library cover addresses are kept, so the app never loads images from elsewhere.
  if ("cover_url" in book && !isCoverUrl(book.cover_url)) delete book.cover_url;
  const source = body.source === "openlibrary" ? "openlibrary" : "manual";

  // A book added with an ISBN gets its cover from Open Library. If that
  // lookup fails, the book still saves without a cover.
  if (!book.cover_url && typeof book.isbn13 === "string" && /^\d{13}$/.test(book.isbn13)) {
    try {
      const found = await lookupCovers(env, [book.isbn13]);
      if (found[book.isbn13]) book.cover_url = found[book.isbn13];
    } catch (err) {
      console.error("cover lookup", err);
    }
  }

  const bookId = newId();
  const itemId = newId();
  const item = pick(body, ITEM_FIELDS);
  item.added_date ??= now().slice(0, 10);
  if ("status_code" in item && !(await statusIsLive(env, item.status_code))) return fail(400, "That status isn't on the menu any more.");
  const sectionError = await checkSections(env, item, { collection_id: item.collection_id ?? "default" });
  if (sectionError) return fail(400, sectionError);
  let tags = [];
  if ("tags" in body) {
    const t = cleanTags(body.tags);
    if (t.error) return fail(400, t.error);
    tags = t.tags;
  }

  const bCols = Object.keys(book);
  const iCols = Object.keys(item);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO books (id, source, ${bCols.join(", ")}) VALUES (?, ?, ${bCols.map(() => "?").join(", ")})`
    ).bind(bookId, source, ...bCols.map((c) => book[c])),
    env.DB.prepare(
      `INSERT INTO shelf_items (id, book_id, created_by, updated_by${iCols.map((c) => ", " + c).join("")})
       VALUES (?, ?, ?, ?${iCols.map(() => ", ?").join("")})`
    ).bind(itemId, bookId, by, by, ...iCols.map((c) => item[c])),
    ...(tags.length ? setTagStatements(env, itemId, tags) : []),
  ];
  await env.DB.batch(stmts);
  const created = await getItem(env, itemId);
  await logChange(env, by, "shelf_item", itemId, "create", null, created).run();
  return json(created, 201);
}

async function updateItem(env, by, id, body) {
  const before = await getItem(env, id);
  if (!before) return fail(404, "No such book.");
  // The book page sends only what changed. These checks keep a bad edit
  // from blanking a title or pointing a cover anywhere but Open Library.
  if ("authors" in body && !(Array.isArray(body.authors) && body.authors.every((a) => typeof a === "string"))) {
    return fail(400, "Authors need to be a list of names.");
  }
  const book = pick(body, BOOK_FIELDS);
  const item = pick(body, ITEM_FIELDS);
  if ("title" in book) {
    book.title = String(book.title ?? "").trim();
    if (!book.title) return fail(400, "A title is needed.");
  }
  if ("cover_url" in book && book.cover_url !== null && !isCoverUrl(book.cover_url)) {
    return fail(400, "Covers can only come from Open Library.");
  }
  if ("copies" in item && !(Number.isInteger(item.copies) && item.copies >= 1)) {
    return fail(400, "Copies needs to be a whole number, 1 or more.");
  }
  const sectionError = await checkSections(env, item, before);
  if (sectionError) return fail(400, sectionError);
  if ("status_code" in item && !(await statusIsLive(env, item.status_code))) return fail(400, "That status isn't on the menu any more.");
  let customStmts = [];
  if ("custom" in body) {
    const c = await customValueStatements(env, id, body.custom);
    if (c.error) return fail(400, c.error);
    customStmts = c.stmts;
  }
  let tags = null;
  if ("tags" in body) {
    const t = cleanTags(body.tags);
    if (t.error) return fail(400, t.error);
    tags = t.tags;
  }
  const stmts = [];
  if (Object.keys(book).length) {
    const cols = Object.keys(book);
    stmts.push(
      env.DB.prepare(
        `UPDATE books SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`
      ).bind(...cols.map((c) => book[c]), now(), before.book_id)
    );
  }
  if (Object.keys(item).length) {
    const cols = Object.keys(item);
    stmts.push(
      env.DB.prepare(
        `UPDATE shelf_items SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`
      ).bind(...cols.map((c) => item[c]), now(), by, id)
    );
  }
  if (tags) stmts.push(...setTagStatements(env, id, tags));
  stmts.push(...customStmts);
  if ((tags || customStmts.length) && !Object.keys(item).length) {
    stmts.push(env.DB.prepare("UPDATE shelf_items SET updated_at = ?, updated_by = ? WHERE id = ?").bind(now(), by, id));
  }
  if (!stmts.length) return fail(400, "Nothing to change.");
  await env.DB.batch(stmts);
  const after = await getItem(env, id);
  await logChange(env, by, "shelf_item", id, "update", before, after).run();
  return json(after);
}

async function setDeleted(env, by, id, deleted) {
  const before = await getItem(env, id);
  if (!before) return fail(404, "No such book.");
  await env.DB.prepare(
    `UPDATE shelf_items SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  )
    .bind(deleted ? now() : null, now(), by, id)
    .run();
  const after = await getItem(env, id);
  await logChange(env, by, "shelf_item", id, deleted ? "delete" : "restore", before, after).run();
  return json(after);
}

// ---------- export (rule one: a copy in her hands) ----------
const CSV_COLUMNS = [
  "title", "subtitle", "authors", "isbn13", "isbn10", "publisher", "publish_date",
  "pages", "status", "list", "collection", "rating", "review", "notes", "began_date",
  "completed_date", "added_date", "copies", "shelf_location", "condition",
  "purchase_place", "purchase_date", "purchase_price", "tags",
  "subcategory", "location",
  // For matching her row photos to her copies: which copy, its pictures and its spot.
  "id", "cover_url", "spine_url", "shelf_row", "shelf_pos",
];
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv(env) {
  const { results } = await env.DB.prepare(
    `${ITEM_SELECT.replace(
      "FROM shelf_items s",
      ", st.label AS status, l.label AS list, c.name AS collection FROM shelf_items s"
    )}
     JOIN statuses st ON st.code = s.status_code
     JOIN lists l ON l.code = s.list_code
     JOIN collections c ON c.id = s.collection_id
     WHERE s.deleted_at IS NULL ORDER BY b.title COLLATE NOCASE`
  ).all();
  // Her own fields go after the standard columns, under the names she gave them.
  const { results: fields } = await fieldsStatement(env).all();
  const lines = [[...CSV_COLUMNS, ...fields.map((f) => csvCell(f.name))].join(",")];
  for (const r of results.map(shapeItem)) {
    lines.push([...CSV_COLUMNS.map((c) => csvCell(r[c])), ...fields.map((f) => csvCell(r.custom[f.id]))].join(","));
  }
  const day = now().slice(0, 10);
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="library-${day}.csv"`,
    },
  });
}

// ---------- router ----------
async function handleApi(request, env) {
  const url = new URL(request.url);
  const email = await whoIsThis(request, env);
  if (!email) return fail(401, "Not signed in.");
  if (!isAllowed(email, env)) return fail(403, "This account isn't on the list.");

  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const body = ["POST", "PATCH", "PUT"].includes(method)
    ? await request.json().catch(() => ({}))
    : {};

  if (path === "/api/me" && method === "GET") return json({ email });

  if (path === "/api/settings" && method === "GET") {
    const [statuses, lists, collections, fields, tags, subcategories, locations] = await env.DB.batch([
      statusesStatement(env),
      env.DB.prepare("SELECT * FROM lists ORDER BY sort_order"),
      env.DB.prepare(
        "SELECT c.*, (SELECT COUNT(*) FROM shelf_items s WHERE s.collection_id = c.id AND s.deleted_at IS NULL) AS count " +
        "FROM collections c ORDER BY c.sort_order"
      ),
      fieldsStatement(env),
      env.DB.prepare(
        "SELECT t.name, COUNT(s.id) AS count FROM tags t JOIN shelf_item_tags st ON st.tag_id = t.id " +
        "JOIN shelf_items s ON s.id = st.shelf_item_id AND s.deleted_at IS NULL GROUP BY t.id ORDER BY t.name COLLATE NOCASE"
      ),
      listStatement(env, "subcategories"),
      listStatement(env, "locations"),
    ]);
    return json({
      statuses: statuses.results,
      lists: lists.results,
      collections: collections.results,
      custom_fields: fields.results,
      tags: tags.results,
      subcategories: subcategories.results,
      locations: locations.results,
    });
  }

  if (path === "/api/stats" && method === "GET") return json(await libraryStats(env));

  // Statuses and her own fields: add, rename, remove (hide) and bring back.
  let m = path.match(/^\/api\/statuses(?:\/([a-z0-9_]{1,40})(\/restore)?)?$/);
  if (m) {
    const [, code, restore] = m;
    let r;
    if (!code && method === "POST") r = await createStatus(env, email, body, logChange);
    else if (code && !restore && method === "PATCH") r = await renameStatus(env, email, code, body, logChange);
    else if (code && !restore && method === "DELETE") r = await setStatusDeleted(env, email, code, true, logChange);
    else if (code && restore && method === "POST") r = await setStatusDeleted(env, email, code, false, logChange);
    if (r) return json(r.data, r.status);
  }
  m = path.match(/^\/api\/fields(?:\/([0-9a-f-]{36})(\/restore)?)?$/);
  if (m) {
    const [, id, restore] = m;
    let r;
    if (!id && method === "POST") r = await createField(env, email, body, logChange);
    else if (id && !restore && method === "PATCH") r = await renameField(env, email, id, body, logChange);
    else if (id && !restore && method === "DELETE") r = await setFieldDeleted(env, email, id, true, logChange);
    else if (id && restore && method === "POST") r = await setFieldDeleted(env, email, id, false, logChange);
    if (r) return json(r.data, r.status);
  }

  // Subcategories and locations: add, rename, remove (hide) and bring back.
  m = path.match(/^\/api\/(subcategories|locations)(?:\/([A-Za-z0-9-]{1,40})(\/restore)?)?$/);
  if (m) {
    const [, kind, id, restore] = m;
    let r;
    if (!id && method === "POST") r = await createSection(env, email, kind, body, logChange);
    else if (id && !restore && method === "PATCH") r = await renameSection(env, email, kind, id, body, logChange);
    else if (id && !restore && method === "DELETE") r = await setSectionDeleted(env, email, kind, id, true, logChange);
    else if (id && restore && method === "POST") r = await setSectionDeleted(env, email, kind, id, false, logChange);
    if (r) return json(r.data, r.status);
  }

  // One tag on or off several books at once.
  if (path === "/api/books/tags" && method === "POST") {
    const r = await bulkTag(env, email, body || {});
    return json(r.data, r.status);
  }

  // Several books at once: subcategory and location.
  if (path === "/api/books/bulk" && method === "POST") {
    const r = await bulkSet(env, email, body);
    return json(r.data, r.status);
  }

  // The shelf scan: where each copy sits (location, row, spot on the row).
  if (path === "/api/books/spots" && method === "POST") {
    const r = await setSpots(env, email, body);
    return json(r.data, r.status);
  }

  // Spine pictures and cover photos, from a file made from her row photos.
  if (path === "/api/pictures" && method === "POST") {
    const r = await addPictures(env, email, body);
    return json(r.data, r.status);
  }
  m = path.match(/^\/api\/pictures\/(spine|cover)\/([A-Za-z0-9-]{1,40})\.jpg$/);
  if (m && method === "GET") return getPicture(env, m[1], m[2]);

  if (path === "/api/books" && method === "GET") return json(await listItems(env, url));
  if (path === "/api/books" && method === "POST") return addBook(env, email, body);
  if (path === "/api/export.csv" && method === "GET") return exportCsv(env);

  // Covers for up to 25 ISBN-13s at a time: /api/covers?isbn=978...,978...
  if (path === "/api/covers" && method === "GET") {
    const isbns = (url.searchParams.get("isbn") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (isbns.length > MAX_ISBNS_PER_CALL) return fail(400, `Ask for ${MAX_ISBNS_PER_CALL} at most.`);
    try {
      return json(await lookupCovers(env, isbns));
    } catch (err) {
      console.error("covers", err);
      return fail(502, "Covers aren't available right now. The import still works without them.");
    }
  }

  // Scan-to-add: /api/lookup?isbn=... gives the book's details from Open
  // Library and any copies already in the library. It saves nothing.
  if (path === "/api/lookup" && method === "GET") {
    const scan = readScan(url.searchParams.get("isbn"));
    if (scan.kind !== "isbn") return fail(400, scan.message || "Type the whole ISBN.");
    const { results } = await env.DB.prepare(
      `SELECT s.id, b.title, l.label AS list, st.label AS status
         FROM shelf_items s JOIN books b ON b.id = s.book_id
         JOIN lists l ON l.code = s.list_code JOIN statuses st ON st.code = s.status_code
        WHERE s.deleted_at IS NULL AND (b.isbn13 = ? OR b.isbn10 = ?)`
    ).bind(scan.isbn13, scan.isbn10 ?? "").all();
    let found = null;
    let lookupFailed = false;
    try {
      found = await lookupBook(env, scan.isbn13);
    } catch (err) {
      console.error("lookup", err);
      lookupFailed = true;
    }
    return json({ isbn13: scan.isbn13, isbn10: scan.isbn10, book: found, lookup_failed: lookupFailed, in_library: results });
  }

  // Title search, for books with no barcode: /api/search?title=...&author=...
  // gives Open Library's matches, each with any copies already in the library
  // under the same title. It saves nothing.
  if (path === "/api/search" && method === "GET") {
    const title = (url.searchParams.get("title") || "").trim().slice(0, 200);
    const author = (url.searchParams.get("author") || "").trim().slice(0, 200);
    if (title.length < 2) return fail(400, "Type at least part of the title.");
    let results = [];
    let searchFailed = false;
    try {
      results = await searchBooks(env, title, author);
    } catch (err) {
      console.error("search", err);
      searchFailed = true;
    }
    const titles = [...new Set([title, ...results.map((r) => r.title)].map((t) => t.toLowerCase()))];
    const { results: have } = await env.DB.prepare(
      `SELECT lower(b.title) AS t, s.id, b.title, l.label AS list, st.label AS status
         FROM shelf_items s JOIN books b ON b.id = s.book_id
         JOIN lists l ON l.code = s.list_code JOIN statuses st ON st.code = s.status_code
        WHERE s.deleted_at IS NULL AND lower(b.title) IN (${titles.map(() => "?").join(", ")})`
    ).bind(...titles).all();
    const copies = (t) => have.filter((h) => h.t === t.toLowerCase()).map(({ id, title, list, status }) => ({ id, title, list, status }));
    return json({
      results: results.map((r) => ({ ...r, in_library: copies(r.title) })),
      typed_in_library: copies(title),
      search_failed: searchFailed,
    });
  }

  // Imports
  if (path === "/api/import/keys" && method === "GET") return json(await libraryKeys(env));
  if (path === "/api/import/start" && method === "POST") {
    const r = await startImport(env, email, body);
    return json(r.data, r.status);
  }
  if (path === "/api/import/rows" && method === "POST") {
    const r = await importRows(env, email, body);
    return json(r.data, r.status);
  }
  if (path === "/api/imports" && method === "GET") return json(await listImports(env));
  m = path.match(/^\/api\/imports\/([0-9a-f-]{36})\/undo$/);
  if (m && method === "POST") {
    const r = await undoImport(env, email, m[1]);
    return json(r.data, r.status);
  }

  m = path.match(/^\/api\/books\/([0-9a-f-]{36})(\/restore)?$/);
  if (m) {
    const [, id, restore] = m;
    if (restore && method === "POST") return setDeleted(env, email, id, false);
    if (!restore && method === "GET") {
      const item = await getItem(env, id);
      return item ? json(item) : fail(404, "No such book.");
    }
    if (!restore && method === "PATCH") return updateItem(env, email, id, body);
    if (!restore && method === "DELETE") return setDeleted(env, email, id, true);
  }

  return fail(404, "Unknown request.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        console.error(err);
        return fail(500, "Something went wrong. Try again.");
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(backupToR2(env));
  },
};

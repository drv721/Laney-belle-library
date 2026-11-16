// Melanie's library: one Worker that serves the app and its /api.
// Data lives in D1. The phone, iPad and desktop only show what D1 holds.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { backupToR2 } from "./backup.js";
import { lookupCovers, lookupBook, searchBooks, isCoverUrl, MAX_ISBNS_PER_CALL } from "./covers.js";
import { readScan } from "../public/isbn.js";
import { libraryKeys, startImport, importRows, listImports, undoImport } from "./import.js";

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
         (SELECT json_group_array(t.name) FROM shelf_item_tags st
            JOIN tags t ON t.id = st.tag_id WHERE st.shelf_item_id = s.id) AS tags
  FROM shelf_items s JOIN books b ON b.id = s.book_id`;

function shapeItem(row) {
  if (!row) return row;
  return {
    ...row,
    authors: safeParse(row.authors, []),
    tags: safeParse(row.tags, []),
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
  const { results } = await env.DB.prepare(
    `${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY b.title COLLATE NOCASE`
  )
    .bind(...binds)
    .all();
  return results.map(shapeItem);
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
  ];
  await env.DB.batch(stmts);
  const created = await getItem(env, itemId);
  await logChange(env, by, "shelf_item", itemId, "create", null, created).run();
  return json(created, 201);
}

async function updateItem(env, by, id, body) {
  const before = await getItem(env, id);
  if (!before) return fail(404, "No such book.");
  const book = pick(body, BOOK_FIELDS);
  const item = pick(body, ITEM_FIELDS);
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
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of results.map(shapeItem)) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
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
    const [statuses, lists, collections, fields] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM statuses ORDER BY sort_order"),
      env.DB.prepare("SELECT * FROM lists ORDER BY sort_order"),
      env.DB.prepare("SELECT * FROM collections ORDER BY sort_order"),
      env.DB.prepare("SELECT * FROM custom_fields ORDER BY sort_order"),
    ]);
    return json({
      statuses: statuses.results,
      lists: lists.results,
      collections: collections.results,
      custom_fields: fields.results,
    });
  }

  // Rename a status label (the code, and so every book, stays the same).
  let m = path.match(/^\/api\/statuses\/([a-z0-9_]+)$/);
  if (m && method === "PATCH") {
    if (!body.label || !String(body.label).trim()) return fail(400, "A name is needed.");
    const before = await env.DB.prepare("SELECT * FROM statuses WHERE code = ?").bind(m[1]).first();
    if (!before) return fail(404, "No such status.");
    await env.DB.prepare("UPDATE statuses SET label = ? WHERE code = ?").bind(String(body.label).trim(), m[1]).run();
    const after = await env.DB.prepare("SELECT * FROM statuses WHERE code = ?").bind(m[1]).first();
    await logChange(env, email, "status", m[1], "update", before, after).run();
    return json(after);
  }

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

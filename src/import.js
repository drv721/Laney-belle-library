// Importing Libib files.
//
// The browser reads the file and shows her every row first (public/import.js).
// Nothing is saved until she taps Import. Then the rows come here 50 at a time,
// each group saved in one D1 batch, so a group either lands whole or not at all.
// Every original row is kept in libib_rows, and a whole import can be undone
// (its books go to Recently removed, nothing is erased).

import { isCoverUrl } from "./covers.js";

export const ROWS_PER_CALL = 50;
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

const text = (v, max = 2000) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const whole = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const date = (v) => text(v, 40);
const isbn13 = (v) => (typeof v === "string" && /^\d{13}$/.test(v) ? v : null);
const isbn10 = (v) => (typeof v === "string" && /^\d{9}[\dX]$/.test(v) ? v : null);

// What the duplicate check needs about what's already in the library.
export async function libraryKeys(env) {
  const { results } = await env.DB.prepare(
    `SELECT b.isbn13, b.title, b.authors, s.list_code
       FROM shelf_items s JOIN books b ON b.id = s.book_id
      WHERE s.deleted_at IS NULL`
  ).all();
  return results.map((r) => {
    let authors = [];
    try { authors = JSON.parse(r.authors); } catch { /* keep empty */ }
    return { isbn13: r.isbn13, title: r.title, authors, list_code: r.list_code };
  });
}

export async function startImport(env, by, body) {
  const fileName = text(body.file_name, 200) || "Libib file";
  const listCode = text(body.list_code, 40);
  const list = listCode && (await env.DB.prepare("SELECT code FROM lists WHERE code = ?").bind(listCode).first());
  if (!list) return { status: 400, data: { error: "Pick a list for this file." } };

  const name = text(body.collection_name, 100) || "Library";
  let collection = await env.DB.prepare("SELECT id FROM collections WHERE name = ? COLLATE NOCASE").bind(name).first();
  const stmts = [];
  let collectionId = collection?.id;
  if (!collectionId) {
    collectionId = newId();
    stmts.push(env.DB.prepare("INSERT INTO collections (id, name) VALUES (?, ?)").bind(collectionId, name));
  }
  const batchId = newId();
  const rowCount = whole(body.row_count) ?? 0;
  stmts.push(
    env.DB.prepare("INSERT INTO import_batches (id, file_name, source, row_count, by_email) VALUES (?, ?, 'libib', ?, ?)")
      .bind(batchId, fileName, rowCount, by)
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO change_log (by_email, entity, entity_id, action, after_json) VALUES (?, 'import_batch', ?, 'create', ?)`
    ).bind(by, batchId, JSON.stringify({ file_name: fileName, list_code: listCode, collection: name, row_count: rowCount }))
  );
  await env.DB.batch(stmts);
  return { status: 201, data: { batch_id: batchId, collection_id: collectionId, list_code: listCode } };
}

export async function importRows(env, by, body) {
  const batch = await env.DB.prepare("SELECT id FROM import_batches WHERE id = ?").bind(text(body.batch_id, 60)).first();
  if (!batch) return { status: 404, data: { error: "That import wasn't started." } };
  const [list, collection, statuses] = await env.DB.batch([
    env.DB.prepare("SELECT code FROM lists WHERE code = ?").bind(text(body.list_code, 40)),
    env.DB.prepare("SELECT id FROM collections WHERE id = ?").bind(text(body.collection_id, 60)),
    env.DB.prepare("SELECT code FROM statuses WHERE deleted_at IS NULL"),
  ]);
  if (!list.results.length || !collection.results.length) return { status: 400, data: { error: "List or collection is missing." } };
  const listCode = list.results[0].code;
  const collectionId = collection.results[0].id;
  const statusCodes = new Set(statuses.results.map((s) => s.code));

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, ROWS_PER_CALL) : [];
  if (!rows.length) return { status: 400, data: { error: "No rows sent." } };

  // Books already in the library with the same ISBN-13 are reused, so two
  // copies share one set of book details.
  const wanted = [...new Set(rows.map((r) => isbn13(r?.book?.isbn13)).filter(Boolean))];
  const existing = new Map();
  if (wanted.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, isbn13, cover_url FROM books WHERE isbn13 IN (${wanted.map(() => "?").join(",")})`
    ).bind(...wanted).all();
    for (const b of results) if (!existing.has(b.isbn13)) existing.set(b.isbn13, b);
  }

  const stmts = [];
  const saved = [];
  const stamp = now();
  for (const r of rows) {
    const b = r?.book || {};
    const it = r?.item || {};
    const title = text(b.title, 500);
    if (!title) continue; // the screen holds these back; never save a book with no title
    const i13 = isbn13(b.isbn13);
    const cover = isCoverUrl(r.cover_url) ? r.cover_url : null;
    const authors = Array.isArray(b.authors) ? b.authors.map((a) => text(a, 200)).filter(Boolean).slice(0, 20) : [];

    let bookId;
    const known = i13 && existing.get(i13);
    if (known) {
      bookId = known.id;
      if (!known.cover_url && cover) {
        stmts.push(env.DB.prepare("UPDATE books SET cover_url = ?, updated_at = ? WHERE id = ?").bind(cover, stamp, bookId));
        known.cover_url = cover;
      }
    } else {
      bookId = newId();
      stmts.push(
        env.DB.prepare(
          `INSERT INTO books (id, isbn13, isbn10, title, authors, publisher, publish_date, pages, cover_url, description, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'libib')`
        ).bind(bookId, i13, isbn10(b.isbn10), title, JSON.stringify(authors), text(b.publisher, 300), date(b.publish_date),
          whole(b.pages), cover, text(b.description, 20000))
      );
      if (i13) existing.set(i13, { id: bookId, isbn13: i13, cover_url: cover });
    }

    const itemId = newId();
    const status = statusCodes.has(it.status_code) ? it.status_code : "not_begun";
    const copies = whole(it.copies);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO shelf_items (id, book_id, collection_id, list_code, status_code, rating, review, review_date, notes,
           began_date, completed_date, added_date, copies, purchase_price, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(itemId, bookId, collectionId, listCode, status, number(it.rating), text(it.review, 20000), date(it.review_date),
        text(it.notes, 20000), date(it.began_date), date(it.completed_date), date(it.added_date) || stamp.slice(0, 10),
        copies && copies > 0 ? copies : 1, number(it.purchase_price), by, by)
    );

    // Libib's group goes in as a tag for now; the original is in libib_rows either way.
    const tags = [...(Array.isArray(r.tags) ? r.tags : []), ...(r.group ? [r.group] : [])]
      .map((t) => text(t, 100)).filter(Boolean);
    for (const name of [...new Set(tags.map((t) => t.toLowerCase()))].map((l) => tags.find((t) => t.toLowerCase() === l)).slice(0, 30)) {
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").bind(newId(), name));
      stmts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO shelf_item_tags (shelf_item_id, tag_id) SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE"
        ).bind(itemId, name)
      );
    }

    const raw = r.raw && typeof r.raw === "object" ? JSON.stringify(r.raw).slice(0, 90000) : "{}";
    stmts.push(
      env.DB.prepare("INSERT INTO libib_rows (id, batch_id, row_number, row_json, shelf_item_id) VALUES (?, ?, ?, ?, ?)")
        .bind(newId(), batch.id, whole(r.rowNumber) ?? 0, raw, itemId)
    );
    stmts.push(
      env.DB.prepare(
        "INSERT INTO change_log (by_email, entity, entity_id, action, after_json) VALUES (?, 'shelf_item', ?, 'import', ?)"
      ).bind(by, itemId, JSON.stringify({ batch_id: batch.id, row_number: r.rowNumber, title }))
    );
    saved.push({ rowNumber: r.rowNumber, shelf_item_id: itemId });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { status: 200, data: { saved: saved.length, rows: saved } };
}

export async function listImports(env) {
  const { results } = await env.DB.prepare(
    `SELECT ib.id, ib.file_name, ib.row_count, ib.imported_at, ib.by_email,
            COUNT(lr.id) AS saved,
            SUM(CASE WHEN s.deleted_at IS NULL THEN 1 ELSE 0 END) AS on_shelf
       FROM import_batches ib
       LEFT JOIN libib_rows lr ON lr.batch_id = ib.id
       LEFT JOIN shelf_items s ON s.id = lr.shelf_item_id
      GROUP BY ib.id ORDER BY ib.imported_at DESC`
  ).all();
  return results;
}

// Undo a whole import: its books go to Recently removed, where each can be restored.
export async function undoImport(env, by, batchId) {
  const batch = await env.DB.prepare("SELECT id, file_name FROM import_batches WHERE id = ?").bind(batchId).first();
  if (!batch) return { status: 404, data: { error: "No such import." } };
  const stamp = now();
  const [res] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE shelf_items SET deleted_at = ?, updated_at = ?, updated_by = ?
        WHERE deleted_at IS NULL AND id IN (SELECT shelf_item_id FROM libib_rows WHERE batch_id = ?)`
    ).bind(stamp, stamp, by, batch.id),
    env.DB.prepare(
      "INSERT INTO change_log (by_email, entity, entity_id, action, after_json) VALUES (?, 'import_batch', ?, 'delete', ?)"
    ).bind(by, batch.id, JSON.stringify({ file_name: batch.file_name })),
  ]);
  return { status: 200, data: { removed: res.meta?.changes ?? 0 } };
}

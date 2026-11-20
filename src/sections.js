// Subcategories (inside a collection, one per book) and Locations (where a
// book lives). She names, renames, adds and removes both herself.
// Removing only hides the row, so Undo brings it back with its books.

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

export const KINDS = {
  subcategories: { table: "subcategories", column: "subcategory_id", entity: "subcategory", label: "subcategory" },
  locations: { table: "locations", column: "location_id", entity: "location", label: "location" },
};

const cleanName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

// The ones in use, each with how many books (not removed) are in it.
export function listStatement(env, kind) {
  const k = KINDS[kind];
  return env.DB.prepare(
    `SELECT x.*, (SELECT COUNT(*) FROM shelf_items s WHERE s.${k.column} = x.id AND s.deleted_at IS NULL) AS count
     FROM ${k.table} x WHERE x.deleted_at IS NULL ORDER BY x.sort_order, x.name COLLATE NOCASE`
  );
}

async function nameTaken(env, kind, name, collectionId, exceptId) {
  const k = KINDS[kind];
  const scope = kind === "subcategories" ? " AND collection_id = ?" : "";
  const binds = [name, ...(kind === "subcategories" ? [collectionId] : []), exceptId || ""];
  const row = await env.DB.prepare(
    `SELECT id FROM ${k.table} WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE${scope} AND id != ?`
  ).bind(...binds).first();
  return Boolean(row);
}

const getRow = (env, kind, id) => env.DB.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ?`).bind(id).first();

export async function createSection(env, by, kind, body, logChange) {
  const k = KINDS[kind];
  const name = cleanName(body.name);
  if (!name) return { status: 400, data: { error: "A name is needed." } };
  let collectionId = null;
  if (kind === "subcategories") {
    collectionId = String(body.collection_id ?? "");
    const c = await env.DB.prepare("SELECT id FROM collections WHERE id = ?").bind(collectionId).first();
    if (!c) return { status: 400, data: { error: "That collection doesn't exist." } };
  }
  if (await nameTaken(env, kind, name, collectionId)) return { status: 409, data: { error: `There's already a ${k.label} called ${name}.` } };
  const id = newId();
  const { next } = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ${k.table}`).first();
  const insert = kind === "subcategories"
    ? env.DB.prepare("INSERT INTO subcategories (id, collection_id, name, sort_order) VALUES (?, ?, ?, ?)").bind(id, collectionId, name, next)
    : env.DB.prepare("INSERT INTO locations (id, name, sort_order) VALUES (?, ?, ?)").bind(id, name, next);
  await insert.run();
  const after = await getRow(env, kind, id);
  await logChange(env, by, k.entity, id, "create", null, after).run();
  return { status: 201, data: after };
}

export async function renameSection(env, by, kind, id, body, logChange) {
  const k = KINDS[kind];
  const before = await getRow(env, kind, id);
  if (!before || before.deleted_at) return { status: 404, data: { error: `No such ${k.label}.` } };
  const name = cleanName(body.name);
  if (!name) return { status: 400, data: { error: "A name is needed." } };
  if (await nameTaken(env, kind, name, before.collection_id, id)) return { status: 409, data: { error: `There's already a ${k.label} called ${name}.` } };
  await env.DB.prepare(`UPDATE ${k.table} SET name = ? WHERE id = ?`).bind(name, id).run();
  const after = await getRow(env, kind, id);
  await logChange(env, by, k.entity, id, "update", before, after).run();
  return { status: 200, data: after };
}

// Remove (hide) or bring back. Books keep pointing at it either way, so Undo is exact.
export async function setSectionDeleted(env, by, kind, id, deleted, logChange) {
  const k = KINDS[kind];
  const before = await getRow(env, kind, id);
  if (!before) return { status: 404, data: { error: `No such ${k.label}.` } };
  if (!deleted && before.deleted_at && (await nameTaken(env, kind, before.name, before.collection_id, id))) {
    return { status: 409, data: { error: `There's a new ${k.label} called ${before.name} now. Rename one of them first.` } };
  }
  await env.DB.prepare(`UPDATE ${k.table} SET deleted_at = ? WHERE id = ?`).bind(deleted ? now() : null, id).run();
  const after = await getRow(env, kind, id);
  await logChange(env, by, k.entity, id, deleted ? "delete" : "restore", before, after).run();
  return { status: 200, data: after };
}

// Checks a book edit's subcategory and location. Returns an error message or null.
// A subcategory has to belong to the book's collection (the new one, if that changes too).
export async function checkSections(env, item, before) {
  if ("subcategory_id" in item && item.subcategory_id !== null) {
    const row = await getRow(env, "subcategories", String(item.subcategory_id));
    const collection = item.collection_id ?? before.collection_id;
    if (!row || row.deleted_at) return "That subcategory doesn't exist.";
    if (row.collection_id !== collection) return "That subcategory belongs to another collection.";
  }
  if ("location_id" in item && item.location_id !== null) {
    const row = await getRow(env, "locations", String(item.location_id));
    if (!row || row.deleted_at) return "That location doesn't exist.";
  }
  // Moving a book to another collection drops a subcategory that doesn't belong there.
  if ("collection_id" in item && item.collection_id !== before.collection_id && !("subcategory_id" in item) && before.subcategory_id) {
    item.subcategory_id = null;
  }
  return null;
}

// Set a subcategory and/or location on several books at once.
// body: { ids: [...], subcategory_id?: id|null, location_id?: id|null }
// Only the fields sent change. The app sends up to BULK_MAX ids per call.
// Answers with each book's earlier values, so Undo can put them back.
export const BULK_MAX = 100;
const SHELF_ID = /^[0-9a-f-]{36}$/;

export async function bulkSet(env, by, body) {
  const bad = (error) => ({ status: 400, data: { error } });
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
  if (!ids.length) return bad("Pick at least one book.");
  if (ids.length > BULK_MAX) return bad(`Up to ${BULK_MAX} books at a time.`);
  if (!ids.every((id) => typeof id === "string" && SHELF_ID.test(id))) return bad("Those books weren't recognised.");
  const fields = ["subcategory_id", "location_id"].filter((f) => f in body);
  if (!fields.length) return bad("Pick a subcategory or a location to set.");
  for (const f of fields) if (body[f] !== null && typeof body[f] !== "string") return bad("That choice wasn't recognised.");

  const idsJson = JSON.stringify(ids);
  const inIds = "s.id IN (SELECT value FROM json_each(?))";
  const { results: before } = await env.DB.prepare(
    // A removed subcategory or location reads as none, as it does everywhere else.
    `SELECT s.id, s.collection_id, sc.id AS subcategory_id, lo.id AS location_id FROM shelf_items s
       LEFT JOIN subcategories sc ON sc.id = s.subcategory_id AND sc.deleted_at IS NULL
       LEFT JOIN locations lo ON lo.id = s.location_id AND lo.deleted_at IS NULL
      WHERE ${inIds} AND s.deleted_at IS NULL`
  ).bind(idsJson).all();
  if (before.length !== ids.length) return { status: 409, data: { error: "Some of these books were removed. Refresh the list and try again." } };

  if (body.subcategory_id) {
    const sub = await env.DB.prepare("SELECT * FROM subcategories WHERE id = ? AND deleted_at IS NULL").bind(body.subcategory_id).first();
    if (!sub) return bad("That subcategory doesn't exist.");
    const elsewhere = before.filter((b) => b.collection_id !== sub.collection_id).length;
    if (elsewhere) return bad(`${elsewhere} of these books ${elsewhere === 1 ? "is" : "are"} in another collection, so ${sub.name} can't go on ${elsewhere === 1 ? "it" : "them"}.`);
  }
  if (body.location_id) {
    const loc = await env.DB.prepare("SELECT id FROM locations WHERE id = ? AND deleted_at IS NULL").bind(body.location_id).first();
    if (!loc) return bad("That location doesn't exist.");
  }

  const set = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => body[f]);
  const snapshot = (prefix) => `json_object(${fields.map((f) => `'${f}', ${prefix}${f}`).join(", ")})`;
  const after = `json_object(${fields.map((f) => `'${f}', ?`).join(", ")})`;
  const stamp = now();
  await env.DB.batch([
    // The change log first, so it records each book's values from before the update.
    env.DB.prepare(
      `INSERT INTO change_log (by_email, entity, entity_id, action, before_json, after_json)
       SELECT ?, 'shelf_item', s.id, 'bulk_update', ${snapshot("s.")}, ${after} FROM shelf_items s WHERE ${inIds}`
    ).bind(by, ...values, idsJson),
    env.DB.prepare(
      `UPDATE shelf_items AS s SET ${set}, updated_at = ?, updated_by = ? WHERE ${inIds}`
    ).bind(...values, stamp, by, idsJson),
  ]);
  return {
    status: 200,
    data: { updated: ids.length, before: before.map(({ id, subcategory_id, location_id }) => ({ id, subcategory_id, location_id })) },
  };
}

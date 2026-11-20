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

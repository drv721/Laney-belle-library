// Her own fields (like Signed or Gift from) and her own statuses (like
// Reading next). She adds, renames and removes both in Settings.
//
// Removing only hides the row, so Undo is exact: a removed field keeps the
// values on every book, and comes back with them. A status can be removed only
// when no book has it, not even a removed book, and the default status for new
// books can't be removed at all.

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

export const FIELD_TYPES = ["text", "number", "date", "yesno"];
export const FIELDS_MAX = 30;
export const STATUSES_MAX = 20;
export const TEXT_MAX = 1000;

export const cleanName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
const bad = (error, status = 400) => ({ status, data: { error } });

// ---------- custom fields ----------

export const fieldsStatement = (env) =>
  env.DB.prepare(
    `SELECT f.id, f.name, f.field_type, f.sort_order,
            (SELECT COUNT(*) FROM custom_values v JOIN shelf_items s ON s.id = v.shelf_item_id AND s.deleted_at IS NULL
              WHERE v.field_id = f.id) AS count
       FROM custom_fields f WHERE f.deleted_at IS NULL ORDER BY f.sort_order, f.name COLLATE NOCASE`
  );

const getField = (env, id) => env.DB.prepare("SELECT * FROM custom_fields WHERE id = ?").bind(id).first();

// The name of a field in use that already has this name (in any case), or null.
async function fieldNameTaken(env, name, exceptId = "") {
  const row = await env.DB.prepare("SELECT name FROM custom_fields WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE AND id != ?")
    .bind(name, exceptId).first();
  return row?.name ?? null;
}

// The table keeps field names unique, removed ones included. A removed field
// with the very name she wants steps aside, so the name is free for the new one.
function freeRemovedName(env, name) {
  return env.DB.prepare(
    "UPDATE custom_fields SET name = name || ' (removed ' || substr(id, 1, 8) || ')' WHERE deleted_at IS NOT NULL AND name = ?"
  ).bind(name);
}

export async function createField(env, by, body, logChange) {
  const name = cleanName(body.name);
  if (!name) return bad("A name is needed.");
  const type = String(body.field_type ?? "text");
  if (!FIELD_TYPES.includes(type)) return bad("Pick what kind of field it is.");
  const taken = await fieldNameTaken(env, name);
  if (taken) return bad(`There's already a field called ${taken}.`, 409);
  const { live, next } = await env.DB.prepare(
    "SELECT SUM(deleted_at IS NULL) AS live, COALESCE(MAX(sort_order), 0) + 1 AS next FROM custom_fields"
  ).first();
  if ((live ?? 0) >= FIELDS_MAX) return bad(`Up to ${FIELDS_MAX} fields.`);
  const id = newId();
  await env.DB.batch([
    freeRemovedName(env, name),
    env.DB.prepare("INSERT INTO custom_fields (id, name, field_type, sort_order) VALUES (?, ?, ?, ?)").bind(id, name, type, next),
  ]);
  const after = await getField(env, id);
  await logChange(env, by, "custom_field", id, "create", null, after).run();
  return { status: 201, data: after };
}

export async function renameField(env, by, id, body, logChange) {
  const before = await getField(env, id);
  if (!before || before.deleted_at) return bad("No such field.", 404);
  const name = cleanName(body.name);
  if (!name) return bad("A name is needed.");
  const taken = await fieldNameTaken(env, name, id);
  if (taken) return bad(`There's already a field called ${taken}.`, 409);
  await env.DB.batch([
    freeRemovedName(env, name),
    env.DB.prepare("UPDATE custom_fields SET name = ? WHERE id = ?").bind(name, id),
  ]);
  const after = await getField(env, id);
  await logChange(env, by, "custom_field", id, "update", before, after).run();
  return { status: 200, data: after };
}

// The name a removed field had before it stepped aside for a new one.
export const originalName = (name) => String(name).replace(/ \(removed [0-9a-f]{8}\)$/, "");

export async function setFieldDeleted(env, by, id, deleted, logChange) {
  const before = await getField(env, id);
  if (!before) return bad("No such field.", 404);
  if (deleted) {
    await env.DB.prepare("UPDATE custom_fields SET deleted_at = ? WHERE id = ?").bind(now(), id).run();
  } else if (before.deleted_at) {
    // It comes back under its own name, never the stepped-aside one.
    const name = originalName(before.name);
    if (await fieldNameTaken(env, name, id)) {
      return bad(`There's a new field called ${name} now. Rename one of them first.`, 409);
    }
    await env.DB.batch([
      ...(name !== before.name ? [freeRemovedName(env, name)] : []),
      env.DB.prepare("UPDATE custom_fields SET name = ?, deleted_at = NULL WHERE id = ?").bind(name, id),
    ]);
  }
  const after = await getField(env, id);
  await logChange(env, by, "custom_field", id, deleted ? "delete" : "restore", before, after).run();
  return { status: 200, data: after };
}

// One value, checked for its kind of field. Returns { value } (null clears it) or { error }.
export function cleanValue(field, raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { value: null };
  const say = (what) => ({ error: `${field.name} needs to be ${what}.` });
  switch (field.field_type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/^\$/, ""));
      return Number.isFinite(n) ? { value: String(n) } : say("a number");
    }
    case "date": {
      const t = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) return say("a date");
      return { value: t };
    }
    case "yesno": {
      if (raw === true || /^yes$/i.test(String(raw).trim())) return { value: "yes" };
      if (raw === false || /^no$/i.test(String(raw).trim())) return { value: "no" };
      return say("yes or no");
    }
    default: {
      const t = String(raw).trim();
      return t.length > TEXT_MAX ? say(`${TEXT_MAX} characters at most`) : { value: t };
    }
  }
}

// A book edit's { field id: value }. Returns { stmts } or { error }.
export async function customValueStatements(env, itemId, custom) {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return { error: "Those fields weren't recognised." };
  const ids = Object.keys(custom);
  if (!ids.length) return { stmts: [] };
  const { results } = await env.DB.prepare(
    "SELECT * FROM custom_fields WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(ids)).all();
  const byId = new Map(results.map((f) => [f.id, f]));
  const stmts = [];
  for (const id of ids) {
    const field = byId.get(id);
    if (!field) return { error: "One of those fields was removed. Close the book and open it again." };
    const { value, error } = cleanValue(field, custom[id]);
    if (error) return { error };
    stmts.push(
      value === null
        ? env.DB.prepare("DELETE FROM custom_values WHERE shelf_item_id = ? AND field_id = ?").bind(itemId, id)
        : env.DB.prepare(
            `INSERT INTO custom_values (shelf_item_id, field_id, value) VALUES (?, ?, ?)
             ON CONFLICT (shelf_item_id, field_id) DO UPDATE SET value = excluded.value`
          ).bind(itemId, id, value)
    );
  }
  return { stmts };
}

// ---------- statuses ----------

export const statusesStatement = (env) =>
  env.DB.prepare(
    `SELECT st.code, st.label, st.sort_order, st.is_default,
            (SELECT COUNT(*) FROM shelf_items s WHERE s.status_code = st.code AND s.deleted_at IS NULL) AS count
       FROM statuses st WHERE st.deleted_at IS NULL ORDER BY st.sort_order`
  );

const getStatus = (env, code) => env.DB.prepare("SELECT * FROM statuses WHERE code = ?").bind(code).first();

async function statusLabelTaken(env, label, exceptCode = "") {
  const row = await env.DB.prepare("SELECT label FROM statuses WHERE deleted_at IS NULL AND label = ? COLLATE NOCASE AND code != ?")
    .bind(label, exceptCode).first();
  return row?.label ?? null;
}

// True when this code is a status on the menu now.
export async function statusIsLive(env, code) {
  return Boolean(await env.DB.prepare("SELECT code FROM statuses WHERE code = ? AND deleted_at IS NULL").bind(String(code)).first());
}

export async function createStatus(env, by, body, logChange) {
  const label = cleanName(body.label);
  if (!label) return bad("A name is needed.");
  const taken = await statusLabelTaken(env, label);
  if (taken) return bad(`There's already a status called ${taken}.`, 409);
  const { live, next } = await env.DB.prepare(
    "SELECT SUM(deleted_at IS NULL) AS live, COALESCE(MAX(sort_order), 0) + 1 AS next FROM statuses"
  ).first();
  if ((live ?? 0) >= STATUSES_MAX) return bad(`Up to ${STATUSES_MAX} statuses.`);
  const code = `s_${newId().replace(/-/g, "").slice(0, 12)}`;
  await env.DB.prepare("INSERT INTO statuses (code, label, sort_order, is_default) VALUES (?, ?, ?, 0)").bind(code, label, next).run();
  const after = await getStatus(env, code);
  await logChange(env, by, "status", code, "create", null, after).run();
  return { status: 201, data: after };
}

// Rename: the code, and so every book, stays the same.
export async function renameStatus(env, by, code, body, logChange) {
  const before = await getStatus(env, code);
  if (!before || before.deleted_at) return bad("No such status.", 404);
  const label = cleanName(body.label);
  if (!label) return bad("A name is needed.");
  const taken = await statusLabelTaken(env, label, code);
  if (taken) return bad(`There's already a status called ${taken}.`, 409);
  await env.DB.prepare("UPDATE statuses SET label = ? WHERE code = ?").bind(label, code).run();
  const after = await getStatus(env, code);
  await logChange(env, by, "status", code, "update", before, after).run();
  return { status: 200, data: after };
}

export async function setStatusDeleted(env, by, code, deleted, logChange) {
  const before = await getStatus(env, code);
  if (!before) return bad("No such status.", 404);
  if (deleted) {
    if (before.is_default) return bad(`${before.label} is the status new books start with, so it stays. You can rename it.`);
    const { live, removed } = await env.DB.prepare(
      "SELECT SUM(deleted_at IS NULL) AS live, SUM(deleted_at IS NOT NULL) AS removed FROM shelf_items WHERE status_code = ?"
    ).bind(code).first();
    if (live || removed) {
      const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;
      const parts = [live ? books(live) : "", removed ? `${books(removed)} in Recently removed` : ""].filter(Boolean).join(" and ");
      return bad(`${parts} ${live + removed === 1 ? "has" : "have"} ${before.label}. Give ${live + removed === 1 ? "it" : "them"} another status first.`, 409);
    }
  } else if (before.deleted_at && (await statusLabelTaken(env, before.label, code))) {
    return bad(`There's a new status called ${before.label} now. Rename one of them first.`, 409);
  }
  await env.DB.prepare("UPDATE statuses SET deleted_at = ? WHERE code = ?").bind(deleted ? now() : null, code).run();
  const after = await getStatus(env, code);
  await logChange(env, by, "status", code, deleted ? "delete" : "restore", before, after).run();
  return { status: 200, data: after };
}

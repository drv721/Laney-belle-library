// Select mode: tick books in the list, then set a subcategory and/or a
// location on all of them at once. Saves through POST /api/books/bulk,
// BULK_MAX books per call, and Undo puts each book back as it was.

export const BULK_MAX = 100; // same as src/sections.js
export const KEEP = "__keep"; // "Leave as is" in the bar's menus

export function chunks(list, size = BULK_MAX) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// The bar's two menus -> the changes to send. "Leave as is" sends nothing for that field.
export function bulkChanges(subValue, locValue) {
  const changes = {};
  if (subValue !== KEEP) changes.subcategory_id = subValue || null;
  if (locValue !== KEEP) changes.location_id = locValue || null;
  return changes;
}

// Undo: books that had the same earlier values go back together in one call.
export function undoGroups(before, fields) {
  const groups = new Map();
  for (const b of before) {
    const values = Object.fromEntries(fields.map((f) => [f, b[f] ?? null]));
    const key = JSON.stringify(values);
    if (!groups.has(key)) groups.set(key, { values, ids: [] });
    groups.get(key).ids.push(b.id);
  }
  return [...groups.values()];
}

// Sends one set of changes for many books, BULK_MAX at a time.
// Returns every book's earlier values (for Undo) and how many were done.
// If a call fails partway, what was already done stays done and is returned too.
export async function applyBulk(api, ids, changes) {
  const before = [];
  try {
    for (const part of chunks(ids)) {
      const r = await api("/api/books/bulk", { method: "POST", body: { ids: part, ...changes } });
      before.push(...r.before);
    }
    return { before, done: before.length };
  } catch (err) {
    return { before, done: before.length, error: err.message };
  }
}

export async function undoBulk(api, before, fields) {
  for (const g of undoGroups(before, fields)) {
    for (const part of chunks(g.ids)) {
      await api("/api/books/bulk", { method: "POST", body: { ids: part, ...g.values } });
    }
  }
}

// What the toast says: "Set Fantasy and Bookcase 2 on 12 books".
export function summary(changes, names, n) {
  const parts = [];
  if ("subcategory_id" in changes) parts.push(changes.subcategory_id ? names.subcategory : "no subcategory");
  if ("location_id" in changes) parts.push(changes.location_id ? names.location : "no location");
  return `Set ${parts.join(" and ")} on ${n} ${n === 1 ? "book" : "books"}`;
}

// The shelf scan saves where each copy sits: its location, the row on it, and
// its spot on that row counted from the left. One call sets up to SPOTS_MAX
// copies, each to exactly the values sent, and answers with what each had
// before, so Undo puts them back with the same call.

import { MAX_SHELVES } from "./sections.js";

export const SPOTS_MAX = 200;
export const MAX_POS = 500;
const SHELF_ID = /^[0-9a-f-]{36}$/;
const isWhole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const PLURAL = { Row: "rows", Cubby: "cubbies", Shelf: "shelves" };

// Checks one spot. Returns an error message or null.
export function checkSpot(s, places) {
  if (!s || typeof s !== "object") return "That spot wasn't recognised.";
  if (typeof s.id !== "string" || !SHELF_ID.test(s.id)) return "Those books weren't recognised.";
  const { location_id: loc, shelf_row: row, shelf_pos: pos } = s;
  if (loc === null) return row === null && pos === null ? null : "A row needs a location.";
  if (typeof loc !== "string") return "That location wasn't recognised.";
  const place = places.get(loc);
  if (!place) return "That location doesn't exist.";
  if (row === null) return pos === null ? null : "A spot needs a row.";
  const top = place.shelf_count || MAX_SHELVES;
  if (!isWhole(row, 1, top)) return `${place.name} has ${top} ${PLURAL[place.shelf_word] || "rows"}.`;
  if (pos !== null && !isWhole(pos, 1, MAX_POS)) return "That spot on the row wasn't recognised.";
  return null;
}

export async function setSpots(env, by, body) {
  const bad = (error) => ({ status: 400, data: { error } });
  const spots = Array.isArray(body?.items) ? body.items : [];
  if (!spots.length) return bad("No books to place.");
  if (spots.length > SPOTS_MAX) return bad(`Up to ${SPOTS_MAX} books at a time.`);
  for (const s of spots) for (const f of ["location_id", "shelf_row", "shelf_pos"]) if (!(f in (s || {}))) s[f] = null;
  const ids = spots.map((s) => s.id);
  if (new Set(ids).size !== ids.length) return bad("A book is in the list twice.");

  const { results: placeRows } = await env.DB.prepare(
    "SELECT id, name, shelf_count, shelf_word FROM locations WHERE deleted_at IS NULL"
  ).all();
  const places = new Map(placeRows.map((p) => [p.id, p]));
  for (const s of spots) {
    const err = checkSpot(s, places);
    if (err) return bad(err);
  }

  const idsJson = JSON.stringify(ids);
  const { results: before } = await env.DB.prepare(
    `SELECT id, location_id, shelf_row, shelf_pos FROM shelf_items
      WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`
  ).bind(idsJson).all();
  if (before.length !== ids.length) return { status: 409, data: { error: "Some of these books were removed. Refresh and try again." } };

  const stamp = new Date().toISOString();
  const statements = [];
  for (const s of spots) {
    const after = JSON.stringify({ location_id: s.location_id, shelf_row: s.shelf_row, shelf_pos: s.shelf_pos });
    statements.push(
      // The change log first, so it records the values from before the update.
      env.DB.prepare(
        `INSERT INTO change_log (by_email, entity, entity_id, action, before_json, after_json)
         SELECT ?, 'shelf_item', id, 'shelf_spot',
                json_object('location_id', location_id, 'shelf_row', shelf_row, 'shelf_pos', shelf_pos), ?
           FROM shelf_items WHERE id = ?`
      ).bind(by, after, s.id),
      env.DB.prepare(
        "UPDATE shelf_items SET location_id = ?, shelf_row = ?, shelf_pos = ?, updated_at = ?, updated_by = ? WHERE id = ?"
      ).bind(s.location_id, s.shelf_row, s.shelf_pos, stamp, by, s.id)
    );
  }
  await env.DB.batch(statements);
  return { status: 200, data: { updated: spots.length, before } };
}

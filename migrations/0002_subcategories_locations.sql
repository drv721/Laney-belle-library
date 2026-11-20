-- Subcategories she names herself inside a collection (Classics, Fantasy,
-- Work...), one per book, and a Location menu for where a book lives.
-- Only adds: nothing existing is renamed or dropped.
--
-- Removing one only hides it (deleted_at), so Undo can bring it back with
-- every book still in it. Names are kept unique among the ones in use by the
-- Worker, not here, so a removed "Fantasy" doesn't block a new "Fantasy".

CREATE TABLE subcategories (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES collections (id),
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_subcategories_collection ON subcategories (collection_id);

CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Stand-in names until the real ones are known. She can rename, add or remove any.
INSERT INTO locations (id, name, sort_order) VALUES
  ('loc-1', 'Bookcase 1', 1),
  ('loc-2', 'Bookcase 2', 2),
  ('loc-3', 'Bookcase 3', 3),
  ('loc-4', 'Bookcase 4', 4),
  ('loc-5', 'Bookcase 5', 5),
  ('loc-6', 'Bookcase 6', 6);

ALTER TABLE shelf_items ADD COLUMN subcategory_id TEXT REFERENCES subcategories (id);
ALTER TABLE shelf_items ADD COLUMN location_id TEXT REFERENCES locations (id);
CREATE INDEX idx_shelf_subcategory ON shelf_items (subcategory_id);
CREATE INDEX idx_shelf_location ON shelf_items (location_id);

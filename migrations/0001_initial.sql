-- 0001_initial.sql
-- Rule one: migrations only ever ADD things. Never rename or drop a column or
-- table in the same release that stops using it.

-- Reading statuses. Books store the fixed code; the label is what she sees.
-- Rename a label or add a status here without touching any book.
CREATE TABLE statuses (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO statuses (code, label, sort_order, is_default) VALUES
  ('not_begun',   'Not begun',   1, 1),
  ('in_progress', 'In progress', 2, 0),
  ('completed',   'Completed',   3, 0),
  ('abandoned',   'Abandoned',   4, 0);

-- Owned, wish list, borrowed, previously owned. Same code + label idea.
CREATE TABLE lists (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO lists (code, label, sort_order, is_default) VALUES
  ('owned',            'Owned',            1, 1),
  ('wish',             'Wish list',        2, 0),
  ('borrowed',         'Borrowed',         3, 0),
  ('previously_owned', 'Previously owned', 4, 0);

-- Separate collections (hers, the kids', ebooks...). Libib calls these groups.
CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO collections (id, name, sort_order) VALUES ('default', 'Library', 1);

-- What a book is. Shared facts, not her copy.
CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  isbn13        TEXT,
  isbn10        TEXT,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  authors       TEXT NOT NULL DEFAULT '[]',   -- JSON array of names
  publisher     TEXT,
  publish_date  TEXT,
  pages         INTEGER,
  cover_url     TEXT,
  description   TEXT,
  source        TEXT NOT NULL DEFAULT 'manual', -- manual, libib, openlibrary
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_books_isbn13 ON books (isbn13);
CREATE INDEX idx_books_isbn10 ON books (isbn10);
CREATE INDEX idx_books_title  ON books (title COLLATE NOCASE);

-- Her copy of a book.
CREATE TABLE shelf_items (
  id              TEXT PRIMARY KEY,
  book_id         TEXT NOT NULL REFERENCES books (id),
  collection_id   TEXT NOT NULL DEFAULT 'default' REFERENCES collections (id),
  list_code       TEXT NOT NULL DEFAULT 'owned' REFERENCES lists (code),
  status_code     TEXT NOT NULL DEFAULT 'not_begun' REFERENCES statuses (code),
  rating          REAL,
  review          TEXT,
  review_date     TEXT,
  notes           TEXT,
  began_date      TEXT,
  completed_date  TEXT,
  added_date      TEXT,
  copies          INTEGER NOT NULL DEFAULT 1,
  shelf_location  TEXT,
  condition       TEXT,
  purchase_place  TEXT,
  purchase_date   TEXT,
  purchase_price  REAL,
  deleted_at      TEXT,          -- soft delete: hidden, never erased
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by      TEXT,
  updated_by      TEXT
);
CREATE INDEX idx_shelf_book       ON shelf_items (book_id);
CREATE INDEX idx_shelf_status     ON shelf_items (status_code);
CREATE INDEX idx_shelf_collection ON shelf_items (collection_id);
CREATE INDEX idx_shelf_deleted    ON shelf_items (deleted_at);

-- Her own labels.
CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE shelf_item_tags (
  shelf_item_id  TEXT NOT NULL REFERENCES shelf_items (id),
  tag_id         TEXT NOT NULL REFERENCES tags (id),
  PRIMARY KEY (shelf_item_id, tag_id)
);

-- Her own custom fields.
CREATE TABLE custom_fields (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  field_type  TEXT NOT NULL DEFAULT 'text',  -- text, number, date, yesno
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE custom_values (
  shelf_item_id  TEXT NOT NULL REFERENCES shelf_items (id),
  field_id       TEXT NOT NULL REFERENCES custom_fields (id),
  value          TEXT,
  PRIMARY KEY (shelf_item_id, field_id)
);

-- Every edit, with before and after, so one book can be put back alone.
CREATE TABLE change_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  by_email     TEXT,
  entity       TEXT NOT NULL,   -- book, shelf_item, tag ...
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,   -- create, update, delete, restore
  before_json  TEXT,
  after_json   TEXT
);
CREATE INDEX idx_change_entity ON change_log (entity, entity_id);

-- Imports. Each file is one batch; every original row is kept untouched.
CREATE TABLE import_batches (
  id           TEXT PRIMARY KEY,
  file_name    TEXT,
  source       TEXT NOT NULL DEFAULT 'libib',
  row_count    INTEGER NOT NULL DEFAULT 0,
  imported_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  by_email     TEXT
);
CREATE TABLE libib_rows (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES import_batches (id),
  row_number      INTEGER NOT NULL,
  row_json        TEXT NOT NULL,
  shelf_item_id   TEXT REFERENCES shelf_items (id),
  imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

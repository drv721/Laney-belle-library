-- Fields and statuses she adds herself, in Settings.
-- Only adds: nothing existing is renamed or dropped.
--
-- Removing a field or a status only hides it (deleted_at), so Undo brings it
-- back exactly. A removed field keeps every value she typed on her books.
-- A status can only be removed when no book has it, so no book is ever left
-- with a status that isn't on the menu.

ALTER TABLE statuses ADD COLUMN deleted_at TEXT;
ALTER TABLE custom_fields ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_custom_values_field ON custom_values (field_id);

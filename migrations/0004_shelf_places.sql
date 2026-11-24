-- Her real places, and where each book sits on them.
-- Only adds: nothing existing is dropped, and no book loses its location.
--
-- Each location gets a room, its doors, how many rows (or cubbies or shelves)
-- it has, and the word for one of them. Each copy gets the row it's on and its
-- spot on that row, counted from the left. The shelf scan sets both.

ALTER TABLE locations ADD COLUMN room TEXT;
ALTER TABLE locations ADD COLUMN doors TEXT;          -- 'glass' or NULL for none
ALTER TABLE locations ADD COLUMN shelf_count INTEGER; -- rows, cubbies or shelves
ALTER TABLE locations ADD COLUMN shelf_word TEXT;     -- 'Row', 'Cubby' or 'Shelf'

ALTER TABLE shelf_items ADD COLUMN shelf_row INTEGER;
ALTER TABLE shelf_items ADD COLUMN shelf_pos INTEGER;
CREATE INDEX idx_shelf_spot ON shelf_items (location_id, shelf_row, shelf_pos);

-- The six stand-ins become her real places, but only a stand-in she hasn't
-- renamed and hasn't put any books in. A used one keeps its name and books,
-- because "Bookcase 5" may not be the kitchen case.
UPDATE locations SET name = 'BILLY 1', room = 'Living room', doors = 'glass', shelf_count = 6, shelf_word = 'Row', sort_order = 1
  WHERE id = 'loc-1' AND name = 'Bookcase 1' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-1');
UPDATE locations SET name = 'BILLY 2', room = 'Living room', doors = 'glass', shelf_count = 6, shelf_word = 'Row', sort_order = 2
  WHERE id = 'loc-2' AND name = 'Bookcase 2' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-2');
UPDATE locations SET name = 'BILLY 3', room = 'Living room', doors = 'glass', shelf_count = 6, shelf_word = 'Row', sort_order = 3
  WHERE id = 'loc-3' AND name = 'Bookcase 3' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-3');
UPDATE locations SET name = 'BILLY 4', room = 'Living room', doors = 'glass', shelf_count = 6, shelf_word = 'Row', sort_order = 4
  WHERE id = 'loc-4' AND name = 'Bookcase 4' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-4');
UPDATE locations SET name = 'Kitchen counter case', room = 'Kitchen', shelf_count = 7, shelf_word = 'Cubby', sort_order = 5
  WHERE id = 'loc-5' AND name = 'Bookcase 5' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-5');
UPDATE locations SET name = 'Sofa console', room = 'Living room', shelf_count = 2, shelf_word = 'Shelf', sort_order = 6
  WHERE id = 'loc-6' AND name = 'Bookcase 6' AND NOT EXISTS (SELECT 1 FROM shelf_items s WHERE s.location_id = 'loc-6');

-- Any real place still missing (its stand-in was used or renamed) is added.
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-billy-1', 'BILLY 1', 'Living room', 'glass', 6, 'Row', 1
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'BILLY 1' COLLATE NOCASE AND deleted_at IS NULL);
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-billy-2', 'BILLY 2', 'Living room', 'glass', 6, 'Row', 2
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'BILLY 2' COLLATE NOCASE AND deleted_at IS NULL);
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-billy-3', 'BILLY 3', 'Living room', 'glass', 6, 'Row', 3
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'BILLY 3' COLLATE NOCASE AND deleted_at IS NULL);
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-billy-4', 'BILLY 4', 'Living room', 'glass', 6, 'Row', 4
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'BILLY 4' COLLATE NOCASE AND deleted_at IS NULL);
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-kitchen', 'Kitchen counter case', 'Kitchen', NULL, 7, 'Cubby', 5
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Kitchen counter case' COLLATE NOCASE AND deleted_at IS NULL);
INSERT INTO locations (id, name, room, doors, shelf_count, shelf_word, sort_order)
  SELECT 'loc-sofa', 'Sofa console', 'Living room', NULL, 2, 'Shelf', 6
  WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Sofa console' COLLATE NOCASE AND deleted_at IS NULL);

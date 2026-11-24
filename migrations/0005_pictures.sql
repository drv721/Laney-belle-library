-- Spine pictures for the Bookcases view. A spine picture belongs to the book
-- (copies share it). The picture itself is in R2 under pictures/spine/.
--   spine_url   the app's own address for it, with a version so a new one shows
--   spine_ratio its width over its height, to draw it to scale
--   spine_tall  how much of the row's height it stands (0 to 1), when known
-- Cover photos use the existing cover_url. Nothing is renamed or removed.
ALTER TABLE books ADD COLUMN spine_url TEXT;
ALTER TABLE books ADD COLUMN spine_ratio REAL;
ALTER TABLE books ADD COLUMN spine_tall REAL;

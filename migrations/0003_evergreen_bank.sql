-- The evergreen bank. The table from 0001 was never filled or read, so this
-- widens it in place with the fields the daily pick needs.
--
-- status: banked (checked, ready to run), review (promoted from the news, not
-- yet fact-checked), used (has run) or removed (failed a later ruling, kept so
-- it is not added again).
ALTER TABLE evergreen ADD COLUMN slug TEXT;
ALTER TABLE evergreen ADD COLUMN topic TEXT;
ALTER TABLE evergreen ADD COLUMN technology TEXT;
ALTER TABLE evergreen ADD COLUMN total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evergreen ADD COLUMN why_its_good TEXT;
ALTER TABLE evergreen ADD COLUMN careful TEXT;
ALTER TABLE evergreen ADD COLUMN sources TEXT;
ALTER TABLE evergreen ADD COLUMN status TEXT NOT NULL DEFAULT 'review';
ALTER TABLE evergreen ADD COLUMN used_on TEXT;
ALTER TABLE evergreen ADD COLUMN added_at TEXT;

CREATE UNIQUE INDEX evergreen_slug ON evergreen (slug);
CREATE INDEX evergreen_ready ON evergreen (status, total DESC);

-- One row per day: what ran and why. story_key is news:<candidate id> or
-- evergreen:<slug>, and a story never runs twice.
CREATE TABLE picks (
  day TEXT PRIMARY KEY,
  story_key TEXT NOT NULL UNIQUE,
  lane TEXT NOT NULL,
  title TEXT NOT NULL,
  total REAL NOT NULL,
  reason TEXT NOT NULL,
  picked_at TEXT NOT NULL
);

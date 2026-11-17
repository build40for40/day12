-- The daily pick. 0003 filled the evergreen bank, so this only adds what the pick needs.
--
-- status: banked (can run), review (promoted from the news, not yet fact-checked),
-- used (has run) or removed. Every story in 0003 starts as banked.
ALTER TABLE evergreen ADD COLUMN status TEXT NOT NULL DEFAULT 'banked';
ALTER TABLE evergreen ADD COLUMN used_on TEXT;
ALTER TABLE evergreen ADD COLUMN added_at TEXT;

CREATE INDEX evergreen_ready ON evergreen (status, score DESC);

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

-- One row per day's issue: the story that ran and how the email send went.
-- The website reads from here, and the row for a date stops the same day being sent twice.
CREATE TABLE issues (
  date TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  headline TEXT,
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  stage TEXT,
  place TEXT,
  created_at TEXT NOT NULL,
  sent INTEGER,
  failed INTEGER,
  suppressed INTEGER
);

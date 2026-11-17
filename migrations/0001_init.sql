CREATE TABLE seen (
  url_key TEXT PRIMARY KEY,
  title_key TEXT NOT NULL,
  first_seen TEXT NOT NULL
);

CREATE INDEX seen_title_key ON seen (title_key);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  url_key TEXT NOT NULL,
  title_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT,
  publisher TEXT,
  source_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  score REAL,
  stage TEXT,
  tags TEXT
);

CREATE TABLE evergreen (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  stage TEXT,
  tags TEXT,
  verified_at TEXT,
  last_used_at TEXT
);

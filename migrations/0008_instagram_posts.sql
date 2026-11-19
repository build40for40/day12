-- One row per day's Instagram post: the 1080 x 1080 card as a base64 JPEG, and the caption to paste with it.
-- Made by the daily run after the email goes out, and served at /instagram. The card is 150 KB or so, well under D1's row limit.
CREATE TABLE instagram_posts (
  date TEXT PRIMARY KEY,
  caption TEXT NOT NULL,
  image TEXT NOT NULL,
  created_at TEXT NOT NULL
);

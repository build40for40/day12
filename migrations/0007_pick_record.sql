ALTER TABLE picks ADD COLUMN record TEXT;

-- Earlier verdicts didn't verify first publication dates. Recheck them before picking.
UPDATE candidates SET scored_at = NULL, gate = NULL, failed_gate = NULL,
  reason = NULL, score = NULL, stage = NULL, tags = NULL, story = NULL
WHERE gate = 'pass' AND json_extract(story, '$.published') IS NULL
  AND 'news:' || id NOT IN (SELECT story_key FROM picks);

-- Live scoring. scripts/score.py reads unscored candidates from the Worker, runs the rubric in
-- prompts/score-story.md over them and writes the verdict back here.
--
-- scored_at: when the verdict was written. Set for every candidate looked at, so none is sent twice.
-- gate: pass, fail, or triage when it was dropped on its headline before the source was opened.
-- score stays NULL unless the story passed, so only passes can reach the daily pick.
-- story: the handoff record as JSON (headline, what_happened, why_its_good, careful, sources).
ALTER TABLE candidates ADD COLUMN scored_at TEXT;
ALTER TABLE candidates ADD COLUMN gate TEXT;
ALTER TABLE candidates ADD COLUMN failed_gate TEXT;
ALTER TABLE candidates ADD COLUMN reason TEXT;
ALTER TABLE candidates ADD COLUMN story TEXT;

CREATE INDEX candidates_unscored ON candidates (scored_at, pulled_at);

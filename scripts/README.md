# Scripts

The daily run lives in the Worker (`src/daily.ts`); see "The daily run" in `AGENTS.md`. `build-prompt.mjs` (`npm run prompt`) copies the headline editor prompt into `src/editor-prompt.ts`.

`score.py` is the quality filter that runs before the daily pick, from `.github/workflows/score.yml`: it triages and scores the live pull with `prompts/score-story.md`, opening the sources, and saves the verdicts on the Worker (`python3 scripts/test_score.py`).

The rest are one-off Python scripts from Day 12, kept so the runs in `runs/2026-11-17/` can be traced. They are not part of the Worker and nothing imports them. The live source pull is in `src/`.

| Script | What it does |
| --- | --- |
| `run_prompt_test.py` | Runs every case in `evals/stories.json` through `prompts/score-story.md` and reports where the model disagrees with the expected answer |
| `triage_headlines.py` | Has the model shortlist each day's AI headlines for source-checking |
| `simulate_week.py` | Replays 11 to 17 November through the daily loop: add, rank, publish five, mark as published |
| `one-off/cands.py`, `one-off/funnel.py` | Built the per-day candidate lists and the funnel counts from downloaded feeds |
| `one-off/parse.py`, `one-off/eure.py`, `one-off/eure2.py`, `one-off/text.py` | First-look parsers for feeds and source pages |

The two scripts that call a model need the `claude` command line tool, signed in.

The `one-off` scripts read feed files that were downloaded by hand into a scratch folder, including pages from the EurekAlert AI spotlight. EurekAlert is not in the live pull because its terms restrict storing its content, so treat those parts as a record of the exploration, not something to rerun.

## Results they produced

- `runs/2026-11-17/funnel-daily.json`: stories pulled per day and per source, 4 to 17 November
- `runs/2026-11-17/triage/`: the model's shortlist for each day, with counts of what it rejected and why
- `runs/2026-11-17/source-checks.json`: the verdict on all 79 shortlisted stories from 11 to 17 November, including the gate each failure tripped
- `runs/2026-11-17/week-run.json`: each day's ranked list from the simulated week

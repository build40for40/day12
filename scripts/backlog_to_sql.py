"""Write migrations/0005_stories.sql: the stories table, loaded from data/backlog.json.

Usage: python3 scripts/backlog_to_sql.py
From this migration on, the stories table in D1 is the backlog the daily run reads and marks as published.
data/backlog.json is where it started. Run this again only to rebuild the migration before it has been
applied anywhere; after that, add new stories with a new migration.
"""
import json, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
backlog = json.load(open(os.path.join(REPO, 'data', 'backlog.json'), encoding='utf-8'))
lines = {s['id']: s['line'] for s in json.load(open(os.path.join(REPO, 'data', 'evergreen.json'), encoding='utf-8'))['stories'] if s.get('line')}


def q(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False)
    return "'" + str(value).replace("'", "''") + "'"


columns = ['id', 'origin', 'lane', 'added', 'headline', 'what_happened', 'why_its_good', 'bad_news', 'flip_kind', 'careful',
           'topic', 'stage', 'technology', 'total', 'sources', 'line', 'status', 'published_on']
out = [
    '-- The backlog: every story that passed the rubric in docs/scoring.md, with its handoff record and status.',
    f"-- Generated from data/backlog.json (updated {backlog.get('updated')}) by scripts/backlog_to_sql.py.",
    '-- The daily run reads waiting and in_bank stories from here and marks the one it sends as published.',
    '',
    'CREATE TABLE stories (',
    '  id TEXT PRIMARY KEY,',
    "  origin TEXT NOT NULL CHECK (origin IN ('new', 'evergreen')),",
    "  lane TEXT NOT NULL CHECK (lane IN ('good', 'flip')),",
    '  added TEXT,',
    '  headline TEXT NOT NULL,',
    '  what_happened TEXT NOT NULL,',
    '  why_its_good TEXT NOT NULL,',
    '  bad_news TEXT,',
    '  flip_kind TEXT,',
    "  careful TEXT NOT NULL DEFAULT '[]',",
    '  topic TEXT NOT NULL,',
    '  stage TEXT NOT NULL,',
    '  technology TEXT,',
    '  total INTEGER NOT NULL,',
    "  sources TEXT NOT NULL DEFAULT '[]',",
    '  line TEXT,',
    "  status TEXT NOT NULL CHECK (status IN ('waiting', 'in_bank', 'published', 'removed')),",
    '  published_on TEXT,',
    '  position INTEGER NOT NULL',
    ');',
    '',
]
for position, s in enumerate(backlog['stories']):
    values = [s['id'], s['from'], s['lane'], s.get('added'), s['headline'], s['what_happened'], s['why_its_good'], s.get('bad_news'),
              s.get('flip_kind'), s.get('careful') or [], s['topic'], s['stage'], s.get('technology'), s['total'], s.get('sources') or [],
              lines.get(s['id']), s['status'], s.get('published_on')]
    out.append(f"INSERT INTO stories ({', '.join(columns)}, position) VALUES ({', '.join(map(q, values))}, {position});")

path = os.path.join(REPO, 'migrations', '0005_stories.sql')
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(f"wrote {len(backlog['stories'])} stories to {os.path.relpath(path, REPO)}")

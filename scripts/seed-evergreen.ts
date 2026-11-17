// Prints the SQL that loads the evergreen bank from data/backlog.json.
// Local:  npm run db:seed
// Remote: node scripts/seed-evergreen.ts > /tmp/seed.sql && npm run wrangler -- d1 execute day12 --remote --file /tmp/seed.sql
import { readFileSync } from 'node:fs'
import { evergreenSeedSql, type BacklogStory } from '../src/bank-seed.ts'

const backlog = JSON.parse(readFileSync('data/backlog.json', 'utf8')) as { updated: string; stories: BacklogStory[] }
process.stdout.write(`${evergreenSeedSql(backlog.stories, backlog.updated)}\n`)

# Day 12

Day 12 of 40 for 40, built live on Twitch on Tuesday 17 November 2026. The problem is "Imagining a hopeful AI future", from Samira. Work is tracked on the Superthread `day12` board and the "Day 12" page.

- **Form factor:** Agent.
- **Name:** the app doesn't have one yet, so the repo is `day12` until it does. Once it's named, anything web-facing is served at `build40for40.com/<app>/`.

Shared 40 for 40 context lives in `../AGENTS.md`.

## The problem

Feel optimistic and inspired about the world we are creating with the use of Ai.
A solution could be…
Eg create a world building game cf minecraft where we can simulate and envisage the future for people, communities and the planet

## The brief

From the "Day 12 - Brief & prep" page on Superthread. The team picked a **positive AI news agent**: a morning brief with five hopeful stories a day about AI and scientific progress, built to counter the brain's bias towards bad news. Think "Morning Brew", but optimistic. Human stories beat productivity rhetoric.

An agent here means something with tools (APIs, data, actions), not just a chat or voice front end. Hosted agent kits are fine, so there's no infrastructure to run.

### The pipeline

Build the engine first and pick where it publishes after:

1. **Sources:** university press releases are the richest. EurekAlert collects them and has an AI Spotlight section with an RSS feed, but it doesn't say whether a story is positive. Also conservation groups, charities and lab blogs.
2. **Reverse real news:** take a major publication's story (data centres, say) and find the honest positive angle in the technology behind it, like data centre water cooling ending up in air conditioning. Don't manufacture news out of non-news.
3. **Quality filter:** does the story get featured at all?
4. **Scoring:** did it happen, might it happen, or is it only promised? How strong is the evidence? Is there a real person or place? Is the day balanced across climate, space, health and so on?
5. **Fact-check** every story that makes the cut.
6. **Format:** short items, about 200 words, or a 140-character hit.
7. **Publish:** see below.

Keep about 30 evergreen stories banked as a fallback for thin days. Prompts and evals are part of the plumbing, not an afterthought.

### Where it publishes

Not chosen yet. The front runners can go live the same day: SMS or text, an RSS feed or podcast, or a website with an email digest. These were ruled out for today because review takes too long: ChatGPT and Claude Code plugins, Alexa skills and podcast directory listings. On X, posting from our own account is fine, but automated replies to keyword searches aren't allowed without approval.

## Running it

The source pull is a Cloudflare Worker (`src/index.ts`) with its own local D1 database, `day12`.

1. **Install:** `npm install`
2. **Configure:** copy `.dev.vars.example` to `.dev.vars` and set `PULL_TOKEN` to any random string.
3. **Migrate:** `npm run db:migrate` applies `migrations/` to the local database.
4. **Run:** `npm run dev`, then in another shell load the token with `export $(grep ^PULL_TOKEN= .dev.vars)` and trigger a pull with `curl -X POST -H "Authorization: Bearer $PULL_TOKEN" localhost:8787/pull`. The response is a JSON report with fetched, kept and stored counts per source.
5. **Inspect:** `npm run wrangler -- d1 execute day12 --local --command "SELECT source_id, COUNT(*) FROM candidates GROUP BY source_id"`
6. **Test:** `npm run typecheck` and `npm test`.

Cloudflare crons run in UTC, so a single cron is 06:00 London only in winter. For 06:00 London all year, add two crons to `wrangler.jsonc` under `triggers.crons` (`0 5 * * *` and `0 6 * * *`) and a `scheduled` handler in `src/index.ts` that calls `runPull` only when the hour in Europe/London is 6.

## The landing page

The Worker also serves the signup page, "Feel good AI stories", at `/feel-good`. Locally that's `localhost:8787/feel-good`, and `wrangler.jsonc` routes `build40for40.com/feel-good` to it once deployed.

- **The page:** `src/landing.ts` renders it as one HTML string with no client-side JavaScript. The story it shows is a constant at the top of that file until the pipeline publishes one.
- **Signing up:** the form posts to `/feel-good/subscribe`, which saves the email to the `subscribers` table and redirects back with `?joined=1`, or `?error=email` if the address is no good. A hidden `website` field catches bots: anything that fills it in is told it worked and nothing is stored.
- **Not built yet:** nothing sends the email. Signups only collect in D1.

Emails are personal data, so they stay in D1 and never go into the repo, logs or fixtures.

## Deploying it

GitHub Actions does the checking and the deploying. `.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck` and `npm test` on every pull request, on the Node version in `.node-version`. `.github/workflows/deploy.yml` runs the same checks on every push to `main`, then applies the D1 migrations to the remote database and deploys the Worker. Deploys queue up one at a time and never overlap.

The deploy job is switched off until the repository variable `DEPLOY_ENABLED` is `true`, so it shows as skipped rather than failed. CI calls `npx wrangler` directly with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment, because the `wrangler` npm script needs the `40for40` profile that only exists on the team's machines.

Switching it on is a one-time job for a human, in this order:

1. **Create the database:** `npm run wrangler -- d1 create day12`
2. **Paste its id:** replace the all-zero `database_id` in `wrangler.jsonc` with the id that command prints, and merge that change to `main`. The checks run and the deploy is still skipped.
3. **Set the token:** `npm run wrangler -- secret put PULL_TOKEN`, with a long random string. If wrangler says the Worker doesn't exist yet, let it create the Worker when it offers.
4. **Add the GitHub secrets:** in the repo's Actions secrets, add `CLOUDFLARE_API_TOKEN` (a Cloudflare API token that can edit Workers Scripts and D1 on the account, and Workers Routes on the `build40for40.com` zone) and `CLOUDFLARE_ACCOUNT_ID` (the `account_id` in `wrangler.jsonc`).
5. **Flip the switch:** add the Actions repository variable `DEPLOY_ENABLED` with the value `true`.

After that every merge to `main` deploys. To deploy without a new commit, rerun the latest Deploy workflow on `main`. To stop deploys, set `DEPLOY_ENABLED` to anything else.

Migrations run before the deploy, so a migration has to work with the Worker version that's already live.

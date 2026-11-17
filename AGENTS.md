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
2. **Configure:** copy `.dev.vars.example` to `.dev.vars` and set `PULL_TOKEN` to any random string. See "Signups and email" for `POSTMARK_SERVER_TOKEN`.
3. **Migrate:** `npm run db:migrate` applies `migrations/` to the local database.
4. **Run:** `npm run dev`, then in another shell load the token with `export $(grep ^PULL_TOKEN= .dev.vars)` and trigger a pull with `curl -X POST -H "Authorization: Bearer $PULL_TOKEN" localhost:8787/pull`. The response is a JSON report with fetched, kept and stored counts per source.
5. **Inspect:** `npm run wrangler -- d1 execute day12 --local --command "SELECT source_id, COUNT(*) FROM candidates GROUP BY source_id"`
6. **Test:** `npm run typecheck` and `npm test`.

### The daily pull

The pull also runs itself at 06:00 London every day. Cloudflare crons run in UTC, so `wrangler.jsonc` has two, `0 5 * * *` and `0 6 * * *`, and the `scheduled` handler (`src/schedule.ts`) only runs the pull when the event's scheduled time is 6am in Europe/London. That's the 05:00 UTC cron in summer and the 06:00 UTC one in winter, and the other one logs a skip. It logs how many stories were stored plus the id and error of any source that failed, and a pull that throws logs an error and fails the invocation. A second pull on the same day is harmless: anything already in `seen` is skipped, so it stores nothing new. The crons only fire on a deployed Worker, and a change to them can take up to 15 minutes to reach Cloudflare's network.

`npm run dev` never fires crons by itself. To run the handler by hand, call `curl "localhost:8787/cdn-cgi/local/scheduled?cron=0+6+*+*+*&time=1794895200000&format=json"`. `time` is the scheduled time in epoch milliseconds (that one is 06:00 London on 17 November 2026). Leave it out to use the current time, which will usually skip. The pull's logs show in the dev server's output, and the response's `outcome` is `exception` if it failed.

## The evergreen bank and the daily pick

The bank is the `evergreen` table in D1. Migration `0003` fills it with the 69 stories from `data/backlog.json`, and `0004` adds the pick and `0005` the issues. Statuses: `banked` (can run), `review` (promoted from the news, needs a fact-check before it is set to `banked`), `used`, `removed`. Deploys apply the migrations to the remote database, so there is no separate seed step.

- **Pick:** `POST /pick` (bearer `PULL_TOKEN`, `?dry=1` to preview) chooses one story for the London day and records it in `picks`. A news story scored 16 or more in the last 14 days runs first, otherwise the best `banked` story runs and becomes `used`. `?story=<slug>` forces a banked story by hand. Stories with no link a reader can use (EurekAlert, API URLs) are skipped. The response includes the story `record` for the headline editor. Asking twice in a day returns the same story, so a run that died can be repeated. Nothing triggers this on a schedule yet, and it only records the pick; the publish stage reads it.
- **Refill:** the same call then promotes scored news that aged out of the 14 days, never ran and scored 16 or more into `review`. Candidates are purged after 30 days, so the pick has to run at least every two weeks.
- **Health:** `GET /bank` (same token) reports ready, review and used counts, topic spread and `low: true` under 20 ready stories.
- **Scoring:** candidates are scored outside the Worker, which only reads `candidates.score` (out of 24).

## Signups and email

The MVP is an email newsletter called Feel good AI, so the Worker also keeps the list of subscribers and sends mail through [Postmark](https://postmarkapp.com), called over its HTTP API. The Worker's own landing page posts to it, and so can a form on the main website.

The Worker is served at `build40for40.com/feel-good`, so every route below lives under that path in production: `POST https://build40for40.com/feel-good/signups` and so on. The base path comes from `PUBLIC_BASE_URL` and is stripped before routing, so the same routes also answer at the root on localhost.

### The contract for `POST /signups`

- **Request:** `POST /feel-good/signups` with either JSON (`Content-Type: application/json`, body `{ "email": "reader@example.com" }`) or a plain form post (`email=reader%40example.com`). The body can be at most 4096 bytes.
- **Success:** `200` with `{ "ok": true }`. It's the same answer whether the address is new, already pending, already confirmed or unsubscribed, so the form can't tell and neither can anyone probing. Show something like "check your inbox" every time.
- **Bad address:** `400` with `{ "ok": false, "error": "invalid_email" }`.
- **Not set up yet:** `503` with `{ "ok": false, "error": "not_configured" }` while `POSTMARK_SERVER_TOKEN` is missing.
- **CORS:** only the origin in `ALLOWED_ORIGIN` gets `Access-Control-Allow-Origin`, on both the `POST` and the `OPTIONS` preflight. The preflight allows the `POST` method and the `Content-Type` header. No cookies or credentials are involved.

### The flow

1. **Sign up:** `POST /signups` trims and lower-cases the address, stores a `pending` row in `signups` and sends a confirmation email on the transactional stream. The same address gets at most one confirmation email every 24 hours.
2. **Confirm:** the email links to `GET /confirm?token=...`, which shows a page with a button, so mail scanners that open links don't confirm anyone. The button does `POST /confirm?token=...`, which marks the row `confirmed`. Only confirmed rows are ever sent the newsletter.
3. **Send:** the publish stage builds the issue with `renderNewsletter(stories, date, signupUrl)` from `src/templates.ts` and passes the result to `sendNewsletter(env, { subject, html, text })` from `src/emails.ts`. It sends to every confirmed subscriber on the broadcast stream, 500 per Postmark batch call, and returns `{ sent, failed, suppressed }`. The body carries no unsubscribe link of ours: Postmark adds its own to every message on the broadcast stream. Every message still carries our `List-Unsubscribe` and `List-Unsubscribe-Post` headers, which only take effect if the stream is ever switched to managing unsubscribes ourselves. There's no HTTP route that triggers a send.
4. **Unsubscribe:** `GET /unsubscribe?token=...` shows a page with a button, so mail scanners that open links don't unsubscribe anyone. The button and the one-click header both `POST /unsubscribe?token=...`, which marks the row `unsubscribed`. Signing up again after that goes back through a fresh confirmation.

Our `signups` table is the source of truth for who gets mail. Postmark keeps its own suppression list per stream for hard bounces, spam complaints and its own unsubscribes, and refuses those recipients with error code 406. When a send gets a 406 the row's `suppressed_at` is set and we stop sending to it, so the two lists converge without a webhook.

Email addresses are personal data: never log them, and only use made-up `example.com` addresses in tests and docs. Postmark error messages can quote the address, so log error codes only.

### Templates

`src/templates.ts` holds both emails, as plain HTML with a text version, sharing one layout and footer.

- **The issue:** `renderNewsletter` takes a list of stories, each with `text` (280 characters at most), a source `url` and an optional `stage`. It throws on a story that is too long or has no usable link. The subject is the London date then the name, like `Nov 17th - Feel good AI`.
- **The confirmation:** `renderConfirmation` takes the confirm link.
- **The footer:** the issue asks "Was this forwarded to you?" with a subscribe link to the sign-up page, then links build40for40.com. The confirmation only links build40for40.com. Neither has an unsubscribe link, since Postmark adds one.

### Config

| Name | Where | What it is |
| --- | --- | --- |
| `POSTMARK_SERVER_TOKEN` | Secret, `.dev.vars` locally | The Postmark server API token. Locally, `POSTMARK_API_TEST` makes Postmark check requests without delivering anything |
| `EMAIL_FROM` | Secret, `.dev.vars` locally | The from address, kept out of the repo because it is someone's own address. Mail goes out as `Feel good AI <address>` |
| `PUBLIC_BASE_URL` | `wrangler.jsonc` vars | Where the Worker is served, `https://build40for40.com/feel-good`. Used for links in emails, the sign-up link in the footer and the base path for routing |
| `ALLOWED_ORIGIN` | `wrangler.jsonc` vars | The one origin allowed to call `POST /signups` from a browser |
| `POSTMARK_TRANSACTIONAL_STREAM` | `wrangler.jsonc` vars | Stream for confirmation emails, `outbound` by default |
| `POSTMARK_BROADCAST_STREAM` | `wrangler.jsonc` vars | Stream for the newsletter, `broadcast` by default |

To try it locally, put `POSTMARK_SERVER_TOKEN=POSTMARK_API_TEST`, `EMAIL_FROM=fake.sender@example.com` and `PUBLIC_BASE_URL=http://localhost:8787` in `.dev.vars`, run `npm run db:migrate` and `npm run dev`, then `curl -X POST localhost:8787/signups -d 'email=fake.reader@example.com'`. Read the tokens back with `npm run wrangler -- d1 execute day12 --local --command "SELECT status, confirm_token, unsubscribe_token FROM signups"`.

### One-time Postmark setup, for a human

1. **Create the server:** in Postmark, create a server for this app. It comes with a transactional stream (`outbound`) and a broadcast stream (`broadcast`). If the broadcast stream has a different id, put it in `POSTMARK_BROADCAST_STREAM`.
2. **Verify the sending domain:** Postmark only sends from an address with a confirmed sender signature or a verified domain, so add the domain's DNS records in Postmark. Check there too whether the account needs approval before it can send to outside addresses.
3. **Ask for custom unsubscribes:** broadcast streams default to Postmark managing unsubscribes, which adds Postmark's own link and sets its own `List-Unsubscribe` headers in place of ours. Ask Postmark support to approve "Manage unsubscribes on your own", then pick it in the broadcast stream's settings. Until then mail still goes out and people who leave through Postmark's link stop getting mail after the next send hits a 406, but their row only shows `suppressed_at`, not `unsubscribed`.
4. **Set the secrets:** `npm run wrangler -- secret put POSTMARK_SERVER_TOKEN` with the server's API token, and `npm run wrangler -- secret put EMAIL_FROM` with the verified from address. Worker secrets survive deploys, so GitHub Actions doesn't need them.

## The landing page

The Worker serves its own sign-up page, "Feel good AI stories", at the base path: `build40for40.com/feel-good` in production and `localhost:8787/feel-good` locally.

- **The page:** `src/landing.ts` renders it as one HTML string. It shows the most recent issue in the `issues` table, which the daily run fills (see below): the post's text, its date in London and the place the editor named. Before the first issue goes out it shows a fallback story kept at the top of that file. Past days are at `/feel-good?date=2026-11-15`, and every page links to the issues either side ("Earlier" and "Later"). A date with no issue answers 404 with "No story went out on ...".
- **Signing up:** a few lines of inline script post the email to `POST /signups`, described above, and swap the form for "Check your inbox" when it answers `ok`. An `invalid_email` answer shows a message under the field, and anything else asks the reader to try again.

## The daily run

One story a day goes out by email, is stored for the website, and is printed as a post for X. `scripts/daily.py` does it in four steps:

1. **Pick:** `POST /pick` on the Worker, which keeps the evergreen bank and what has run in D1 (see "The evergreen bank and the daily pick"). The rules are `docs/scoring.md`, layer 3. A story with no link a reader can use (only EurekAlert, or only an API search) is skipped until it's re-sourced, and a Europe PMC search link becomes the paper's DOI link. The pick is saved when it's made, so running again the same day gets the same story.
2. **Write:** `prompts/headline-editor.md`, sent to Claude Opus 5.5 with the company key in `ANTHROPIC_API_KEY`, through the `anthropic` Python package, with server-side fallbacks on so a decline is retried on another model. Without the key it falls back to the `claude` command line tool, signed in, for running on a laptop. The post is checked before it goes anywhere: 255 characters or fewer plus the source link, no hashtags, no second link. Three tries, then it stops.
3. **Publish:** `POST /publish` on the Worker, with the same bearer token as `/pull`. It emails every confirmed subscriber and stores the issue in the `issues` table. The Worker refuses a second send for the same date, so a rerun can't email people twice.
4. **Log:** writes `runs/<date>/daily.json`. The database already knows the story has run, so nothing else needs committing.

The X post is printed, not posted: there's no X account or API key in the repo yet.

### The 6am schedule

`.github/workflows/daily.yml` runs it every morning at 06:00 London, using the organisation's `ANTHROPIC_API_KEY` secret, and commits the run log to `main`. It runs on two UTC crons and only goes ahead from 06:00 London, so it's right in summer and winter. Before it calls the model it checks `GET /issues/latest`: if today's issue already went out it stops.

Switching it on is a one-time job for a human:

1. **Give the repo the key:** the organisation secret `ANTHROPIC_API_KEY` has to list this repository under its repository access.
2. **Add the publish token:** the Actions secret `PUBLISH_TOKEN`, with the same value as the Worker's `PULL_TOKEN`.
3. **Point it at the Worker:** optional. The Actions variable `WORKER_URL` defaults to `https://build40for40.com/feel-good`.
4. **Try it:** run "Daily story" by hand from the Actions tab. It defaults to a dry run, which shows the pick, the post and the email without sending.
5. **Flip the switch:** add the Actions variable `DAILY_ENABLED` with the value `true`. Until then the schedule is skipped, and only manual runs work.

If `main` has branch protection, the workflow's push of the run log needs to be allowed.

### Running it by hand

```bash
python3 scripts/daily.py --dry-run --worker https://build40for40.com/feel-good
python3 scripts/daily.py --worker https://build40for40.com/feel-good
```

Set `PUBLISH_TOKEN` to the Worker's `PULL_TOKEN`, and `ANTHROPIC_API_KEY` if you have the key; otherwise sign in the `claude` command. Useful flags: `--story <slug>` to run a banked story chosen by a person (the pick is for today in London, so there is no `--date`), `--story <id> --text "..."` to use a post written by a person instead of calling the editor (`--text` only works with `--story`, so the post can't go out with the wrong story), `--place "..."` for the place line on the page, `--force` to send a date again. Exit code 1 means the run stopped, with the reason on stderr. A real run writes `runs/`, so commit it.

The daily run doesn't score new stories. Something still has to run `prompts/score-story.md` over the live pull, open the sources and write the score onto `candidates.score` (card 320). Until then no news story can reach 16, so every day runs from the evergreen bank.

### For the website

The landing page at `/feel-good` already shows the latest issue. For anything else that wants it:

- `GET /feel-good/issues/latest`: `{ "ok": true, "issue": { "date", "storyId", "headline", "text", "url", "stage", "place", "createdAt" } }`, or `404` with `{ "ok": false, "error": "no_issues" }` before the first send.
- `GET /feel-good/issues`: `{ "ok": true, "issues": [...] }`, newest first, at most 30.

Both are public, cached for five minutes, and send `Access-Control-Allow-Origin` to `ALLOWED_ORIGIN` only. `stage` is `in_the_lab`, `in_a_trial` or `helping_people_now`.

### `POST /publish`

Body: `{ "date": "2026-11-18", "story": { "id", "headline", "text", "url", "stage", "place" }, "dry_run": false, "force": false }`. `text` is at most 280 characters, `place` at most 80 and optional. Answers: `200` with `{ ok, issue, report: { sent, failed, suppressed } }`; with `dry_run`, `200` with `{ ok, preview: { subject, html, text } }` and nothing sent or stored; `409` `already_published` with the issue that went out; `400` for a bad body; `502` `send_failed` when nothing was delivered, and then the date is free to retry.

### Trying it locally

With `.dev.vars` set up as in "Signups and email" and `npm run dev` running, sign up a made-up address and confirm it (read the token as shown there and `curl -X POST "localhost:8787/confirm?token=..."`), then `python3 scripts/daily.py --dry-run`. A real run against `POSTMARK_API_TEST` goes through Postmark's checks and delivers nothing, but it does use up that day's pick in your local database.

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

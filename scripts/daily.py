"""The daily run: pick the day's story, have the headline editor write the post, publish it, and mark it as published.

Usage:
  python3 scripts/daily.py --dry-run                 pick and write, preview the email, change nothing
  python3 scripts/daily.py                           pick, write, send the email, update data/backlog.json
  python3 scripts/daily.py --date 2026-11-18 --story japan-ai-lost-property-keio --worker https://build40for40.com/feel-good

Steps:
  1. Pick: the rules in docs/scoring.md, layer 3. A news story from the last 14 days scoring 16 or more runs ahead of
     the evergreen bank, otherwise the best bank story. Never a story that has run, one flip a week at most, and never
     a story whose only sources are EurekAlert (they need re-sourcing first).
  2. Write: prompts/headline-editor.md. With ANTHROPIC_API_KEY set (the company key, as in GitHub Actions) it calls the
     Claude API through the anthropic package. Without it, it falls back to the `claude` command line tool, signed in.
  3. Publish: POST /publish on the Worker, which emails every confirmed subscriber and stores the issue for the website.
     The Worker refuses a second send for the same date.
  4. Mark: sets status and published_on in data/backlog.json and writes runs/<date>/daily.json. Commit both.

The token is PUBLISH_TOKEN, or PULL_TOKEN, from the environment or from .dev.vars. Standard library only, plus the
anthropic package when the API key is used.
"""
import argparse, json, os, re, subprocess, sys, tempfile, urllib.error, urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKLOG = os.path.join(REPO, 'data', 'backlog.json')
EVERGREEN = os.path.join(REPO, 'data', 'evergreen.json')
PROMPT = os.path.join(REPO, 'prompts', 'headline-editor.md')
MAX_TEXT = 255  # X counts the link as 23, so 255 + space + link fits in 280
NEWS_DAYS, NEWS_FLOOR, FLIP_DAYS = 14, 16, 7


class Stop(Exception):
    pass


def days_between(earlier, later):
    return (date.fromisoformat(later) - date.fromisoformat(earlier)).days


def reader_link(url):
    """The link a reader should get for one source, or None. Europe PMC API searches become the paper's DOI link."""
    from urllib.parse import parse_qs, urlparse
    if 'eurekalert.org' in url:
        return None  # its terms restrict reuse, and these need re-sourcing to the institution's own page
    if 'europepmc/webservices' in url:
        query = parse_qs(urlparse(url).query).get('query', [''])[0]
        return f"https://doi.org/{query[4:]}" if query.upper().startswith('DOI:') else None
    if 'format=json' in url or '/api/' in url:
        return None
    return url


def source_url(story):
    return next((link for link in map(reader_link, story.get('sources') or []) if link), None)


def needs_resourcing(story):
    return source_url(story) is None


def pick(stories, day):
    """Return (story, reason) for the day, following docs/scoring.md layer 3."""
    flip_ran = [s for s in stories if s['lane'] == 'flip' and s.get('published_on') and 0 <= days_between(s['published_on'], day) < FLIP_DAYS]
    usable = [s for s in stories if s['status'] in ('waiting', 'in_bank') and not needs_resourcing(s) and not (s['lane'] == 'flip' and flip_ran)]

    news = [s for s in usable if s['from'] == 'new' and s.get('added') and 0 <= days_between(s['added'], day) < NEWS_DAYS and s['total'] >= NEWS_FLOOR]
    if news:
        best = max(news, key=lambda s: (s['total'], s['added']))
        return best, f"News story from {best['added']} scoring {best['total']} of 24, so it runs ahead of the bank."

    bank = [s for s in usable if s['from'] == 'evergreen' and s['status'] == 'in_bank']
    if not bank:
        raise Stop('Nothing left to run: no news story scores 16 or more and the evergreen bank is empty.')
    top = max(s['total'] for s in bank)
    best = next(s for s in bank if s['total'] == top)  # ties go to the earlier story in the file
    return best, f"No news story from the last {NEWS_DAYS} days scored {NEWS_FLOOR} or more, so the best bank story runs: {best['total']} of 24."


def editor_input(story, draft_lines):
    record = {k: story.get(k) for k in ('headline', 'what_happened', 'why_its_good', 'careful', 'stage', 'topic', 'lane')}
    if story['lane'] == 'flip':
        record.update(bad_news=story.get('bad_news'), flip_kind=story.get('flip_kind'))
    record['source_url'] = source_url(story)
    if story['id'] in draft_lines:
        record['draft_line'] = draft_lines[story['id']]
    return record


def system_prompt():
    text = open(PROMPT, encoding='utf-8').read()
    return text.split('\n---\n', 1)[1].strip()  # the notes above the line are for us, not the model


def check_post(out, url):
    post = (out.get('post') or '').strip()
    if out.get('decision') not in ('keep', 'rewrite', 'write'):
        return None, f"decision is {out.get('decision')!r}"
    if not post.endswith(url):
        return None, 'the post does not end with the source link'
    text = post[: -len(url)].strip()
    if not text:
        return None, 'the post has no text'
    if len(text) > MAX_TEXT:
        return None, f'the text is {len(text)} characters, the limit is {MAX_TEXT}'
    if '#' in text or re.search(r'https?://', text):
        return None, 'the text has a hashtag or a second link'
    return text, None


API_MODEL = 'claude-opus-5-5'


def ask_api(system, prompt, model):
    """The company API key (ANTHROPIC_API_KEY), through the official SDK. Used in GitHub Actions."""
    try:
        import anthropic
    except ImportError:
        raise Stop('ANTHROPIC_API_KEY is set but the anthropic package is not installed: pip install anthropic')
    client = anthropic.Anthropic()
    try:
        # Server-side fallbacks: if the model declines, the API reruns the request on a fallback model in the same call.
        response = client.beta.messages.create(
            model=model or API_MODEL,
            max_tokens=16000,
            output_config={'effort': 'medium'},
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            system=system,
            messages=[{'role': 'user', 'content': prompt}],
        )
    except anthropic.AuthenticationError:
        raise Stop('The Anthropic API rejected the key in ANTHROPIC_API_KEY.')
    except anthropic.RateLimitError:
        raise Stop('The Anthropic API is rate limiting this key. Try again in a few minutes.')
    except anthropic.APIStatusError as error:
        raise Stop(f'The Anthropic API answered {error.status_code}: {error.message}')
    except anthropic.APIConnectionError:
        raise Stop('Could not reach the Anthropic API.')
    if response.stop_reason == 'refusal':
        raise Stop('The model declined to write this story. Pick another with --story.')
    return ''.join(block.text for block in response.content if block.type == 'text')


def ask_cli(system, prompt, model):
    """The `claude` command line tool, signed in. For running by hand on a laptop."""
    env = {k: v for k, v in os.environ.items() if k not in ('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT')}
    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--system-prompt', system, '--model', model or 'opus', '--max-turns', '1', '--output-format', 'json'],
            capture_output=True, text=True, stdin=subprocess.DEVNULL, cwd=tempfile.mkdtemp(), env=env, timeout=300,
        )
    except FileNotFoundError:
        raise Stop('No ANTHROPIC_API_KEY and no `claude` command, so nothing can write the post.')
    try:
        answer = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise Stop(f"The claude command didn't answer: {(result.stderr or result.stdout).strip()[:300]}")
    if answer.get('is_error'):
        raise Stop(f"The claude command failed: {answer.get('result')}. Set ANTHROPIC_API_KEY, or sign `claude` in.")
    return answer.get('result') or ''


def write(record, model):
    ask = ask_api if os.environ.get('ANTHROPIC_API_KEY') else ask_cli
    message = 'Story record:\n' + json.dumps(record, ensure_ascii=False, indent=2)
    problem = None
    for attempt in range(3):
        prompt = message if not problem else f"{message}\n\nYour last answer was rejected: {problem}. Fix that and answer again."
        reply = ask(system_prompt(), prompt, model)
        try:
            out = json.JSONDecoder().raw_decode(reply[reply.index('{'):])[0]
        except (ValueError, json.JSONDecodeError):
            problem = 'the answer was not the JSON object asked for'
            continue
        text, problem = check_post(out, record['source_url'])
        if text:
            return text, out
    raise Stop(f'The headline editor failed three times. Last problem: {problem}')


def token():
    for name in ('PUBLISH_TOKEN', 'PULL_TOKEN'):
        if os.environ.get(name):
            return os.environ[name]
    path = os.path.join(REPO, '.dev.vars')
    if os.path.exists(path):
        for line in open(path):
            if line.startswith('PULL_TOKEN=') and line.strip() != 'PULL_TOKEN=':
                return line.split('=', 1)[1].strip()
    raise Stop('No token: set PUBLISH_TOKEN, or PULL_TOKEN in .dev.vars.')


def publish(worker, payload):
    request = urllib.request.Request(
        worker.rstrip('/') + '/publish', data=json.dumps(payload).encode(), method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token()}'},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, {'ok': False, 'error': body.decode(errors='replace')[:200]}
    except urllib.error.URLError as error:
        raise Stop(f'Could not reach the Worker at {worker}: {error.reason}')


def issue_on(worker, day):
    """The issue already sent for this date, or None."""
    try:
        with urllib.request.urlopen(worker.rstrip('/') + '/issues/latest', timeout=30) as response:
            issue = json.loads(response.read()).get('issue') or {}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise Stop(f'Could not read the latest issue from the Worker: {error.code}')
    except urllib.error.URLError as error:
        raise Stop(f'Could not reach the Worker at {worker}: {error.reason}')
    return issue if issue.get('date') == day else None


def mark(backlog, story_id, day):
    for story in backlog['stories']:
        if story['id'] == story_id:
            story['status'], story['published_on'] = 'published', day
    backlog['updated'] = day
    with open(BACKLOG, 'w', encoding='utf-8') as f:
        json.dump(backlog, f, indent=2, ensure_ascii=False)
        f.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--date', default=datetime.now(ZoneInfo('Europe/London')).date().isoformat(), help='the issue date, default today in London')
    parser.add_argument('--worker', default=os.environ.get('WORKER_URL', 'http://localhost:8787'), help='where the Worker is served')
    parser.add_argument('--story', help='run this story id instead of the pick')
    parser.add_argument('--model', help=f'model for the headline editor, default {API_MODEL} with the API key, opus with the claude command')
    parser.add_argument('--text', help='use this post text instead of calling the headline editor (still checked for length and links)')
    parser.add_argument('--dry-run', action='store_true', help='preview the email, send nothing, change no files')
    parser.add_argument('--force', action='store_true', help='send again even if this date has already gone out')
    args = parser.parse_args()

    backlog = json.load(open(BACKLOG, encoding='utf-8'))
    stories = backlog['stories']
    if not args.dry_run and not args.force:
        sent = issue_on(args.worker, args.date)
        if sent:
            story = next((s for s in stories if s['id'] == sent['storyId']), None)
            if story and story['status'] != 'published':
                mark(backlog, story['id'], args.date)  # the email went out but the last run died before marking it
                print(f"{args.date} already went out with {sent['storyId']}. Marked it as published, nothing sent.")
            else:
                print(f"{args.date} already went out with {sent['storyId']}. Nothing to do.")
            return
    if args.story:
        story = next((s for s in stories if s['id'] == args.story), None)
        if not story:
            raise Stop(f'No story with id {args.story} in data/backlog.json.')
        if story['status'] not in ('waiting', 'in_bank') and not args.force:
            raise Stop(f"{args.story} is {story['status']}, so it can't run again without --force.")
        reason = 'Chosen by hand with --story.'
    else:
        story, reason = pick(stories, args.date)
    print(f"1. Pick ({args.date}): {story['id']}\n   {story['headline']}\n   {reason}")

    draft_lines = {s['id']: s['line'] for s in json.load(open(EVERGREEN, encoding='utf-8'))['stories'] if s.get('line')}
    record = editor_input(story, draft_lines)
    if args.text:
        editor = {'decision': 'given', 'post': f"{args.text.strip()} {record['source_url']}", 'changes': 'Text given with --text, headline editor not called.'}
        text, problem = check_post(editor | {'decision': 'write'}, record['source_url'])
        if problem:
            raise Stop(f'2. The --text post was rejected: {problem}')
    else:
        text, editor = write(record, args.model)
    print(f"2. Write ({editor['decision']}, {len(text)} characters):\n   {text}\n   {record['source_url']}\n   Why: {editor.get('changes')}")
    if editor.get('needs_from_source'):
        print(f"   Missing from the record: {editor['needs_from_source']}")

    payload = {
        'date': args.date,
        'story': {'id': story['id'], 'headline': story['headline'], 'text': text, 'url': record['source_url'], 'stage': story['stage']},
        'dry_run': args.dry_run,
        'force': args.force,
    }
    status, answer = publish(args.worker, payload)
    if args.dry_run:
        if status != 200:
            raise Stop(f"3. Preview failed ({status}): {answer.get('error')}")
        print(f"3. Preview, nothing sent: {answer['preview']['subject']}\n")
        print(answer['preview']['text'])
        print(f"X post ({len(text) + 24} of 280 counting the link as 23):\n{text} {record['source_url']}")
        return

    if status == 409 and answer.get('issue', {}).get('storyId') != story['id']:
        raise Stop(f"3. {args.date} already went out with {answer['issue']['storyId']}. Use --force to send again.")
    if status not in (200, 409):
        raise Stop(f"3. Publish failed ({status}): {answer.get('error')} {answer.get('report') or ''}")
    report = answer.get('report')
    print(f"3. Publish: {'sent ' + str(report['sent']) + ', failed ' + str(report['failed']) + ', suppressed ' + str(report['suppressed']) if report else 'already sent earlier today'}")

    mark(backlog, story['id'], args.date)
    log_dir = os.path.join(REPO, 'runs', args.date)
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(log_dir, 'daily.json'), 'w', encoding='utf-8') as f:
        json.dump({'date': args.date, 'story_id': story['id'], 'pick_reason': reason, 'editor_input': record, 'editor_output': editor,
                   'text': text, 'x_post': f"{text} {record['source_url']}", 'email_report': report}, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f"4. Marked {story['id']} as published on {args.date}. Commit data/backlog.json and runs/{args.date}/daily.json.")
    print(f"\nX post, ready to paste:\n{text} {record['source_url']}")


if __name__ == '__main__':
    try:
        main()
    except Stop as stop:
        print(stop, file=sys.stderr)
        sys.exit(1)

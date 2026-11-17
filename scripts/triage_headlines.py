"""Triage one day of AI headlines at a time into a shortlist worth source-checking.

Usage: python3 scripts/triage_headlines.py <work-dir>
Reads <work-dir>/funnel/cands_<date>.json (built by one-off/cands.py) and writes triage_<date>.json beside each.
Needs the `claude` command line tool signed in. A shortlist is a headline judgement, not a pass.
"""
import json,subprocess,os,sys,glob,re
from concurrent.futures import ThreadPoolExecutor
import tempfile
S=sys.argv[1]; repo=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); rubric=open(os.path.join(repo,'docs','scoring.md')).read(); tmp=tempfile.mkdtemp()
SYS='''You triage one day of AI news headlines for a daily brief of five hopeful, true AI stories for people who don't work in tech. The full rubric is below. You only see headlines (and sometimes a short intro), so your job is to shortlist the stories worth opening the source for, not to pass them.

Shortlist a story only if, from the headline, it plausibly clears every gate: something has already happened (not "could", "may", "plans to", "launches fund"), AI is the reason, it is about the world outside the AI industry (no funding, product launches, benchmarks, opinion pieces, surveys of attitudes, market reports, explainers, conferences, awards or grants), and there is likely real evidence (a study, a trial result, or real use). Be strict: most days should shortlist between 3 and 10 good-news stories.

Also shortlist up to 3 flip candidates: widely covered bad-news AI stories where an honest good side might exist (a regulator or court acting, the people responsible owning up, a fix shipped, or the same technology used well). Never shortlist a flip where a person was killed, physically injured, abused or defrauded.

Several headlines are often the same story from different outlets. Merge them into one entry and list every item number.

Reply with JSON only: {"shortlist":[{"items":[numbers],"lane":"good|flip","story":"one plain sentence saying what the story is","best_title":"the clearest headline","publisher":"its publisher","why":"why it might pass"}],"rejected_summary":{"not_happened":0,"industry_news":0,"opinion_or_explainer":0,"ai_not_the_reason":0,"negative_no_flip":0,"other":0}}
The rejected_summary counts must add up to the number of items you did not shortlist.

RUBRIC:
'''+rubric
env={k:v for k,v in os.environ.items() if k not in('CLAUDECODE','CLAUDE_CODE_ENTRYPOINT')}
def run(fn):
    d=os.path.basename(fn)[6:16]; items=json.load(open(fn))
    lines=[]
    for x in items:
        l='%d. [%s] %s (%s)'%(x['n'],x['src'],x['title'],x['publisher'])
        if x.get('intro'): l+=' :: '+x['intro'][:220]
        lines.append(l)
    msg='Date: %s. %d items.\n\n%s'%(d,len(items),'\n'.join(lines))
    for attempt in range(2):
        try:
            r=subprocess.run(['claude','-p',msg,'--system-prompt',SYS,'--model','sonnet','--max-turns','1','--output-format','json'],capture_output=True,text=True,stdin=subprocess.DEVNULL,cwd=tmp,env=env,timeout=420)
            txt=json.loads(r.stdout)['result']; out=json.JSONDecoder().raw_decode(txt[txt.index('{'):])[0]
            out['date']=d; out['n_items']=len(items); json.dump(out,open(S+'/funnel/triage_%s.json'%d,'w'),indent=1,ensure_ascii=False); return d,len(out['shortlist'])
        except Exception as e: err=str(e)[:150]
    return d,'ERROR '+err
with ThreadPoolExecutor(5) as ex:
    for r in ex.map(run,[f for f in sorted(glob.glob(S+'/funnel/cands_*.json')) if not os.path.exists(f.replace('cands_','triage_'))]): print(r,flush=True)

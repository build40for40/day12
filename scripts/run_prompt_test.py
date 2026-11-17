"""Run every case in evals/stories.json through prompts/score-story.md and compare with the expected answers.

Usage: python3 scripts/run_prompt_test.py [output.json]
Needs the `claude` command line tool signed in. Uses Claude Sonnet, about 23 calls.
"""
import json,subprocess,os,re,sys
from concurrent.futures import ThreadPoolExecutor
import tempfile
repo=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); cwd=tempfile.mkdtemp()
out_path=sys.argv[1] if len(sys.argv)>1 else os.path.join(repo,'runs','prompt-test.json')
d=json.load(open(repo+'/evals/stories.json')); sysp=open(repo+'/prompts/score-story.md').read()
env={k:v for k,v in os.environ.items() if k not in('CLAUDECODE','CLAUDE_CODE_ENTRYPOINT')}
def run(c):
    r=run1(c)
    return run1(c) if r.get('error') else r
def run1(c):
    msg='Today is %s. Candidate:\n%s'%(d['today'],json.dumps(c['input']))
    try:
        r=subprocess.run(['claude','-p',msg,'--system-prompt',sysp,'--model','sonnet','--max-turns','1','--output-format','json'],capture_output=True,text=True,stdin=subprocess.DEVNULL,cwd=cwd,env=env,timeout=150)
        o=json.loads(r.stdout); txt=o['result']; model=list(o.get('modelUsage',{}).keys())
        out=json.JSONDecoder().raw_decode(txt[txt.index('{'):])[0]
    except Exception as e:
        return dict(id=c['id'],error=str(e)[:200])
    e=c['expect']; probs=[]
    if out.get('gate')!=e['gate']: probs.append('gate %s, expected %s'%(out.get('gate'),e['gate']))
    elif e['gate']=='fail':
        ok=e.get('failed_gate_any_of') or [e['failed_gate']]
        if out.get('failed_gate') not in ok: probs.append('failed_gate %s, expected %s'%(out.get('failed_gate'),'/'.join(ok)))
    else:
        for k in('topic','stage','flip_kind'):
            if k in e and out.get(k)!=e[k]: probs.append('%s %s, expected %s'%(k,out.get(k),e[k]))
        if 'flip_kind_any_of' in e and out.get('flip_kind') not in e['flip_kind_any_of']: probs.append('flip_kind %s'%out.get('flip_kind'))
        s=out.get('scores') or {}
        tot=s.get('mass_appeal',0)*3+s.get('real_person_or_place',0)*2+s.get('stage',0)*2+s.get('surprise',0)
        if out.get('total')!=tot: probs.append('total %s but scores add to %s'%(out.get('total'),tot))
        if tot<e.get('min_total',0): probs.append('total %s below %s'%(tot,e['min_total']))
        st=out.get('story') or {}
        for k in('headline','what_happened','why_its_good'):
            if not st.get(k): probs.append('story.%s missing'%k)
        if not isinstance(st.get('careful'),list): probs.append('story.careful not a list')
        if c['input']['lane']=='flip' and not st.get('bad_news'): probs.append('story.bad_news missing')
        if re.search(r'\b(could|may|might)\b',st.get('what_happened') or '',re.I): probs.append('could/may in what_happened')
    return dict(id=c['id'],expected=e,got=out,problems=probs,model=model)
with ThreadPoolExecutor(6) as ex: res=list(ex.map(run,d['cases']))
json.dump(res,open(out_path,'w'),indent=2,ensure_ascii=False)
ok=sum(1 for r in res if not r.get('error') and not r['problems'])
print('agree',ok,'of',len(res))
for r in res:
    if r.get('error'): print('ERROR',r['id'],r['error'])
    elif r['problems']: print('DIFF',r['id'],'|','; '.join(r['problems']),'|',(r['got'].get('reason') or '')[:160],'|',json.dumps(r['got'].get('story'))[:300])
print({m for r in res for m in r.get('model',[])})

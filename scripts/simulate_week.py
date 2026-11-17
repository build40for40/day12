"""Replay the week of 11 to 17 November 2026 through the daily loop: add stories on the day they surfaced, rank, publish five under the mix rules.

Usage: python3 scripts/simulate_week.py [output.json]
Reads runs/2026-11-17/source-checks.json and handoff.json. It uses the first 25 evergreen stories only, as the original run did, and it does not touch data/backlog.json.
"""
import json,sys,re
from collections import Counter
repo=__import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
out_path=sys.argv[1] if len(sys.argv)>1 else 'week-run.json'
T={'health':'health','climate_and_nature':'climate and nature','space':'space','accessibility':'accessibility','science':'science','everyday_life':'everyday life'}
slug=lambda h: re.sub(r'[^a-z0-9]+','-',h.lower()).strip('-')[:48].rstrip('-')
allr=json.load(open(repo+'/runs/2026-11-17/source-checks.json'))
items=[]; dup=next(x for x in allr if x['key']=='11-15-13')
def mk(id,added,frm,h,by,note=None):
    return dict(id=id,added=added,lane=h['lane'],**{'from':frm},headline=h['headline'],what_happened=h['what_happened'],why_its_good=h['why_its_good'],bad_news=h.get('bad_news'),flip_kind=h.get('flip_kind'),careful=h.get('careful') or [],topic=h['topic'],stage=h['stage'],technology=h.get('technology'),total=h['total'],sources=list(h['sources']),checked_by=by,note=note)
for x in allr:
    if x['gate']!='pass' or x['key']=='11-15-13': continue
    it=mk(slug(x['headline']),x['date'],'new',x,'agent')
    if x['key']=='11-14-10':
        it['sources']+=[u for u in dup['sources'] if u not in it['sources']]; it['note']="Merged with a second report of the same story on 15 November (the government's review of all national licensing exams)."
    items.append(it)
hand=json.load(open(repo+'/runs/2026-11-17/handoff.json'))['stories']
for h in hand:
    if h['from']=='new': items.append(mk(h['id'],h['date'],'new',h,'hand',"Source is a EurekAlert release. Re-source to the institution's own page before publishing." if any('eurekalert' in u for u in h['sources']) else None))
bank=sorted([mk(h['id'],None,'evergreen',h,'agent') for h in hand if h['from']=='evergreen'],key=lambda s:-s['total'])
assert len({i['id'] for i in items+bank})==len(items+bank)
pub={}; week=[]
for day in ['2026-11-%02d'%d for d in range(11,18)]:
    avail=sorted([i for i in items if i['added']<=day and i['id'] not in pub],key=lambda s:(-s['total'],s['added']))
    picks=[];topics={};lab=0;flip=None;ranked=[];waiting=[];low=[]
    for i in avail:
        why=None
        if i['total']<12: low.append(i); continue
        if len(picks)==5: why="Waits: all five slots were filled by higher-scoring stories."
        elif i['topic'] in topics: why="Waits: the %s slot went to \"%s\" (score %d)."%(T[i['topic']],topics[i['topic']]['headline'],topics[i['topic']]['total'])
        elif i['lane']=='flip' and flip: why="Waits: today's one flip slot went to \"%s\"."%flip['headline']
        elif i['stage']=='in_the_lab' and lab==2: why="Waits: two lab-stage stories were already picked."
        if why: waiting.append((i,why)); continue
        r=("Score %d of 24, the highest in the list."%i['total']) if not picks else "Score %d. The best remaining story that fits: the %s slot was open."%(i['total'],T[i['topic']])
        if i['added']<day: r+=" Carried over from %s."%i['added']
        if i['lane']=='flip': r+=" Takes today's flip slot."
        picks.append(i);topics[i['topic']]=i;lab+=i['stage']=='in_the_lab';flip=i if i['lane']=='flip' else flip
        ranked.append(dict(id=i['id'],headline=i['headline'],total=i['total'],topic=i['topic'],decision='publish',reason=r,**{'from':'new'}))
    nnew=len(picks); bent=[]
    for relax in(0,):
        for b in bank:
            if len(picks)==5: break
            if b['id'] in pub or b in picks: continue
            if relax<2 and b['topic'] in topics: continue
            if relax<1 and b['stage']=='in_the_lab' and lab==2: continue
            r="From the evergreen bank: no new %s story was waiting. Score %d."%(T[b['topic']],b['total'])
            if relax==1: r="From the evergreen bank, bending the two-lab-stories limit because nothing else was left for an open topic. Score %d."%b['total']; bent.append('lab limit')
            if relax==2: r="From the evergreen bank, as a second %s story because the bank had nothing left for the open topics. Score %d."%(T[b['topic']],b['total']); bent.append('one per topic')
            picks.append(b);topics.setdefault(b['topic'],b);lab+=b['stage']=='in_the_lab'
            ranked.append(dict(id=b['id'],headline=b['headline'],total=b['total'],topic=b['topic'],decision='publish',reason=r,**{'from':'evergreen'}))
    for i in low:
        if len(picks)<5 and i['topic'] not in [p['topic'] for p in picks] and not (i['stage']=='in_the_lab' and sum(p['stage']=='in_the_lab' for p in picks)>=2):
            picks.append(i); nnew+=1; ranked.append(dict(id=i['id'],headline=i['headline'],total=i['total'],topic=i['topic'],decision='publish',reason="Score %d, below the floor of 12, but the bank had nothing left that fits the %s slot."%(i['total'],T[i['topic']]),**{'from':'new'}))
        else: waiting.append((i,"Waits: score %d is below the floor of 12, so a bank story took the slot."%i['total']))
    for relax in(1,2):
        for b in bank:
            if len(picks)==5: break
            if b['id'] in pub or b in picks: continue
            if relax<2 and b['topic'] in [p['topic'] for p in picks]: continue
            r="From the evergreen bank, bending the two-lab-stories limit because nothing else was left for an open topic. Score %d."%b['total'] if relax==1 else "From the evergreen bank, as a second %s story because nothing was left for the open topics. Score %d."%(T[b['topic']],b['total'])
            bent.append('lab limit' if relax==1 else 'one per topic'); picks.append(b)
            ranked.append(dict(id=b['id'],headline=b['headline'],total=b['total'],topic=b['topic'],decision='publish',reason=r,**{'from':'evergreen'}))
    for i,why in waiting: ranked.append(dict(id=i['id'],headline=i['headline'],total=i['total'],topic=i['topic'],decision='wait',reason=why,waiting_since=i['added']))
    short=5-len(picks)
    for p in picks: pub[p['id']]=day
    week.append(dict(date=day,added_today=[i['id'] for i in items if i['added']==day],in_list_this_morning=len(avail),published=[p['id'] for p in picks],new_published=nnew,from_bank=len(picks)-nnew,short_by=short,rules_bent=sorted(set(bent)),left_waiting=len(avail)-len([p for p in picks if p['from']=='new']),bank_left=len([b for b in bank if b['id'] not in pub]),ranked=ranked))
    print(day,'added',len([i for i in items if i['added']==day]),'in list',len(avail),'new pub',nnew,'bank',len(picks)-nnew,'short',short,'bent',sorted(set(bent)),'waiting',len(avail)-nnew,'bank left',week[-1]['bank_left'])
    for r in ranked: print('   ',r['decision'][:4],r['total'],r['topic'][:6],'|',r['headline'][:72],'|',r['reason'][:70])
for i in items+bank: i['status']='published' if i['id'] in pub else 'waiting' if i['from']=='new' else 'in_bank'; i['published_on']=pub.get(i['id'])
json.dump(dict(about="A simulated week of the daily loop, 11 to 17 November 2026: stories are added to the backlog on the day they surfaced, the list is ranked each morning, five are published under the mix rules (including the floor of 12 for a new story to take a slot from the bank), and published stories are marked in data/backlog.json. Stories were found by one-off fetches, a model triage of headlines and agent source checks, not by the live pull.",days=week),open(out_path,'w'),indent=2,ensure_ascii=False)
print(Counter(i['status'] for i in items+bank),len(items)); print([(i['headline'][:50],i['total']) for i in items if i['status']=='waiting'])

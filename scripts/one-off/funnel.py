import sys,re,html,glob,os,json
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from collections import defaultdict,Counter
S=sys.argv[1]
days=['2026-11-%02d'%d for d in range(4,18)]
kw=re.compile(r'\b(AI|A\.I\.|artificial intelligence|machine learning|deep learning|algorithm|neural network|language model|chatbot|computer vision)\b',re.I)
out=re.compile(r'\b(patients?|diagnos\w+|detect\w+|trial|study|researchers?|scientists?|hospital|NHS|flood|wildfire|wildlife|conservation|rescue\w*|blind|deaf|students?|farmers?|telescope|astronom\w+|cancer|climate|species|disease|drug|discover\w+)\b',re.I)
T=defaultdict(Counter); small=[]
# google news
seen=set(); gn_items=defaultdict(list)
for fn in sorted(glob.glob(S+'/funnel/gn_*.xml')):
    d='2026-11-'+os.path.basename(fn)[3:5]
    try: root=ET.parse(fn).getroot()
    except Exception as e: small.append(os.path.basename(fn)); continue
    its=list(root.iter('item')); T[d]['gn_raw']+=len(its)
    if len(its)>=100: T[d]['gn_capped']+=1
    for it in its:
        t=(it.findtext('title') or '').rsplit(' - ',1)[0].strip().lower()
        if t in seen: continue
        seen.add(t); T[d]['gn_unique']+=1; gn_items[d].append(t)
        if kw.search(t): 
            T[d]['gn_ai']+=1
            if out.search(t): T[d]['gn_ai_outcome']+=1
# eurekalert
c=lambda x: html.unescape(re.sub(r'<[^>]+>|\s+',' ',x.group(1))).strip() if x else ''
es=set(); M={'Nov':'11'}
for fn in glob.glob(S+'/feeds/eure_p*.html'):
    h=open(fn,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'<article class="post">(.*?)</article>',h,re.S):
        a=m.group(1); href=re.search(r'href="(/news-releases/\d+)"',a)
        if not href or href.group(1) in es: continue
        es.add(href.group(1)); dt=c(re.search(r'class="reltime">(.*?)<',a,re.S)); mm=re.match(r'(\d+)-Nov-2026',dt)
        if not mm: continue
        d='2026-11-%02d'%int(mm.group(1)); T[d]['eure']+=1
        txt=c(re.search(r'<h2[^>]*>(.*?)</h2>',a,re.S))+' '+c(re.search(r'<div class="entry[^"]*">(.*?)</div>',a,re.S))
        if kw.search(txt): T[d]['eure_ai']+=1
        if a.find('<dt')>=0 and re.search(r'Journal</dt>\s*<dd>\s*<em>',a) and kw.search(txt): T[d]['eure_ai_journal']+=1
# rss feeds
for fn,key in[('deepmind.xml','dm'),('gnn.xml','gnn'),('rtbc.xml','rtbc')]:
    for it in ET.parse(S+'/feeds/'+fn).getroot().iter('item'):
        try: d=parsedate_to_datetime(it.findtext('pubDate')).strftime('%Y-%m-%d')
        except Exception: continue
        T[d][key]+=1
        if key!='dm' and kw.search((it.findtext('title') or '')+' '+re.sub(r'<[^>]+>',' ',it.findtext('description') or '')): T[d][key+'_ai']+=1
cols=['eure','eure_ai','eure_ai_journal','gn_raw','gn_unique','gn_ai','gn_ai_outcome','gn_capped','dm','gnn','gnn_ai','rtbc','rtbc_ai']
print('day        '+' '.join('%8s'%c[:8] for c in cols))
tot=Counter()
for d in days:
    print(d,' '.join('%8d'%T[d][c] for c in cols)); tot.update(T[d])
print('TOTAL     ',' '.join('%8d'%tot[c] for c in cols))
print('unparsed',small)
json.dump({d:dict(T[d]) for d in days},open(S+'/funnel/daily.json','w'),indent=1)

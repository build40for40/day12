import sys,re,html,glob,os,json
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from collections import defaultdict
S=sys.argv[1]
kw=re.compile(r'\b(AI|A\.I\.|artificial intelligence|machine learning|deep learning|algorithm|neural network|language model|chatbot|computer vision)\b',re.I)
C=defaultdict(list); seen=set()
for fn in sorted(glob.glob(S+'/funnel/gn_*.xml')):
    d='2026-11-'+os.path.basename(fn)[3:5]
    for it in ET.parse(fn).getroot().iter('item'):
        full=(it.findtext('title') or '').strip(); t,_,pub=full.rpartition(' - ')
        t=t or full; k=t.lower()
        if k in seen or not kw.search(t): continue
        seen.add(k); C[d].append(dict(src='news',title=t[:200],publisher=pub[:40]))
c=lambda x: html.unescape(re.sub(r'<[^>]+>|\s+',' ',x.group(1))).strip() if x else ''
es=set()
for fn in glob.glob(S+'/feeds/eure_p*.html'):
    h=open(fn,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'<article class="post">(.*?)</article>',h,re.S):
        a=m.group(1); href=re.search(r'href="(/news-releases/\d+)"',a)
        if not href or href.group(1) in es: continue
        es.add(href.group(1)); mm=re.match(r'(\d+)-Nov-2026',c(re.search(r'class="reltime">(.*?)<',a,re.S)))
        if not mm or not 4<=int(mm.group(1))<=17: continue
        t=c(re.search(r'<h2[^>]*>(.*?)</h2>',a,re.S)); intro=c(re.search(r'<div class="entry[^"]*">(.*?)</div>',a,re.S))
        if not kw.search(t+' '+intro): continue
        C['2026-11-%02d'%int(mm.group(1))].append(dict(src='eurekalert',title=t[:200],publisher=c(re.search(r'class="author">(.*?)<',a,re.S))[:50],journal=c(re.search(r'<dt[^>]*>Journal</dt>\s*<dd>(.*?)</dd>',a,re.S))[:50],intro=intro[:300],url='https://www.eurekalert.org'+href.group(1)))
for fn,key in[('deepmind.xml','deepmind blog'),('gnn.xml','good news network')]:
    for it in ET.parse(S+'/feeds/'+fn).getroot().iter('item'):
        d=parsedate_to_datetime(it.findtext('pubDate')).strftime('%Y-%m-%d'); t=it.findtext('title') or ''
        if key.startswith('good') and not kw.search(t+' '+re.sub(r'<[^>]+>',' ',it.findtext('description') or '')): continue
        if '2026-11-04'<=d<='2026-11-17': C[d].append(dict(src=key,title=t[:200],publisher=key,url=it.findtext('link')))
n=0
for d in sorted(C):
    for i,x in enumerate(C[d]): x['n']=i+1
    json.dump(C[d],open(S+'/funnel/cands_%s.json'%d,'w'),ensure_ascii=False); n+=len(C[d]); print(d,len(C[d]))
print(n)

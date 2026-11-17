import sys,re,html,glob,json
seen={};kw=re.compile(r'\b(AI|artificial intelligence|machine learning|deep learning|algorithm|neural network|language model|computer vision)\b',re.I)
c=lambda x: html.unescape(re.sub(r'<[^>]+>|\s+',' ',x.group(1))).strip() if x else ''
dates={}
for fn in sorted(glob.glob(sys.argv[1]+'/eure_p*.html'),key=lambda f:int(re.search(r'p(\d+)',f).group(1))):
    h=open(fn,encoding='utf-8',errors='replace').read()
    ds=re.findall(r'class="reltime">(\d+-\w+-\d+)',h); dates[fn[-9:]]=(ds[0],ds[-1]) if ds else None
    for m in re.finditer(r'<article class="post">(.*?)</article>',h,re.S):
        a=m.group(1); href=re.search(r'href="(/news-releases/\d+)"',a)
        if not href or href.group(1) in seen: continue
        dt=c(re.search(r'class="reltime">(.*?)<',a,re.S)); t=c(re.search(r'<h2[^>]*>(.*?)</h2>',a,re.S))
        intro=c(re.search(r'<div class="entry[^"]*">(.*?)</div>',a,re.S))
        seen[href.group(1)]=dict(date=dt,url='https://www.eurekalert.org'+href.group(1),title=t,inst=c(re.search(r'class="author">(.*?)<',a,re.S)),journal=c(re.search(r'<dt[^>]*>Journal</dt>\s*<dd>(.*?)</dd>',a,re.S)),intro=intro,ai=bool(kw.search(t+' '+intro)))
print(dates)
rows=[r for r in seen.values() if re.match(r'1[3-7]-Nov-2026',r['date'])]
json.dump(rows,open(sys.argv[2],'w'),indent=1)
from collections import Counter
print(len(seen),len(rows),Counter(r['date'] for r in rows),'ai:',sum(r['ai'] for r in rows))
for r in rows:
    if r['ai'] and r['date'][:2] in('13','14','15') or (r['ai'] and r['url'][-7:]>'1152170'):
        print(r['date'][:6],'|',r['url'][-7:],'|',r['title'][:140],'|',r['inst'][:35],'| J:',r['journal'][:30],'\n     ',r['intro'][:200])

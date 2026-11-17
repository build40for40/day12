import sys,re,html
seen=set()
c=lambda x: html.unescape(re.sub(r'<[^>]+>|\s+',' ',x.group(1))).strip() if x else ''
for fn in sys.argv[1:]:
    h=open(fn,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'<article class="post">(.*?)</article>',h,re.S):
        a=m.group(1)
        href=re.search(r'href="(/news-releases/\d+)"',a)
        if not href or href.group(1) in seen: continue
        seen.add(href.group(1))
        dt=c(re.search(r'class="reltime">(.*?)<',a,re.S))
        if not re.match(r'1[3-7]-Nov-2026',dt): continue
        t=c(re.search(r'<h2[^>]*>(.*?)</h2>',a,re.S)); au=c(re.search(r'class="author">(.*?)<',a,re.S))
        j=c(re.search(r'<dt[^>]*>Journal</dt>\s*<dd>(.*?)</dd>',a,re.S))
        intro=c(re.search(r'<div class="entry[^"]*">(.*?)</div>',a,re.S))
        print(dt[:6],'|',href.group(1)[-7:],'|',t[:150],'|',au[:40],'| J:',j[:40],'\n     ',intro[:230])
print('total seen',len(seen))

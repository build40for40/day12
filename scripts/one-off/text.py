import sys,re,html
for fn in sys.argv[2:]:
    h=open(fn,encoding='utf-8',errors='replace').read()
    h=re.sub(r'<(script|style|nav|header|footer|noscript)[^>]*>.*?</\1>',' ',h,flags=re.S|re.I)
    t=re.search(r'<title[^>]*>(.*?)</title>',h,re.S)
    ps=[html.unescape(re.sub(r'<[^>]+>','',p)).strip() for p in re.findall(r'<p[^>]*>(.*?)</p>',h,re.S)]
    ps=[re.sub(r'\s+',' ',p) for p in ps if len(p)>60]
    print('\n#####',fn.split('/')[-1],'|',html.unescape(t.group(1)).strip()[:120] if t else '')
    print(' '.join(ps)[:int(sys.argv[1])])

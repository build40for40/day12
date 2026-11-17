import sys,re,html,os
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime,timezone
d=sys.argv[1]; cut=datetime(2026,11,13,tzinfo=timezone.utc)
kw=re.compile(r'\b(AI|A\.I\.|artificial intelligence|machine learning|deep learning|algorithm|neural|chatbot|LLM|robot)\b',re.I)
for fn in ['deepmind.xml','gnn.xml','rtbc.xml','gn_diag.xml','gn_nature.xml','gn_access.xml','gn_neg.xml']:
    print('\n=====',fn)
    try: root=ET.parse(os.path.join(d,fn)).getroot()
    except Exception as e: print('ERR',e); continue
    n=0
    for it in root.iter('item'):
        t=(it.findtext('title') or '').strip(); pd=it.findtext('pubDate') or ''
        try: dt=parsedate_to_datetime(pd)
        except Exception: dt=None
        if dt and dt<cut: continue
        if fn in('gnn.xml','rtbc.xml') and not kw.search(t+' '+(it.findtext('description') or '')): continue
        src=it.findtext('source') or ''
        print((dt.strftime('%m-%d') if dt else '??'),'|',t[:150],'|',src[:30]); n+=1
        if n>=45: break

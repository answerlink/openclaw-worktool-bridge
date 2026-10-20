"""Render offline DOM snapshots at 4K. No production requests or mutations."""
from pathlib import Path
import json,re,os
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
 chrome=os.environ.get('CHROME_PATH','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 b=p.chromium.launch(headless=True,**({'executable_path':chrome} if Path(chrome).exists() else {}))
 page=b.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
 page.route('**/*',lambda route:route.abort())
 for path in sorted((ROOT/'out/snapshots').glob('*.json')):
  data=json.loads(path.read_text()); soup=BeautifulSoup(data['html'],'html.parser')
  for e in soup.select('script,noscript,style,link,base'):e.decompose()
  style=soup.new_tag('style');style.string=data['css']+"""
  * { animation: none!important; transition:none!important; }
  body {margin:0!important;}
  .ant-layout-sider { flex:0 0 208px!important;max-width:208px!important;min-width:208px!important;width:208px!important; }
  .ant-layout-sider-children {overflow:hidden!important;}
  header button, button[aria-label="打开在线助手"] {visibility:hidden!important;}
  .ant-table-cell {font-size:15px!important;}
  """
  soup.head.append(style)
  # Remove account identity, native input values and all URL/title metadata.
  for txt in list(soup.find_all(string=True)):
   if txt.parent.name=='style':continue
   if '账号：' in str(txt):txt.replace_with('')
  for el in soup.find_all(True):
   for attr in list(el.attrs):
    if attr.startswith('on') or attr in ('title','data-row-key','href','value'):del el[attr]
   if el.name=='input' and el.get('type') not in ['checkbox','radio']:el['value']=''
  # Irreversibly redact sensitive table cells, preserve functional fields.
  keep={
   'robots':{0,2,4,5,6},'providers':{0,2,4,6,7},
   'scheduled':{1,2,3,4,5,6},'events':{1,2,3,4,5},
   'groups':{0,4,5,6,7,8,9},'logs':{0,3,4,5,11},
   'tags':{0,2},'forward':set(),'forward-form':set(),'task-center':set(),'dashboard':set()
  }[path.stem]
  for row in soup.select('tbody tr'):
   cells=row.find_all('td',recursive=False)
   if len(cells)<=1:continue
   for i,cell in enumerate(cells):
    if i not in keep:
     cell.clear(); bar=soup.new_tag('span');bar['style']='display:inline-block;width:78px;height:9px;border-radius:5px;background:#dce2eb;vertical-align:middle';cell.append(bar)
  for el in soup.select('.ant-select-selection-item'):
   if 'worktool' in el.get_text().lower() or '机器人 (' in el.get_text():el.string='机器人（信息已隐藏）'
  # Preserve the captured chart; expose its original SVG with responsive sizing.
  for img in soup.select('img'):
   if not str(img.get('src','')).startswith('data:'):img.decompose()
  html=str(soup)
  (ROOT/'out/snapshots'/f'{path.stem}-clean.html').write_text(html)
  page.set_content(html,wait_until='load')
  page.screenshot(path=str(ROOT/'public/shots'/f'{path.stem}.jpg'),type='jpeg',quality=94)
  print(path.stem, '3840x2160',flush=True)
 b.close()

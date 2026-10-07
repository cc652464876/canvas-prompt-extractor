"""Developer-only import. The application uses the saved JSON, never the network."""
from pathlib import Path
import json,re,urllib.request,concurrent.futures,colorsys

root=Path(__file__).resolve().parents[1]/'src'
out=root/'theme-sources'
out.mkdir(exist_ok=True)
shaw='ac4551873d0bb1b6c4a5c62c49510a7f5480f317'
samux='3139c928366f129cb53d7eca18bfd2ddfcc899a3'
def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'CanvasPromptExtractor-theme-import'})
    return urllib.request.urlopen(req,timeout=30).read().decode('utf-8')
def raw(repo,commit,path):return f'https://raw.githubusercontent.com/{repo}/{commit}/{path}'
families=[
 ('absolutely','绝对','Absolutely','absolutely-light',None),
 ('ayu','Ayu','Ayu','ayu-light','ayu-dark'),
 ('catppuccin','猫布奇诺','Catppuccin','catppuccin-latte','catppuccin-mocha'),
 ('dracula','德古拉','Dracula',None,'dracula'),
 ('everforest','常青森林','Everforest','everforest-light','everforest-dark'),
 ('github','GitHub','GitHub','github-light','github-dark'),
 ('gruvbox','Gruvbox','Gruvbox','gruvbox-light','gruvbox-dark'),
 ('linear','Linear','Linear',None,None),
 ('lobster','龙虾','Lobster',None,None),
 ('tokyo-night','东京之夜','Tokyo Night','tokyo-day','tokyo-night'),
 ('material','材质','Material','material-lighter','material-ocean'),
 ('monokai','Monokai','Monokai',None,'monokai'),
 ('nord','北欧','Nord',None,'nord'),
 ('notion','Notion','Notion',None,None),
 ('one','一','One',None,'one-dark'),
 ('rose-pine','玫瑰松','Rosé Pine','rose-pine-dawn','rose-pine'),
 ('solarized','日光','Solarized','solarized-light','solarized-dark'),
 ('codex','Codex','Codex',None,'codex-dark'),
]
slugs=sorted({s for _,_,_,l,d in families for s in [l,d] if s})
def load_slug(slug):
    url=raw('shaw-baobao/codex-themes',shaw,f'themes/{slug}/theme.json')
    body=fetch(url);(out/(slug+'.json')).write_text(body,encoding='utf-8')
    return slug,{'colors':json.loads(body)['theme'],'url':url}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:known=dict(pool.map(load_slug,slugs))
generator_url=raw('samuxbuilds/codex-themes',samux,'src/lib/theme-generator.ts')
generator=fetch(generator_url)
def generated(slug):
    line=next(line for line in generator.splitlines() if f'makeTheme("{slug}",' in line)
    values=re.findall(r'"(#[0-9a-fA-F]{6})"',line)
    accent,bg,ink,good,bad,*_=values
    return {'colors':{'accent':accent,'background':bg,'foreground':ink,'semanticColors':{'diffAdded':good,'diffRemoved':bad}},'url':generator_url}
extra={('linear','light'):generated('linear-light'),('linear','dark'):generated('linear'),('notion','light'):generated('notion'),('notion','dark'):generated('notion-dark'),('one','light'):generated('one-light'),('nord','light'):generated('nord-light')}
lobster_commit=json.loads(fetch('https://api.github.com/repos/7368697661/Ultra-Lobster/commits/main'))['sha']
lobster_url=raw('7368697661/Ultra-Lobster',lobster_commit,'theme.css')
lobster=fetch(lobster_url)
lobster_blocks={}
for mode,selector in [('light','.theme-light.ulu-lobstertime-lt'),('dark','.theme-dark.ulu-lobstertime-dt')]:
    block=re.search(re.escape(selector)+r'\s*\{([^}]+)\}',lobster).group(1)
    lobster_blocks[mode]=block
    values=dict(re.findall(r'--([a-zA-Z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;',block))
    extra[('lobster',mode)]={'colors':{'accent':values['color-red'],'background':values['proxy-00'],'surface':values['proxy-10'],'foreground':values['mono-rgb-100'],'semanticColors':{'diffAdded':values['color-green'],'diffRemoved':values['color-red']}},'url':lobster_url,'adaptation':'参考 Ultra Lobster 的 lobster-time 配色，并以红色作为强调色；不声称等同 Codex 内置 Lobster。'}
(out/'lobster-time-reference.css').write_text('\n\n'.join(selector+' {\n'+lobster_blocks[mode]+'}' for mode,selector in [('light','.theme-light.ulu-lobstertime-lt'),('dark','.theme-dark.ulu-lobstertime-dt')]),encoding='utf-8')
library={}
for id,name,original,l,d in families:
    item={'name':name,'originalName':original,'description':original+' 参考配色','references':{}}
    for mode,slug in [('light',l),('dark',d)]:
        ref=known[slug] if slug else extra.get((id,mode))
        if ref is None:
            opposite=known[d if mode=='light' else l]
            colors=dict(opposite['colors'])
            if mode=='dark':colors['background'],colors['foreground']=colors['foreground'],colors['background']
            else:colors['background']='#faf7fc';colors['foreground']='#302a3b'
            colors.pop('surface',None)
            ref={'colors':colors,'url':opposite['url'],'adaptation':'该模式由已有参考配色补齐，沿用强调色与主题风格。'}
        item[mode]=ref['colors'];item['references'][mode]={'url':ref['url'],'adaptation':ref.get('adaptation','公开参考主题数据；组件颜色由程序统一适配。')}
    library[id]=item
(root/'theme-library.json').write_text(json.dumps(library,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for repo,commit,name in [('shaw-baobao/codex-themes',shaw,'LICENSE-shaw.txt'),('7368697661/Ultra-Lobster',lobster_commit,'LICENSE-ultra-lobster.txt')]:
    (out/name).write_text(fetch(raw(repo,commit,'LICENSE')),encoding='utf-8')
# samux publishes no LICENSE file; copied records retain source attribution above.
print('Imported',len(library),'theme families with pinned reference URLs.')

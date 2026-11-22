"""Gera elementor.html (versão para o widget HTML do Elementor) a partir de index.html.
Uso: python3 gerar-elementor.py   — rode de novo sempre que alterar index.html."""
import re, sys

import os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'index.html')
OUT = os.path.join(HERE, 'elementor.html')
P = '.me-app'
s = open(SRC, encoding='utf8').read()

css = re.search(r'<style>([\s\S]*?)</style>', s).group(1)
body = re.search(r'<body>([\s\S]*?)<script>', s).group(1)
js = re.search(r'<script>([\s\S]*?)</script>\s*</body>', s).group(1)

# ---------------- CSS: escopo em .me-app ----------------
def blocks(text):
    """Divide CSS em (cabeçalho, corpo) no nível superior."""
    out, i, n = [], 0, len(text)
    while i < n:
        j = text.find('{', i)
        if j < 0: break
        head = text[i:j].strip()
        depth, k = 1, j + 1
        while depth:
            if text[k] == '{': depth += 1
            elif text[k] == '}': depth -= 1
            k += 1
        out.append((head, text[j + 1:k - 1]))
        i = k
    return out

def scope_sel(sel):
    sel = re.sub(r'/\*[\s\S]*?\*/', '', sel).strip()
    if sel == ':root': return P
    if sel == 'body': return P + '.me-main'
    if sel == 'html': return None
    return f'{P} {sel}'

def scope(text):
    res = []
    for head, inner in blocks(text):
        head = re.sub(r'/\*[\s\S]*?\*/', '', head).strip()
        if head.startswith('@keyframes'):
            res.append(f'{head.replace("@keyframes ", "@keyframes me-")} {{{inner}}}')
        elif head.startswith('@media'):
            res.append(f'{head} {{\n{scope(inner)}\n}}')
        else:
            sels = [x for x in (scope_sel(p) for p in head.split(',')) if x]
            if sels: res.append(f'{", ".join(sels)} {{{inner}}}')
    return '\n'.join(res)

scoped = scope(css)
# nomes das animações também recebem prefixo
for name in set(re.findall(r'@keyframes me-([\w-]+)', scoped)):
    scoped = re.sub(rf'(animation:[^;]*?)\b{name}\b', rf'\1me-{name}', scoped)
# ajustes: body -> container principal; sticky respeita cabeçalho do tema
scoped = scoped.replace('overflow-x: hidden;', '')
scoped = scoped.replace('.sticky { position: sticky; top: 0;', '.sticky { position: sticky; top: var(--me-top);')
scoped = scoped.replace('scroll-margin-top: 120px;', 'scroll-margin-top: calc(120px + var(--me-top));')
# camadas fixas acima de cabeçalhos do WordPress
for sel, z in [('.cart-bar', 99990), ('.overlay', 99991), ('.sheet', 99992), ('.toast', 99995), ('.fly', 99996)]:
    scoped = re.sub(rf'({re.escape(P + " " + sel)} \{{[^}}]*?z-index: )\d+', rf'\g<1>{z}', scoped)

reset = f"""
/* Isolamento do tema do WordPress/Elementor */
{P} {{ --me-top: 0px; /* altura do cabeçalho fixo do site, ex.: 80px */ font-family: 'Montserrat', system-ui, sans-serif; color: var(--ink); line-height: normal; text-align: left; }}
{P}.me-main {{ background: var(--bg); padding-bottom: 110px; }}
{P} button, {P} input, {P} select, {P} textarea {{ margin: 0; text-transform: none; letter-spacing: normal; box-shadow: none; min-height: 0; line-height: normal; font-weight: inherit; }}
{P} button {{ padding: 0; border: 0; background: none; color: inherit; border-radius: 0; }}
{P} button:hover, {P} button:focus {{ background-color: transparent; color: inherit; }}
{P} h1, {P} h2, {P} h3, {P} h4, {P} p {{ margin: 0; color: inherit; letter-spacing: normal; text-transform: none; line-height: 1.25; }}
{P} a {{ box-shadow: none; }}
{P} img {{ max-width: 100%; height: auto; border: 0; }}
{P} label {{ font-weight: inherit; margin: 0; }}
"""
# repõe fundos de botões com classe (o reset de :hover acima não pode apagá-los)
fix_hover = f"""
{P} .btn:hover, {P} .btn:focus {{ background: var(--brand); color: var(--accent); }}
{P} .btn.wpp:hover, {P} .btn.wpp:focus {{ background: #25D366; color: #fff; }}
{P} .add:hover, {P} .add:focus {{ background: var(--brand); color: var(--accent); }}
{P} .cart-bar:hover, {P} .cart-bar:focus {{ background: var(--brand); color: #fff; }}
{P} .cat.active:hover {{ background: var(--brand); color: var(--accent); }}
{P} .cat:hover {{ background: var(--surface); }}
{P} .chip.on:hover {{ background: var(--accent-soft); }}
{P} .x:hover {{ background: var(--bg); }}
{P} .coupon button:hover {{ background: var(--accent-soft); }}
{P} .share:hover {{ background: rgba(255,255,255,.12); color: #fff; }}
{P} .quick a:hover {{ color: var(--ink); }}
"""
final_css = reset + scoped + fix_hover

# ---------------- HTML: ids com prefixo me- ----------------
ids = re.findall(r'id="([\w-]+)"', body + js)
ids = sorted(set(i for i in ids if '$' not in i), key=len, reverse=True)

def ren_ids(t):
    for i in ids:
        t = re.sub(rf'(id="){i}(")', rf'\1me-{i}\2', t)
        t = re.sub(rf"#{i}\b(?![\w-])", f'#me-{i}', t)
    return t

body = ren_ids(body)
body = body.replace('id="cat-${c.id}"', 'id="me-cat-${c.id}"')
body = body.replace(' · <a href="../manicure-elegante.html">Conheça o salão</a>', '')
cut = body.index('<!-- BOTÃO FLUTUANTE')
main_html, layer_html = body[:cut].strip(), body[cut:].strip()

# ---------------- JS ----------------
js = ren_ids(js)
js = js.replace("'#c' + k", "'#me-c' + k").replace("$('#cat-' + b.dataset.cat)", "$('#me-cat-' + b.dataset.cat)")
js = js.replace('id="cat-${c.id}"', 'id="me-cat-${c.id}"')
js = js.replace("const $ = s => document.querySelector(s);",
    "const APP = document.getElementById('me-cardapio'), LAYER = document.getElementById('me-layer');\n"
    "// leva as janelas fixas para o <body>: assim efeitos/animações do Elementor não as deslocam\n"
    "document.body.appendChild(LAYER);\n"
    "const $ = s => APP.querySelector(s) || LAYER.querySelector(s);")
js = js.replace("document.body.appendChild(f)", "LAYER.appendChild(f)")
js = js.replace("document.querySelectorAll('.card')", "APP.querySelectorAll('.card')")
js = js.replace("document.querySelectorAll('section.category')", "APP.querySelectorAll('section.category')")
js = js.replace("document.querySelectorAll('.cat')", "APP.querySelectorAll('.cat')")
js = js.replace("document.querySelectorAll('[data-close]')", "LAYER.querySelectorAll('[data-close]')")
js = js.replace("document.querySelectorAll('.sheet')", "LAYER.querySelectorAll('.sheet')")
js = js.replace("    ['../manicure-elegante.html', '🌐', 'Site'],\n", "    STORE.site && [STORE.site, '🌐', 'Site'],\n")
js = js.replace("].map(([href, i, l])", "].filter(Boolean).map(([href, i, l])")
js = js.replace("  instagram: 'https://instagram.com',", "  instagram: 'https://instagram.com',\n  site: '',                            // link do seu site (vazio = esconde o botão)")
js = re.sub(r"\n/\* PWA:[^\n]*\n[^\n]*\n", '\n', js)
js = js.replace('// botão voltar do celular fecha a gaveta', '')
assert "serviceWorker" not in js and 'manicure-elegante.html' not in js

out = f"""<!-- =====================================================================
  CARDÁPIO DIGITAL – MANICURE ELEGANTE  ·  versão para o widget HTML do Elementor
  Como usar: Elementor → arraste o widget "HTML" para a página → cole TODO este
  arquivo → Atualizar. Para mudar serviços/preços/WhatsApp, edite os blocos
  STORE e MENU logo abaixo de "CONFIGURAÇÃO".
  Dica: se o seu site tem cabeçalho fixo, ajuste --me-top (procure por me-top).
====================================================================== -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
{final_css}
</style>

<div class="me-app me-main" id="me-cardapio">
{main_html}
</div>

<div class="me-app" id="me-layer">
{layer_html}
</div>

<script>
(function () {{
{js}
}})();
</script>
"""
open(OUT, 'w', encoding='utf8').write(out)
print('ok', len(out), 'bytes;', len(ids), 'ids')

#!/usr/bin/env python3
# gas/ の3画面から、GitHub Pages に置く静的版（docs/）を作る。Google の枠を通さないので上部の帯が出ない
import re, os, json
root = os.path.dirname(os.path.abspath(__file__)); g = os.path.join(root, 'gas'); out = os.path.join(root, 'docs'); os.makedirs(out, exist_ok=True)
SHIM = '''<script src="config.js"></script>
<script>
// google.script.run の代わりに、Apps Script の doPost へ fetch で送る（Content-Type は text/plain にして事前確認なしで通す）
window.google = { script: { run: (function () {
  function mk(ok, ng) { return new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return h => mk(h, ng);
    if (name === 'withFailureHandler') return h => mk(ok, h);
    return (...args) => { fetch(window.NENCHO.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: args[0], payload: args[1] || {} }) })
      .then(r => r.json()).then(j => { if (j.error) { ng && ng(new Error(j.error)); } else ok && ok(j.result); }).catch(e => ng && ng(e)); };
  } }); }
  return mk(null, null); })() } };
</script>'''
def rd(n): return open(os.path.join(g, n), encoding='utf-8').read()
def wr(n, s): open(os.path.join(out, n), 'w', encoding='utf-8').write(s)
# 従業員
s = rd('EmpPage.html')
s = s.replace('<?= cfg.app_name ?>', 'メーティス 年末調整').replace('<?= cfg.brand_color ?>', '#00A88E')
s = s.replace('<?!= JSON.stringify(cfg.liff_id) ?>', '(window.NENCHO.liff_id || "")').replace('<?= cfg.year ?>', '(window.NENCHO.year)')
# 判定ロジック（Judge.gs）を画面にも同梱：扶養・配偶者の区分を手元で即時に出す。元は1つ（gas/Judge.gs）
com = rd('Common.gs')
tax = re.search(r'var TAX = \{.*?\};', com, re.S).group(0)
helpers = '\n'.join(re.search(r'^function ' + n + r'\(.*$', com, re.M).group(0) for n in ['zenToHanDigits', 'yen', 'fmt'])
JUDGE = '<script>(function(){\n' + tax + '\nfunction cfg(){ return { year: window.NENCHO.year, tax: TAX }; }\n' + helpers + '\n' + rd('Judge.gs') + '\nwindow.judgeCompute = compute;\n})();</script>'
s = s.replace('<head>', '<head>' + SHIM + JUDGE, 1)
assert '<?' not in s; wr('index.html', s)
# 事務所
s = rd('AdminPage.html').replace('<?= cfg.app_name ?>', 'メーティス 年末調整').replace('<head>', '<head>' + SHIM, 1)
assert '<?' not in s; wr('admin.html', s)
# 会社：ctx はサーバーから取る
s = rd('CompanyPage.html')
s = re.sub(r'<\? if \(!ctx\.ok\) \{ \?>.*?<\? \} else \{ \?>', '', s, flags=re.S).replace('<? } ?>', '')
s = s.replace('<title>在籍者の確認 - <?= ctx.ok ? ctx.name : \'\' ?></title>', '<title>在籍者の確認</title>')
s = s.replace('<header><b><?= ctx.name ?></b><br><small><?= ctx.year ?>年 年末調整　在籍者の確認</small></header>', '<header><b id="ctxname">読み込み中…</b><br><small><span id="ctxyear"></span>年 年末調整　在籍者の確認</small></header>')
s = s.replace("const CTX = { c: <?!= JSON.stringify(ctx.client) ?>, k: <?!= JSON.stringify(q.k || '') ?> }, YEAR = <?= ctx.year ?>;",
  "const _qs = new URLSearchParams(location.search); const CTX = { c: _qs.get('c') || '', k: _qs.get('k') || '' }, YEAR = window.NENCHO.year; document.getElementById('ctxyear').textContent = YEAR;")
s = s.replace("async function load(){ try{ const j=await api('list'); render(j.rows); }catch(e){ msg(e.message); } }",
  "async function load(){ try{ const j=await api('list'); document.getElementById('ctxname').textContent=j.ctx.name; document.title='在籍者の確認 - '+j.ctx.name; render(j.rows); }catch(e){ document.getElementById('ctxname').textContent='開けません'; document.querySelectorAll('.wrap .card').forEach(c=>c.style.display='none'); msg(e.message); } }")
s = s.replace('<head>', '<head>' + SHIM, 1)
assert '<?' not in s, re.findall(r'<\?.*?\?>', s); wr('company.html', s)
# 設定ファイル（無ければ雛形）
cfgp = os.path.join(out, 'config.js')
if not os.path.exists(cfgp):
    open(cfgp, 'w', encoding='utf-8').write("// 画面の設定。api は Apps Script の配備URL（…/exec）\nwindow.NENCHO = { api: 'https://script.google.com/macros/s/XXXX/exec', year: 2026, liff_id: '' };\n")
open(os.path.join(out, '.nojekyll'), 'w').close()
print('docs/ built')

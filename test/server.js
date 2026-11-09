// ローカルで GAS 版を動かす開発サーバー（google.script.run を /rpc に置き換える）
const http = require('http'), fs = require('fs'), url = require('url'), vm = require('vm'); const { makeContext } = require('./gasmock');
const PORT = +(process.env.PORT || 8090);
const ctx = makeContext({ props: { YEAR: '2026', DEADLINE_TEXT: '令和8年12月4日（金）', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || (process.env.FAKE_AI ? 'fake' : '') }, baseUrl: 'http://127.0.0.1:' + PORT + '/exec',
  fetch: (u, o) => { // Claude API だけ本物（鍵があれば）。それ以外は失敗
    if (process.env.FAKE_AI && /api\.anthropic\.com/.test(u)) { const body = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ doc_type: 'life', issuer: 'サンプル生命保険株式会社（架空）', year: 2026, items: [{ category: 'life', contract: 'new', amount: 60000, label: '一般生命保険料・新制度（申告額）', start_date: '', confidence: 'high' }, { category: 'kaigo', contract: 'new', amount: 24000, label: '介護医療保険料（申告額）', start_date: '', confidence: 'high' }], notes: '' }) }], usage: { input_tokens: 1200, output_tokens: 150 } }); return { getResponseCode: () => 200, getContentText: () => body }; }
    if (/api\.anthropic\.com/.test(u) && process.env.ANTHROPIC_API_KEY) { const r = require('child_process').spawnSync('curl', ['-s', '-o', '/tmp/claude_res.json', '-w', '%{http_code}', '-X', 'POST', u, '-H', 'content-type: application/json', '-H', 'x-api-key: ' + process.env.ANTHROPIC_API_KEY, '-H', 'anthropic-version: 2023-06-01', '--data-binary', '@-'], { input: o.payload }); const code = parseInt(r.stdout.toString(), 10); const body = fs.readFileSync('/tmp/claude_res.json', 'utf8'); return { getResponseCode: () => code, getContentText: () => body }; }
    throw new Error('テスト環境ではネットに出られません: ' + u); } });
const run = (code) => vm.runInContext(code, ctx);
// 初期データ
ctx.__csv = fs.readFileSync('/tmp/KYCSV0601019999.CSV').toString('base64');
run('初期設定(); icsImport("9999", sjisToUtf8(__csv)); jsonSave(rootFolder(), "_clients.json", {"9999":"サンプル株式会社"});');
// テスト用に事務所パスワードと認証を固定
if (process.env.STATIC) run('setProp("PAGES_URL", "http://127.0.0.1:8091/")');
run('setProp("ADMIN_PW_HASH", pwHash("test-pass-1234")); setProp("ADMIN_TOTP_SECRET", "JBSWY3DPEHPK3PXP");');
console.log('pins:', run('JSON.stringify(Object.values(summaryLoad("9999")).map(function(e){return e.emp+":"+e.pin}))'));
const SHIM = `<script>window.google={script:{run:(function(){function mk(ok,ng){return new Proxy({},{get(_,name){ if(name==='withSuccessHandler') return h=>mk(h,ng); if(name==='withFailureHandler') return h=>mk(ok,h); return (...args)=>{ fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fn:name,args})}).then(r=>r.json()).then(j=>{ if(j.error){ ng&&ng(new Error(j.error)); } else ok&&ok(j.result); }).catch(e=>ng&&ng(e)); }; }}); } return mk(null,null); })()}};</script>`;
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'POST' && u.pathname === '/rpc') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => { try { const { fn, args } = JSON.parse(body); ctx.__args = args; const r = run('(function(){ return ' + fn + '.apply(null, __args); })()'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: r })); } catch (e) { res.end(JSON.stringify({ error: String(e.message || e) })); } });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/post') { // 外の画面からの doPost を真似る（CORS付き）
    let body = ''; req.on('data', c => body += c); req.on('end', () => { ctx.__body = body; const r = run('doPost({postData:{contents: __body}})'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(r.getContent()); });
    return;
  }
  if (u.pathname === '/exec' || u.pathname === '/') {
    try { ctx.__q = u.query; const out = run('doGet({parameter: __q})'); let html = out._html; html = html.replace('<head>', '<head>' + SHIM); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
    catch (e) { res.statusCode = 500; res.end('error: ' + e.stack); }
    return;
  }
  if (u.pathname === '/__dump') { res.end(JSON.stringify([...ctx.__nodes.values()].map(n => ({ id: n.id, name: n.name, type: n.type, parent: n.parent, size: n.bytes ? n.bytes.length : 0 })), null, 1)); return; }
  res.statusCode = 404; res.end('not found');
}).listen(PORT, () => console.log('listening', PORT));

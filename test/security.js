// 守りの点検（2026-11-14 に見つかった不備4件が通らないことを確かめる）
// 使い方： node test/security.js   （見本CSVは不要）
const { makeContext } = require('./gasmock'); const vm = require('vm'); const fs = require('fs'); const path = require('path');
let lineOk = {}; // 模擬のLINE：この表にあるIDトークンだけ本物として扱う
const ctx = makeContext({ props: { YEAR: '2026', LIFF_ID: '1234567890-AbCdEfGh' }, fetch: (u, o) => {
  if (/api\.line\.me\/oauth2\/v2\.1\/verify/.test(u)) { const sub = lineOk[o.payload.id_token]; if (o.payload.client_id !== '1234567890') return { getResponseCode: () => 400, getContentText: () => '{}' };
    return sub ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub }) } : { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_request"}' }; }
  throw new Error('no net ' + u); } });
const run = (code) => vm.runInContext(code, ctx);
const call = (action, payload) => { ctx.__a = action; ctx.__p = payload; return JSON.parse(run('JSON.stringify(api(__a, __p))')); };
let ng = 0; const check = (label, cond) => { console.log((cond ? '  OK  ' : '  NG  ') + label); if (!cond) ng++; };

run('rootFolder(); var keys={}; keys["9999"]={key:"k",issued_at:nowIso()}; jsonSave(rootFolder(),"_company_keys.json",keys);');
const K = { c: '9999', k: 'k' };
for (const n of ['見本 一郎', '見本 二郎', '見本 三郎']) call('company.add', Object.assign({ name: n, kana: 'ミホン', hire: '2026-04' }, K));
let rows = call('company.list', K).rows; const A = rows[0], B = rows[1], C = rows[2];

console.log('1. 会社用ページから、好きな文字を個人コードとして送り込めない');
const EVIL = "x');alert(document.cookie);('";
let r = call('company.roster', Object.assign({ emp: EVIL, status: 'active', hire: '2026-04' }, K));
check('一覧にない個人コードは断る', r.ok === false);
check('一覧（集計）に細工した行が増えていない', !JSON.parse(run('JSON.stringify(Object.keys(summaryLoad("9999")))')).some(k => /alert/.test(k)));
check('再発行も、一覧にない個人コードは断る', call('company.pin_reissue', Object.assign({ emp: EVIL }, K)).ok === false);
check('一覧にある人の在籍変更は今までどおり通る', call('company.roster', Object.assign({ emp: A.emp, status: 'active', hire: '2026-05' }, K)).ok === true);

console.log('2. 画面のボタンに入れた値で、命令を差し込めない');
// ブラウザと同じ順に処理する：ボタンの属性の文字（&#39; など）を元に戻してから、命令として読む
const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
for (const page of ['AdminPage.html', 'CompanyPage.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gas', page), 'utf8');
  const esc = eval('(' + /const esc = (s => .*?);\n/.exec(html)[1] + ')');
  const qm = /const q = (v => .*?);\n/.exec(html); const q = qm ? eval('(' + qm[1] + ')') : null;
  check(page + '：ボタンの中に esc() だけで値を入れている箇所がない', !/on(click|change|input)="[^"]*'\$\{/.test(html));
  if (!q) { check(page + '：ボタン用の関数 q() がある', false); continue; }
  let allSafe = true;
  for (const v of [EVIL, "'+alert(1)+'", '");alert(1);//', '\\', "\\');alert(1)//", '</script><script>alert(1)</script>', 'O\'Brien 太郎', '&#39;);alert(1);(&#39;']) {
    const attr = `f(${q(v)})`; let got, alerted = false;
    try { new Function('f', 'alert', decode(attr))(x => { got = x; }, () => { alerted = true; }); } catch (e) { alerted = true; }
    if (alerted || got !== v) allSafe = false;
  }
  check(page + '：記号入りの値を入れても、値はそのまま届き、余計な命令は動かない', allSafe);
}

console.log('3. 暗証番号を数で当てられない');
check('登録コードだけ送ったとき、実在しない番号でも同じ返事（実在を教えない）', JSON.stringify(call('login', { code: A.code })) === JSON.stringify(call('login', { code: '9999999999' })) && JSON.stringify(call('login', { code: '1234000001' })) === JSON.stringify(call('login', { code: A.code })));
const wrong = p => (p === '000000' ? '111111' : '000000');
const e1 = call('login', { code: A.code, pin: wrong(A.pin) }).error, e2 = call('login', { code: '9999999999', pin: '000000' }).error;
check('暗証番号違いと、実在しない登録コードで、同じ文が返る', !!e1 && e1 === e2);
// 15分の一時停止を毎回外しても（＝15分おきに根気よく試しても）、累計10回で止まる
let lockedAt = 0;
for (let i = 1; i <= 12 && !lockedAt; i++) { run('throttleClear("code:' + B.code + '"); throttleClear("client:9999");'); const x = call('login', { code: B.code, pin: wrong(B.pin) }); if (/止めています/.test(x.error || '')) lockedAt = i; }
check('間違いが累計10回で、その暗証番号が止まる（' + (lockedAt - 1) + ' 回間違えた次の回から入れない）', lockedAt === 11);
run('throttleClear("code:' + B.code + '"); throttleClear("client:9999");');
check('止まったあとは、正しい暗証番号でも入れない', call('login', { code: B.code, pin: B.pin }).ok === false);
rows = call('company.list', K).rows;
check('会社の一覧に「停止中」が出る', rows.find(w => w.emp === B.emp).pin_locked === true);
call('company.pin_reissue', Object.assign({ emp: B.emp }, K)); rows = call('company.list', K).rows; const B2 = rows.find(w => w.emp === B.emp);
check('再発行すると停止が外れ、新しい暗証番号で入れる', B2.pin_locked === false && call('login', { code: B.code, pin: B2.pin }).ok === true);
run('throttleClear("code:' + A.code + '"); throttleClear("client:9999");');
check('正しい暗証番号なら今までどおり入れる', call('login', { code: A.code, pin: A.pin }).ok === true);

console.log('4. LINE の ID を名乗るだけでは入れない');
lineOk = { 'good-token-C': 'Uc000000000000000000000000000000c' };
run('throttleClear("client:9999");');
const lc = call('login', { code: C.code, pin: C.pin, id_token: 'good-token-C' });
check('LINEに照会できたときだけ結びつく', lc.ok === true && lc.record.line_user_id === 'Uc000000000000000000000000000000c');
check('古い送り方（LINEのIDを名乗る）では入れない', call('line_login', { line_user_id: 'Uc000000000000000000000000000000c' }).known === false);
check('偽のIDトークンでは入れない', call('line_login', { id_token: 'fake-token' }).known === false);
check('本物のIDトークンなら入れる', call('line_login', { id_token: 'good-token-C' }).known === true);
run('withLock(function(){ var mp=jsonLoad(rootFolder(),"_line_map.json",{}); for (var k in mp) mp[k].at="2026-01-01T00:00:00+09:00"; jsonSave(rootFolder(),"_line_map.json",mp); });');
check('結びつけてから日数が過ぎたら、暗証番号の入れ直しになる', call('line_login', { id_token: 'good-token-C' }).known === false);
run('throttleClear("client:9999");'); call('login', { code: C.code, pin: C.pin, id_token: 'good-token-C' });
call('company.pin_reissue', Object.assign({ emp: C.emp }, K));
check('暗証番号を再発行すると、LINEの結びつけも外れる', call('line_login', { id_token: 'good-token-C' }).known === false);
run('throttleClear("client:9999");');
const la = call('login', { code: A.code, pin: A.pin, line_user_id: 'Uattacker' });
check('名乗っただけのLINEのIDは結びつけない', la.ok === true && !la.record.line_user_id && !JSON.parse(run('JSON.stringify(lineMapLoad())')).Uattacker);

console.log('5. 乱数');
const src = fs.readdirSync(path.join(__dirname, '..', 'gas')).map(f => fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8')).join('\n');
check('サーバー側のコードで Math.random( を使っていない', !/Math\.random\(/.test(src.replace(/<script[\s\S]*?<\/script>/g, '')));
if (run('typeof randomPick') === 'function') { const d = run('randomDigits(6000)'); const cnt = Array(10).fill(0); for (const ch of d) cnt[+ch]++;
  check('暗証番号の数字に偏りがない', /^\d{6000}$/.test(d) && Math.min(...cnt) > 500 && Math.max(...cnt) < 700); check('合鍵は48文字の16進', /^[0-9a-f]{48}$/.test(run('randomHex(24)'))); }

console.log(ng ? '\n不合格 ' + ng + ' 件' : '\nすべて合格');
process.exit(ng ? 1 : 0);

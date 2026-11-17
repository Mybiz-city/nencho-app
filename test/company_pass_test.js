// 会社用ページの「社長用の番号」の確認（node test/company_pass_test.js）。見本CSVは要らない
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert');
const ctx = makeContext({ props: { YEAR: '2026' } }); const run = c => vm.runInContext(c, ctx);
const api = (a, p) => { ctx.__a = a; ctx.__p = p; return run('api("company." + __a, __p)'); };
const adm = (a, p) => { ctx.__a = a; ctx.__p = p; return run('adminApi(__a, __p)'); };
let n = 0; const ok = (label, cond) => { n++; assert.ok(cond, label); console.log('  ok  ' + label); };
run('rootFolder(); jsonSave(rootFolder(), "_clients.json", {"9999":"サンプル株式会社"}); adminNeed = function () {};'); // 事務所のログインはここでは省く
adm('company_key', { client: '9999' });
const K = () => run('jsonLoad(rootFolder(), "_company_keys.json", {})["9999"]');
const base = () => ({ c: '9999', k: K().key });

console.log('1. URLだけでは一覧が出ない');
ok('合言葉が違うURLは開けない', api('gate', { c: '9999', k: 'x' }).ok === false);
ok('初回は「番号を決める」状態', api('gate', base()).state === 'set');
ok('番号を決める前は一覧が出ない', api('list', base()).ok === false && !api('list', base()).rows);
ok('番号を決める前は従業員を追加できない', api('add', Object.assign(base(), { name: '山田 太郎', kana: 'ヤマダ タロウ', hire: '2026-04' })).ok === false);

console.log('2. 初回に番号を決める');
ok('5桁は断る', api('pass_set', Object.assign(base(), { pass: '12345' })).ok === false);
ok('同じ数字6つは断る', api('pass_set', Object.assign(base(), { pass: '111111' })).ok === false);
ok('123456 は断る', api('pass_set', Object.assign(base(), { pass: '123456' })).ok === false);
const s1 = api('pass_set', Object.assign(base(), { pass: '２４６８１０' })); // 全角でも通る
ok('番号を決めると端末の合鍵が返る', s1.ok && /^[0-9a-f]{48}$/.test(s1.dev));
ok('番号を決めた返事に一覧も入っている（通信1回で画面が出る）', Array.isArray(s1.rows) && s1.ctx && s1.ctx.name === 'サンプル株式会社');
ok('番号そのものは保存しない（ハッシュだけ）', JSON.stringify(K()).indexOf('246810') < 0 && JSON.stringify(K()).indexOf(s1.dev) < 0);
ok('2回目は決められない', api('pass_set', Object.assign(base(), { pass: '135790' })).ok === false);
const d1 = Object.assign(base(), { dev: s1.dev });
ok('決めた端末は番号なしで開く', api('gate', d1).state === 'ok' && api('list', d1).ok === true);
ok('決めた端末は従業員を追加できる', api('add', Object.assign({}, d1, { name: '山田 太郎', kana: 'ヤマダ タロウ', hire: '2026-04' })).ok === true);
ok('一覧に暗証番号が出るのは確認済みの端末だけ', api('list', d1).rows[0].pin.length === 6);

console.log('3. 別の端末（URLだけを知っている人）');
ok('番号を聞かれる', api('gate', base()).state === 'enter');
ok('番号を聞く返事には一覧が入っていない', api('gate', base()).rows === undefined && JSON.stringify(api('gate', base())).indexOf('pin') < 0);
ok('確認済みの端末への返事には一覧が入っている', api('gate', d1).rows.length === 1);
ok('一覧は出ない', api('list', base()).ok === false);
ok('でたらめな合鍵でも出ない', api('list', Object.assign(base(), { dev: 'a'.repeat(48) })).ok === false);
const w1 = api('pass_enter', Object.assign(base(), { pass: '000001' }));
ok('違う番号は通らず、返事に一覧も入っていない', w1.ok === false && w1.rows === undefined);
const s2 = api('pass_enter', Object.assign(base(), { pass: '246810' }));
ok('正しい番号で開き、合鍵が返る', s2.ok && s2.dev && s2.dev !== s1.dev);
ok('正しい番号の返事に一覧も入っている', s2.rows.length === 1);
ok('2台目も一覧が出る', api('list', Object.assign(base(), { dev: s2.dev })).ok === true);
ok('正しく入ると間違いの回数は0に戻る', (K().pass_fail || 0) === 0);

console.log('4. 間違いが続いたとき');
for (let i = 0; i < 4; i++) api('pass_enter', Object.assign(base(), { pass: '999999' }));
const r5 = api('pass_enter', Object.assign(base(), { pass: '999999' }));
ok('5回目も通らない', r5.ok === false);
const r6 = api('pass_enter', Object.assign(base(), { pass: '246810' }));
ok('5回間違えると、正しい番号でも15分止まる', r6.ok === false && /15分/.test(r6.error));
ok('止まっている間も、確認済みの端末は使える', api('list', d1).ok === true);
for (let i = 0; i < 15; i++) { run('throttleClear("cpass:9999")'); api('pass_enter', Object.assign(base(), { pass: '999999' })); } // 15分待った体で続ける
run('throttleClear("cpass:9999")');
ok('20回続けて間違えると止まる', api('gate', base()).state === 'locked');
ok('止まった後は正しい番号でも開かない', api('pass_enter', Object.assign(base(), { pass: '246810' })).ok === false);
const c1 = adm('client', { client: '9999' }).company;
ok('事務所画面に「止まっている」と出る', c1.pass_set === true && c1.pass_stopped === true && c1.devs === 2);

console.log('5. 事務所の「やり直し」と、URLの作り直し');
ok('やり直しができる', adm('company_pass_reset', { client: '9999' }).ok === true);
ok('やり直すと、前の端末も番号を決め直す', api('gate', d1).state === 'set' && api('list', d1).ok === false);
const s3 = api('pass_set', Object.assign(base(), { pass: '135790' }));
ok('決め直せる', s3.ok === true);
const oldUrl = base(), oldDev = s3.dev;
adm('company_key', { client: '9999' });
ok('URLを作り直すと古いURLは開けない', api('gate', Object.assign({}, oldUrl, { dev: oldDev })).ok === false);
ok('新しいURLは番号が白紙', api('gate', Object.assign(base(), { dev: oldDev })).state === 'set');
const c2 = adm('client', { client: '9999' }).company;
ok('事務所画面に「未設定」と出る', c2.pass_set === false && c2.devs === 0);
console.log('\n全 ' + n + ' 項目 OK');

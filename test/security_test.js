// 守りの確認（node test/security_test.js）。見本CSVは要らない。架空の氏名のみ
// 1) 画面に命令を仕込めないこと　2) 暗証番号を10回続けて間違えると再発行まで止まること　3) 事務所の大事な操作は6桁の再確認が要ること
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert'); const fs = require('fs'); const path = require('path');
const ctx = makeContext({ props: { YEAR: '2026' } }); const run = c => vm.runInContext(c, ctx);
const call = (a, p) => { ctx.__a = a; ctx.__p = p; return run('api(__a, __p)'); };
let n = 0; const ok = (label, cond) => { n++; assert.ok(cond, label); console.log('  ok  ' + label); };
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
run('rootFolder(); jsonSave(rootFolder(), "_clients.json", {"9999":"サンプル株式会社"}); setProp("ADMIN_PW_HASH", pwHash("office-pass-123456")); setProp("ADMIN_TOTP_SECRET", "' + SECRET + '");');
const otp = () => run('totpCode("' + SECRET + '", Math.floor(Date.now() / 1000))');
const T = call('admin.login', { pw: 'office-pass-123456', otp: otp() })._t; ok('事務所にログインできる', !!T);
const adm = (a, p) => call('admin.' + a, Object.assign({ _t: T }, p || {}));
adm('company_key', { client: '9999' });
const KEY = run('jsonLoad(rootFolder(), "_company_keys.json", {})["9999"].key');
const DEV = call('company.pass_set', { c: '9999', k: KEY, pass: '246810' }).dev;
const co = (a, p) => call('company.' + a, Object.assign({ c: '9999', k: KEY, dev: DEV }, p || {}));
ok('会社用ページから従業員を追加できる', co('add', { name: '見本 一郎', kana: 'ミホン イチロウ', hire: '2024-04' }).ok && co('add', { name: '見本 二郎', kana: 'ミホン ジロウ', hire: '2024-04' }).ok);
let rows = co('list').rows; const E1 = rows[0], E2 = rows[1];

console.log('1. 画面に命令を仕込めない');
const BAD = "Z');window.__mark=1;//";
ok('会社用ページ：一覧にいない個人コードでは保存できない', co('roster', { emp: BAD, status: 'active', hire: '2026-04' }).ok === false);
ok('会社用ページ：一覧にいない個人コードでは再発行できない', co('pin_reissue', { emp: BAD }).ok === false);
ok('会社用ページ：一覧にいない個人コードでは氏名を直せない・削除できない', co('edit', { emp: BAD, name: 'x' }).ok === false && co('remove', { emp: BAD }).ok === false);
ok('一覧に、変な個人コードの行が増えていない', co('list').rows.length === 2 && adm('client', { client: '9999' }).rows.every(w => /^[\w*-]+$/.test(w.emp)));
ok('入社日に日付以外の文字は入らない', co('roster', { emp: E1.emp, status: 'active', hire: '<b>x</b>' }).ok && co('list').rows[0].hire === '');
ok('事務所画面：個人コードに使えない文字は断る', adm('add_emp', { client: '9999', emp: BAD }).ok === false && adm('assign_code', { client: '9999', old: E1.emp, new: BAD }).ok === false && adm('emp', { client: '9999', emp: BAD }).ok === false);
ok('ふつうの個人コード（**000001 など）は通る', run('empIdOk("**000001") && empIdOk("N001") && empIdOk("A-12_3") && !empIdOk("a b") && !empIdOk("") && !empIdOk("x\'y")'));
// 画面の中に「ボタンへ値を直接入れる書き方」が残っていないこと（esc だけでは防げないため）
const pages = ['AdminPage.html', 'CompanyPage.html', 'EmpPage.html'].map(f => fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8'));
const bad = []; pages.forEach(h => { const re = /on(?:click|change|input|keydown|blur)="([^"]*)"/g; let m; while ((m = re.exec(h))) if (/\$\{\s*esc\(/.test(m[1])) bad.push(m[1].slice(0, 80)); });
ok('ボタンの中に esc(...) で値を入れている箇所がない（jq か行番号を使う）', bad.length === 0);
// 氏名に引用符が入っていても、会社用ページの裏側はそのまま文字として返すだけ（画面側は行番号で引く）
const lg0 = call('login', { code: E1.code, pin: E1.pin }); call('save', { _t: lg0._t, answers: { name: "見本')){};window.__mark=1;//" } });
ok('従業員が氏名に記号を入れても、保存はできる（文字として扱う）', co('list').rows[0].name.indexOf("')){}") > 0);

console.log('2. 暗証番号：10回続けて間違えると、再発行まで止まる');
const wrong = pin => { run('throttleClear("code:' + E2.code + '"); throttleClear("client:9999")'); return call('login', { code: E2.code, pin }); }; // 15分の停止は別の仕組みなので、ここでは解除しながら数える
let last = null; for (let i = 0; i < 9; i++) last = wrong('000000');
ok('9回目までは「一致しません」で、回数が消えずに数えられている', /一致しません/.test(last.error) && run('empRoster("9999", "' + E2.emp + '").pin_fail') === 9);
ok('9回間違えた時点では、まだ正しい番号で入れる状態（止まっていない）', co('list').rows[1].pin_locked === false);
const t10 = wrong('000000'); ok('10回目で止まる', t10.ok === false && /止めています/.test(t10.error) && run('empRoster("9999", "' + E2.emp + '").pin_fail') === 10);
const stopped = wrong(E2.pin); ok('止まった後は、正しい暗証番号でも入れない', stopped.ok === false && /止めています/.test(stopped.error));
ok('会社用ページの一覧に「止まっている」印が出る', co('list').rows[1].pin_locked === true && co('list').rows[0].pin_locked === false);
ok('事務所画面の一覧にも印が出る', adm('client', { client: '9999' }).rows.find(w => w.emp === E2.emp).pin_locked === true);
const re = co('pin_reissue', { emp: E2.emp }); const newPin = re.rows[1].pin;
ok('再発行すると印が消え、新しい暗証番号で入れる', re.ok && re.rows[1].pin_locked === false && newPin !== E2.pin && wrong(newPin).ok === true);
for (let i = 0; i < 3; i++) wrong('000000');
ok('途中で正しく入ると、回数は0に戻る', wrong(newPin).ok === true && (run('empRoster("9999", "' + E2.emp + '").pin_fail') || 0) === 0);

console.log('3. 事務所の大事な操作は、6桁の再確認が要る');
['update', 'settings_set', 'change_pw', 'backup_codes', 'purge'].forEach(a => { const r = adm(a, { pw: 'new-office-pass-1234', year: 2000, app_name: 'x' }); ok(a + '：合鍵だけでは実行されない', r.ok === false && r.need_otp === true); });
ok('設定は変わっていない', run('cfg._c = null, cfg().app_name') !== 'x' && call('admin.login', { pw: 'new-office-pass-1234', otp: otp() }).ok === false);
run('throttleClear("admin")');
ok('違う6桁では通らない', adm('settings_set', { app_name: 'x', otp: '000000' }).need_otp === true);
ok('正しい6桁で通る', adm('settings_set', { app_name: 'メーティス 年末調整', otp: otp() }).ok === true);
ok('確認の直後（5分間）は聞き直さない', adm('settings_set', { deadline_text: '12月4日' }).ok === true);
const T2 = call('admin.login', { pw: 'office-pass-123456', otp: otp() })._t;
ok('別のログイン（別の合鍵）には、その確認は引き継がれない', call('admin.settings_set', { _t: T2, app_name: 'y' }).need_otp === true);
ok('ふだんの操作（一覧・出力）は今までどおり', adm('home').ok === true && adm('client', { client: '9999' }).ok === true);
console.log('\n全 ' + n + ' 項目 OK');

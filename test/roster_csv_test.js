// 名簿CSVの「出す・読み込む」：会社用ページと事務所画面で同じ仕組み。事務所は日本ICSの形と使い分ける。架空の氏名のみ
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert');
const ctx = makeContext({ props: { YEAR: '2026' } }); const run = c => vm.runInContext(c, ctx);
const api = (a, p) => { ctx.__a = a; ctx.__p = p; return run('api("company." + __a, __p)'); };
const adm = (a, p) => { ctx.__a = a; ctx.__p = p; return run('adminApi(__a, __p)'); };
let n = 0; const ok = (label, cond) => { n++; assert.ok(cond, label); console.log('  ok  ' + label); };
run('rootFolder(); adminNeed = function () {};'); adm('company_key', { client: '9999' });
const key = run('jsonLoad(rootFolder(), "_company_keys.json", {})["9999"].key');
const dev = api('pass_set', { c: '9999', k: key, pass: '246810' }).dev; const base = o => Object.assign({ c: '9999', k: key, dev: dev }, o || {});

console.log('1. 事務所：会社用の形で読み込む');
let r = adm('roster_import', { client: '9999', text: '社員番号,氏名,フリガナ,入社日,退職日\n1,見本 一郎,ミホン イチロウ,2020/4/1,\n3,見本 三郎,,2026年4月,\n25,見本 花子,ミホン ハナコ,平成30年10月1日,2026/9/30\n' });
ok('3人追加', r.add === 3 && r.upd === 0 && r.skip === 0);
let rows = adm('client', { client: '9999' }).rows;
ok('個人コードは **＋社員番号', rows.map(w => w.emp).join() === '**000001,**000003,**000025');
ok('入社日（年月日・年月だけ・和暦）', rows[0].hire === '2020-04-01' && rows[1].hire === '2026-04' && rows[2].hire === '2018-10-01');
ok('退職日が入った人は退職', rows[2].roster === 'retired' && rows[2].retire === '2026-09-30' && rows[0].roster === 'active');

console.log('2. 出す（事務所・会社で同じ中身）');
const ea = adm('roster_export', { client: '9999' }), ec = api('export', base());
ok('事務所と会社で同じCSV', ea.csv === ec.csv && /^9999_名簿_\d{8}\.csv$/.test(ea.filename));
ok('見出し', ea.csv.split('\r\n')[0] === '社員番号,氏名,フリガナ,入社日,退職日');
ok('中身', ea.csv.split('\r\n').slice(1, 4).join('|') === '1,見本 一郎,ミホン イチロウ,2020/04/01,|3,見本 三郎,,2026年4月,|25,見本 花子,ミホン ハナコ,2018/10/01,2026/09/30');
ok('登録コード・暗証番号は入らない', rows.every(w => ea.csv.indexOf(w.pin) < 0) && ea.csv.indexOf('9999000001') < 0);
ok('番号を確認していない端末には出さない', api('export', { c: '9999', k: key }).ok === false);

console.log('3. 出したCSVをそのまま読み込み直す → 何も変わらない');
r = api('bulk', base({ text: ec.csv })); ok('会社：更新3・追加0', r.upd === 3 && r.add === 0 && r.skip === 0);
r = adm('roster_import', { client: '9999', text: '﻿' + ea.csv }); ok('事務所：更新3・追加0（BOMつきでも）', r.upd === 3 && r.add === 0);
ok('中身は同じまま', adm('roster_export', { client: '9999' }).csv === ea.csv);

console.log('4. 直して読み込む');
r = api('bulk', base({ text: ea.csv.replace('3,見本 三郎,,2026年4月,', '3,見本 三郎,ミホン サブロウ,2026/4/15,2026/10/31').replace('2020/04/01', '') + '26,見本 新人,ミホン シンジン,2026/11/1,\r\n' }));
ok('更新3・追加1', r.upd === 3 && r.add === 1);
rows = adm('client', { client: '9999' }).rows;
ok('入社日・退職日・フリガナが変わる', rows[1].hire === '2026-04-15' && rows[1].retire === '2026-10-31' && rows[1].roster === 'retired' && rows[1].kana === 'ミホン サブロウ');
ok('空欄にした項目は変えない', rows[0].hire === '2020-04-01');
ok('追加した人', rows[3].emp === '**000026' && rows[3].hire === '2026-11-01');

console.log('5. 事務所：種類とファイルが合わないと止まる');
const hdr = ['個人コード'].concat(Array.from({ length: 539 }, (_, i) => 'h' + i)); const row = Array(540).fill(''); row[0] = '**000050'; row[2] = '前年'; row[3] = '太郎'; row[4] = 'ｾﾞﾝﾈﾝ'; row[5] = 'ﾀﾛｳ';
const ics = [['給与'], ['タイプ６'], hdr, row].map(x => x.map(c => '"' + c + '"').join(',')).join('\r\n') + '\r\n';
assert.throws(() => adm('roster_import', { client: '9999', text: ics }), /氏名/); ok('日本ICSのCSVを「会社用の形」で入れると止まる', true);
const b64 = t => run('Utilities.base64Encode(Utilities.newBlob("").setDataFromString(' + JSON.stringify(t) + ', "Shift_JIS").getBytes())');
r = adm('import_csv', { client: '9999', files: [{ name: '名簿.csv', b64: b64(ea.csv) }] }); ok('名簿CSVを「日本ICSの形」で入れると取り込まない', /取込に失敗/.test(r.msg) && adm('client', { client: '9999' }).rows.length === 4);
r = adm('import_csv', { client: '9999', files: [{ name: 'なんでも.csv', b64: b64(ics) }] }); ok('日本ICSの形は、顧問先のページからならファイル名を問わず入る', /1 人/.test(r.msg));
rows = adm('client', { client: '9999' }).rows; ok('前年CSVの人も名簿に出る（半角カナのまま）', rows.length === 5 && adm('roster_export', { client: '9999' }).csv.indexOf('50,前年 太郎,ｾﾞﾝﾈﾝ ﾀﾛｳ,,') > 0);
console.log('\n全 ' + n + ' 項目 OK');

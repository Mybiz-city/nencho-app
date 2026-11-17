// 名簿CSVを前年CSVの欄に入れても取り込まれないこと／顧問先の名簿を空にしてやり直せること。架空の氏名のみ
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert');
const ctx = makeContext({ props: { YEAR: '2026' } }); const run = code => vm.runInContext(code, ctx);
run('rootFolder(); var T=sessionNew("adm",{admin:true},7200); adminApi("company_key",{_t:T,client:"9999"}); var K=jsonLoad(rootFolder(),"_company_keys.json",{})["9999"].key;');
const roster = '社員番号,氏名\n1,見本 一郎\n3,見本 三郎\n4,見本 四郎\n5,見本 五郎\n';
ctx.__r = roster;
// 1) 名簿CSVは、前年CSVとしては受け付けない
assert.throws(() => run('icsImport("9999", __r)'), /日本ICSの年末調整CSVではありません/);
assert.strictEqual(run('Object.keys(summaryLoad("9999")).length'), 0);
// 2) 日本ICSの形のCSVは今までどおり入る（見出し540列・4行目からデータ）
const hdr = ['個人コード'].concat(Array.from({ length: 539 }, (_, i) => 'h' + i)); const row = n => { const r = Array(540).fill(''); r[0] = '**00000' + n; r[2] = '見本'; r[3] = n + '郎'; return r; };
ctx.__i = [['給与'], ['タイプ６'], hdr, row(1), row(2)].map(r => r.map(c => '"' + c + '"').join(',')).join('\r\n') + '\r\n';
assert.strictEqual(run('icsImport("9999", __i).length'), 2);
// 3) 以前の版で誤って入った「氏名のない人」を再現し、空にする
run('var yd=pathFolder(["9999","2026"],true); ["10","11"].forEach(function(e){ jsonCreate(newSubFolder(yd,e),"roster.json",{status:"active",pin:"123456"}); summaryUpdate("9999",e); });');
assert.strictEqual(run('adminApi("client",{_t:T,client:"9999"}).rows.length'), 4);
assert.throws(() => run('adminApi("client_clear",{_t:T,client:"9999",confirm:"0000"})'), /確認/);
console.log(run('adminApi("client_clear",{_t:T,client:"9999",confirm:"9999"}).msg'));
assert.strictEqual(run('adminApi("client",{_t:T,client:"9999"}).rows.length'), 0);
assert.strictEqual(run('adminApi("home",{_t:T}).rows.filter(function(x){return x.client==="9999";})[0].n'), 0);
// 4) 空にしたあと、会社用ページで名簿を読み込む → **＋社員番号
assert.strictEqual(run('companyApi("bulk",{c:"9999",k:K,text:__r}).add'), 4);
assert.deepStrictEqual(run('JSON.stringify(companyApi("list",{c:"9999",k:K}).rows.map(function(w){return w.emp+" "+w.code+" "+w.name;}))'), JSON.stringify(['**000001 9999000001 見本 一郎', '**000003 9999000003 見本 三郎', '**000004 9999000004 見本 四郎', '**000005 9999000005 見本 五郎']));
// 5) 提出済みの人がいると空にできない
run('var r=loadRecord("9999","**000003"); r.status="submitted"; saveRecord(r,true);');
assert.throws(() => run('adminApi("client_clear",{_t:T,client:"9999",confirm:"9999"})'), /提出済み/);
assert.strictEqual(run('adminApi("client",{_t:T,client:"9999"}).rows.length'), 4);
// 6) ドライブで年のフォルダを手でごみ箱に入れた跡（一時保存が古い場所を指す）があっても、空にしてやり直せる
run('var r=loadRecord("9999","**000003"); r.status="new"; saveRecord(r,true); pathFolder(["9999","2026"],false).setTrashed(true);');
run('adminApi("client_clear",{_t:T,client:"9999",confirm:"9999"})');
assert.strictEqual(run('companyApi("bulk",{c:"9999",k:K,text:__r}).add'), 4);
assert.strictEqual(run('pathFolder(["9999","2026"],false).isTrashed()'), false);
assert.strictEqual(run('companyApi("list",{c:"9999",k:K}).rows.length'), 4);
console.log('clear_test OK');

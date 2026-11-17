// 名簿CSV（会社用の形）の取込の本体 rosterBulk：氏名だけ（生年月日なし）・社員番号つき・以前の形式 の確認。架空の氏名のみ
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert');
function fresh() { const ctx = makeContext({ props: { YEAR: '2026' } }); vm.runInContext('rootFolder(); var keys={}; keys["9999"]={key:"k",issued_at:nowIso()}; jsonSave(rootFolder(),"_company_keys.json",keys);', ctx); return ctx; }
const run = (ctx, code) => vm.runInContext(code, ctx);
// 画面と同じく、見出しつきで10行ずつ送る
function upload(ctx, text) { const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== ''); const head = lines[0], body = lines.slice(1); const t = { upd: 0, add: 0, skip: 0, warn: [] };
  for (let i = 0; i < body.length; i += 10) { ctx.__t = [head].concat(body.slice(i, i + 10)).join('\n'); const j = run(ctx, 'rosterBulk("9999",__t,"company-csv")'); t.upd += j.upd; t.add += j.add; t.skip += j.skip; t.warn = t.warn.concat(j.warn); } return t; }
const list = ctx => run(ctx, 'companyRows("9999")');
const eq = (r, a) => assert.deepStrictEqual([r.upd, r.add, r.skip], a);

// 1) 氏名と社員番号だけ：空の顧問先に12人。個人コードは **＋社員番号6桁、暗証番号つき
let ctx = fresh(); let csv = '社員番号,氏名\n'; const nums = [1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 25]; nums.forEach(n => { csv += n + ',見本 ' + n + '郎\n'; });
eq(upload(ctx, csv), [0, 12, 0]); let rows = list(ctx);
assert(rows.every(w => /^\*\*\d{6}$/.test(w.emp) && /^9999\d{6}$/.test(w.code) && /^\d{6}$/.test(w.pin) && !w.pending && w.added));
assert.strictEqual(rows[0].code, '9999000001'); assert.strictEqual(rows[11].code, '9999000025');
eq(upload(ctx, csv), [12, 0, 0]); assert.strictEqual(list(ctx).length, 12); // 同じファイルをもう一度 → 増えない
const rec = run(ctx, 'loadRecord("9999","**000009")'); assert.strictEqual(rec.answers.name, '見本 9郎'); assert.strictEqual(rec.prev, null); // 本人が生年月日などを入力する
assert.strictEqual(run(ctx, 'nextEmpCode("9999")'), '**000026');
// 2) 番号の重なり・同じ氏名は足さずに知らせる
let r = upload(ctx, '社員番号,氏名\n1,別人 花子\n30,見本 9郎\n,見本 9郎\n31,追加 次郎\n,番号なし 三郎\n'); eq(r, [1, 2, 2]); assert.strictEqual(r.warn.length, 2);
// 3) 以前の形式（氏名・生年月日・入社日）
ctx = fresh(); let old = '氏名,生年月日,入社日\n'; for (let i = 0; i < 25; i++) old += `追加 ${i}郎,1990/01/${String(i % 28 + 1).padStart(2, '0')},2026/04/01\n`;
eq(upload(ctx, old), [0, 25, 0]); eq(upload(ctx, old), [25, 0, 0]); rows = list(ctx);
assert.strictEqual(rows[0].emp, '**000001'); assert.strictEqual(rows[0].birth, '1990-01-01'); assert.strictEqual(rows[0].hire, '2026-04-01');
eq(upload(ctx, '氏名,生年月日,退職日\n追加 3郎,1990/01/04,2026/09/30\n追加 3郎,1985/05/05,\n'), [1, 1, 0]); // 退職の更新／同じ氏名で生年月日が違う人は別人として追加
// 4) 「氏名」の見出しが無ければ止まる
assert.throws(() => upload(ctx, '名,生年月日\nx,1990/1/1\n'), /氏名/);
console.log('bulk_test OK');

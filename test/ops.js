// ドライブへの問い合わせ回数を数える（速さの物差し。本番の目安：読み 約0.3秒、書き 約1秒）
const { makeContext } = require('./gasmock'); const vm = require('vm'); const fs = require('fs'); const iconv = require('iconv-lite');
const est = o => Math.round(o.read * 0.3 + o.write * 1.0);
function measure(label, ctx, code) { ctx.__ops.read = 0; ctx.__ops.write = 0; const r = vm.runInContext(code, ctx); console.log(label.padEnd(44), 'read', String(ctx.__ops.read).padStart(4), 'write', String(ctx.__ops.write).padStart(4), ' 目安', est(ctx.__ops) + '秒'); return r; }
const ctx = makeContext({ props: { YEAR: '2026' } });
vm.runInContext('rootFolder(); var keys={}; keys["9999"]={key:"k",issued_at:nowIso()}; jsonSave(rootFolder(),"_company_keys.json",keys);', ctx);
// ICS 取込：5人の見本を20人分に増やす
const src = iconv.decode(fs.readFileSync('/tmp/KYCSV0601019999.CSV'), 'Shift_JIS').split('\r\n').filter(Boolean); const rows = [];
for (let i = 0; i < 20; i++) { const c = src[3 + (i % 5)].split('","'); c[0] = '"**' + String(i + 1).padStart(6, '0'); rows.push(c.join('","')); }
ctx.__text = src.slice(0, 3).concat(rows).join('\r\n') + '\r\n';
measure('ICS取込 20人（初回）', ctx, 'icsImport("9999", __text).length');
measure('ICS取込 20人（2回目・上書き）', ctx, 'icsImport("9999", __text).length');
// 会社CSV：50人追加
let csv = '氏名,生年月日,入社日\n'; for (let i = 0; i < 50; i++) csv += `追加 ${i}郎,1990/01/${String(i % 28 + 1).padStart(2, '0')},2026/04/01\n`;
ctx.__csv = csv; ctx.__b64 = Buffer.from(csv).toString('base64');
console.log(measure('会社CSV 50人追加', ctx, 'JSON.stringify((function(){ var r=companyApi("bulk",{c:"9999",k:"k",b64:__b64,text:__csv}); return r.msg; })())'));
console.log(measure('会社CSV 同じ50人を再読込（更新）', ctx, 'JSON.stringify(companyApi("bulk",{c:"9999",k:"k",b64:__b64,text:__csv}).msg)'));
measure('会社 1人追加', ctx, 'companyApi("add",{c:"9999",k:"k",name:"単独 太郎",kana:"タンドク タロウ",hire:"2026-04"}).ok');
measure('会社ページ 一覧', ctx, 'companyApi("list",{c:"9999",k:"k"}).rows.length');
console.log('summary人数', vm.runInContext('Object.keys(summaryLoad("9999")).length', ctx));
// 追加した人が従業員画面で名前を引き継ぐか
console.log('N001 name:', vm.runInContext('loadRecord("9999","N001").answers.name', ctx));

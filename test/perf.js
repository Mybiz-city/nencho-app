// 重さの物差し（従業員・会社・事務所のよく使う操作）。ドライブの読み書き回数を数える
// 使い方： node test/perf.js   （見本CSVは不要。会社ページの「追加」で20人を作ってから測る）
// 目安の秒数は ops.js と同じ式（読み 約0.3秒、書き 約1秒）。本番では Google の起動＋通信の2〜3秒が別に乗る
const { makeContext } = require('./gasmock'); const vm = require('vm'); const crypto = require('crypto');
const ctx = makeContext({ props: { YEAR: '2026' } });
const run = (code) => vm.runInContext(code, ctx);
const rows = [];
function measure(label, code) {
  ctx.__ops.read = 0; ctx.__ops.write = 0; const r = run(code);
  const o = { label, read: ctx.__ops.read, write: ctx.__ops.write }; o.est = Math.round((o.read * 0.3 + o.write * 1.0) * 10) / 10; rows.push(o);
  console.log(label.padEnd(40), 'read', String(o.read).padStart(3), 'write', String(o.write).padStart(3), ' 目安', o.est.toFixed(1) + '秒'); return r;
}
function totp(secret) { // RFC6238
  const al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const ch of secret) bits += al.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2))); const c = Buffer.alloc(8); c.writeUInt32BE(Math.floor(Date.now() / 30000), 4);
  const h = crypto.createHmac('sha1', key).update(c).digest(); const o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
// ---- 準備（測らない）----
run('rootFolder(); var keys={}; keys["9999"]={key:"k",issued_at:nowIso()}; jsonSave(rootFolder(),"_company_keys.json",keys); jsonSave(rootFolder(),"_clients.json",{"9999":"サンプル株式会社"});');
run('setProp("ADMIN_PW_HASH", pwHash("test-pass-1234")); setProp("ADMIN_TOTP_SECRET", "JBSWY3DPEHPK3PXP");');
for (let i = 1; i <= 20; i++) { ctx.__n = '見本 ' + i + '郎'; run('companyApi("add",{c:"9999",k:"k",name:__n,kana:"ミホン",hire:"2026-04"})'); }
const list = run('JSON.stringify(companyApi("list",{c:"9999",k:"k"}).rows)'); const emp = JSON.parse(list)[0];
ctx.__code = emp.code; ctx.__pin = emp.pin; ctx.__emp = emp.emp;
ctx.__img = Buffer.alloc(300000, 7).toString('base64'); // 約300KBの写真
// ---- 従業員 ----
measure('従業員 登録コードだけ送る', 'JSON.stringify(api("login",{code:__code}))');
measure('従業員 暗証番号を間違える', 'api("login",{code:__code,pin:"000000"}).ok');
const lg = JSON.parse(measure('従業員 ログイン（暗証番号が合う）', 'JSON.stringify(api("login",{code:__code,pin:__pin}))'));
if (!lg.ok) throw new Error('ログインできません: ' + lg.error);
ctx.__t = lg._t; ctx.__dev = lg.dev;
measure('従業員 2回目以降の自動ログイン', 'api("device_login",{dev:__dev}).known');
measure('従業員 読み込み', 'api("load",{_t:__t}).ok');
measure('従業員 保存（同意つき・集計も更新）', 'api("save",{_t:__t,consent:true,answers:{name:"見本 1郎",salary:4000000}}).ok');
measure('従業員 保存（ふつうの1問）', 'api("save",{_t:__t,answers:{has_spouse:"no"},step:3}).ok');
measure('従業員 写真を送る（AIなし）', 'api("upload",{_t:__t,kind:"cert",cat:"life",data:__img,mime:"image/jpeg"}).ok');
measure('従業員 提出', 'api("submit",{_t:__t}).ok');
// ---- 会社 ----
measure('会社 一覧を開く', 'api("company.list",{c:"9999",k:"k"}).rows.length');
measure('会社 在籍の変更を保存', 'api("company.roster",{c:"9999",k:"k",emp:__emp,status:"active",hire:"2026-05"}).ok');
measure('会社 1人追加', 'api("company.add",{c:"9999",k:"k",name:"追加 花子",kana:"ツイカ ハナコ",hire:"2026-06"}).ok');
measure('会社 暗証番号の再発行', 'api("company.pin_reissue",{c:"9999",k:"k",emp:__emp}).ok');
// ---- 事務所 ----
ctx.__otp = totp('JBSWY3DPEHPK3PXP');
const ad = JSON.parse(measure('事務所 ログイン', 'JSON.stringify(api("admin.login",{pw:"test-pass-1234",otp:__otp}))')); if (!ad.ok) throw new Error('事務所ログイン失敗: ' + ad.error);
ctx.__at = ad._t;
measure('事務所 ホーム', 'api("admin.home",{_t:__at}).ok');
measure('事務所 顧問先の一覧', 'api("admin.client",{_t:__at,client:"9999"}).rows.length');
measure('事務所 1人の中身を開く', 'api("admin.emp",{_t:__at,client:"9999",emp:__emp}).ok');
if (process.env.PERF_JSON) require('fs').writeFileSync(process.env.PERF_JSON, JSON.stringify(rows, null, 1));

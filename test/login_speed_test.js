// ログインの見張り：開くたびに暗証番号（自動ログインなし）／暗証番号が合ったあと、画面を出すまでにドライブへ書き込まないこと。記録は login_after が書く。架空の氏名のみ
const { makeContext } = require('./gasmock'); const vm = require('vm'); const assert = require('assert');
const ctx = makeContext({ props: { YEAR: '2026' } }); const run = c => vm.runInContext(c, ctx);
run('rootFolder(); rosterBulk("9999", "社員番号,氏名\\n1,見本 一郎\\n2,見本 二郎", "office-csv");'); ctx.__pin = run('summaryLoad("9999")["**000001"].pin');
const ops = (label, code) => { ctx.__ops.read = 0; ctx.__ops.write = 0; const r = run(code); console.log('  ' + label.padEnd(30), '読み', ctx.__ops.read, '書き', ctx.__ops.write); return { r, read: ctx.__ops.read, write: ctx.__ops.write }; };
let o = ops('ログイン（画面を出すまで）', 'var J = empApi("login", {code:"9999000001", pin:__pin}); J.ok');
assert.strictEqual(o.write, 0, 'ログインで書き込みをしない'); assert.ok(o.read <= 7, '読みは7回まで'); assert.ok(run('J.after === true && J.dev === undefined'), '合鍵（自動ログイン）は発行しない');
assert.strictEqual(run('summaryLoad("9999")["**000001"].pin_used'), false); // まだ書いていない
o = ops('後片づけ（裏で1回）', 'empApi("login_after", {_t: J._t}).ok');
assert.ok(run('var s = summaryLoad("9999")["**000001"]; s.pin_used === true && s.pin_used_count === 1 && s.device === true'));
assert.strictEqual(run('empApi("device_login", {dev: "x"}).known'), false, '自動ログインはできない'); assert.strictEqual(run('empApi("line_login", {line_user_id: "U1"}).known'), false);
o = ops('後片づけをもう一度（何もしない）', 'empApi("login_after", {_t: J._t}).ok'); assert.strictEqual(o.write, 0); assert.strictEqual(run('summaryLoad("9999")["**000001"].pin_used_count'), 1);
// 古い画面（login_after を呼ばない）でも、最初の保存のときに記録が残る
ctx.__pin2 = run('summaryLoad("9999")["**000002"].pin'); run('var K = empApi("login", {code:"9999000002", pin:__pin2}); empApi("save", {_t: K._t, answers: {head_is_self: "yes"}});');
assert.ok(run('var s2 = summaryLoad("9999")["**000002"]; s2.pin_used === true && s2.pin_used_count === 1 && s2.status === "in_progress"'));
// 暗証番号が違えば入れない・何も書かれない
assert.throws(() => run('empApi("login", {code:"9999000001", pin:"000000"})'), /暗証番号/);
console.log('login_speed_test OK');

// 判定・CSV の突き合わせ：PHP版と同じ結果になるか
const fs = require('fs'), path = require('path'); const { makeContext } = require('./gasmock');
const ctx = makeContext({ props: { YEAR: '2026', ADMIN_PW_HASH: '' } });
const run = (code) => require('vm').runInContext(code, ctx);
const csvB64 = fs.readFileSync('/tmp/KYCSV0601019999.CSV').toString('base64');
ctx.__csv = csvB64;
const codes = run('icsImport("9999", sjisToUtf8(__csv))');
console.log('imported', codes);
// PHP側の answers.json（画面操作で作ったもの）を流し込む
const phpDir = '/tmp/nencho_data/9999/2026';
let n = 0;
for (const emp of fs.readdirSync(phpDir)) {
  const f = path.join(phpDir, emp, 'answers.json'); if (!fs.existsSync(f)) continue;
  ctx.__rec = JSON.parse(fs.readFileSync(f, 'utf8')); run('saveRecord(__rec)'); n++;
}
console.log('records', n);
// 判定の比較
const emp = '**000001';
ctx.__emp = emp;
const gasComputed = run('JSON.stringify(compute(loadRecord("9999", __emp)))');
const phpComputed = require('child_process').execSync(`cd /home/claude/nencho && cp /tmp/test_cfg.php config.php && php -r 'require "lib/ics.php"; echo json_encode(compute(load_record("9999","${emp}")), JSON_UNESCAPED_UNICODE);'`).toString();
const a = JSON.parse(gasComputed), b = JSON.parse(phpComputed);
function diff(x, y, p) { if (typeof x !== typeof y || (x && typeof x === 'object') !== (y && typeof y === 'object')) { console.log('DIFF', p, JSON.stringify(x), JSON.stringify(y)); return; } if (x && typeof x === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], p + '.' + k); } else if (x !== y) console.log('DIFF', p, JSON.stringify(x), JSON.stringify(y)); }
diff(a, b, 'compute');
// CSV の比較（全員分・全列）
const gasCsv = Buffer.from(run('utf8ToSjisB64(icsExport("9999", false, 2026, false))'), 'base64');
const phpCsv = require('child_process').execSync(`cd /home/claude/nencho && php -r 'require "lib/ics.php"; echo ics_export("9999", false, 2026, false);'`);
const iconv = require('iconv-lite');
const p = iconv.decode(phpCsv, 'Shift_JIS').split('\r\n'); const pc0 = new Set(p.map(l => l.split('","')[0]));
// GAS版は未入力の人も前年のまま出す（PHP版は出さない）。PHP版にある人だけ比べる
const g = iconv.decode(gasCsv, 'Shift_JIS').split('\r\n').filter(l => pc0.has(l.split('","')[0]));
console.log('csv lines', g.length, p.length);
for (let i = 0; i < Math.max(g.length, p.length); i++) if (g[i] !== p[i]) { const gc = (g[i] || '').split('","'), pc = (p[i] || '').split('","'); for (let j = 0; j < Math.max(gc.length, pc.length); j++) if (gc[j] !== pc[j]) console.log('CSV DIFF line', i, 'col', j + 1, JSON.stringify(gc[j]), JSON.stringify(pc[j])); }
// subset export
const sub = run('icsExport("9999", false, 2026, true)').split('\r\n');
console.log('subset cols', sub[2].split('","').length);
fs.unlinkSync('/home/claude/nencho/config.php');
console.log('done');

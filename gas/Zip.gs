// 郵便番号 → 市区町村コード（全国地方公共団体コード6桁）
// 日本郵便の KEN_ALL.CSV（公開データ）を取り込み、_zip フォルダに郵便番号の先頭1桁ごとのJSONで持つ

var KEN_ALL_URL = 'https://www.post.japanpost.jp/zipcode/dl/kogaki/zip/ken_all.zip';

function cityCode6(c5) {
  c5 = ('00000' + String(c5).replace(/\D/g, '')).slice(-5);
  var w = [6, 5, 4, 3, 2], sum = 0;
  for (var i = 0; i < 5; i++) sum += parseInt(c5[i], 10) * w[i];
  var chk = 11 - (sum % 11); if (chk >= 10) chk -= 10;
  return c5 + chk;
}
/** 日本郵便から取り込んで辞書を作る。戻り：件数 */
function zipDictUpdate() {
  var res = UrlFetchApp.fetch(KEN_ALL_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('日本郵便から取得できません (HTTP ' + res.getResponseCode() + ')');
  var files = Utilities.unzip(res.getBlob().setContentType('application/zip'));
  var csv = null;
  files.forEach(function (b) { if (/\.csv$/i.test(b.getName())) csv = b.getDataAsString('Shift_JIS'); });
  if (csv === null) throw new Error('CSVが見つかりません');
  var buckets = {}; var n = 0;
  csv.split(/\r\n|\n|\r/).forEach(function (line) {
    if (line === '') return; var c = csvSplit(line); if (c.length < 9) return;
    var z = c[2].replace(/\D/g, ''); if (z.length !== 7) return;
    var k = z[0]; buckets[k] = buckets[k] || {};
    if (!buckets[k][z]) { buckets[k][z] = cityCode6(c[0]) + '|' + c[6] + c[7]; n++; }
  });
  var dir = subFolder(rootFolder(), '_zip', true);
  for (var k2 in buckets) { jsonSave(dir, 'zip' + k2 + '.json', buckets[k2]); cacheDel('json:' + dir.getId() + '/zip' + k2 + '.json'); }
  jsonSave(dir, '_meta.json', { updated_at: nowIso(), count: n });
  return n;
}
function zipDictMeta() { var dir = subFolder(rootFolder(), '_zip', false); return dir ? jsonLoad(dir, '_meta.json') : null; }
/** 郵便番号 → [6桁コード, 市区町村名] または null */
function zipToCity(zip) {
  var z = zenToHanDigits(zip).replace(/\D/g, ''); if (z.length !== 7) return null;
  var dir = subFolder(rootFolder(), '_zip', false); if (!dir) return null;
  var m = jsonLoad(dir, 'zip' + z[0] + '.json', {}); if (!m[z]) return null;
  var p = m[z].split('|'); return [p[0], p.slice(1).join('|')];
}

// 共通：設定・ドライブ保存・小道具
// データはすべて work@metis.tax のドライブ「年調アプリデータ」フォルダの中（顧問先コード／年／個人コード）

var TAX = { // 令和8年分の基準（config.sample.php と同じ値）
  salary_deduction_min: 740000, salary_deduction_flat_upto: 2190000,
  pension_deduction_under65: 600000, pension_deduction_over65: 1100000, pension_simple_upto: 1300000,
  dependent_income_max: 620000, special_relative_income_max: 1230000, special_relative_gensen_income_max: 850000,
  spouse_special_income_max: 1330000, self_income_max_for_spouse: 10000000,
  self_income_max_for_gensen: 9000000, spouse_income_max_for_gensen: 950000,
  working_student_income_max: 890000, adjust_income_threshold: 8500000
};

/** 設定（スクリプト プロパティ）。初期値つき */
function cfg() {
  if (cfg._c) return cfg._c;
  var p = PropertiesService.getScriptProperties().getProperties();
  var y = parseInt(p.YEAR || '', 10) || (new Date()).getFullYear();
  cfg._c = {
    year: y,
    app_name: p.APP_NAME || 'メーティス 年末調整',
    brand_color: p.BRAND_COLOR || '#00A88E',
    deadline_text: p.DEADLINE_TEXT || '',
    admin_pw_hash: p.ADMIN_PW_HASH || '',
    admin_totp_secret: p.ADMIN_TOTP_SECRET || '',
    anthropic_api_key: p.ANTHROPIC_API_KEY || '',
    anthropic_model: p.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    liff_id: p.LIFF_ID || '',
    github_repo: p.GITHUB_REPO || 'Mybiz-city/nencho-app',
    github_branch: p.GITHUB_BRANCH || 'main',
    github_dir: p.GITHUB_DIR || 'gas',
    root_folder_id: p.ROOT_FOLDER_ID || '',
    pages_url: p.PAGES_URL || '', // 画面を外（GitHub Pages）に置いたときの URL（末尾 / まで）
    version: p.VERSION || '',
    tax: TAX
  };
  return cfg._c;
}
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, String(v)); cfg._c = null; }

// ---------- ドライブ ----------
/** フォルダの「引換券」。IDだけ持ち、本当にドライブへ取りに行くのは中身を触るときだけ（一時保存に当たれば通信ゼロ） */
function lazyFolder(id) {
  var real = null; function r() { return real || (real = DriveApp.getFolderById(id)); }
  var o = { getId: function () { return id; }, getUrl: function () { return 'https://drive.google.com/drive/folders/' + id; } };
  ['getName', 'setName', 'getFoldersByName', 'getFilesByName', 'getFolders', 'getFiles', 'createFolder', 'createFile', 'setTrashed', 'isTrashed', 'getParents'].forEach(function (m) {
    o[m] = function () { var x = r(); return x[m].apply(x, arguments); };
  });
  return o;
}
function rootFolder() {
  if (rootFolder._f) return rootFolder._f;
  var id = cfg().root_folder_id;
  if (id) return (rootFolder._f = lazyFolder(id));
  var it = DriveApp.getRootFolder().getFoldersByName('年調アプリデータ');
  var f = it.hasNext() ? it.next() : DriveApp.createFolder('年調アプリデータ');
  setProp('ROOT_FOLDER_ID', f.getId());
  return (rootFolder._f = lazyFolder(f.getId()));
}
var _cache = CacheService.getScriptCache();
function cacheGet(k) { try { return _cache.get(k); } catch (e) { return null; } }
function cachePut(k, v, sec) { try { if (v !== null && v !== undefined && String(v).length < 95000) _cache.put(k, String(v), sec || 3600); } catch (e) {} }
function cacheDel(k) { try { _cache.remove(k); } catch (e) {} }

/** 子フォルダ（名前で）。create=false で無ければ null */
function subFolder(parent, name, create) {
  var key = 'fid:' + parent.getId() + '/' + name;
  var id = cacheGet(key);
  if (id) return lazyFolder(id);
  var it = parent.getFoldersByName(name);
  var f = null;
  if (it.hasNext()) f = it.next();
  else if (create) f = parent.createFolder(name);
  if (f) cachePut(key, f.getId(), 21600);
  return f;
}
/** 階層をたどる。parts=['9999','2026','**000001'] */
function pathFolder(parts, create) {
  var f = rootFolder();
  for (var i = 0; i < parts.length; i++) { f = subFolder(f, parts[i], create); if (!f) return null; }
  return f;
}
function listFolderNames(folder) {
  var out = []; if (!folder) return out;
  var it = folder.getFolders(); while (it.hasNext()) out.push(it.next().getName());
  return out.sort();
}
/** フォルダ内のファイルを名前で */
function fileIn(folder, name) {
  if (!folder) return null;
  var key = 'file:' + folder.getId() + '/' + name;
  var id = cacheGet(key);
  if (id) { try { var f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} cacheDel(key); }
  var it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  var f2 = it.next(); cachePut(key, f2.getId(), 21600); return f2;
}
function jsonLoad(folder, name, def) {
  if (!folder) return def === undefined ? null : def;
  var ck = 'json:' + folder.getId() + '/' + name;
  var c = cacheGet(ck);
  if (c !== null) { try { return JSON.parse(c); } catch (e) {} }
  var f = fileIn(folder, name);
  if (!f) return def === undefined ? null : def;
  var s = f.getBlob().getDataAsString('UTF-8');
  try { var v = JSON.parse(s); cachePut(ck, s, 21600); return v; } catch (e) { return def === undefined ? null : def; }
}
function jsonSave(folder, name, obj) {
  var s = JSON.stringify(obj, null, 1);
  var f = fileIn(folder, name);
  if (f) f.setContent(s);
  else { f = folder.createFile(name, s, 'application/json'); cachePut('file:' + folder.getId() + '/' + name, f.getId(), 21600); }
  cachePut('json:' + folder.getId() + '/' + name, s, 21600);
  return f;
}
function fileDelete(folder, name) { var f = fileIn(folder, name); if (f) { f.setTrashed(true); cacheDel('file:' + folder.getId() + '/' + name); cacheDel('json:' + folder.getId() + '/' + name); } }
/** フォルダをごみ箱へ（中身ごと） */
function folderTrash(folder) { if (folder) folder.setTrashed(true); }
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- 監査ログ ----------
/** 記録。毎回ファイルを書くと遅いので、いったんプロパティにためて、たまったらファイルへ移す */
function audit(what) {
  try {
    var p = PropertiesService.getScriptProperties();
    var buf = (p.getProperty('AUDIT_BUF') || '') + nowIso() + '\t' + what + '\n';
    if (buf.length > 3000) { auditFlush(buf); buf = ''; }
    p.setProperty('AUDIT_BUF', buf);
  } catch (e) {}
}
function auditFlush(buf) {
  var root = rootFolder(); var name = '_audit_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM') + '.log';
  var f = fileIn(root, name);
  if (f) f.setContent(f.getBlob().getDataAsString('UTF-8') + buf); else root.createFile(name, buf, 'text/plain');
}
function nowIso() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function today() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }

// ---------- 試行回数の制限（キャッシュ上。15分） ----------
function throttleOk(key) { var v = cacheGet('lock:' + key); return !v; }
function throttleFail(key, max) {
  max = max || 5;
  var n = parseInt(cacheGet('fail:' + key) || '0', 10) + 1;
  if (n >= max) { cachePut('lock:' + key, '1', 900); cacheDel('fail:' + key); } else cachePut('fail:' + key, String(n), 900);
}
function throttleClear(key) { cacheDel('fail:' + key); cacheDel('lock:' + key); }

// ---------- 乱数・ハッシュ ----------
function randomHex(nBytes) {
  var s = ''; for (var i = 0; i < nBytes; i++) s += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2); return s;
}
function randomDigits(n) { var s = ''; for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }
function sha256(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function pwHash(pw, salt) { salt = salt || randomHex(8); return salt + '$' + sha256(salt + ':' + pw); }
function pwVerify(pw, stored) { if (!stored || stored.indexOf('$') < 0) return false; var salt = stored.split('$')[0]; return safeEq(pwHash(pw, salt), stored); }
function safeEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// ---------- セッション（トークン→誰か。キャッシュ上、無操作6時間で切れる） ----------
function sessionNew(kind, data, sec) { var t = randomHex(24); cachePut('ses:' + kind + ':' + t, JSON.stringify(data), sec || 21600); return t; }
function sessionGet(kind, t, sec) {
  if (!t) return null; var v = cacheGet('ses:' + kind + ':' + t); if (!v) return null;
  cachePut('ses:' + kind + ':' + t, v, sec || 21600); // 延長
  return JSON.parse(v);
}
function sessionDrop(kind, t) { if (t) cacheDel('ses:' + kind + ':' + t); }

// ---------- ワンタイムパスワード（RFC6238, 30秒, 6桁） ----------
function base32Decode(s) {
  var al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; s = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  var bits = '', out = [];
  for (var i = 0; i < s.length; i++) bits += ('00000' + al.indexOf(s[i]).toString(2)).slice(-5);
  for (var j = 0; j + 8 <= bits.length; j += 8) out.push(parseInt(bits.substr(j, 8), 2));
  return out;
}
function totpCode(secret, t) {
  var key = base32Decode(secret); var c = Math.floor(t / 30);
  var msg = [0, 0, 0, 0, (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, key).map(function (b) { return b & 255; });
  var o = h[19] & 15;
  var v = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return ('000000' + (v % 1000000)).slice(-6);
}
function totpVerify(secret, code) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6) return false;
  var now = Math.floor(Date.now() / 1000);
  for (var w = -1; w <= 1; w++) if (safeEq(totpCode(secret, now + w * 30), code)) return true;
  return false;
}
function totpNewSecret() { var al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', s = ''; for (var i = 0; i < 32; i++) s += al[Math.floor(Math.random() * 32)]; return s; } // 認証アプリは8の倍数の文字数しか受け付けない

// ---------- 文字の小道具 ----------
function zenToHanDigits(s) { return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[／－．]/g, function (c) { return { '／': '/', '－': '-', '．': '.' }[c]; }); }
function yen(v) { if (v === null || v === undefined) return 0; var d = zenToHanDigits(v).replace(/[^\d\-]/g, ''); return parseInt(d, 10) || 0; }
function fmt(n) { return (Number(n) || 0).toLocaleString('ja-JP'); }
var ERA = { '明': 1867, 'M': 1867, '大': 1911, 'T': 1911, '昭': 1925, 'S': 1925, '平': 1988, 'H': 1988, '令': 2018, 'R': 2018 };
/** 和暦文字列（昭60/03/29, 令08/01/01, 平29.12.7, 1985-03-29）→ Y-m-d */
function warekiToIso(s) {
  if (!s) return null; s = zenToHanDigits(String(s).trim()).replace(/\s+/g, '');
  s = s.replace(/^明治/, '明').replace(/^大正/, '大').replace(/^昭和/, '昭').replace(/^平成/, '平').replace(/^令和/, '令').replace(/元年/, '1年');
  var m = s.match(/^(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})日?$/);
  if (m) return pad4(m[1]) + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = s.match(/^([明大昭平令MTSHRmtshr])(\d{1,2})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})日?$/);
  if (m && ERA[m[1].toUpperCase()] !== undefined) return pad4(ERA[m[1].toUpperCase()] + parseInt(m[2], 10)) + '-' + pad2(m[3]) + '-' + pad2(m[4]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}
function isoToWareki(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return '';
  var y = +m[1], mo = +m[2], d = +m[3], ymd = y * 10000 + mo * 100 + d, g, b;
  if (ymd >= 20190501) { g = '令'; b = 2018; } else if (ymd >= 19890108) { g = '平'; b = 1988; } else if (ymd >= 19261225) { g = '昭'; b = 1925; } else if (ymd >= 19120730) { g = '大'; b = 1911; } else { g = '明'; b = 1867; }
  return g + pad2(y - b) + '/' + pad2(mo) + '/' + pad2(d);
}
function pad2(n) { return ('0' + n).slice(-2); }
function pad4(n) { return ('000' + n).slice(-4); }
/** 全角カナ→半角カナ */
var KANA_MAP = { 'ガ': 'ｶﾞ', 'ギ': 'ｷﾞ', 'グ': 'ｸﾞ', 'ゲ': 'ｹﾞ', 'ゴ': 'ｺﾞ', 'ザ': 'ｻﾞ', 'ジ': 'ｼﾞ', 'ズ': 'ｽﾞ', 'ゼ': 'ｾﾞ', 'ゾ': 'ｿﾞ', 'ダ': 'ﾀﾞ', 'ヂ': 'ﾁﾞ', 'ヅ': 'ﾂﾞ', 'デ': 'ﾃﾞ', 'ド': 'ﾄﾞ', 'バ': 'ﾊﾞ', 'ビ': 'ﾋﾞ', 'ブ': 'ﾌﾞ', 'ベ': 'ﾍﾞ', 'ボ': 'ﾎﾞ', 'パ': 'ﾊﾟ', 'ピ': 'ﾋﾟ', 'プ': 'ﾌﾟ', 'ペ': 'ﾍﾟ', 'ポ': 'ﾎﾟ', 'ヴ': 'ｳﾞ',
  'ア': 'ｱ', 'イ': 'ｲ', 'ウ': 'ｳ', 'エ': 'ｴ', 'オ': 'ｵ', 'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ', 'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ', 'タ': 'ﾀ', 'チ': 'ﾁ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ', 'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ', 'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ', 'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ', 'ヤ': 'ﾔ', 'ユ': 'ﾕ', 'ヨ': 'ﾖ', 'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ', 'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ',
  'ァ': 'ｧ', 'ィ': 'ｨ', 'ゥ': 'ｩ', 'ェ': 'ｪ', 'ォ': 'ｫ', 'ッ': 'ｯ', 'ャ': 'ｬ', 'ュ': 'ｭ', 'ョ': 'ｮ', 'ー': 'ｰ', '、': '､', '。': '｡', '　': ' ' };
function toHankakuKana(s) {
  s = String(s || '').replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  return s.replace(/./g, function (c) { return KANA_MAP[c] !== undefined ? KANA_MAP[c] : c; });
}
/** 氏名「山田 太郎」→ [姓, 名] */
function splitName(full) { var p = String(full || '').trim().replace(/　/g, ' ').split(/\s+/); return [p[0] || '', p.slice(1).join(' ') || '']; }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ---------- 登録コード・個人コード ----------
function parseCode(code) {
  var d = zenToHanDigits(code).replace(/\D/g, '');
  if (d.length < 5) return null;
  return { client: d.substr(0, 4), num: d.substr(4) };
}
function codeDigits(emp) { return String(emp || '').replace(/\D/g, ''); }
function safeEmp(emp) { return String(emp).replace(/[^\w\*\-]/g, '_'); }
function clientDir(client, year) { return pathFolder([client, String(year || cfg().year)], false); }
function empDir(client, emp, create, year) { return pathFolder([client, String(year || cfg().year), safeEmp(emp)], !!create); }
function photosDir(empFolder, create) { return subFolder(empFolder, 'photos', !!create); }

/** 顧問先・年の一覧（_summary.json）を読む */
function summaryLoad(client, year) { return jsonLoad(clientDir(client, year), '_summary.json', {}); }
/** 1人分の集計を書き直す */
function summaryUpdate(client, emp, year) {
  year = year || cfg().year;
  var cd = pathFolder([client, String(year)], true);
  var ed = pathFolder([client, String(year), safeEmp(emp)], false);
  withLock(function () {
    var s = jsonLoad(cd, '_summary.json', {});
    if (!ed) { delete s[emp]; jsonSave(cd, '_summary.json', s); return; }
    s[emp] = summaryRow(client, emp, ed);
    jsonSave(cd, '_summary.json', s);
    homeUpdate(client, year, s);
  });
}
/** ホーム画面用の件数（顧問先×年）。_home.json に1枚で持つ */
function homeCounts(s) { var cnt = { submitted: 0, in_progress: 0, 'new': 0, retired: 0 }, n = 0; for (var k in s) { if (s[k].roster === 'retired') cnt.retired++; else { n++; cnt[s[k].status] = (cnt[s[k].status] || 0) + 1; } } return { n: n, cnt: cnt }; }
function homeUpdate(client, year, s) { var h = jsonLoad(rootFolder(), '_home.json', {}); h[String(year)] = h[String(year)] || {}; h[String(year)][client] = homeCounts(s); jsonSave(rootFolder(), '_home.json', h); }
function summaryRow(client, emp, ed) {
  var r = jsonLoad(ed, 'answers.json'), p = jsonLoad(ed, 'prev.json'), ro = jsonLoad(ed, 'roster.json', {});
  return summaryRowFrom(emp, r, p, ro);
}
/** 読み込み済みの中身から集計の1行を作る（ドライブに問い合わせない） */
function summaryRowFrom(emp, r, p, ro) {
  ro = ro || {};
  var a = (r && r.answers) || {};
  var certs = ((r && r.certs) || []).filter(function (c) { return c.status !== 'deleted'; }).length;
  return {
    emp: (r && r.emp) || (p && p.code) || emp,
    name: a.name || (p ? (p.sei + ' ' + p.mei) : (ro.name || '')),
    birth: a.birth || (p && p.birth) || ro.birth || '',
    status: (r && r.status) || 'new',
    updated: (r && (r.submitted_at || r.updated_at)) || '',
    certs: certs, checked: !!(r && r.office_checked_at),
    roster: ro.status || 'active', hire: ro.hire || '', retire: ro.retire || '',
    pin: ro.pin || '', pin_used: !!ro.pin_used, pin_used_count: ro.pin_used_count || 0, device: !!(r && r.device_bound_at),
    unknown_income: a.has_other_income === 'unknown', otsu: a.other_employer_decl === 'other',
    pending: /^N/.test(String((r && r.emp) || emp))
  };
}
/** 新しいフォルダを作る（無いと分かっているとき。探す問い合わせを省く） */
function newSubFolder(parent, name) { var f = parent.createFolder(name); cachePut('fid:' + parent.getId() + '/' + name, f.getId(), 21600); return lazyFolder(f.getId()); }
/** 新しいJSONファイルを作る（無いと分かっているとき） */
function jsonCreate(folder, name, obj) {
  var s = JSON.stringify(obj, null, 1); var f = folder.createFile(name, s, 'application/json');
  cachePut('file:' + folder.getId() + '/' + name, f.getId(), 21600); cachePut('json:' + folder.getId() + '/' + name, s, 21600); return f;
}
/** 集計に何人分かをまとめて反映する（書き込みは1回）。rows = {個人コード: 行 または null（削除）} */
function summaryMerge(client, year, rows) {
  year = year || cfg().year; var cd = pathFolder([client, String(year)], true);
  withLock(function () {
    var s = jsonLoad(cd, '_summary.json', {});
    for (var k in rows) { if (rows[k] === null) delete s[k]; else s[k] = rows[k]; }
    jsonSave(cd, '_summary.json', s); homeUpdate(client, year, s);
  });
}
/** 顧問先全員の集計を作り直す */
function summaryRebuild(client, year) {
  year = year || cfg().year;
  var cd = pathFolder([client, String(year)], true);
  var s = {}; var it = cd.getFolders();
  while (it.hasNext()) { var f = it.next(); var n = f.getName(); if (n.charAt(0) === '_') continue; s[n] = summaryRow(client, n, f); }
  jsonSave(cd, '_summary.json', s);
  withLock(function () { homeUpdate(client, year, s); });
  indexAdd(client, year);
  return s;
}
/** ルートの索引（顧問先→年の一覧） */
function indexLoad() { return jsonLoad(rootFolder(), '_index.json', {}); }
function indexAdd(client, year) {
  withLock(function () {
    var ix = jsonLoad(rootFolder(), '_index.json', {});
    if (ix[client] && (ix[client].years || []).indexOf(String(year)) >= 0) return; // 変わらなければ書かない
    ix[client] = ix[client] || { years: [] };
    ix[client].years.push(String(year)); ix[client].years.sort();
    jsonSave(rootFolder(), '_index.json', ix);
  });
}
function clientsLoad() { return jsonLoad(rootFolder(), '_clients.json', {}); }

/** 顧問先の中から、数字部分が一致する個人コードを探す（_summary から） */
function resolveEmp(client, num) {
  var s = summaryLoad(client); var n = parseInt(num, 10);
  for (var k in s) { var d = codeDigits(s[k].emp); if (d !== '' && parseInt(d, 10) === n) return s[k].emp; }
  return null;
}
/** 個人コードの形（**000001）に合わせた次の番号 */
function nextEmpCode(client) {
  var s = summaryLoad(client), max = 0, prefix = '', width = 6;
  for (var k in s) { var m = /^(\D*)(\d+)$/.exec(s[k].emp); if (!m) continue; if (parseInt(m[2], 10) > max) { max = parseInt(m[2], 10); prefix = m[1]; width = m[2].length; } }
  return prefix + ('000000000' + (max + 1)).slice(-width);
}

// ---------- 従業員の記録 ----------
function emptyRecord(client, emp) {
  return { client: client, emp: emp, year: cfg().year, status: 'new', consent_at: null, submitted_at: null, line_user_id: null,
    prev: null, answers: {}, family: [], certs: [], changes: [], computed: {} };
}
function loadRecord(client, emp) {
  var ed = empDir(client, emp, true);
  var r = jsonLoad(ed, 'answers.json');
  if (!r) {
    r = emptyRecord(client, emp); var prev = jsonLoad(ed, 'prev.json');
    if (prev) r.prev = prev;
    else { var ro0 = jsonLoad(ed, 'roster.json', {}); if (ro0.name) r.answers = { name: ro0.name, kana: ro0.kana || '', birth: ro0.birth || '', sex: ro0.sex || '' }; } // 会社が追加した人：名簿の氏名を引き継ぐ
  }
  if (r.prev_answers === undefined) {
    var last = jsonLoad(empDir(client, emp, false, cfg().year - 1), 'answers.json');
    r.prev_certs = [];
    r.prev_answers = last ? { salary: (last.answers || {}).salary || null, submitted_at: last.submitted_at || null } : null;
    (last && last.certs || []).forEach(function (ct) { if (ct.kind === 'cert' && ct.status !== 'deleted') r.prev_certs.push({ cat: ct.cat || '', issuer: ct.issuer || '', items: ct.items || [] }); });
  }
  return r;
}
function saveRecord(r, force) {
  var ed = empDir(r.client, r.emp, true);
  // 一覧用の集計は、状態が変わったときと3分に1回だけ書き直す（毎回だと保存が遅くなる）
  var prevStatus = r._sum_status, need = force || r.status !== prevStatus || !r._sum_at || (Date.now() - new Date(r._sum_at).getTime() > 180000);
  if (need) { r._sum_status = r.status; r._sum_at = nowIso(); }
  jsonSave(ed, 'answers.json', r);
  if (need) summaryUpdate(r.client, r.emp);
}
/** 配備URL（Workspace の /a/ドメイン/ 付きは、ログインなしで開けないので外す） */
function appUrl() { return String(ScriptApp.getService().getUrl() || '').replace(/\/a\/[^\/]+\//, '/'); }
/** 従業員・会社・事務所の各画面のURL（外に置いた画面があればそちら） */
function pageUrl(kind, query) {
  var pu = cfg().pages_url;
  if (pu) { if (pu.slice(-1) !== '/') pu += '/'; return pu + ({ emp: '', company: 'company.html', admin: 'admin.html' }[kind]) + (query ? '?' + query : ''); }
  var q = ({ emp: '', company: 'p=company', admin: 'p=admin' }[kind]); if (query) q += (q ? '&' : '') + query;
  return appUrl() + (q ? '?' + q : '');
}

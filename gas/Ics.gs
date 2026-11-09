// 日本ICS 給与マスター表形式（タイプ6・540列）の読み込みと書き出し

var ICS_COLS = 540;
var C = { code: 0, kubun: 1, sei: 2, mei: 3, sei_k: 4, mei_k: 5, sex: 6, birth: 7, hire: 8, retire: 9, zip: 10, city_code: 11, addr1: 16, addr2: 17,
  self_kubun: 18, gensen_sp: 19, spouse_kubun: 20, dep_kubun: 21, zai: 125,
  dep_decl: 129, shaho_self: 132, kokumin_nenkin: 133, kyosai: 134, life_old: 135, nenkin_old: 136, jishin: 137, old_songai: 138,
  sp_salary_income: 139, sp_other_income: 140, jutaku_koujo: 141, kyojuu1: 143, jkubun1: 144, tokutei1: 145, zandaka1: 146,
  life_new: 152, kaigo: 153, nenkin_new: 154, self_other_income: 155, sp_salary_revenue: 156, adjust_req: 157,
  adj_sei: 158, adj_mei: 159, adj_sei_k: 160, adj_mei_k: 161, adj_rel: 162, adj_birth: 163, adj_addr: 164, adj_income: 165, adj_fact: 166,
  self_income: 170, head_sei: 171, head_mei: 172, head_rel: 174,
  sp_sei: 176, sp_mei: 177, sp_sei_k: 178, sp_mei_k: 179, sp_birth: 182, sp_addr: 183, sp_gensen: 184, sp_kubun2: 185, sp_dis: 187, sp_job: 188,
  sp_salary_income2: 189, sp_other_income2: 190, sp_nonres: 191, sp_fact: 192, sp_income_ex: 193,
  fam_base: 194, fam_stride: 16, fam_max: 20, self_dis_text: 514, other_base: 516, other_stride: 12, other_max: 2 };
var F = { sei: 0, mei: 1, sei_k: 2, mei_k: 3, rel: 5, birth: 6, addr: 7, together: 8, kubun: 9, dis: 10, job: 11, income: 12, nonres: 13, fact: 14, income_ex: 15 };
var O = { sei: 0, mei: 1, sei_k: 2, mei_k: 3, rel: 4, birth: 5, addr: 6, o_sei: 7, o_mei: 8, o_rel: 9, o_addr: 10 };

/** CSV 1行を分解（"…" 対応） */
function csvSplit(line) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function csvParse(text) { return text.split(/\r\n|\n|\r/).filter(function (l) { return l !== ''; }).map(csvSplit); }
/** Shift-JIS のバイト列（base64）→ UTF-8 文字列 */
function sjisToUtf8(b64) { return Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('Shift_JIS'); }
/** 文字列 → Shift-JIS の base64 */
function utf8ToSjisB64(text) { return Utilities.base64Encode(Utilities.newBlob('').setDataFromString(text, 'Shift_JIS').getBytes()); }

/** ICSのCSV（UTF-8に直したもの）→ {meta, header, rows} */
function icsRead(text) {
  var rows = csvParse(text);
  if (rows.length < 4) throw new Error('CSVの行数が足りません');
  return { meta: [rows[0], rows[1]], header: rows[2], rows: rows.slice(3) };
}
function icsRowToPrev(r) {
  var g = function (i) { return r[i] === undefined ? '' : r[i]; };
  var sum = function (a, b) { var s = 0; for (var i = a; i <= b; i++) s += yen(g(i)); return s; };
  var p = { code: g(C.code), raw: r, sei: g(C.sei), mei: g(C.mei), sei_k: g(C.sei_k), mei_k: g(C.mei_k), sex: g(C.sex), birth: warekiToIso(g(C.birth)), zip: g(C.zip),
    addr: g(C.addr1) + g(C.addr2), self_kubun: g(C.self_kubun), spouse_kubun: g(C.spouse_kubun), dep_kubun: g(C.dep_kubun),
    head: { sei: g(C.head_sei), mei: g(C.head_mei), rel: g(C.head_rel) }, spouse: null, family: [],
    amounts: { life_new: yen(g(C.life_new)), life_old: yen(g(C.life_old)), kaigo: yen(g(C.kaigo)), nenkin_new: yen(g(C.nenkin_new)), nenkin_old: yen(g(C.nenkin_old)),
      jishin: yen(g(C.jishin)), old_songai: yen(g(C.old_songai)), kyosai: yen(g(C.kyosai)), shaho_self: yen(g(C.shaho_self)), kokumin_nenkin: yen(g(C.kokumin_nenkin)),
      jutaku_koujo: yen(g(C.jutaku_koujo)), zandaka1: yen(g(C.zandaka1)) },
    self_income: yen(g(C.self_income)),
    salary_total: sum(24, 35) - sum(36, 47) + sum(102, 107) - sum(96, 101) };
  if (g(C.sp_sei) !== '' || g(C.sp_mei) !== '') p.spouse = { sei: g(C.sp_sei), mei: g(C.sp_mei), sei_k: g(C.sp_sei_k), mei_k: g(C.sp_mei_k), birth: warekiToIso(g(C.sp_birth)), addr: g(C.sp_addr),
    kubun: g(C.sp_kubun2), dis: g(C.sp_dis), job: g(C.sp_job), salary_income: yen(g(C.sp_salary_income2)), nonres: g(C.sp_nonres) };
  for (var k = 0; k < C.fam_max; k++) { var b = C.fam_base + k * C.fam_stride; if (g(b + F.sei) === '' && g(b + F.mei) === '') continue;
    p.family.push({ sei: g(b + F.sei), mei: g(b + F.mei), sei_k: g(b + F.sei_k), mei_k: g(b + F.mei_k), rel: g(b + F.rel), birth: warekiToIso(g(b + F.birth)), addr: g(b + F.addr),
      kubun: g(b + F.kubun), dis: g(b + F.dis), job: g(b + F.job), income: yen(g(b + F.income)), nonres: g(b + F.nonres), supporter: 'self' }); }
  for (var k2 = 0; k2 < C.other_max; k2++) { var b2 = C.other_base + k2 * C.other_stride; if (g(b2 + O.sei) === '' && g(b2 + O.mei) === '') continue;
    p.family.push({ sei: g(b2 + O.sei), mei: g(b2 + O.mei), sei_k: g(b2 + O.sei_k), mei_k: g(b2 + O.mei_k), rel: g(b2 + O.rel), birth: warekiToIso(g(b2 + O.birth)), addr: g(b2 + O.addr),
      supporter: 'other', supporter_name: g(b2 + O.o_sei) + ' ' + g(b2 + O.o_mei), supporter_rel: g(b2 + O.o_rel) }); }
  return p;
}
/** 前年CSV（UTF-8文字列）を顧問先フォルダに取り込む。戻り：個人コードの配列 */
function icsImport(client, text) {
  var d = icsRead(text), year = cfg().year;
  var cd = pathFolder([client, String(year)], true);
  jsonSave(cd, '_ics_meta.json', { meta: d.meta, header: d.header, imported_at: nowIso() });
  var codes = [];
  d.rows.forEach(function (row) {
    var code = String(row[C.code] || '').trim(); if (code === '') return;
    var prev = icsRowToPrev(row);
    var ed = pathFolder([client, String(year), safeEmp(code)], true);
    jsonSave(ed, 'prev.json', prev);
    var ro = jsonLoad(ed, 'roster.json', {});
    var hire = warekiToIso(row[C.hire]), retire = warekiToIso(row[C.retire]), zai = String(row[C.zai] || '').trim();
    if (hire) ro.hire = hire;
    if (retire || zai.indexOf('退職') >= 0) { ro.status = 'retired'; if (retire) ro.retire = retire; ro.source = 'ics'; }
    else if (zai.indexOf('在職') >= 0) { ro.status = 'active'; ro.retire = ''; ro.source = 'ics'; }
    if (!ro.pin) { ro.pin = randomDigits(6); ro.pin_used = false; ro.pin_issued_at = nowIso(); } // 初回番号（会社が本人に渡す）
    ro.ics_imported_at = nowIso();
    jsonSave(ed, 'roster.json', ro);
    codes.push(code);
  });
  summaryRebuild(client, year);
  return codes;
}
function famAddr(f) { return (f.living || 'together') === 'together' ? '同上' : String(f.addr || ''); }
function incomeLabel(incomes) {
  var m = { salary: '給与', pension: '年金', business: '事業', other: 'その他' }, l = [];
  (incomes || []).forEach(function (i) { if (yen(i.amount) > 0) { var v = m[i.type || 'salary'] || 'その他'; if (l.indexOf(v) < 0) l.push(v); } });
  return l.join('・');
}
function certKey(cat, contract) {
  var old = contract === 'old';
  return { life: old ? 'life_old' : 'life_new', kaigo: 'kaigo', nenkin: old ? 'nenkin_old' : 'nenkin_new', jishin: 'jishin', old_songai: 'old_songai', kyosai: 'kyosai', ideco: 'kyosai', kokumin_nenkin: 'kokumin_nenkin', jutaku: 'zandaka1' }[cat] || null;
}
function certTotals(r) {
  var s = { life_new: 0, life_old: 0, kaigo: 0, nenkin_new: 0, nenkin_old: 0, jishin: 0, old_songai: 0, kyosai: 0, kokumin_nenkin: 0, shaho_self: 0, jutaku_koujo: 0, zandaka1: 0 };
  (r.certs || []).forEach(function (c) { if (c.status === 'deleted') return;
    (c.items || []).forEach(function (it) { var amt = yen(it.amount), key = certKey(it.category || '', it.contract || ''); if (key) s[key] += amt; if (key === 'zandaka1' && it.start_date) s.kyojuu1 = it.start_date; }); });
  ((r.answers || {}).shaho || []).forEach(function (sh) { var amt = yen(sh.amount); s.shaho_self += amt; if (sh.type === 'kokumin_nenkin') s.kokumin_nenkin += amt; });
  return s;
}
/** 記録 → CSV 1行（540列） */
function icsRowFromRecord(r) {
  var row = (r.prev && r.prev.raw) ? r.prev.raw.slice(0, ICS_COLS) : [];
  while (row.length < ICS_COLS) row.push('');
  var a = r.answers || {}, c = compute(r), prev = r.prev || {};
  var set = function (i, v) { row[i] = (typeof v === 'number') ? (v === 0 ? '' : String(v)) : String(v === null || v === undefined ? '' : v); };
  row[C.code] = r.emp;
  var nm = a.name !== undefined ? splitName(a.name) : [prev.sei || '', prev.mei || ''];
  var kn = a.kana !== undefined ? splitName(a.kana) : [prev.sei_k || '', prev.mei_k || ''];
  set(C.sei, nm[0]); set(C.mei, nm[1]); set(C.sei_k, toHankakuKana(kn[0])); set(C.mei_k, toHankakuKana(kn[1]));
  if (a.birth) set(C.birth, isoToWareki(a.birth));
  if (a.sex) set(C.sex, a.sex);
  var zip = a.zip !== undefined ? a.zip : (prev.zip || ''), addr = a.addr !== undefined ? a.addr : (prev.addr || '');
  set(C.zip, zip); set(C.addr1, addr.substr(0, 20)); set(C.addr2, addr.substr(20, 20));
  var prevZip = prev.zip || '';
  if (zip !== '' && (row[C.city_code] === '' || zip.replace(/\D/g, '') !== prevZip.replace(/\D/g, ''))) { var cc = zipToCity(zip); if (cc) set(C.city_code, cc[0]); }
  var flags = [], sf = a.self_flags || {};
  if (sf.disability === 'general') flags.push('障害者');
  if (sf.disability === 'special') flags.push('特障者');
  if (sf.student) flags.push('勤労学生');
  if (sf.hitorioya) flags.push('ひとり親'); else if (sf.kafu) flags.push('寡婦');
  set(C.self_kubun, flags.join('/'));
  var dt = [];
  if ((sf.disability || 'none') !== 'none' || sf.student) dt.push('本人：' + (sf.disability_text || ''));
  if (a.has_spouse === 'yes' && ((a.spouse || {}).disability || 'none') !== 'none') dt.push((a.spouse.relation || '配偶者') + '：' + (a.spouse.disability_text || ''));
  (r.family || []).forEach(function (ff) { if ((ff.disability || 'none') !== 'none') dt.push((ff.relation || '') + '：' + (ff.disability_text || '')); });
  set(C.self_dis_text, dt.join('\\\\'));
  set(C.dep_decl, (a.other_employer_decl || 'here') === 'other' ? '無' : '有');
  set(C.self_income, c.self.total_income);
  set(C.self_other_income, c.self.other_income + c.self.pension_income);
  if ((a.head_is_self || 'yes') === 'yes') { set(C.head_sei, nm[0]); set(C.head_mei, nm[1]); set(C.head_rel, '本人'); }
  else { var hn = splitName(a.head_name || ''); set(C.head_sei, hn[0]); set(C.head_mei, hn[1]); set(C.head_rel, a.head_rel || ''); }
  [C.sp_sei, C.sp_mei, C.sp_sei_k, C.sp_mei_k, C.sp_birth, C.sp_addr, C.sp_gensen, C.sp_kubun2, C.sp_dis, C.sp_job, C.sp_salary_income2, C.sp_other_income2, C.sp_nonres, C.sp_fact, C.sp_income_ex, C.sp_salary_income, C.sp_other_income, C.sp_salary_revenue].forEach(function (i) { row[i] = ''; });
  if (a.has_spouse === 'yes' && c.spouse) {
    var sp = a.spouse || {}, cs = c.spouse, sn = splitName(sp.name || ''), sk = splitName(sp.kana || '');
    set(C.sp_sei, sn[0]); set(C.sp_mei, sn[1]); set(C.sp_sei_k, toHankakuKana(sk[0])); set(C.sp_mei_k, toHankakuKana(sk[1]));
    set(C.sp_birth, isoToWareki(sp.birth)); set(C.sp_addr, famAddr(sp));
    set(C.sp_gensen, cs.gensen); set(C.gensen_sp, cs.gensen);
    var k2 = cs.kubun === '一般' ? '一般' : cs.kubun === '老人' ? '老人' : '対象外';
    set(C.sp_kubun2, k2);
    var disc = disabilityCode(sp.disability); set(C.sp_dis, disc);
    set(C.spouse_kubun, '配/' + k2 + (disc !== '非該当' ? '/' + (disc === '一般' ? '障害' : disc === '特別' ? '特障' : '同特') : ''));
    set(C.sp_job, incomeLabel(sp.incomes).substr(0, 5));
    set(C.sp_salary_income2, cs.income.salary_income); set(C.sp_salary_income, cs.income.salary_income);
    var oth = cs.income.pension_income + cs.income.other_income; set(C.sp_other_income2, oth); set(C.sp_other_income, oth);
    set(C.sp_salary_revenue, cs.income.salary_revenue); set(C.sp_income_ex, cs.income.total_income);
    if (sp.living === 'abroad') { set(C.sp_nonres, '非居住者'); set(C.sp_fact, sp.remit || ''); }
  } else set(C.spouse_kubun, '配/無');
  for (var k = 0; k < C.fam_max * C.fam_stride; k++) row[C.fam_base + k] = '';
  for (var k3 = 0; k3 < C.other_max * C.other_stride; k3++) row[C.other_base + k3] = '';
  var fi = 0, oi = 0;
  c.family.forEach(function (f) {
    if (f['class'] === '除外') return;
    var fn = splitName(f.name || ''), fk = splitName(f.kana || '');
    if ((f.supporter || 'self') !== 'self') {
      if (oi >= C.other_max) return; var b = C.other_base + (oi++) * C.other_stride;
      set(b + O.sei, fn[0]); set(b + O.mei, fn[1]); set(b + O.sei_k, toHankakuKana(fk[0])); set(b + O.mei_k, toHankakuKana(fk[1]));
      set(b + O.rel, f.relation || ''); set(b + O.birth, isoToWareki(f.birth)); set(b + O.addr, famAddr(f));
      var on = splitName(f.supporter_name || ''); set(b + O.o_sei, on[0]); set(b + O.o_mei, on[1]); set(b + O.o_rel, f.supporter_rel || ''); set(b + O.o_addr, f.supporter_addr || addr);
      return;
    }
    if (fi >= C.fam_max) return; var b2 = C.fam_base + (fi++) * C.fam_stride;
    set(b2 + F.sei, fn[0]); set(b2 + F.mei, fn[1]); set(b2 + F.sei_k, toHankakuKana(fk[0])); set(b2 + F.mei_k, toHankakuKana(fk[1]));
    set(b2 + F.rel, f.relation || ''); set(b2 + F.birth, isoToWareki(f.birth)); set(b2 + F.addr, famAddr(f));
    set(b2 + F.kubun, f['class']); set(b2 + F.dis, disabilityCode(f.disability)); set(b2 + F.job, incomeLabel(f.incomes).substr(0, 5));
    set(b2 + F.income, f.income.total_income); set(b2 + F.income_ex, f.income.total_income);
    if (f.living === 'abroad') { set(b2 + F.nonres, '非居住者'); set(b2 + F.fact, f.remit || ''); }
  });
  var parts = []; for (var key in c.dependent_summary) parts.push(key + ' ' + c.dependent_summary[key]);
  set(C.dep_kubun, parts.join(' '));
  [C.adjust_req, C.adj_sei, C.adj_mei, C.adj_sei_k, C.adj_mei_k, C.adj_rel, C.adj_birth, C.adj_addr, C.adj_income, C.adj_fact].forEach(function (i) { row[i] = ''; });
  if (c.adjust) {
    set(C.adjust_req, c.adjust.kind);
    var tg = c.adjust.target;
    if (tg) { var tn = splitName(tg.name || ''), tk = splitName(tg.kana || '');
      set(C.adj_sei, tn[0]); set(C.adj_mei, tn[1]); set(C.adj_sei_k, toHankakuKana(tk[0])); set(C.adj_mei_k, toHankakuKana(tk[1]));
      set(C.adj_rel, tg.relation || ''); set(C.adj_birth, isoToWareki(tg.birth)); set(C.adj_addr, famAddr(tg)); set(C.adj_income, (tg.income || {}).total_income || 0); }
  }
  row[167] = '';
  var sum = certTotals(r);
  ['life_new', 'life_old', 'kaigo', 'nenkin_new', 'nenkin_old', 'jishin', 'old_songai', 'kyosai', 'kokumin_nenkin', 'shaho_self', 'jutaku_koujo', 'zandaka1'].forEach(function (k4) { set(C[k4], sum[k4] || 0); });
  if (sum.kyojuu1) set(C.kyojuu1, isoToWareki(sum.kyojuu1));
  return row;
}
/** 年調で書き換える列だけ（給与実績・口座・徴収区分などは含めない） */
function icsNenchoColumns() { var cols = []; for (var i = 0; i <= 23; i++) cols.push(i); cols.push(129); for (var j = 132; j <= 539; j++) cols.push(j); return cols; }
/** 顧問先の提出済み（または全員）→ CSV文字列（UTF-8。呼び出し側でShift-JISへ） */
function icsExport(client, onlySubmitted, year, subset) {
  year = year || cfg().year;
  var cd = clientDir(client, year); var meta = jsonLoad(cd, '_ics_meta.json');
  var lines = [];
  if (meta) { lines.push(meta.meta[0]); lines.push(meta.meta[1]); lines.push(meta.header); }
  else { lines.push(['給与', '12', '月分', 'FMT', '1', 'DBVER', '1,10,4,3']); lines.push(['タイプ６', 'SL=4', '個人コードタイプ', '0', '6']); var h = []; for (var i = 0; i < ICS_COLS; i++) h.push(''); lines.push(h); }
  var s = summaryLoad(client, year);
  Object.keys(s).sort().forEach(function (k) {
    var e = s[k];
    if (e.roster === 'retired') return;
    if (/^N/.test(String(e.emp))) return;
    if (onlySubmitted && e.status !== 'submitted') return;
    var ed = pathFolder([client, String(year), k], false); if (!ed) return;
    var r = jsonLoad(ed, 'answers.json');
    if (!r) { var prev = jsonLoad(ed, 'prev.json'); if (!prev) return; r = emptyRecord(client, e.emp); r.prev = prev; } // まだ開いていない人は前年の内容のまま出す
    lines.push(icsRowFromRecord(r));
  });
  if (subset) { var keep = icsNenchoColumns(); for (var n = 2; n < lines.length; n++) { var l = lines[n]; lines[n] = keep.map(function (i) { return l[i] === undefined ? '' : l[i]; }); } }
  return lines.map(function (l) { return l.map(function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n') + '\r\n';
}

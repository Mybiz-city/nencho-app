// 会社（経営者）用：在籍者の確認・入社日退職日・新しい従業員の追加・暗証番号の確認と再発行
// URL: ?p=company&c=顧問先コード&k=合言葉（事務所画面で発行。90日で期限切れ）
// 守りは2段：①URLの合言葉　②社長用の番号（6桁。初めて開いた人が決める。同じ端末はURLの期限まで覚える）
// このページには全従業員の登録コードと暗証番号が出るため、URLだけが漏れても開かないようにしている

var COMPANY_PASS_MAX_FAIL = 20; // 続けてこの回数間違えたら、事務所が「やり直し」を押すまで止める
var COMPANY_DEV_MAX = 20;       // 1社で覚える端末の数の上限（古い順に捨てる）

function companyContext(c, k) {
  var client = four(c); var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var kk = keys[client];
  var expired = kk && (Date.now() - new Date(kk.issued_at || '2000-01-01').getTime() > 90 * 86400000);
  if (client.length !== 4 || !kk || expired || !safeEq(kk.key || '', String(k || ''))) { audit('company page denied ' + client); return { ok: false, error: 'このページは開けません。事務所から届いたURLをそのまま開いてください（URLは90日で期限が切れます）' }; }
  return { ok: true, client: client, name: clientsLoad()[client] || ('顧問先 ' + client), year: cfg().year, emp_url: pageUrl('emp'), deadline: cfg().deadline_text };
}
function companyNeed(p) { var ctx = companyContext(p.c, p.k); if (!ctx.ok) throw new Error(ctx.error); return ctx; }
function companyRows(client) {
  var s = summaryLoad(client); var y = cfg().year;
  return Object.keys(s).sort().map(function (k) { var e = s[k]; return { emp: e.emp, name: e.name, birth: e.birth, hire: e.hire, retire: e.retire, status: e.roster, app: e.status, pending: e.pending, code: client + codeDigits(e.emp), added: !!e.added, pin: e.pin, pin_used: e.pin_used, pin_used_count: e.pin_used_count || 0, pin_locked: !!e.pin_locked, device: e.device }; });
}
/** 社長用の番号の状態。set：まだ決めていない　enter：番号が要る　ok：この端末は確認済み　locked：間違いが続いて止まっている */
function companyGate(client, p) {
  var kk = (jsonLoad(rootFolder(), '_company_keys.json', {}) || {})[client] || {};
  if (!kk.pass) return 'set';
  var dev = String((p && p.dev) || '');
  if (dev && kk.devs && kk.devs[sha256(dev)]) return 'ok';
  if ((kk.pass_fail || 0) >= COMPANY_PASS_MAX_FAIL) return 'locked';
  return 'enter';
}
/** この端末の合鍵を作って覚える（鍵そのものは保存せず、ハッシュだけ）。keys[client] を書き換える。保存は呼び出し側 */
function companyDevAdd(kk) {
  var tok = randomHex(24); kk.devs = kk.devs || {};
  var hs = Object.keys(kk.devs).sort(function (x, y) { return kk.devs[x] < kk.devs[y] ? -1 : 1; });
  while (hs.length >= COMPANY_DEV_MAX) delete kk.devs[hs.shift()];
  kk.devs[sha256(tok)] = nowIso();
  return tok;
}
function companyPassDigits(v) {
  var pw = zenToHanDigits(v || '').replace(/\D/g, '');
  if (pw.length !== 6) throw new Error('番号は数字6桁で入れてください');
  return pw;
}
/** 一覧の画面に要るものをまとめて返す（番号の確認と同じ通信で返して、待ち時間を1回分に減らす） */
function companyListData(client, ctx) { return { rows: companyRows(client), ctx: ctx, tpl: (jsonLoad(clientDir(client), '_company_msg.json', {}) || {}).tpl || '' }; }
function companyWith(base, client, ctx) { var d = companyListData(client, ctx); for (var k in d) base[k] = d[k]; return base; }
var COMPANY_LOCKED_MSG = '番号の間違いが続いたため、このページを止めています。事務所にご連絡ください';
/** 名簿CSV（会社用の形）の日付。年月日のほか、年と月だけ（2026年4月・2026/04）も受ける */
function rosterDate(v) {
  var iso = warekiToIso(v); if (iso) return iso;
  var m = /^(\d{4})[\/\-\.年](\d{1,2})月?$/.exec(zenToHanDigits(String(v || '').trim()).replace(/\s+/g, ''));
  return m ? m[1] + '-' + pad2(m[2]) : '';
}
function rosterDateOut(v) { var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v || ''); return !m ? '' : m[3] ? m[1] + '/' + m[2] + '/' + m[3] : m[1] + '年' + parseInt(m[2], 10) + '月'; }
/** 名簿をCSV（会社用の形）にする。登録コード・暗証番号は入れない。そのまま読み込み直せる */
function rosterCsvText(client) {
  var s = summaryLoad(client), q = function (v) { v = String(v === null || v === undefined ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var out = ['社員番号,氏名,フリガナ,入社日,退職日'];
  Object.keys(s).sort().forEach(function (k) {
    var e = s[k], kana = e.kana;
    if (kana === undefined) { var ed = empDir(client, k, false); var r = ed ? jsonLoad(ed, 'answers.json') : null, pv = ed ? jsonLoad(ed, 'prev.json') : null, ro = ed ? jsonLoad(ed, 'roster.json', {}) : {}; kana = summaryRowFrom(k, r, pv, ro).kana; } // 古い集計にはフリガナが無いので、その人だけ読みに行く
    var d = codeDigits(e.emp);
    out.push([d === '' ? '' : String(parseInt(d, 10)), e.name || '', kana || '', rosterDateOut(e.hire), e.roster === 'retired' ? rosterDateOut(e.retire) : ''].map(q).join(','));
  });
  return out.join('\r\n') + '\r\n';
}
function rosterCsvName(client) { return client + '_名簿_' + today().replace(/-/g, '') + '.csv'; }
/** 名簿CSV（会社用の形）を読み込む。by：誰が入れたか（company-csv／office-csv）。戻り {upd, add, skip, warn} */
function rosterBulk(client, text, by) {
  var year = cfg().year;
  var lines = csvParse(text);
  if (!lines.length) throw new Error('空のファイルです');
  var hdr = lines[0].map(function (c) { return String(c).trim().replace(/　/g, ' ').replace(/^﻿/, ''); });
  var col = function (names) { for (var i = 0; i < names.length; i++) { var j = hdr.indexOf(names[i]); if (j >= 0) return j; } return null; };
  var iName = col(['氏名', '名前', '社員名']), iKana = col(['フリガナ', 'ふりがな', 'カナ']), iBirth = col(['生年月日']), iHire = col(['入社日', '入社年月日']), iRet = col(['退職日', '退職年月日']), iSex = col(['性別']), iNo = col(['社員番号', '個人コード', '社員コード']);
  if (iName === null) throw new Error('1行目に「氏名」の見出しが必要です（フリガナ・入社日・退職日・生年月日・性別・社員番号は任意）。日本ICSの年末調整CSVは、事務所画面で種類を「日本ICSの形」にして読み込みます');
  var strip = function (v) { return String(v || '').replace(/[ 　]/g, ''); };
  var s = summaryLoad(client), existing = {}, byName = {}, byNum = {}, used = {};
  var reg = function (k, nm, bd) { var n0 = strip(nm); if (bd) existing[n0 + '|' + bd] = k; (byName[n0] = byName[n0] || []).push(k); var d = codeDigits(k); if (d !== '') byNum[parseInt(d, 10)] = k; used[k] = 1; };
  for (var k in s) reg(k, s[k].name, s[k].birth);
  var yd = pathFolder([client, String(year)], true), changed = {};
  var have = null, pend = pendingLoad(client, year), pdirty = false; // 新しい人は、全員分を _pending.json 1枚に置く（フォルダは本人が初めて入ったときに作る）
  var nx = nextEmpCode(client), nm0 = /^(\D*)(\d+)$/.exec(nx), npre = nm0[1], nw = nm0[2].length, nseq = parseInt(nm0[2], 10); // 個人コードは今ある最大の番号の続き
  var upd = 0, add = 0, skip = 0, warn = [];
  lines.slice(1).forEach(function (c) {
    var nm = String(c[iName] || '').trim(), bd = iBirth !== null ? (warekiToIso(c[iBirth]) || '') : '';
    if (!nm) { skip++; return; }
    var hire2 = iHire !== null ? (rosterDate(c[iHire])) : '', ret = iRet !== null ? (rosterDate(c[iRet])) : '';
    var no = iNo !== null ? zenToHanDigits(c[iNo]).replace(/\D/g, '') : '', num = no !== '' ? parseInt(no, 10) : null;
    var n1 = strip(nm), hit = null, row0 = function (e) { return changed[e] || s[e] || {}; };
    if (num !== null && byNum[num]) { // 社員番号が同じ人：氏名も同じなら本人。違えば番号の重なり
      if (strip(row0(byNum[num]).name) !== n1) { skip++; warn.push(nm + '（社員番号 ' + num + ' は別の方が使っています）'); return; }
      hit = byNum[num];
    } else if (bd && existing[n1 + '|' + bd]) hit = existing[n1 + '|' + bd];
    else if (byName[n1]) { // 氏名が同じ人：生年月日が食い違わない人が1人だけなら本人
      var cand = byName[n1].filter(function (e) { var b0 = row0(e).birth || ''; return !bd || !b0 || b0 === bd; });
      if (cand.length > 1) { skip++; warn.push(nm + '（同じ氏名の方が複数います。生年月日か社員番号を入れてください）'); return; }
      if (cand.length === 1) { if (num !== null) { skip++; warn.push(nm + '（すでに別の番号で登録されています）'); return; } hit = cand[0]; }
    }
    if (hit) {
      var e3 = hit; var row = changed[e3] || s[e3];
      var kana2 = String(c[iKana !== null ? iKana : -1] || '').trim();
      if (!hire2 && !ret && !kana2) { upd++; return; } // 変えるものが無ければ書かない
      if (!have) { have = {}; listFolderNames(yd).forEach(function (n) { have[n] = 1; }); } // フォルダがある人の一覧（問い合わせは1回だけ）
      var k3 = safeEmp(e3), inPend = !have[k3] && !!pend[k3], ed3 = inPend ? null : pathFolder([client, String(year), k3], true);
      var ro3 = inPend ? (pend[k3].ro || {}) : jsonLoad(ed3, 'roster.json', {});
      var kanaChg = !!(kana2 && ro3.added_by && ro3.kana !== kana2); // フリガナを直せるのは、名簿で追加した人だけ（前年CSVの人は本人が直す）
      if ((!hire2 || ro3.hire === hire2) && (!ret || (ro3.status === 'retired' && ro3.retire === ret)) && !kanaChg) { upd++; return; } // 同じ内容なら書かない
      if (kanaChg) { ro3.kana = kana2; row.kana = kana2; }
      if (hire2) { ro3.hire = hire2; row.hire = hire2; } if (ret) { ro3.status = 'retired'; ro3.retire = ret; row.roster = 'retired'; row.retire = ret; }
      ro3.updated_at = nowIso(); ro3.updated_by = by; if (inPend) { pend[k3].ro = ro3; pdirty = true; } else jsonSave(ed3, 'roster.json', ro3); changed[e3] = row; upd++;
    } else {
      var e4;
      if (num !== null) e4 = npre + ('000000000' + num).slice(-Math.max(nw, String(num).length)); // 社員番号を個人コードにする
      else { e4 = npre + ('000000000' + nseq).slice(-nw); while (used[e4]) { nseq++; e4 = npre + ('000000000' + nseq).slice(-nw); } nseq++; }
      var ro4 = { status: ret ? 'retired' : 'active', hire: hire2, retire: ret, added_by: by, added_at: nowIso(), name: nm, kana: String(c[iKana !== null ? iKana : -1] || '').trim(), birth: bd, sex: String(c[iSex !== null ? iSex : -1] || '').trim(), pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() };
      pend[safeEmp(e4)] = { ro: ro4 }; pdirty = true;
      changed[e4] = summaryRowFrom(e4, null, null, ro4); reg(e4, nm, bd); add++;
    }
  });
  if (pdirty) pendingSave(client, year, pend);
  if (Object.keys(changed).length) summaryMerge(client, year, changed);
  indexAdd(client, year);
  return { upd: upd, add: add, skip: skip, warn: warn };
}
function rosterBulkMsg(r) { return '更新 ' + r.upd + ' 人、追加 ' + r.add + ' 人、読み飛ばし ' + r.skip + ' 行' + (r.warn.length ? '（' + r.warn.join('、') + '）' : ''); }
function companyApi(a, p) {
  var ctx = companyNeed(p); var client = ctx.client, year = cfg().year;
  var gate = companyGate(client, p);
  if (a === 'gate') { var g0 = { ok: true, state: gate, name: ctx.name, year: ctx.year }; return gate === 'ok' ? companyWith(g0, client, ctx) : g0; } // 確認済みの端末には一覧も一緒に返す
  if (a === 'pass_set') { // 初めて開いた人が番号を決める（決められるのは1回だけ。やり直しは事務所画面から）
    var pw = companyPassDigits(p.pass);
    if (/^(\d)\1{5}$/.test(pw) || pw === '123456' || pw === '654321') throw new Error('この番号は当てられやすいので、別の番号にしてください');
    var tok = null;
    withLock(function () {
      var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var k2 = keys[client];
      if (!k2 || !safeEq(k2.key || '', String(p.k || ''))) throw new Error('このページは開けません。事務所から届いたURLをそのまま開いてください');
      if (k2.pass) throw new Error('すでに番号が決められています。画面を開き直して、決めた番号を入れてください。心当たりがないときは、事務所にご連絡ください');
      k2.pass = pwHash(pw); k2.pass_set_at = nowIso(); k2.pass_fail = 0; k2.devs = {}; tok = companyDevAdd(k2);
      jsonSave(rootFolder(), '_company_keys.json', keys);
    });
    audit('company pass set ' + client);
    return companyWith({ ok: true, dev: tok }, client, ctx);
  }
  if (a === 'pass_enter') { // 別の端末で開いたとき：決めた番号を入れる
    if (gate === 'set') throw new Error('まだ番号が決められていません。画面を開き直してください');
    if (gate === 'locked') throw new Error(COMPANY_LOCKED_MSG);
    var tk = 'cpass:' + client;
    if (!throttleOk(tk)) { audit('company pass locked ' + client); throw new Error('試行回数が多すぎます。15分ほど待ってからやり直してください'); }
    var pw2 = companyPassDigits(p.pass), tok2 = null, bad = false, stop = false;
    withLock(function () {
      var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var k2 = keys[client] || {};
      if (!pwVerify(pw2, k2.pass)) { bad = true; k2.pass_fail = (k2.pass_fail || 0) + 1; stop = k2.pass_fail >= COMPANY_PASS_MAX_FAIL; }
      else { k2.pass_fail = 0; tok2 = companyDevAdd(k2); }
      jsonSave(rootFolder(), '_company_keys.json', keys);
    });
    if (bad) {
      throttleFail(tk, 5); audit('company pass mismatch ' + client + (stop ? ' (stopped)' : ''));
      throw new Error(stop ? COMPANY_LOCKED_MSG : '番号が一致しません');
    }
    throttleClear(tk); audit('company pass ok ' + client);
    return companyWith({ ok: true, dev: tok2 }, client, ctx);
  }
  // ここから下は、社長用の番号を確認できた端末だけ
  if (gate !== 'ok') throw new Error(gate === 'locked' ? COMPANY_LOCKED_MSG : gate === 'set' ? 'このページを開き直して、最初に社長用の番号（6桁）を決めてください' : 'このページを開き直して、社長用の番号（6桁）を入れてください');
  switch (a) {
    case 'list': return companyWith({ ok: true }, client, ctx);
    case 'msg_save': { // 従業員への案内文（会社ごと）
      var tpl = String(p.tpl || '').substr(0, 1500); jsonSave(pathFolder([client, String(year)], true), '_company_msg.json', { tpl: tpl, at: nowIso() });
      return { ok: true, msg: tpl ? '案内文を保存しました' : '案内文を元の文に戻しました' };
    }
    case 'roster': {
      var emp = empListedNeed(client, p.emp); var ed = empDir(client, emp, true); var ro = jsonLoad(ed, 'roster.json', {}); // 一覧にいる人だけ（存在しない個人コードで新しい行を作らせない）
      var ymd = function (v) { v = String(v || '').trim(); return /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? v : ''; }; // 日付は 2026-04 か 2026-04-01 の形だけ
      ro.status = p.status === 'retired' ? 'retired' : 'active'; ro.hire = ymd(p.hire); ro.retire = ro.status === 'retired' ? ymd(p.retire) : '';
      ro.updated_at = nowIso(); ro.updated_by = 'company'; jsonSave(ed, 'roster.json', ro); summaryUpdate(client, emp);
      return { ok: true, msg: '保存しました', rows: companyRows(client) };
    }
    case 'add': {
      var name = String(p.name || '').trim().substr(0, 60), kana = String(p.kana || '').trim().substr(0, 60), birth = /^\d{4}-\d{2}-\d{2}$/.test(String(p.birth || '')) ? String(p.birth) : '', hire = String(p.hire || ''), sex = String(p.sex || '').substr(0, 4);
      if (!name) throw new Error('氏名を入れてください');
      if (!kana) throw new Error('フリガナを入れてください');
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(hire)) throw new Error('入社日の年と月を選んでください');
      var emp2, yd2 = pathFolder([client, String(year)], true);
      var ro2 = { status: 'active', hire: hire, retire: '', added_by: 'company', added_at: nowIso(), name: name, kana: kana, birth: birth, sex: sex, pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() };
      withLock(function () { // 番号の取り合いを防ぐため、番号決め〜集計の反映までを1人ずつ
        emp2 = nextEmpCode(client);
        jsonCreate(newSubFolder(yd2, emp2), 'roster.json', ro2);
        var s0 = jsonLoad(yd2, '_summary.json', {}); s0[emp2] = summaryRowFrom(emp2, null, null, ro2); jsonSave(yd2, '_summary.json', s0); homeUpdate(client, year, s0);
      });
      indexAdd(client, year);
      audit('company added ' + client + '-' + emp2);
      return { ok: true, msg: name + ' さんを追加しました。登録コードと暗証番号が一覧に出ています', rows: companyRows(client) };
    }
    case 'bulk': { // 名簿CSVの読み込み。text（画面側で文字コードを直して小分けに送る）または b64。必須は「氏名」だけ
      var rb = rosterBulk(client, p.text !== undefined ? String(p.text) : decodeAuto(p.b64), 'company-csv');
      return { ok: true, upd: rb.upd, add: rb.add, skip: rb.skip, warn: rb.warn, msg: rosterBulkMsg(rb), rows: p.norows ? undefined : companyRows(client) };
    }
    case 'export': audit('company roster export ' + client); return { ok: true, csv: rosterCsvText(client), filename: rosterCsvName(client) }; // 名簿をCSVで出す（登録コード・暗証番号は含めない）
    case 'edit': { // 会社が追加した人の氏名・フリガナの直し
      var e5 = empListedNeed(client, p.emp), nm5 = String(p.name || '').trim().substr(0, 60); if (!nm5) throw new Error('氏名を入れてください');
      var ed5 = empDir(client, e5, false); var ro5 = ed5 ? jsonLoad(ed5, 'roster.json', {}) : null;
      if (!ro5 || !ro5.added_by) throw new Error('直せるのは、この画面で追加した方だけです');
      ro5.name = nm5; if (String(p.kana || '').trim()) ro5.kana = String(p.kana).trim().substr(0, 60); ro5.updated_at = nowIso(); jsonSave(ed5, 'roster.json', ro5);
      var r5 = jsonLoad(ed5, 'answers.json'); if (r5 && !r5.submitted_at) { r5.answers = r5.answers || {}; r5.answers.name = nm5; if (ro5.kana) r5.answers.kana = ro5.kana; jsonSave(ed5, 'answers.json', r5); }
      var o5 = {}; o5[e5] = summaryRowFrom(e5, r5, null, ro5); summaryMerge(client, year, o5);
      return { ok: true, msg: '氏名を直しました', rows: companyRows(client) };
    }
    case 'remove': { // 会社が追加した人の取り消し（提出済みは不可）
      var e6 = empListedNeed(client, p.emp); var ed6 = empDir(client, e6, false); var ro6 = ed6 ? jsonLoad(ed6, 'roster.json', {}) : null;
      if (!ro6 || !ro6.added_by) throw new Error('削除できるのは、この画面で追加した方だけです。前からいる方は「退職」にしてください');
      var r6 = jsonLoad(ed6, 'answers.json'); if (r6 && r6.status === 'submitted') throw new Error('この方は提出済みのため削除できません。事務所にご連絡ください');
      deviceUnbindAll(client, e6); ed6.setTrashed(true); pendingDrop(client, e6); cacheDel('fid:' + pathFolder([client, String(year)], true).getId() + '/' + safeEmp(e6));
      var o6 = {}; o6[e6] = null; summaryMerge(client, year, o6); audit('company removed ' + client + '-' + e6);
      return { ok: true, msg: (ro6.name || '') + ' さんを削除しました', rows: companyRows(client) };
    }
    case 'pin_reissue': { var ep = empListedNeed(client, p.emp); var pin = pinReissue(client, ep); audit('pin reissue by company ' + client + '-' + ep); return { ok: true, msg: '暗証番号を発行し直しました：' + pin, rows: companyRows(client) }; }
  }
  throw new Error('不明な操作');
}
/** 会社が追加した人の仮コード N001… */
function companyNewCode(client) { var s = summaryLoad(client); var n = 1; while (s['N' + ('00' + n).slice(-3)]) n++; return 'N' + ('00' + n).slice(-3); }

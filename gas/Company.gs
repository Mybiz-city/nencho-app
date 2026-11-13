// 会社（経営者）用：在籍者の確認・入社日退職日・新しい従業員の追加・暗証番号の確認と再発行
// URL: ?p=company&c=顧問先コード&k=合言葉（事務所画面で発行。90日で期限切れ）

function companyContext(c, k) {
  var client = four(c); var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var kk = keys[client];
  var expired = kk && (Date.now() - new Date(kk.issued_at || '2000-01-01').getTime() > 90 * 86400000);
  if (client.length !== 4 || !kk || expired || !safeEq(kk.key || '', String(k || ''))) { audit('company page denied ' + client); return { ok: false, error: 'このページは開けません。事務所から届いたURLをそのまま開いてください（URLは90日で期限が切れます）' }; }
  return { ok: true, client: client, name: clientsLoad()[client] || ('顧問先 ' + client), year: cfg().year, emp_url: pageUrl('emp'), deadline: cfg().deadline_text };
}
function companyNeed(p) { var ctx = companyContext(p.c, p.k); if (!ctx.ok) throw new Error(ctx.error); return ctx; }
/** 会社用ページから指定できるのは、一覧に載っている個人コードだけ（好きな文字を個人コードとして送り込ませない） */
function companyEmp(client, emp) {
  emp = String(emp || ''); var s = summaryLoad(client);
  if (!emp || !Object.prototype.hasOwnProperty.call(s, emp)) throw new Error('この方は一覧に見つかりません。画面を開き直してください');
  return emp;
}
function companyRows(client) {
  var s = summaryLoad(client); var y = cfg().year;
  return Object.keys(s).sort().map(function (k) { var e = s[k]; return { emp: e.emp, name: e.name, birth: e.birth, hire: e.hire, retire: e.retire, status: e.roster, app: e.status, pending: e.pending, code: client + codeDigits(e.emp), added: !!e.added, pin: e.pin, pin_locked: !!e.pin_locked, pin_used: e.pin_used, pin_used_count: e.pin_used_count || 0, device: e.device }; });
}
function companyApi(a, p) {
  var ctx = companyNeed(p); var client = ctx.client, year = cfg().year;
  switch (a) {
    case 'list': return { ok: true, rows: companyRows(client), ctx: ctx, tpl: (jsonLoad(clientDir(client), '_company_msg.json', {}) || {}).tpl || '' };
    case 'msg_save': { // 従業員への案内文（会社ごと）
      var tpl = String(p.tpl || '').substr(0, 1500); jsonSave(pathFolder([client, String(year)], true), '_company_msg.json', { tpl: tpl, at: nowIso() });
      return { ok: true, msg: tpl ? '案内文を保存しました' : '案内文を元の文に戻しました' };
    }
    case 'roster': {
      var emp = companyEmp(client, p.emp); var ed = empDir(client, emp, true); var ro = jsonLoad(ed, 'roster.json', {});
      ro.status = p.status === 'retired' ? 'retired' : 'active'; ro.hire = String(p.hire || '').trim(); ro.retire = ro.status === 'retired' ? String(p.retire || '').trim() : '';
      ro.updated_at = nowIso(); ro.updated_by = 'company'; jsonSave(ed, 'roster.json', ro); summaryUpdate(client, emp);
      return { ok: true, msg: '保存しました', rows: companyRows(client) };
    }
    case 'add': {
      var name = String(p.name || '').trim(), kana = String(p.kana || '').trim(), birth = String(p.birth || ''), hire = String(p.hire || ''), sex = String(p.sex || '');
      if (!name) throw new Error('氏名を入れてください');
      if (!kana) throw new Error('フリガナを入れてください');
      if (!/^\d{4}-\d{2}/.test(hire)) throw new Error('入社日の年と月を選んでください');
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
    case 'bulk': { // text（画面側で文字コードを直して小分けに送る）または b64
      var text = p.text !== undefined ? String(p.text) : decodeAuto(p.b64); var lines = csvParse(text);
      if (!lines.length) throw new Error('空のファイルです');
      var hdr = lines[0].map(function (c) { return String(c).trim().replace(/　/g, ' ').replace(/^\uFEFF/, ''); });
      var col = function (names) { for (var i = 0; i < names.length; i++) { var j = hdr.indexOf(names[i]); if (j >= 0) return j; } return null; };
      var iName = col(['氏名', '名前', '社員名']), iKana = col(['フリガナ', 'ふりがな', 'カナ']), iBirth = col(['生年月日']), iHire = col(['入社日', '入社年月日']), iRet = col(['退職日', '退職年月日']), iSex = col(['性別']);
      if (iName === null || iBirth === null) throw new Error('1行目に「氏名」と「生年月日」の見出しが必要です（入社日・退職日・フリガナ・性別は任意）');
      var s = summaryLoad(client), existing = {}, used = {};
      for (var k in s) { existing[String(s[k].name).replace(/[ 　]/g, '') + '|' + s[k].birth] = k; used[k] = 1; }
      var yd = pathFolder([client, String(year)], true), changed = {};
      var nx = nextEmpCode(client), nm0 = /^(\D*)(\d+)$/.exec(nx), npre = nm0[1], nw = nm0[2].length, nseq = parseInt(nm0[2], 10); // 個人コードは今ある最大の番号の続き
      var upd = 0, add = 0, skip = 0;
      lines.slice(1).forEach(function (c) {
        var nm = String(c[iName] || '').trim(), bd = warekiToIso(c[iBirth]) || '';
        if (!nm || !bd) { skip++; return; }
        var hire2 = iHire !== null ? (warekiToIso(c[iHire]) || '') : '', ret = iRet !== null ? (warekiToIso(c[iRet]) || '') : '';
        var key = nm.replace(/[ 　]/g, '') + '|' + bd;
        if (existing[key]) {
          var e3 = existing[key]; var row = changed[e3] || s[e3];
          if (!hire2 && !ret) { upd++; return; } // 変えるものが無ければ書かない
          var ed3 = pathFolder([client, String(year), safeEmp(e3)], true); var ro3 = jsonLoad(ed3, 'roster.json', {});
          if ((!hire2 || ro3.hire === hire2) && (!ret || (ro3.status === 'retired' && ro3.retire === ret))) { upd++; return; } // 同じ内容なら書かない
          if (hire2) { ro3.hire = hire2; row.hire = hire2; } if (ret) { ro3.status = 'retired'; ro3.retire = ret; row.roster = 'retired'; row.retire = ret; }
          ro3.updated_at = nowIso(); ro3.updated_by = 'company-csv'; jsonSave(ed3, 'roster.json', ro3); changed[e3] = row; upd++;
        } else {
          var e4 = npre + ('000000000' + nseq).slice(-nw); while (used[e4]) { nseq++; e4 = npre + ('000000000' + nseq).slice(-nw); } used[e4] = 1; nseq++;
          var ro4 = { status: ret ? 'retired' : 'active', hire: hire2, retire: ret, added_by: 'company-csv', added_at: nowIso(), name: nm, kana: String(c[iKana !== null ? iKana : -1] || '').trim(), birth: bd, sex: String(c[iSex !== null ? iSex : -1] || '').trim(), pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() };
          jsonCreate(newSubFolder(yd, e4), 'roster.json', ro4);
          changed[e4] = summaryRowFrom(e4, null, null, ro4); existing[key] = e4; add++;
        }
      });
      if (Object.keys(changed).length) summaryMerge(client, year, changed);
      indexAdd(client, year);
      return { ok: true, upd: upd, add: add, skip: skip, msg: '更新 ' + upd + ' 人、追加 ' + add + ' 人、読み飛ばし ' + skip + ' 行', rows: p.norows ? undefined : companyRows(client) };
    }
    case 'edit': { // 会社が追加した人の氏名・フリガナの直し
      var e5 = companyEmp(client, p.emp), nm5 = String(p.name || '').trim(); if (!nm5) throw new Error('氏名を入れてください');
      var ed5 = empDir(client, e5, false); var ro5 = ed5 ? jsonLoad(ed5, 'roster.json', {}) : null;
      if (!ro5 || !ro5.added_by) throw new Error('直せるのは、この画面で追加した方だけです');
      ro5.name = nm5; if (String(p.kana || '').trim()) ro5.kana = String(p.kana).trim(); ro5.updated_at = nowIso(); jsonSave(ed5, 'roster.json', ro5);
      var r5 = jsonLoad(ed5, 'answers.json'); if (r5 && !r5.submitted_at) { r5.answers = r5.answers || {}; r5.answers.name = nm5; if (ro5.kana) r5.answers.kana = ro5.kana; jsonSave(ed5, 'answers.json', r5); }
      var o5 = {}; o5[e5] = summaryRowFrom(e5, r5, null, ro5); summaryMerge(client, year, o5);
      return { ok: true, msg: '氏名を直しました', rows: companyRows(client) };
    }
    case 'remove': { // 会社が追加した人の取り消し（提出済みは不可）
      var e6 = companyEmp(client, p.emp); var ed6 = empDir(client, e6, false); var ro6 = ed6 ? jsonLoad(ed6, 'roster.json', {}) : null;
      if (!ro6 || !ro6.added_by) throw new Error('削除できるのは、この画面で追加した方だけです。前からいる方は「退職」にしてください');
      var r6 = jsonLoad(ed6, 'answers.json'); if (r6 && r6.status === 'submitted') throw new Error('この方は提出済みのため削除できません。事務所にご連絡ください');
      deviceUnbindAll(client, e6); ed6.setTrashed(true); cacheDel('fid:' + pathFolder([client, String(year)], true).getId() + '/' + safeEmp(e6));
      var o6 = {}; o6[e6] = null; summaryMerge(client, year, o6); audit('company removed ' + client + '-' + e6);
      return { ok: true, msg: (ro6.name || '') + ' さんを削除しました', rows: companyRows(client) };
    }
    case 'pin_reissue': { var e7 = companyEmp(client, p.emp); var pin = pinReissue(client, e7); audit('pin reissue by company ' + client + '-' + e7); return { ok: true, msg: '暗証番号を発行し直しました：' + pin, rows: companyRows(client) }; }
  }
  throw new Error('不明な操作');
}
/** 会社が追加した人の仮コード N001… */
function companyNewCode(client) { var s = summaryLoad(client); var n = 1; while (s['N' + ('00' + n).slice(-3)]) n++; return 'N' + ('00' + n).slice(-3); }

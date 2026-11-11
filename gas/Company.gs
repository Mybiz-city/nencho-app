// 会社（経営者）用：在籍者の確認・入社日退職日・新しい従業員の追加・初回番号の確認と再発行
// URL: ?p=company&c=顧問先コード&k=合言葉（事務所画面で発行。90日で期限切れ）

function companyContext(c, k) {
  var client = four(c); var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var kk = keys[client];
  var expired = kk && (Date.now() - new Date(kk.issued_at || '2000-01-01').getTime() > 90 * 86400000);
  if (client.length !== 4 || !kk || expired || !safeEq(kk.key || '', String(k || ''))) { audit('company page denied ' + client); return { ok: false, error: 'このページは開けません。事務所から届いたURLをそのまま開いてください（URLは90日で期限が切れます）' }; }
  return { ok: true, client: client, name: clientsLoad()[client] || ('顧問先 ' + client), year: cfg().year, emp_url: pageUrl('emp'), deadline: cfg().deadline_text };
}
function companyNeed(p) { var ctx = companyContext(p.c, p.k); if (!ctx.ok) throw new Error(ctx.error); return ctx; }
function companyRows(client) {
  var s = summaryLoad(client); var y = cfg().year;
  return Object.keys(s).sort().map(function (k) { var e = s[k]; return { emp: e.emp, name: e.name, birth: e.birth, hire: e.hire, retire: e.retire, status: e.roster, app: e.status, pending: e.pending, code: client + codeDigits(e.emp), pin: e.pin, pin_used: e.pin_used, pin_used_count: e.pin_used_count || 0, device: e.device }; });
}
function companyApi(a, p) {
  var ctx = companyNeed(p); var client = ctx.client, year = cfg().year;
  switch (a) {
    case 'list': return { ok: true, rows: companyRows(client), ctx: ctx };
    case 'roster': {
      var emp = String(p.emp || ''); var ed = empDir(client, emp, true); var ro = jsonLoad(ed, 'roster.json', {});
      ro.status = p.status === 'retired' ? 'retired' : 'active'; ro.hire = String(p.hire || '').trim(); ro.retire = ro.status === 'retired' ? String(p.retire || '').trim() : '';
      ro.updated_at = nowIso(); ro.updated_by = 'company'; jsonSave(ed, 'roster.json', ro); summaryUpdate(client, emp);
      return { ok: true, msg: '保存しました', rows: companyRows(client) };
    }
    case 'add': {
      var name = String(p.name || '').trim(), kana = String(p.kana || '').trim(), birth = String(p.birth || ''), hire = String(p.hire || ''), sex = String(p.sex || '');
      if (!name) throw new Error('氏名を入れてください');
      var emp2 = companyNewCode(client); var yd2 = pathFolder([client, String(year)], true);
      var ro2 = { status: 'active', hire: hire, retire: '', added_by: 'company', added_at: nowIso(), name: name, kana: kana, birth: birth, sex: sex, pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() };
      jsonCreate(newSubFolder(yd2, emp2), 'roster.json', ro2);
      var one = {}; one[emp2] = summaryRowFrom(emp2, null, null, ro2); summaryMerge(client, year, one); indexAdd(client, year);
      audit('company added ' + client + '-' + emp2);
      return { ok: true, msg: name + ' さんを追加しました。登録コードは事務所が番号を割り当ててからお知らせします', rows: companyRows(client) };
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
      var yd = pathFolder([client, String(year)], true), changed = {}, nseq = 1;
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
          while (used['N' + ('00' + nseq).slice(-3)]) nseq++; var e4 = 'N' + ('00' + nseq).slice(-3); used[e4] = 1;
          var ro4 = { status: ret ? 'retired' : 'active', hire: hire2, retire: ret, added_by: 'company-csv', added_at: nowIso(), name: nm, kana: String(c[iKana !== null ? iKana : -1] || '').trim(), birth: bd, sex: String(c[iSex !== null ? iSex : -1] || '').trim(), pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() };
          jsonCreate(newSubFolder(yd, e4), 'roster.json', ro4);
          changed[e4] = summaryRowFrom(e4, null, null, ro4); existing[key] = e4; add++;
        }
      });
      if (Object.keys(changed).length) summaryMerge(client, year, changed);
      indexAdd(client, year);
      return { ok: true, upd: upd, add: add, skip: skip, msg: '更新 ' + upd + ' 人、追加 ' + add + ' 人、読み飛ばし ' + skip + ' 行', rows: p.norows ? undefined : companyRows(client) };
    }
    case 'pin_reissue': { var pin = pinReissue(client, String(p.emp || '')); audit('pin reissue by company ' + client + '-' + p.emp); return { ok: true, msg: '初回番号を発行し直しました：' + pin, rows: companyRows(client) }; }
  }
  throw new Error('不明な操作');
}
/** 会社が追加した人の仮コード N001… */
function companyNewCode(client) { var s = summaryLoad(client); var n = 1; while (s['N' + ('00' + n).slice(-3)]) n++; return 'N' + ('00' + n).slice(-3); }

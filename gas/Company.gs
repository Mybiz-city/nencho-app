// 会社（経営者）用：在籍者の確認・入社日退職日・新しい従業員の追加・初回番号の確認と再発行
// URL: ?p=company&c=顧問先コード&k=合言葉（事務所画面で発行。90日で期限切れ）

function companyContext(c, k) {
  var client = four(c); var keys = jsonLoad(rootFolder(), '_company_keys.json', {}); var kk = keys[client];
  var expired = kk && (Date.now() - new Date(kk.issued_at || '2000-01-01').getTime() > 90 * 86400000);
  if (client.length !== 4 || !kk || expired || !safeEq(kk.key || '', String(k || ''))) { audit('company page denied ' + client); return { ok: false, error: 'このページは開けません。事務所から届いたURLをそのまま開いてください（URLは90日で期限が切れます）' }; }
  return { ok: true, client: client, name: clientsLoad()[client] || ('顧問先 ' + client), year: cfg().year };
}
function companyNeed(p) { var ctx = companyContext(p.c, p.k); if (!ctx.ok) throw new Error(ctx.error); return ctx; }
function companyRows(client) {
  var s = summaryLoad(client); var y = cfg().year;
  return Object.keys(s).sort().map(function (k) { var e = s[k]; return { emp: e.emp, name: e.name, birth: e.birth, hire: e.hire, retire: e.retire, status: e.roster, app: e.status, pending: e.pending, code: client + codeDigits(e.emp), pin: e.pin, pin_used: e.pin_used, device: e.device }; });
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
      if (!name || !birth) throw new Error('氏名と生年月日は必須です');
      var emp2 = companyNewCode(client); var ed2 = pathFolder([client, String(year), emp2], true);
      jsonSave(ed2, 'roster.json', { status: 'active', hire: hire, retire: '', added_by: 'company', added_at: nowIso(), name: name, kana: kana, birth: birth, sex: sex, pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() });
      var r = emptyRecord(client, emp2); r.answers = { name: name, kana: kana, birth: birth, sex: sex }; jsonSave(ed2, 'answers.json', r);
      summaryUpdate(client, emp2); indexAdd(client, year); audit('company added ' + client + '-' + emp2);
      return { ok: true, msg: name + ' さんを追加しました。登録コードは事務所が番号を割り当ててからお知らせします', rows: companyRows(client) };
    }
    case 'bulk': {
      var text = decodeAuto(p.b64); var lines = csvParse(text);
      if (!lines.length) throw new Error('空のファイルです');
      var hdr = lines[0].map(function (c) { return String(c).trim().replace(/　/g, ' '); });
      var col = function (names) { for (var i = 0; i < names.length; i++) { var j = hdr.indexOf(names[i]); if (j >= 0) return j; } return null; };
      var iName = col(['氏名', '名前', '社員名']), iKana = col(['フリガナ', 'ふりがな', 'カナ']), iBirth = col(['生年月日']), iHire = col(['入社日', '入社年月日']), iRet = col(['退職日', '退職年月日']), iSex = col(['性別']);
      if (iName === null || iBirth === null) throw new Error('1行目に「氏名」と「生年月日」の見出しが必要です（入社日・退職日・フリガナ・性別は任意）');
      var s = summaryLoad(client), existing = {};
      for (var k in s) existing[String(s[k].name).replace(/[ 　]/g, '') + '|' + s[k].birth] = k;
      var upd = 0, add = 0, skip = 0;
      lines.slice(1).forEach(function (c) {
        var nm = String(c[iName] || '').trim(), bd = warekiToIso(c[iBirth]) || '';
        if (!nm || !bd) { skip++; return; }
        var hire2 = iHire !== null ? (warekiToIso(c[iHire]) || '') : '', ret = iRet !== null ? (warekiToIso(c[iRet]) || '') : '';
        var key = nm.replace(/[ 　]/g, '') + '|' + bd;
        if (existing[key]) { var e3 = existing[key]; var ed3 = empDir(client, e3, true); var ro3 = jsonLoad(ed3, 'roster.json', {}); if (hire2) ro3.hire = hire2; if (ret) { ro3.status = 'retired'; ro3.retire = ret; } ro3.updated_at = nowIso(); ro3.updated_by = 'company-csv'; jsonSave(ed3, 'roster.json', ro3); summaryUpdate(client, e3); upd++; }
        else { var e4 = companyNewCode(client); var ed4 = pathFolder([client, String(year), e4], true);
          jsonSave(ed4, 'roster.json', { status: ret ? 'retired' : 'active', hire: hire2, retire: ret, added_by: 'company-csv', added_at: nowIso(), name: nm, birth: bd, pin: randomDigits(6), pin_used: false, pin_issued_at: nowIso() });
          var r4 = emptyRecord(client, e4); r4.answers = { name: nm, kana: String(c[iKana !== null ? iKana : -1] || '').trim(), birth: bd, sex: String(c[iSex !== null ? iSex : -1] || '').trim() }; jsonSave(ed4, 'answers.json', r4);
          summaryUpdate(client, e4); existing[key] = e4; add++; }
      });
      indexAdd(client, year);
      return { ok: true, msg: '更新 ' + upd + ' 人、追加 ' + add + ' 人、読み飛ばし ' + skip + ' 行', rows: companyRows(client) };
    }
    case 'pin_reissue': { var pin = pinReissue(client, String(p.emp || '')); audit('pin reissue by company ' + client + '-' + p.emp); return { ok: true, msg: '初回番号を発行し直しました：' + pin, rows: companyRows(client) }; }
  }
  throw new Error('不明な操作');
}
/** 会社が追加した人の仮コード N001… */
function companyNewCode(client) { var s = summaryLoad(client); var n = 1; while (s['N' + ('00' + n).slice(-3)]) n++; return 'N' + ('00' + n).slice(-3); }

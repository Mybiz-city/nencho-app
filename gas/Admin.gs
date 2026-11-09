// 事務所画面の裏側（パスワード＋認証アプリの6桁でログイン）

function adminNeed(p) { var s = sessionGet('adm', p._t, 7200); if (!s) throw new Error('ログインが切れました。開き直してください'); return s; }
function four(c) { return String(c || '').replace(/\D/g, '').substr(0, 4); }
function yearOf(p) { var y = parseInt(p.y, 10); return (y && y > 2000) ? y : cfg().year; }

function adminApi(a, p) {
  var c = cfg();
  if (a === 'login') {
    if (!throttleOk('admin')) { audit('admin locked'); throw new Error('試行回数が多すぎます。15分後にやり直してください'); }
    var pwOk = pwVerify(String(p.pw || ''), c.admin_pw_hash);
    var otpOk = !c.admin_totp_secret || totpVerify(c.admin_totp_secret, p.otp);
    if (!otpOk && pwOk) { // バックアップコード（1回限り）
      var norm = String(p.otp || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (norm.length >= 8) withLock(function () {
        var codes = jsonLoad(rootFolder(), '_backup_codes.json', []);
        for (var i = 0; i < codes.length; i++) if (pwVerify(norm, codes[i])) { codes.splice(i, 1); jsonSave(rootFolder(), '_backup_codes.json', codes); otpOk = true; audit('admin login with backup code (' + codes.length + ' left)'); break; }
      });
    }
    if (!(pwOk && otpOk)) { throttleFail('admin', 5); audit('admin login ng'); Utilities.sleep(500); throw new Error('パスワードか6桁の番号が違います'); }
    throttleClear('admin'); audit('admin login ok');
    return { ok: true, _t: sessionNew('adm', { admin: true }, 7200), totp: !!c.admin_totp_secret };
  }
  if (a === 'login_info') return { ok: true, totp: !!c.admin_totp_secret, app_name: c.app_name };
  adminNeed(p);
  switch (a) {
    case 'home': {
      var y = yearOf(p); var ix = indexLoad(), names = clientsLoad(), keys = jsonLoad(rootFolder(), '_company_keys.json', {});
      var years = {}; var rows = []; var home = jsonLoad(rootFolder(), '_home.json', {}); var hy = home[String(y)] || {};
      Object.keys(ix).sort().forEach(function (cl) {
        (ix[cl].years || []).forEach(function (yy) { years[yy] = 1; });
        if ((ix[cl].years || []).indexOf(String(y)) < 0) return;
        var hc = hy[cl];
        if (!hc) { hc = homeCounts(summaryLoad(cl, y)); hy[cl] = hc; home[String(y)] = hy; jsonSave(rootFolder(), '_home.json', home); } // 古いデータの初回だけ作る
        rows.push({ client: cl, name: names[cl] || '', n: hc.n, cnt: hc.cnt, key: !!(keys[cl] && keys[cl].key) });
      });
      return { ok: true, year: y, cur_year: c.year, years: Object.keys(years).sort().reverse(), rows: rows, clients_total: Object.keys(names).length,
        zipdict: zipDictMeta(), totp: !!c.admin_totp_secret, backup_left: jsonLoad(rootFolder(), '_backup_codes.json', []).length, version: c.version, url: pageUrl('emp'), admin_url: pageUrl('admin'),
        settings: { year: c.year, pages_url: c.pages_url, app_name: c.app_name, deadline_text: c.deadline_text, ai: !!c.anthropic_api_key, model: c.anthropic_model, liff_id: c.liff_id, github_repo: c.github_repo, root_url: rootFolder().getUrl() } };
    }
    case 'client': {
      var cl2 = four(p.client), y2 = yearOf(p); var s2 = summaryLoad(cl2, y2), names2 = clientsLoad(), keys2 = jsonLoad(rootFolder(), '_company_keys.json', {});
      var list = Object.keys(s2).sort().map(function (k) { return s2[k]; });
      var kk = keys2[cl2] || null;
      return { ok: true, client: cl2, name: names2[cl2] || '', year: y2, cur_year: c.year, rows: list, next_code: nextEmpCode(cl2),
        company: kk ? { url: pageUrl('company', 'c=' + cl2 + '&k=' + kk.key), issued_at: kk.issued_at, expires: addDays(kk.issued_at, 90) } : null };
    }
    case 'emp': {
      var cl3 = four(p.client), y3 = yearOf(p), emp = String(p.emp || '');
      var ed = empDir(cl3, emp, false, y3); if (!ed) throw new Error('見つかりません');
      var r = jsonLoad(ed, 'answers.json') || emptyRecord(cl3, emp); if (!r.prev) r.prev = jsonLoad(ed, 'prev.json');
      var ro = jsonLoad(ed, 'roster.json', {});
      var meta = jsonLoad(clientDir(cl3, y3), '_ics_meta.json'); var row = icsRowFromRecord(r);
      var diff = []; var raw = (r.prev && r.prev.raw) || [];
      for (var i = 0; i < row.length; i++) { var pv = raw[i] === undefined ? '' : raw[i]; if (row[i] === '' && pv === '') continue; if (i >= 24 && i <= 125) continue; diff.push({ col: i + 1, name: (meta && meta.header[i]) || '', prev: pv, now: row[i], chg: String(row[i]) !== String(pv) }); }
      var pk = packRecord(r); pk.roster = ro; pk.dep_kubun = row[C.dep_kubun]; pk.totals = certTotals(r); pk.diff = diff;
      return { ok: true, record: pk };
    }
    case 'photo': return { ok: true, data: photoDataUrl(four(p.client), String(p.emp), p.f, yearOf(p)) };
    case 'import_csv': { // files:[{name,b64}] client?
      var names3 = clientsLoad(); var lines = [];
      (p.files || []).forEach(function (f) {
        var client = four(p.client); var mm = /KYCSV\d{2}(\d{8})/i.exec(f.name || '');
        if (client.length !== 4 && mm) client = mm[1].substr(-4);
        if (client.length !== 4) { lines.push(f.name + '：顧問先コードが分かりません（ファイル名が KYCSV06xxxxxxxx.CSV の形でなければ、欄に4桁を入れてください）'); return; }
        try { var codes = icsImport(client, sjisToUtf8(f.b64)); lines.push(f.name + ' → 顧問先 ' + client + ' ' + (names3[client] || '（名前未登録）') + '：' + codes.length + ' 人'); audit('import ' + client + ' ' + codes.length); }
        catch (e) { lines.push(f.name + '：取込に失敗 ' + e.message); }
      });
      return { ok: true, msg: lines.join(' ／ ') || 'ファイルがありません' };
    }
    case 'clients_import': {
      var names4 = clientsLoad(), n = 0;
      if (p.b64) {
        if (/\.xlsx$/i.test(p.name || '')) { var sheets = xlsxRows(p.b64); for (var sn in sheets) n += clientsFromRows(sheets[sn], names4); }
        else { var txt = decodeAuto(p.b64); n += clientsFromRows(csvParse(txt.replace(/\t/g, ',')), names4); }
      }
      if (p.paste && String(p.paste).trim()) n += clientsFromRows(csvParse(String(p.paste).replace(/\t/g, ',')), names4);
      jsonSave(rootFolder(), '_clients.json', names4);
      return { ok: true, msg: '顧問先一覧を ' + n + ' 件読み込みました（登録合計 ' + Object.keys(names4).length + ' 件）' };
    }
    case 'client_name': { var nm = clientsLoad(); nm[four(p.client)] = String(p.name || '').trim(); jsonSave(rootFolder(), '_clients.json', nm); return { ok: true, msg: '保存しました' }; }
    case 'add_emp': {
      var cl4 = four(p.client), e4 = String(p.emp || '').trim(); if (cl4.length !== 4 || !e4) throw new Error('顧問先コード4桁と個人コードを入れてください');
      var ed4 = pathFolder([cl4, String(c.year), safeEmp(e4)], true); var ro4 = jsonLoad(ed4, 'roster.json', {});
      if (!ro4.pin) { ro4.pin = randomDigits(6); ro4.pin_used = false; ro4.pin_issued_at = nowIso(); ro4.status = ro4.status || 'active'; jsonSave(ed4, 'roster.json', ro4); }
      summaryUpdate(cl4, e4); indexAdd(cl4, c.year);
      return { ok: true, msg: '登録コード ' + cl4 + codeDigits(e4) + ' を作りました（初回番号 ' + ro4.pin + '）' };
    }
    case 'export': {
      var cl5 = four(p.client), y5 = yearOf(p);
      var csv = icsExport(cl5, !p.all, y5, !p.full); audit('export ' + cl5 + ' ' + y5 + (p.all ? ' all' : '') + (p.full ? ' full' : ''));
      return { ok: true, b64: utf8ToSjisB64(csv), filename: 'KYCSV06_' + cl5 + '_' + y5 + '.CSV' };
    }
    case 'photos_zip': {
      var cl6 = four(p.client), y6 = yearOf(p); var cd6 = clientDir(cl6, y6); if (!cd6) throw new Error('データがありません');
      var blobs = []; var it = cd6.getFolders();
      while (it.hasNext()) { var ef = it.next(); if (ef.getName().charAt(0) === '_') continue; var pd = subFolder(ef, 'photos', false);
        if (pd) { var fit = pd.getFiles(); while (fit.hasNext()) { var ph = fit.next(); blobs.push(ph.getBlob().setName(ef.getName() + '/' + ph.getName())); } }
        var sub = fileIn(ef, 'submitted.json'); if (sub) blobs.push(sub.getBlob().setName(ef.getName() + '/submitted.json')); }
      if (!blobs.length) throw new Error('写真がありません');
      var zip = Utilities.zip(blobs, 'nencho_' + cl6 + '_' + y6 + '_photos.zip');
      return { ok: true, b64: Utilities.base64Encode(zip.getBytes()), filename: zip.getName() };
    }
    case 'zipdict': { var zn = zipDictUpdate(); return { ok: true, msg: '郵便番号辞書を更新しました（' + zn + ' 件）' }; }
    case 'backup_codes': {
      var plain = [], hashes = [], al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (var i2 = 0; i2 < 8; i2++) { var cd = ''; for (var j = 0; j < 10; j++) cd += al[Math.floor(Math.random() * 32)]; plain.push(cd.substr(0, 5) + '-' + cd.substr(5)); hashes.push(pwHash(cd)); }
      jsonSave(rootFolder(), '_backup_codes.json', hashes); audit('backup codes issued');
      return { ok: true, msg: 'バックアップコードを発行しました（古いコードは無効）。この画面を閉じると二度と表示されません：' + plain.join('　') };
    }
    case 'purge': {
      var py = parseInt(p.year, 10); if (!(py <= c.year - 5)) throw new Error('5年を過ぎた年だけ削除できます');
      var ix2 = indexLoad(), n2 = 0;
      for (var cl7 in ix2) { var yd = pathFolder([cl7, String(py)], false); if (yd) { yd.setTrashed(true); n2++; } ix2[cl7].years = (ix2[cl7].years || []).filter(function (yy) { return yy !== String(py); }); }
      jsonSave(rootFolder(), '_index.json', ix2); audit('purged year ' + py + ' (' + n2 + ' clients)');
      return { ok: true, msg: py + ' 年分をごみ箱に移しました（' + n2 + ' 社）。ドライブのごみ箱を空にすると完全に消えます' };
    }
    case 'company_key': {
      var cl8 = four(p.client); var keys8 = jsonLoad(rootFolder(), '_company_keys.json', {});
      keys8[cl8] = { key: randomHex(16), issued_at: nowIso() }; jsonSave(rootFolder(), '_company_keys.json', keys8); audit('company key issued ' + cl8);
      return { ok: true, msg: '会社用ページのURLを用意しました（' + cl8 + '）。有効期限は90日です' };
    }
    case 'assign_code': {
      var cl9 = four(p.client), old = String(p.old || ''), nw = String(p.new || '').trim();
      var od = empDir(cl9, old, false); if (!od) throw new Error('元のフォルダがありません');
      if (!nw) throw new Error('個人コードを入れてください');
      if (empDir(cl9, nw, false)) throw new Error('その個人コードは既にあります');
      od.setName(safeEmp(nw)); cacheDel('fid:' + od.getParents().next().getId() + '/' + safeEmp(old));
      var r9 = jsonLoad(od, 'answers.json'); if (r9) { r9.emp = nw; jsonSave(od, 'answers.json', r9); }
      summaryUpdate(cl9, old); summaryUpdate(cl9, nw);
      return { ok: true, msg: old + ' → ' + nw + ' に割り当てました。登録コード：' + cl9 + codeDigits(nw) };
    }
    case 'reset_emp': {
      var cl10 = four(p.client), e10 = String(p.emp || ''); var r10 = loadRecord(cl10, e10); var ed10 = empDir(cl10, e10, true);
      var pd10 = photosDir(ed10, false); if (pd10) { var it10 = pd10.getFiles(); while (it10.hasNext()) it10.next().setTrashed(true); }
      fileDelete(ed10, 'submitted.json');
      var n10 = emptyRecord(cl10, e10); n10.prev = r10.prev; n10.line_user_id = r10.line_user_id; n10.device_bound_at = r10.device_bound_at; n10.reset_log = (r10.reset_log || []).concat([nowIso() + ' 事務所']);
      saveRecord(n10); audit('reset by office ' + cl10 + '-' + e10);
      return { ok: true, msg: cl10 + '-' + e10 + ' の今年の入力を消しました' };
    }
    case 'note': {
      var r11 = loadRecord(four(p.client), String(p.emp || ''));
      r11.office_note = String(p.note || '').trim();
      if (p.birth && /^\d{4}-\d{2}-\d{2}$/.test(p.birth)) { r11.answers.birth = p.birth; r11.birth_set_by = 'office'; }
      if (p.checked) r11.office_checked_at = nowIso(); else delete r11.office_checked_at;
      saveRecord(r11); return { ok: true, msg: '保存しました' };
    }
    case 'pin_reissue': { var pr = pinReissue(four(p.client), String(p.emp || '')); audit('pin reissue by office ' + four(p.client) + '-' + p.emp); return { ok: true, msg: '初回番号を発行し直しました：' + pr + '（前のスマホの合鍵は無効になりました）', pin: pr }; }
    case 'audit_tail': {
      var root = rootFolder(); var nm2 = '_audit_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM') + '.log'; var f = fileIn(root, nm2);
      var ls = f ? f.getBlob().getDataAsString('UTF-8').split('\n').filter(function (l) { return l; }) : [];
      return { ok: true, lines: ls.slice(-150).reverse() };
    }
    case 'settings_set': {
      var allowed = { year: 'YEAR', pages_url: 'PAGES_URL', app_name: 'APP_NAME', deadline_text: 'DEADLINE_TEXT', anthropic_api_key: 'ANTHROPIC_API_KEY', anthropic_model: 'ANTHROPIC_MODEL', liff_id: 'LIFF_ID', github_repo: 'GITHUB_REPO' };
      for (var k2 in allowed) if (p[k2] !== undefined && String(p[k2]) !== '') setProp(allowed[k2], String(p[k2]).trim());
      if (p.anthropic_api_key === '__clear__') setProp('ANTHROPIC_API_KEY', '');
      if (p.pages_url !== undefined && String(p.pages_url).trim() === '') setProp('PAGES_URL', '');
      audit('settings changed'); return { ok: true, msg: '設定を保存しました' };
    }
    case 'change_pw': {
      if (String(p.pw || '').length < 10) throw new Error('パスワードは10文字以上にしてください');
      setProp('ADMIN_PW_HASH', pwHash(String(p.pw))); audit('admin password changed'); return { ok: true, msg: 'パスワードを変えました。次回からこのパスワードです' };
    }
    case 'update': { var um = selfUpdate(); audit('self update: ' + um); return { ok: true, msg: um }; }
    case 'logout': sessionDrop('adm', p._t); return { ok: true };
  }
  throw new Error('不明な操作: ' + a);
}
function addDays(iso, n) { var d = new Date(iso); if (isNaN(d)) return ''; d.setDate(d.getDate() + n); return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
/** 初回番号を作り直し、そのスマホの合鍵を無効にする */
function pinReissue(client, emp) {
  var ed = empDir(client, emp, true); var ro = jsonLoad(ed, 'roster.json', {});
  ro.pin = randomDigits(6); ro.pin_used = false; ro.pin_issued_at = nowIso(); jsonSave(ed, 'roster.json', ro);
  deviceUnbindAll(client, emp);
  var r = jsonLoad(ed, 'answers.json'); if (r) { delete r.device_bound_at; jsonSave(ed, 'answers.json', r); }
  summaryUpdate(client, emp);
  return ro.pin;
}
/** 文字コードを推定して UTF-8 に（UTF-8 か Shift-JIS） */
function decodeAuto(b64) {
  var bytes = Utilities.base64Decode(b64); var blob = Utilities.newBlob(bytes);
  var u = blob.getDataAsString('UTF-8'); if (u.indexOf('�') < 0) return u;
  return blob.getDataAsString('Shift_JIS');
}
/** 顧問先一覧の行 → 名前の辞書に足す。行に日本ICSの会社コード 0101xxxx があれば末尾4桁を顧問先コードにする */
function clientsFromRows(rows, names) {
  var n = 0;
  rows.forEach(function (cells0) {
    var cells = cells0.map(function (c) { return String(c).trim(); }).filter(function (c) { return c !== ''; });
    var code = null, texts = [];
    cells.forEach(function (c) {
      var c2 = zenToHanDigits(c); var mm = /^0101(\d{4})$/.exec(c2);
      if (mm) { if (code === null) code = mm[1]; return; }
      if (/^[\d\-\.\s\/:]+$/.test(c2) || /^\d{4}$/.test(c2)) return;
      if (/▼|関数|番号|決算月|屋\s*号|月次|年一/.test(c)) return;
      texts.push(c);
    });
    if (code === null) { var m2 = /^(\d{4})(?:[\.\s]+(.+))?$/.exec(zenToHanDigits(cells[0] || '')); if (m2) { code = m2[1]; if (m2[2]) texts = [m2[2].trim()]; } }
    if (code === null || !texts.length) return;
    names[code] = texts[0] + (texts[1] ? '（' + texts[1] + '）' : ''); n++;
  });
  return n;
}

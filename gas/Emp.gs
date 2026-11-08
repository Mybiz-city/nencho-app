// 従業員画面の裏側。ログインは「登録コード＋初回番号（会社が渡す）」。2回目以降はこのスマホの合鍵で自動

function packRecord(r) {
  var o = JSON.parse(JSON.stringify(r));
  o.computed = compute(r);
  if (o.prev && o.prev.raw) delete o.prev.raw;
  var c = cfg();
  o.config = { app_name: c.app_name, color: c.brand_color, year: c.year, deadline: c.deadline_text, ai: !!c.anthropic_api_key, liff_id: c.liff_id };
  return o;
}
function devicesLoad() { return jsonLoad(rootFolder(), '_devices.json', {}); }
function deviceBind(client, emp) {
  var tok = randomHex(24), h = sha256(tok);
  withLock(function () { var d = jsonLoad(rootFolder(), '_devices.json', {}); d[h] = { client: client, emp: emp, at: nowIso() }; jsonSave(rootFolder(), '_devices.json', d); });
  return tok;
}
function deviceUnbindAll(client, emp) {
  withLock(function () { var d = jsonLoad(rootFolder(), '_devices.json', {}); var n = 0; for (var k in d) if (d[k].client === client && d[k].emp === emp) { delete d[k]; n++; } if (n) jsonSave(rootFolder(), '_devices.json', d); });
}
function lineMapLoad() { return jsonLoad(rootFolder(), '_line_map.json', {}); }

function empApi(a, p) {
  var who = sessionGet('emp', p._t);
  var need = function () { if (!who) throw new Error('ログインが切れました。画面を開き直してください'); return who; };
  switch (a) {
    case 'config': { var c = cfg(); return { ok: true, app_name: c.app_name, color: c.brand_color, year: c.year, deadline: c.deadline_text, liff_id: c.liff_id, logged_in: !!who }; }

    case 'device_login': { // このスマホの合鍵で入る
      var dev = String(p.dev || ''); if (!dev) return { ok: true, known: false };
      var d = devicesLoad()[sha256(dev)]; if (!d) return { ok: true, known: false };
      var ro = jsonLoad(empDir(d.client, d.emp, false), 'roster.json', {});
      if ((ro.status || 'active') === 'retired') return { ok: true, known: false, retired: true };
      var r = loadRecord(d.client, d.emp);
      var t = sessionNew('emp', { client: d.client, emp: d.emp });
      audit('device login ' + d.client + '-' + d.emp);
      return { ok: true, known: true, _t: t, record: packRecord(r) };
    }
    case 'line_login': {
      var uid = String(p.line_user_id || '').trim(); if (!uid) throw new Error('LINEのIDがありません');
      var m = lineMapLoad()[uid]; if (!m) return { ok: true, known: false };
      var r2 = loadRecord(m.client, m.emp); var t2 = sessionNew('emp', { client: m.client, emp: m.emp });
      return { ok: true, known: true, _t: t2, record: packRecord(r2) };
    }
    case 'login': {
      var pc = parseCode(p.code || ''); if (!pc) throw new Error('登録コードは数字で入れてください（例：9999000001）');
      var tk = 'code:' + pc.client + pc.num, tkc = 'client:' + pc.client;
      if (!throttleOk(tk) || !throttleOk(tkc)) { audit('login locked ' + tk); throw new Error('試行回数が多すぎます。15分ほど待ってからやり直してください'); }
      if (!clientDir(pc.client)) { throttleFail(tkc, 30); throw new Error('この登録コードの会社は、まだ登録されていません。事務所にご確認ください'); }
      var emp = resolveEmp(pc.client, pc.num);
      if (!emp) { throttleFail(tk, 5); throttleFail(tkc, 30); throw new Error('この登録コードは見つかりません。数字をもう一度ご確認ください'); }
      var ed = empDir(pc.client, emp, true); var ro2 = jsonLoad(ed, 'roster.json', {});
      if ((ro2.status || 'active') === 'retired') throw new Error('退職された方は、この会社の年末調整の対象外です。源泉徴収票をもとにご自身で確定申告をしてください');
      var pin = zenToHanDigits(p.pin || '').replace(/\D/g, '');
      if (!pin) return { ok: true, need_pin: true };
      if (!ro2.pin) { // 初回番号が未発行（古い取り込み）：この場で発行して会社に出す形にする
        throw new Error('この登録コードには初回番号がまだありません。会社または事務所に「初回番号」を発行してもらってください');
      }
      if (ro2.pin_used) { throttleFail(tk, 5); audit('pin reused ' + tk); throw new Error('この初回番号は使用済みです。別のスマホから入る場合は、会社または事務所に初回番号の再発行を頼んでください'); }
      if (!safeEq(ro2.pin, pin)) { throttleFail(tk, 5); throttleFail(tkc, 30); audit('pin mismatch ' + tk); throw new Error('初回番号が一致しません'); }
      ro2.pin_used = true; ro2.pin_used_at = nowIso(); jsonSave(ed, 'roster.json', ro2);
      throttleClear(tk); audit('login ok ' + pc.client + '-' + emp);
      var r3 = loadRecord(pc.client, emp);
      var dtok = deviceBind(pc.client, emp); r3.device_bound_at = nowIso();
      var uid2 = String(p.line_user_id || '').trim();
      if (uid2) { withLock(function () { var mp = jsonLoad(rootFolder(), '_line_map.json', {}); mp[uid2] = { client: pc.client, emp: emp, at: nowIso() }; jsonSave(rootFolder(), '_line_map.json', mp); }); r3.line_user_id = uid2; }
      if (r3.status === 'new') r3.status = 'in_progress';
      saveRecord(r3);
      var t3 = sessionNew('emp', { client: pc.client, emp: emp });
      return { ok: true, _t: t3, dev: dtok, record: packRecord(r3) };
    }
    case 'logout': sessionDrop('emp', p._t); return { ok: true };
    case 'unbind': { var w0 = need(); deviceUnbindAll(w0.client, w0.emp); var rr = loadRecord(w0.client, w0.emp); delete rr.device_bound_at; saveRecord(rr); sessionDrop('emp', p._t); audit('device unbind by employee ' + w0.client + '-' + w0.emp); return { ok: true }; }
    case 'load': { var w = need(); return { ok: true, record: packRecord(loadRecord(w.client, w.emp)) }; }
    case 'save': {
      var w1 = need(); var r4 = loadRecord(w1.client, w1.emp);
      if (p.answers && typeof p.answers === 'object') for (var k in p.answers) r4.answers[k] = p.answers[k];
      if (Array.isArray(p.family)) r4.family = p.family;
      if (p.consent) r4.consent_at = r4.consent_at || nowIso();
      if (p.step !== undefined) r4.last_step = p.step;
      if (p.change) r4.changes.push({ at: nowIso(), what: p.change });
      if (r4.status === 'submitted') r4.status = 'in_progress';
      r4.updated_at = nowIso();
      saveRecord(r4);
      return { ok: true, record: packRecord(r4) };
    }
    case 'upload': { // {kind, data(base64), mime}
      var w2 = need(); var r5 = loadRecord(w2.client, w2.emp);
      var kind = String(p.kind || 'cert').replace(/[^a-z_]/g, '');
      if (!p.data) throw new Error('写真を受け取れませんでした');
      var mime = ['image/png', 'image/webp'].indexOf(p.mime) >= 0 ? p.mime : 'image/jpeg';
      var ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      var id = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss') + '-' + randomHex(3);
      var name = kind + '_' + id + '.' + ext;
      var bytes = Utilities.base64Decode(p.data);
      if (bytes.length > 6000000) throw new Error('写真が大きすぎます。もう一度撮り直してください');
      var pd = photosDir(empDir(w2.client, w2.emp, true), true);
      var file = pd.createFile(Utilities.newBlob(bytes, mime, name));
      var entry = { id: id, kind: kind, file: name, file_id: file.getId(), at: nowIso(), status: 'uploaded', items: [], ai: null };
      if (kind === 'techo' && cfg().anthropic_api_key) {
        try { var ai = claudeReadCert(p.data, mime, 'techo'); entry.ai = ai; entry.status = 'read';
          var t = ai.techo || {}; var txt = ((t.type || '') + ' ' + (t.grade || '')).trim();
          if (txt && t.type !== 'その他') {
            var strip = function (s) { return String(s || '').replace(/[ 　]/g, ''); };
            var selfName = strip(r5.answers.name || ((r5.prev || {}).sei || '') + ((r5.prev || {}).mei || '')); var holder = strip(t.holder);
            r5.answers.self_flags = r5.answers.self_flags || {};
            if (!holder || holder === selfName) { if (!r5.answers.self_flags.disability_text) r5.answers.self_flags.disability_text = txt; }
            else { (r5.family || []).forEach(function (ff) { if (strip(ff.name) === holder && !ff.disability_text) ff.disability_text = txt; });
              if (r5.answers.spouse && strip(r5.answers.spouse.name) === holder && !r5.answers.spouse.disability_text) r5.answers.spouse.disability_text = txt; }
          }
        } catch (e) { entry.status = 'read_failed'; entry.error = e.message; }
      }
      if (kind === 'cert' && cfg().anthropic_api_key) {
        try { var ai2 = claudeReadCert(p.data, mime, 'cert'); entry.ai = ai2; entry.items = ai2.items; entry.issuer = ai2.issuer || ''; entry.doc_type = ai2.doc_type || ''; entry.status = 'read'; }
        catch (e2) { entry.status = 'read_failed'; entry.error = e2.message; }
      }
      r5.certs.push(entry); saveRecord(r5);
      return { ok: true, cert: entry, record: packRecord(r5) };
    }
    case 'cert_update': {
      var w3 = need(); var r6 = loadRecord(w3.client, w3.emp);
      r6.certs.forEach(function (ct) {
        if (ct.id !== p.id) return;
        if (p.items !== undefined) { var before = JSON.stringify(ct.items); ct.items = p.items; if (before !== JSON.stringify(ct.items)) r6.changes.push({ at: nowIso(), what: '証明書 ' + ct.id + ' を本人が訂正', before: before }); }
        if (p.issuer !== undefined) ct.issuer = p.issuer;
        if (p.status !== undefined) { ct.status = p.status; if (p.status === 'read') ct.confirmed = false; if (p.status === 'confirmed') ct.confirmed = true; }
        if (p.cat !== undefined) ct.cat = String(p.cat).replace(/[^a-z_]/g, '');
        if (p.sub !== undefined) ct.sub = String(p.sub).replace(/[^a-z_]/g, '');
        if (p.confirmed !== undefined) ct.confirmed = !!p.confirmed;
      });
      saveRecord(r6);
      return { ok: true, record: packRecord(r6) };
    }
    case 'photo': { var w4 = need(); return { ok: true, data: photoDataUrl(w4.client, w4.emp, p.f) }; }
    case 'reset': {
      var w5 = need(); var r7 = loadRecord(w5.client, w5.emp); var ed2 = empDir(w5.client, w5.emp, true);
      var pd2 = photosDir(ed2, false); if (pd2) { var it = pd2.getFiles(); while (it.hasNext()) it.next().setTrashed(true); }
      fileDelete(ed2, 'submitted.json');
      var n = emptyRecord(w5.client, w5.emp); n.prev = r7.prev; n.prev_certs = r7.prev_certs || []; n.prev_answers = r7.prev_answers || null; n.line_user_id = r7.line_user_id; n.device_bound_at = r7.device_bound_at; n.status = 'in_progress';
      n.reset_log = (r7.reset_log || []).concat([nowIso()]);
      saveRecord(n);
      return { ok: true, record: packRecord(n) };
    }
    case 'submit': {
      var w6 = need(); var r8 = loadRecord(w6.client, w6.emp);
      r8.status = 'submitted'; r8.submitted_at = nowIso(); r8.computed = compute(r8);
      saveRecord(r8); jsonSave(empDir(w6.client, w6.emp, true), 'submitted.json', r8);
      audit('submit ' + w6.client + '-' + w6.emp);
      return { ok: true, record: packRecord(r8) };
    }
  }
  throw new Error('不明な操作');
}
/** 写真 → data URL（本人・事務所の画面で見るため） */
function photoDataUrl(client, emp, fname, year) {
  var pd = photosDir(empDir(client, emp, false, year), false); if (!pd) throw new Error('見つかりません');
  var f = fileIn(pd, String(fname || '').replace(/[\/\\]/g, '')); if (!f) throw new Error('見つかりません');
  var b = f.getBlob(); return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

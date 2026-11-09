// 入口。?p= なし：従業員　?p=company&c=顧問先&k=合言葉：会社　?p=admin：事務所
// 画面からの呼び出しは api(action, payload) の1本（google.script.run）

function doGet(e) {
  var p = (e && e.parameter) || {};
  var c = cfg();
  var page = p.p === 'admin' ? 'AdminPage' : p.p === 'company' ? 'CompanyPage' : 'EmpPage';
  var t = HtmlService.createTemplateFromFile(page);
  t.cfg = c; t.q = p;
  if (page === 'CompanyPage') { t.ctx = companyContext(p.c, p.k); }
  var out = t.evaluate().setTitle(c.app_name).addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // LINEの中のブラウザでも開けるように
  return out;
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** 画面からの呼び出し口。例外は {ok:false,error} で返す */
function api(action, payload) {
  payload = payload || {};
  try {
    var a = String(action || '');
    if (a.indexOf('admin.') === 0) return adminApi(a.substr(6), payload);
    if (a.indexOf('company.') === 0) return companyApi(a.substr(8), payload);
    return empApi(a, payload);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** 初期設定：エディタから1回だけ実行する。データ用フォルダ・事務所パスワード・2段階認証の秘密を作る */
function 初期設定() {
  var p = PropertiesService.getScriptProperties();
  rootFolder();
  var out = [];
  if (!p.getProperty('YEAR')) { p.setProperty('YEAR', String((new Date()).getFullYear())); }
  if (!p.getProperty('ADMIN_PW_HASH')) {
    var al = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', pw = '';
    for (var i = 0; i < 14; i++) pw += al[Math.floor(Math.random() * al.length)];
    p.setProperty('ADMIN_PW_HASH', pwHash(pw));
    out.push('事務所パスワード（この1回しか表示されません。控えてください）： ' + pw);
  } else out.push('事務所パスワード：設定済み（変えるには パスワード再設定() を実行）');
  if (!p.getProperty('ADMIN_TOTP_SECRET')) {
    var sec = totpNewSecret(); p.setProperty('ADMIN_TOTP_SECRET', sec);
    out.push('2段階認証の秘密の文字列（認証アプリに「手動で入力」で登録。種類は時間ベース）： ' + sec);
  } else out.push('2段階認証：設定済み');
  cfg._c = null;
  out.push('データの保存先： ' + rootFolder().getUrl());
  out.push('従業員画面のURL： ' + ScriptApp.getService().getUrl());
  out.push('事務所画面のURL： ' + ScriptApp.getService().getUrl() + '?p=admin');
  Logger.log(out.join('\n'));
  return out.join('\n');
}
/** 事務所パスワードを作り直す（エディタから実行） */
function パスワード再設定() {
  var al = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', pw = '';
  for (var i = 0; i < 14; i++) pw += al[Math.floor(Math.random() * al.length)];
  setProp('ADMIN_PW_HASH', pwHash(pw));
  Logger.log('新しい事務所パスワード： ' + pw);
  return pw;
}
/** 2段階認証の秘密を作り直す（スマホを失くしたとき。エディタから実行） */
function 二段階認証再設定() {
  var sec = totpNewSecret(); setProp('ADMIN_TOTP_SECRET', sec);
  Logger.log('新しい秘密の文字列（認証アプリに登録し直す）： ' + sec);
  return sec;
}

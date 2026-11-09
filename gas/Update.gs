// GitHub の最新版で自分自身を書き換え、新しい版として配備し直す
// 前提：Google アカウントの設定で Apps Script API を「オン」にしておく（https://script.google.com/home/usersettings）

function ghHeaders() { var h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nencho-app' }; var t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }
function gasApi(method, path, body) {
  var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/' + path, { method: method, contentType: 'application/json', payload: body ? JSON.stringify(body) : null,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  var code = res.getResponseCode(); var j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (code >= 300) {
    var msg = (j.error && j.error.message) || res.getContentText().substr(0, 300);
    if (code === 403 && /has not been used|is disabled|Apps Script API/i.test(msg)) msg = 'Apps Script API がオフか、オンにした直後です。work@metis.tax でログインした状態で https://script.google.com/home/usersettings を確かめ、数分待ってから押し直してください。元の文：' + msg;
    throw new Error('Apps Script API エラー(' + code + '): ' + msg);
  }
  return j;
}
/** 更新本体。GitHub の API は使わず、raw.githubusercontent.com の gas/manifest.json を読む（回数制限にかからない） */
function selfUpdate() {
  var c = cfg(); var repo = c.github_repo, branch = c.github_branch, dir = c.github_dir;
  var base = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + dir + '/';
  var res = UrlFetchApp.fetch(base + 'manifest.json?t=' + Date.now(), { headers: ghHeaders(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('GitHub から一覧を取得できません (' + res.getResponseCode() + ')。しばらくしてから押し直してください');
  var man = JSON.parse(res.getContentText());
  if (man.version && man.version === c.version) return '既に最新です（' + man.version + '：' + (man.note || '') + '）';
  var files = [];
  man.files.forEach(function (name) {
    var type = /\.gs$/.test(name) ? 'SERVER_JS' : /\.html$/.test(name) ? 'HTML' : name === 'appsscript.json' ? 'JSON' : null;
    if (!type) return;
    var r = UrlFetchApp.fetch(base + name + '?t=' + Date.now(), { headers: ghHeaders(), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('取得に失敗: ' + name + ' (' + r.getResponseCode() + ')');
    files.push({ name: name.replace(/\.(gs|html|json)$/, ''), type: type, source: r.getContentText() });
  });
  if (!files.some(function (f) { return f.name === 'Code'; })) throw new Error('GitHub 側に Code.gs がありません。取得先の設定（' + repo + '/' + dir + '）を確かめてください');
  var id = ScriptApp.getScriptId();
  gasApi('put', 'projects/' + id + '/content', { files: files });
  var ver = gasApi('post', 'projects/' + id + '/versions', { description: man.version + ' ' + (man.note || '') });
  var deps = gasApi('get', 'projects/' + id + '/deployments').deployments || [];
  var target = null;
  deps.forEach(function (d) { if (d.deploymentConfig && d.deploymentConfig.versionNumber && (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; })) target = d; });
  var msg = 'コードを更新しました（' + man.version + '：' + (man.note || '') + '）。';
  if (target) { gasApi('put', 'projects/' + id + '/deployments/' + target.deploymentId, { deploymentConfig: { scriptId: id, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: man.version + ' ' + (man.note || '') } }); msg += '配備も新しい版に切り替えました。画面を開き直すと反映されます'; }
  else msg += 'ただし配備が見つからなかったので、エディタの「デプロイ」→「デプロイを管理」→ 鉛筆 → 「新バージョン」で切り替えてください';
  setProp('VERSION', man.version);
  return msg;
}

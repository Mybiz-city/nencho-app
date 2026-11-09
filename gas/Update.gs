// GitHub の最新版で自分自身を書き換え、新しい版として配備し直す
// 前提：Google アカウントの設定で Apps Script API を「オン」にしておく（https://script.google.com/home/usersettings）

function ghHeaders() { var h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nencho-app' }; var t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'); if (t) h['Authorization'] = 'Bearer ' + t; return h; }
function ghJson(url) {
  var res = UrlFetchApp.fetch(url, { headers: ghHeaders(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('GitHub から取得できません (' + res.getResponseCode() + '): ' + url);
  return JSON.parse(res.getContentText());
}
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
/** 更新本体。戻り：結果の文章 */
function selfUpdate() {
  var c = cfg(); var repo = c.github_repo, branch = c.github_branch, dir = c.github_dir;
  var commit = ghJson('https://api.github.com/repos/' + repo + '/commits?sha=' + encodeURIComponent(branch) + '&path=' + encodeURIComponent(dir) + '&per_page=1')[0];
  var sha = commit ? commit.sha.substr(0, 7) : '';
  var date = commit ? Utilities.formatDate(new Date(commit.commit.committer.date), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '';
  var note = commit ? String(commit.commit.message).split('\n')[0] : '';
  if (sha && sha === c.version) return '既に最新です（' + sha + ' ' + date + '：' + note + '）';
  var list = ghJson('https://api.github.com/repos/' + repo + '/contents/' + dir + '?ref=' + encodeURIComponent(branch));
  var files = [];
  list.forEach(function (f) {
    if (f.type !== 'file') return;
    var type = /\.gs$/.test(f.name) ? 'SERVER_JS' : /\.html$/.test(f.name) ? 'HTML' : f.name === 'appsscript.json' ? 'JSON' : null;
    if (!type) return;
    var res = UrlFetchApp.fetch(f.download_url, { headers: ghHeaders(), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('取得に失敗: ' + f.name);
    files.push({ name: f.name.replace(/\.(gs|html|json)$/, ''), type: type, source: res.getContentText() });
  });
  if (!files.some(function (f) { return f.name === 'Code'; })) throw new Error('GitHub 側に Code.gs がありません。取得先の設定（' + repo + '/' + dir + '）を確かめてください');
  var id = ScriptApp.getScriptId();
  gasApi('put', 'projects/' + id + '/content', { files: files });
  var ver = gasApi('post', 'projects/' + id + '/versions', { description: sha + ' ' + note });
  var deps = gasApi('get', 'projects/' + id + '/deployments').deployments || [];
  var target = null;
  deps.forEach(function (d) { if (d.deploymentConfig && d.deploymentConfig.versionNumber && (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; })) target = d; });
  var msg = 'コードを更新しました（' + sha + ' ' + date + '：' + note + '）。';
  if (target) { gasApi('put', 'projects/' + id + '/deployments/' + target.deploymentId, { deploymentConfig: { scriptId: id, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: sha + ' ' + note } }); msg += '配備も新しい版に切り替えました。画面を開き直すと反映されます'; }
  else msg += 'ただし配備が見つからなかったので、エディタの「デプロイ」→「デプロイを管理」→ 鉛筆 → 「新バージョン」で切り替えてください';
  setProp('VERSION', sha);
  return msg;
}

const { makeContext } = require('./gasmock'); const vm = require('vm'); const cp = require('child_process'); const fs=require('fs');
const calls = [];
const ctx = makeContext({ props: { GITHUB_REPO: 'Mybiz-city/nencho-app' }, fetch: (u, o) => {
  if (/raw\.githubusercontent\.com/.test(u)) { // ローカルのファイルで代用（push前のテスト）
    const name = u.replace(/\?.*$/, '').split('/gas/')[1]; const p = '/home/claude/nencho-app/gas/' + name; if (!fs.existsSync(p)) return { getResponseCode: () => 404, getContentText: () => '' }; return { getResponseCode: () => 200, getContentText: () => fs.readFileSync(p, 'utf8') }; }
  if (/script\.googleapis\.com/.test(u)) { calls.push([o.method, u]);
    if (/deployments$/.test(u)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ deployments: [{ deploymentId: 'DEP1', deploymentConfig: { versionNumber: 3 }, entryPoints: [{ entryPointType: 'WEB_APP' }] }] }) };
    if (/versions$/.test(u)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ versionNumber: 4 }) };
    return { getResponseCode: () => 200, getContentText: () => '{}' }; }
  throw new Error('no ' + u); } });
console.log(vm.runInContext('selfUpdate()', ctx)); console.log(calls.length, 'api calls; VERSION', ctx.__props.VERSION);
console.log(vm.runInContext('selfUpdate()', ctx));

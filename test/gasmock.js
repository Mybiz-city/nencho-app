// Apps Script の実行環境をNodeで真似る（テスト用）。ドライブはメモリ上（必要なら JSON でダンプ）
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const iconv = require('iconv-lite'); const AdmZip = require('adm-zip');

function makeContext(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props || {});
  const cache = new Map();
  let idSeq = 1; const nid = () => 'id' + (idSeq++);
  // ---- Drive（メモリ）----
  const nodes = new Map(); // id -> {id,name,type:'folder'|'file',parent,children:Set,bytes,mime,trashed}
  function mkFolder(name, parent) { const n = { id: nid(), name, type: 'folder', parent, children: new Set(), trashed: false }; nodes.set(n.id, n); if (parent) nodes.get(parent).children.add(n.id); return n; }
  const rootNode = mkFolder('MyDrive', null);
  class Blob { constructor(bytes, mime, name) { this.bytes = Buffer.from(bytes || []); this.mime = mime || 'application/octet-stream'; this.name = name || 'blob'; }
    getBytes() { return [...this.bytes]; } getDataAsString(cs) { return cs && /shift/i.test(cs) ? iconv.decode(this.bytes, 'Shift_JIS') : this.bytes.toString('utf8'); }
    setDataFromString(s, cs) { this.bytes = cs && /shift/i.test(cs) ? iconv.encode(s, 'Shift_JIS') : Buffer.from(s, 'utf8'); return this; }
    getContentType() { return this.mime; } setContentType(m) { this.mime = m; return this; } getName() { return this.name; } setName(n) { this.name = n; return this; } }
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  const ops = { read: 0, write: 0 }; const R_ = (f) => (...a) => { ops.read++; return f(...a); }, W_ = (f) => (...a) => { ops.write++; return f(...a); };
  function wrap(n) {
    if (!n) return null;
    const common = { getId: () => n.id, getName: () => n.name, setName: (x) => { n.name = x; return wrap(n); }, isTrashed: () => n.trashed, setTrashed: (t) => { n.trashed = t; if (t && n.parent) nodes.get(n.parent).children.delete(n.id); return wrap(n); },
      getParents: () => iter(n.parent ? [wrap(nodes.get(n.parent))] : []), getUrl: () => 'https://drive.google.com/drive/folders/' + n.id };
    if (n.type === 'folder') return Object.assign(common, {
      getFoldersByName: R_((name) => iter([...n.children].map(id => nodes.get(id)).filter(c => c.type === 'folder' && c.name === name && !c.trashed).map(wrap))),
      getFilesByName: R_((name) => iter([...n.children].map(id => nodes.get(id)).filter(c => c.type === 'file' && c.name === name && !c.trashed).map(wrap))),
      getFolders: R_(() => iter([...n.children].map(id => nodes.get(id)).filter(c => c.type === 'folder' && !c.trashed).map(wrap))),
      getFiles: R_(() => iter([...n.children].map(id => nodes.get(id)).filter(c => c.type === 'file' && !c.trashed).map(wrap))),
      createFolder: W_((name) => wrap(mkFolder(name, n.id))),
      createFile: W_((a, b, c) => { let blob = a instanceof Blob ? a : new Blob(Buffer.from(String(b), 'utf8'), c || 'text/plain', a); const f = { id: nid(), name: blob.name, type: 'file', parent: n.id, bytes: blob.bytes, mime: blob.mime, trashed: false }; nodes.set(f.id, f); n.children.add(f.id); return wrap(f); }),
    });
    return Object.assign(common, { getBlob: () => { ops.read++; return new Blob(n.bytes, n.mime, n.name); }, setContent: (s) => { ops.write++; n.bytes = Buffer.from(String(s), 'utf8'); return wrap(n); } });
  }
  const DriveApp = { getRootFolder: () => wrap(rootNode), getFolderById: (id) => { ops.read++; const n = nodes.get(id); if (!n || n.type !== 'folder' || n.trashed) throw new Error('not found ' + id); return wrap(n); }, getFileById: (id) => { ops.read++; const n = nodes.get(id); if (!n || n.type !== 'file') throw new Error('not found'); return wrap(n); }, createFolder: (name) => wrap(mkFolder(name, rootNode.id)) };
  // ---- その他のサービス ----
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k], setProperty: (k, v) => { props[k] = String(v); }, getProperties: () => Object.assign({}, props) }) };
  const CacheService = { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) };
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const Utilities = {
    base64Encode: (x) => Buffer.from(typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255))).toString('base64'),
    base64Decode: (s) => [...Buffer.from(s, 'base64')],
    newBlob: (data, mime, name) => new Blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from((data || []).map(b => b & 255)), mime, name),
    formatDate: (d, tz, f) => { const z = new Date(d.getTime() + 9 * 3600000); const p = (n, l) => String(n).padStart(l || 2, '0'); const map = { yyyy: z.getUTCFullYear(), MM: p(z.getUTCMonth() + 1), dd: p(z.getUTCDate()), HH: p(z.getUTCHours()), mm: p(z.getUTCMinutes()), ss: p(z.getUTCSeconds()), XXX: '+09:00' }; return f.replace(/'T'/g, 'T').replace(/yyyy|MM|dd|HH|mm|ss|XXX/g, m => map[m]); },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
    computeHmacSignature: (alg, msg, key) => [...crypto.createHmac('sha1', Buffer.from(key)).update(Buffer.from(msg)).digest()].map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, MacAlgorithm: { HMAC_SHA_1: 'sha1' },
    sleep: () => {},
    zip: (blobs, name) => { const z = new AdmZip(); blobs.forEach(b => z.addFile(b.name, b.bytes)); return new Blob(z.toBuffer(), 'application/zip', name); },
    unzip: (blob) => { const z = new AdmZip(blob.bytes); return z.getEntries().filter(e => !e.isDirectory).map(e => new Blob(e.getData(), 'application/octet-stream', e.entryName)); },
  };
  const UrlFetchApp = { fetch: (url, o) => { if (opts.fetch) return opts.fetch(url, o); throw new Error('ネットは使えません(テスト): ' + url); } };
  const ScriptApp = { getService: () => ({ getUrl: () => opts.baseUrl || 'http://127.0.0.1:8090/exec' }), getScriptId: () => 'TESTSCRIPT', getOAuthToken: () => 'tok' };
  const Logger = { log: (s) => console.log('[Logger]', s) };
  const htmlFiles = {};
  function compileTemplate(src) {
    let code = 'var __o="";'; let last = 0; const re = /<\?(!?=)?([\s\S]*?)\?>/g; let m;
    while ((m = re.exec(src))) { code += '__o+=' + JSON.stringify(src.slice(last, m.index)) + ';'; if (m[1] === '=') code += '__o+=__esc(' + m[2] + ');'; else if (m[1] === '!=') code += '__o+=String(' + m[2] + ');'; else code += m[2] + '\n'; last = re.lastIndex; }
    code += '__o+=' + JSON.stringify(src.slice(last)) + '; return __o;';
    return code;
  }
  const HtmlService = { XFrameOptionsMode: { ALLOWALL: 1 },
    createTemplateFromFile: (name) => { const t = { evaluate() { const code = compileTemplate(htmlFiles[name]); const keys = Object.keys(t).filter(k => k !== 'evaluate'); const fn = vm.runInContext('(function(__esc,' + keys.join(',') + '){' + code + '})', ctx); const html = fn((s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), ...keys.map(k => t[k])); return { _html: html, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }, getContent() { return html; } }; } }; return t; },
    createHtmlOutputFromFile: (name) => ({ getContent: () => htmlFiles[name] }) };
  const XmlService = null;
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }) };
  const ctx = vm.createContext({ ContentService, DriveApp, PropertiesService, CacheService, LockService, Utilities, UrlFetchApp, ScriptApp, Logger, HtmlService, XmlService, console, Date, Math, JSON, Buffer });
  const dir = path.join(__dirname, '..', 'gas');
  for (const f of fs.readdirSync(dir)) { if (f.endsWith('.gs')) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); if (f.endsWith('.html')) htmlFiles[f.replace(/\.html$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8'); }
  ctx.__ops = ops; ctx.__props = props; ctx.__nodes = nodes; ctx.__cache = cache;
  return ctx;
}
module.exports = { makeContext };

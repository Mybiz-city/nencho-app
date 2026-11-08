// Excel（.xlsx）を読む最小限の仕組み。値だけを行ごとに返す

/** base64 の .xlsx → {シート名: [[cell,...],...]} */
function xlsxRows(b64) {
  var files = Utilities.unzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/zip', 'x.xlsx'));
  var byName = {}; files.forEach(function (b) { byName[b.getName()] = b; });
  var shared = [];
  if (byName['xl/sharedStrings.xml']) {
    var ss = XmlService.parse(byName['xl/sharedStrings.xml'].getDataAsString('UTF-8')); var ns = ss.getRootElement().getNamespace();
    ss.getRootElement().getChildren('si', ns).forEach(function (si) { var t = ''; collectText(si, t, function (s) { t += s; }); shared.push(t); });
  }
  var wb = XmlService.parse(byName['xl/workbook.xml'].getDataAsString('UTF-8')); var wns = wb.getRootElement().getNamespace();
  var rels = XmlService.parse(byName['xl/_rels/workbook.xml.rels'].getDataAsString('UTF-8')); var relMap = {};
  rels.getRootElement().getChildren().forEach(function (r) { relMap[r.getAttribute('Id').getValue()] = r.getAttribute('Target').getValue(); });
  var rns = XmlService.getNamespace('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  var out = {};
  wb.getRootElement().getChild('sheets', wns).getChildren('sheet', wns).forEach(function (sh) {
    var rid = sh.getAttribute('id', rns).getValue(); var target = relMap[rid] || '';
    target = target.charAt(0) === '/' ? target.substr(1) : 'xl/' + target;
    if (!byName[target]) return;
    var sx = XmlService.parse(byName[target].getDataAsString('UTF-8')); var sns = sx.getRootElement().getNamespace();
    var rows = [];
    var sd = sx.getRootElement().getChild('sheetData', sns); if (!sd) return;
    sd.getChildren('row', sns).forEach(function (row) {
      var cells = [];
      row.getChildren('c', sns).forEach(function (c) {
        var type = c.getAttribute('t') ? c.getAttribute('t').getValue() : ''; var vEl = c.getChild('v', sns); var v = vEl ? vEl.getText() : '';
        if (type === 's') v = shared[parseInt(v, 10)] || '';
        else if (type === 'inlineStr') { var is = c.getChild('is', sns); v = is ? is.getChild('t', sns).getText() : ''; }
        cells.push(v);
      });
      rows.push(cells);
    });
    out[sh.getAttribute('name').getValue()] = rows;
  });
  return out;
}
function collectText(el, acc, add) {
  el.getChildren().forEach(function (ch) { if (ch.getName() === 't') add(ch.getText()); else collectText(ch, acc, add); });
}

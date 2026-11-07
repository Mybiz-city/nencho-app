<?php
// Excel（.xlsx）を読む最小限の仕組み（ライブラリ不要）。値だけを行ごとに返す
declare(strict_types=1);

/** .xlsx → [シート名 => [[cell, cell, ...], ...]] */
function xlsx_rows(string $path): array {
    if (!class_exists('ZipArchive')) throw new RuntimeException('このサーバーではExcelを読めません（zip拡張なし）。CSVで上げてください');
    $z = new ZipArchive();
    if ($z->open($path) !== true) throw new RuntimeException('Excelファイルを開けません');
    $shared = [];
    if (($ss = $z->getFromName('xl/sharedStrings.xml')) !== false) {
        $x = simplexml_load_string($ss);
        foreach ($x->si as $si) { $t = ''; foreach ($si->xpath('.//*[local-name()="t"]') as $tn) $t .= (string)$tn; $shared[] = $t; }
    }
    $wb = simplexml_load_string((string)$z->getFromName('xl/workbook.xml'));
    $rels = simplexml_load_string((string)$z->getFromName('xl/_rels/workbook.xml.rels'));
    $relMap = [];
    foreach ($rels->Relationship as $r) $relMap[(string)$r['Id']] = (string)$r['Target'];
    $out = [];
    foreach ($wb->sheets->sheet as $sh) {
        $rid = (string)$sh->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
        $target = $relMap[$rid] ?? '';
        $target = str_starts_with($target, '/') ? substr($target, 1) : 'xl/' . $target;
        $xml = $z->getFromName($target);
        if ($xml === false) continue;
        $sx = simplexml_load_string($xml);
        $rows = [];
        foreach ($sx->sheetData->row as $row) {
            $cells = [];
            foreach ($row->c as $c) {
                $type = (string)$c['t']; $v = isset($c->v) ? (string)$c->v : '';
                if ($type === 's') $v = $shared[(int)$v] ?? '';
                elseif ($type === 'inlineStr') $v = (string)$c->is->t;
                $cells[] = $v;
            }
            $rows[] = $cells;
        }
        $out[(string)$sh['name']] = $rows;
    }
    $z->close();
    return $out;
}

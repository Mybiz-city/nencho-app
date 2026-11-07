<?php
// 郵便番号 → 市区町村コード（全国地方公共団体コード6桁）
// 日本郵便の KEN_ALL.CSV（公開データ）を取り込み、data_dir/_zip2city.json に圧縮して持つ
declare(strict_types=1);
require_once __DIR__ . '/common.php';

const KEN_ALL_URL = 'https://www.post.japanpost.jp/zipcode/dl/kogaki/zip/ken_all.zip';

/** 5桁コード → 検査数字を付けた6桁 */
function city_code6(string $c5): string {
    $c5 = str_pad(preg_replace('/\D/', '', $c5), 5, '0', STR_PAD_LEFT);
    $w = [6, 5, 4, 3, 2]; $sum = 0;
    for ($i = 0; $i < 5; $i++) $sum += (int)$c5[$i] * $w[$i];
    $chk = 11 - ($sum % 11);
    if ($chk >= 10) $chk -= 10;
    return $c5 . $chk;
}

/** 日本郵便から取り込んで辞書を作る。戻り: 件数 */
function zip_dict_update(): int {
    $ch = curl_init(KEN_ALL_URL);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 120, CURLOPT_USERAGENT => 'nencho-app']);
    $zip = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($zip === false || $code !== 200) throw new RuntimeException("日本郵便から取得できません (HTTP $code)");
    $tmp = tempnam(sys_get_temp_dir(), 'kenall'); file_put_contents($tmp, $zip);
    $za = new ZipArchive(); if ($za->open($tmp) !== true) throw new RuntimeException('ZIPを開けません');
    $csv = null;
    for ($i = 0; $i < $za->numFiles; $i++) { $n = $za->getNameIndex($i); if (preg_match('/\.csv$/i', $n)) { $csv = $za->getFromIndex($i); break; } }
    $za->close(); unlink($tmp);
    if ($csv === null) throw new RuntimeException('CSVが見つかりません');
    $csv = mb_convert_encoding($csv, 'UTF-8', 'SJIS-win');
    $map = [];
    foreach (preg_split('/\r\n|\n|\r/', $csv) as $line) {
        if ($line === '') continue;
        $c = str_getcsv($line);
        if (count($c) < 9) continue;
        $z = preg_replace('/\D/', '', $c[2]); $code5 = $c[0];
        if (strlen($z) !== 7) continue;
        if (!isset($map[$z])) $map[$z] = city_code6($code5) . '|' . $c[6] . $c[7]; // コード|都道府県市区町村
    }
    json_save(data_dir() . '/_zip2city.json', ['updated_at' => date('c'), 'map' => $map]);
    return count($map);
}

/** 郵便番号 → [6桁コード, 市区町村名] または null */
function zip_to_city(string $zip): ?array {
    static $d = null;
    if ($d === null) $d = json_load(data_dir() . '/_zip2city.json', ['map' => []]);
    $z = preg_replace('/\D/', '', mb_convert_kana($zip, 'n'));
    if (strlen($z) !== 7 || empty($d['map'][$z])) return null;
    [$code, $name] = explode('|', $d['map'][$z], 2);
    return [$code, $name];
}

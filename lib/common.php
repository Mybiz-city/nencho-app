<?php
// 共通：設定・保存・小道具
declare(strict_types=1);
mb_internal_encoding('UTF-8');

function cfg(): array {
    static $c = null;
    if ($c === null) {
        $f = dirname(__DIR__) . '/config.php';
        if (!file_exists($f)) $f = dirname(__DIR__) . '/config.sample.php';
        $c = require $f;
    }
    return $c;
}

function data_dir(): string {
    $d = cfg()['data_dir'];
    if (!is_dir($d)) mkdir($d, 0700, true);
    // 万一 www の中に置かれても、ブラウザから見えないようにする
    if (!file_exists("$d/.htaccess")) file_put_contents("$d/.htaccess", "Require all denied\nDeny from all\n");
    return $d;
}

/** 登録コード（数字だけ。顧問先4桁＋個人コードの数字部分）を分解する。記号は無視する */
function parse_code(string $code): ?array {
    $d = preg_replace('/\D/', '', mb_convert_kana($code, 'n'));
    if (strlen($d) < 5) return null;
    return ['client' => substr($d, 0, 4), 'num' => substr($d, 4)];
}

/** 個人コード（**000001 など）→ 登録コードの数字部分（000001） */
function code_digits(string $emp): string { return preg_replace('/\D/', '', $emp); }

/** 顧問先の中から、数字部分が一致する個人コードを探す */
function resolve_emp(string $client, string $num): ?string {
    $cdir = data_dir() . "/$client/" . cfg()['year'];
    if (!is_dir($cdir)) return null;
    foreach (glob("$cdir/*", GLOB_ONLYDIR) ?: [] as $d) {
        $r = json_load("$d/answers.json") ?: json_load("$d/prev.json");
        $emp = $r['emp'] ?? ($r['code'] ?? basename($d));
        if ((int)code_digits($emp) === (int)$num && code_digits($emp) !== '') return $emp;
    }
    return null;
}

/** 表示用の登録コード（0302-000001） */
function display_code(string $client, string $emp): string { return $client . '-' . code_digits($emp); }

function emp_dir(string $client, string $emp, bool $create = true): string {
    $y = cfg()['year'];
    $safe = preg_replace('/[^\w\*\-]/u', '_', $emp);
    $d = data_dir() . "/$client/$y/$safe";
    if ($create && !is_dir($d)) mkdir($d . '/photos', 0700, true);
    return $d;
}

function json_load(string $path, $default = null) {
    if (!file_exists($path)) return $default;
    $v = json_decode((string)file_get_contents($path), true);
    return $v === null ? $default : $v;
}

function json_save(string $path, $data): void {
    $tmp = $path . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    rename($tmp, $path);
}

function json_out($data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $status = 400): never { json_out(['ok' => false, 'error' => $msg], $status); }

/** 従業員の記録（answers.json）の雛形 */
function empty_record(string $client, string $emp): array {
    return [
        'client' => $client, 'emp' => $emp, 'year' => cfg()['year'],
        'status' => 'new',          // new / in_progress / submitted
        'consent_at' => null, 'submitted_at' => null,
        'line_user_id' => null,
        'prev' => null,              // 前年CSVから読んだ内容（ics.php の形）
        'answers' => [],             // 画面の答え（キー=質問ID）
        'family' => [],              // 家族の配列
        'certs' => [],               // 証明書の読み取り結果
        'changes' => [],             // 本人が訂正した項目のログ
        'computed' => [],            // 判定結果
    ];
}

function load_record(string $client, string $emp): array {
    $p = emp_dir($client, $emp) . '/answers.json';
    $r = json_load($p);
    if (!$r) {
        $r = empty_record($client, $emp);
        $prev = json_load(emp_dir($client, $emp) . '/prev.json');
        if ($prev) $r['prev'] = $prev;
    }
    // 前年にこのアプリで提出した証明書（保険会社名つき）があれば引き継ぐ
    if (!isset($r['prev_answers'])) {
        $y = cfg()['year'] - 1; $safe = preg_replace('/[^\w\*\-]/u', '_', $emp);
        $last = json_load(data_dir() . "/$client/$y/$safe/answers.json");
        $r['prev_certs'] = [];
        $r['prev_answers'] = $last ? ['salary' => $last['answers']['salary'] ?? null, 'submitted_at' => $last['submitted_at'] ?? null] : null;
        foreach ($last['certs'] ?? [] as $ct) if (($ct['kind'] ?? '') === 'cert' && ($ct['status'] ?? '') !== 'deleted') $r['prev_certs'][] = ['cat' => $ct['cat'] ?? '', 'issuer' => $ct['issuer'] ?? '', 'items' => $ct['items'] ?? []];
    }
    return $r;
}

function save_record(array $r): void {
    json_save(emp_dir($r['client'], $r['emp']) . '/answers.json', $r);
}

/** 和暦文字列（昭60/03/29, 令08/01/01, 平29.12.7 など）→ Y-m-d */
function wareki_to_iso(?string $s): ?string {
    if (!$s) return null;
    $s = mb_convert_kana(trim($s), 'as');
    if (preg_match('/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/', $s, $m))
        return sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]);
    $era = ['明' => 1867, 'M' => 1867, '大' => 1911, 'T' => 1911, '昭' => 1925, 'S' => 1925, '平' => 1988, 'H' => 1988, '令' => 2018, 'R' => 2018];
    if (preg_match('/^([明大昭平令MTSHR])(\d{1,2})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})日?$/u', $s, $m) && isset($era[$m[1]]))
        return sprintf('%04d-%02d-%02d', $era[$m[1]] + (int)$m[2], $m[3], $m[4]);
    return null;
}

/** Y-m-d → ICS形式（令08/01/01） */
function iso_to_wareki(?string $iso): string {
    if (!$iso || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m)) return '';
    [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
    $ymd = $y * 10000 + $mo * 100 + $d;
    if ($ymd >= 20190501) [$g, $b] = ['令', 2018];
    elseif ($ymd >= 19890108) [$g, $b] = ['平', 1988];
    elseif ($ymd >= 19261225) [$g, $b] = ['昭', 1925];
    elseif ($ymd >= 19120730) [$g, $b] = ['大', 1911];
    else [$g, $b] = ['明', 1867];
    return sprintf('%s%02d/%02d/%02d', $g, $y - $b, $mo, $d);
}

/** 半角カナへ */
function to_hankaku_kana(string $s): string { return mb_convert_kana($s, 'kh'); }

function yen(?string $v): int {
    if ($v === null) return 0;
    $v = mb_convert_kana((string)$v, 'n');
    return (int)preg_replace('/[^\d\-]/', '', $v);
}

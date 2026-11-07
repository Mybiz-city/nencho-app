<?php
// 共通：設定・保存・小道具
declare(strict_types=1);
mb_internal_encoding('UTF-8');
ini_set('display_errors', '0'); // エラーの中身を画面に出さない（ログにだけ残す）
error_reporting(E_ALL);

/** セッション開始（Cookieを守る設定つき） */
function secure_session(string $name = 'nenchosid', int $lifetime = 28800): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name($name);
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    ini_set('session.gc_maxlifetime', (string)$lifetime);
    session_start();
    if (!empty($_SESSION['_last']) && time() - $_SESSION['_last'] > $lifetime) { session_unset(); session_destroy(); session_start(); }
    $_SESSION['_last'] = time();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
}
function csrf_field(): string { return '<input type="hidden" name="_t" value="' . htmlspecialchars($_SESSION['csrf'] ?? '') . '">'; }
function csrf_check(): void { if ($_SERVER['REQUEST_METHOD'] === 'POST' && !hash_equals((string)($_SESSION['csrf'] ?? ''), (string)($_POST['_t'] ?? ''))) { http_response_code(400); exit('画面を開き直してから、もう一度操作してください（確認用の印が一致しません）'); } }

/** 試行回数の制限。key ごとに window 秒間に max 回まで失敗できる。超えると false */
function throttle_ok(string $key, int $max = 5, int $window = 900): bool {
    $f = data_dir() . '/_throttle.json'; $d = json_load($f, []); $now = time();
    foreach ($d as $k => $v) if (max($v['until'], $v['first']) < $now - 86400) unset($d[$k]);
    $e = $d[$key] ?? ['n' => 0, 'until' => 0, 'first' => $now];
    if ($e['until'] > $now) return false;
    if ($now - $e['first'] > $window) $e = ['n' => 0, 'until' => 0, 'first' => $now];
    $d[$key] = $e; json_save($f, $d);
    return true;
}
function throttle_fail(string $key, int $max = 5, int $window = 900, int $lock = 900): void {
    $f = data_dir() . '/_throttle.json'; $d = json_load($f, []); $now = time();
    $e = $d[$key] ?? ['n' => 0, 'until' => 0, 'first' => $now];
    if ($now - $e['first'] > $window) $e = ['n' => 0, 'until' => 0, 'first' => $now];
    $e['n']++;
    if ($e['n'] >= $max) { $e['until'] = $now + $lock; $e['n'] = 0; $e['first'] = $now; }
    $d[$key] = $e; json_save($f, $d);
}
function throttle_clear(string $key): void { $f = data_dir() . '/_throttle.json'; $d = json_load($f, []); unset($d[$key]); json_save($f, $d); }
/** ワンタイムパスワード（RFC6238, 30秒, 6桁）。secret は base32 */
function base32_decode_str(string $s): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $s = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s)); $bits = ''; $out = '';
    foreach (str_split($s) as $ch) $bits .= str_pad(decbin(strpos($alphabet, $ch)), 5, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 8) as $b) if (strlen($b) === 8) $out .= chr(bindec($b));
    return $out;
}
function totp_code(string $secret, int $time): string {
    $key = base32_decode_str($secret); $counter = pack('N*', 0) . pack('N*', intdiv($time, 30));
    $h = hash_hmac('sha1', $counter, $key, true); $o = ord($h[19]) & 0xF;
    $v = ((ord($h[$o]) & 0x7F) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($v % 1000000), 6, '0', STR_PAD_LEFT);
}
function totp_verify(string $secret, string $code): bool {
    $code = preg_replace('/\D/', '', $code); if (strlen($code) !== 6) return false;
    foreach ([-1, 0, 1] as $w) if (hash_equals(totp_code($secret, time() + $w * 30), $code)) return true;
    return false;
}
function client_ip(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'); }
function audit(string $what): void { file_put_contents(data_dir() . '/_audit.log', date('c') . "\t" . client_ip() . "\t$what\n", FILE_APPEND | LOCK_EX); }

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

/** 顧問先の個人コードの形（**000001 / 000001）に合わせて、次の番号を作る */
function next_emp_code(string $client): string {
    $cdir = data_dir() . "/$client/" . cfg()['year']; $max = 0; $prefix = ''; $width = 6;
    foreach (glob("$cdir/*", GLOB_ONLYDIR) ?: [] as $d) {
        $r = json_load("$d/answers.json") ?: json_load("$d/prev.json"); $emp = $r['emp'] ?? ($r['code'] ?? basename($d));
        if (!preg_match('/^(\D*)(\d+)$/', $emp, $m)) continue;
        if ((int)$m[2] > $max) { $max = (int)$m[2]; $prefix = $m[1]; $width = strlen($m[2]); }
    }
    return $prefix . str_pad((string)($max + 1), $width, '0', STR_PAD_LEFT);
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

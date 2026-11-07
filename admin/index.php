<?php
// 事務所画面：前年CSV取込、提出状況、内容確認、CSV書き出し
declare(strict_types=1);
require_once __DIR__ . '/../lib/common.php';
require_once __DIR__ . '/../lib/judge.php';
require_once __DIR__ . '/../lib/ics.php';
require_once __DIR__ . '/../lib/xlsx.php';
require_once __DIR__ . '/../lib/zipcode.php';
secure_session('nencho_adm', 7200);
$cfg = cfg();
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);

// ログイン
if (($_POST['act'] ?? '') === 'login') {
    $tk = 'admin:' . client_ip();
    if (!throttle_ok($tk, 5)) { audit('admin locked'); exit('<meta charset="UTF-8"><p style="font-family:sans-serif;padding:30px">試行回数が多すぎます。15分後にやり直してください。</p>'); }
    $pwOk = hash_equals((string)$cfg['admin_password'], (string)($_POST['pw'] ?? ''));
    $otpIn = (string)($_POST['otp'] ?? '');
    $otpOk = empty($cfg['admin_totp_secret']) || totp_verify((string)$cfg['admin_totp_secret'], $otpIn);
    if (!$otpOk && $pwOk) { // バックアップコード（1回限り）
        $bf = data_dir() . '/_backup_codes.json'; $codes = json_load($bf, []); $norm = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $otpIn));
        foreach ($codes as $k => $hsh) if (strlen($norm) >= 8 && password_verify($norm, $hsh)) { unset($codes[$k]); json_save($bf, array_values($codes)); $otpOk = true; audit('admin login with backup code (' . count($codes) . ' left)'); break; }
    }
    if ($pwOk && $otpOk) { $_SESSION['admin'] = true; session_regenerate_id(true); throttle_clear($tk); audit('admin login ok'); }
    else { throttle_fail($tk, 5); audit('admin login ng'); usleep(500000); }
    header('Location: ./'); exit;
}
if (($_GET['act'] ?? '') === 'logout') { unset($_SESSION['admin']); header('Location: ./'); exit; }
if (empty($_SESSION['admin'])) {
    echo '<!DOCTYPE html><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>事務所ログイン</title><body style="font-family:sans-serif;max-width:360px;margin:60px auto;padding:0 16px"><h2>事務所画面</h2><form method="post"><input type="hidden" name="act" value="login">' . csrf_field() . '<input type="password" name="pw" placeholder="パスワード" style="width:100%;font-size:18px;padding:10px">' . (!empty($cfg['admin_totp_secret']) ? '<input type="tel" name="otp" placeholder="認証アプリの6桁" inputmode="numeric" style="width:100%;font-size:18px;padding:10px;margin-top:8px">' : '') . '<button style="width:100%;font-size:18px;padding:10px;margin-top:10px;background:#00A88E;color:#fff;border:0;border-radius:8px">ログイン</button></form>';
    exit;
}

csrf_check();
$year = $cfg['year'];
$viewYear = preg_match('/^\d{4}$/', (string)($_GET['y'] ?? '')) ? (int)$_GET['y'] : $year;
$readonly = $viewYear !== $year;
$msg = '';
// 取込（複数ファイル可。顧問先コードはファイル名 KYCSV06 0101xxxx .CSV の末尾4桁から取る）
if (($_POST['act'] ?? '') === 'import' && !empty($_FILES['csv']['tmp_name'])) {
    $names = json_load(data_dir() . '/_clients.json', []);
    $files = is_array($_FILES['csv']['tmp_name']) ? $_FILES['csv'] : ['tmp_name' => [$_FILES['csv']['tmp_name']], 'name' => [$_FILES['csv']['name']], 'error' => [$_FILES['csv']['error']]];
    $lines = [];
    foreach ($files['tmp_name'] as $i => $tmp) {
        if (!$tmp || ($files['error'][$i] ?? 1) !== UPLOAD_ERR_OK) continue;
        $fname = (string)$files['name'][$i];
        $client = preg_replace('/\D/', '', (string)($_POST['client'] ?? ''));
        if (strlen($client) !== 4 && preg_match('/KYCSV\d{2}(\d{8})/i', $fname, $mm)) $client = substr($mm[1], -4);
        if (strlen($client) !== 4) { $lines[] = "$fname：顧問先コードが分かりません（ファイル名が KYCSV06xxxxxxxx.CSV の形でなければ、欄に4桁を入れてください）"; continue; }
        try { $codes = ics_import($client, $tmp); $lines[] = "$fname → 顧問先 $client " . ($names[$client] ?? '（名前未登録）') . "：" . count($codes) . " 人"; }
        catch (Throwable $e) { $lines[] = "$fname：取込に失敗 " . $e->getMessage(); }
    }
    $msg = implode(' ／ ', $lines) ?: 'ファイルがありません';
}
// 顧問先一覧の取り込み（Excel・CSV・貼り付け）。
// 行の中に日本ICSの会社コード 0101xxxx があれば末尾4桁を顧問先コードにし、数字でない文字を名前にする（2つ目はかっこで添える）
function clients_from_rows(array $rows, array &$names): int {
    $n = 0;
    foreach ($rows as $cells) {
        $cells = array_values(array_filter(array_map(fn($c) => trim((string)$c), $cells), fn($c) => $c !== ''));
        $code = null; $texts = [];
        foreach ($cells as $c) {
            $c2 = mb_convert_kana($c, 'n');
            if (preg_match('/^0101(\d{4})$/', $c2, $mm)) { $code = $code ?? $mm[1]; continue; }
            if (preg_match('/^[\d\-\.\s\/:]+$/', $c2) || preg_match('/^\d{4}$/', $c2)) continue;
            if (preg_match('/▼|関数|番号|決算月|屋\s*号|月次|年一/u', $c)) continue;
            $texts[] = $c;
        }
        if ($code === null) { // ICS会社コードがない行は「4桁 名前」の形だけ受け付ける
            $c2 = mb_convert_kana($cells[0] ?? '', 'n'); // 先頭が4桁のときだけ（貼り付け用）
            if (preg_match('/^(\d{4})(?:[\.\s]+(.+))?$/u', $c2, $mm)) { $code = $mm[1]; if (!empty($mm[2])) $texts = [trim($mm[2])]; }
        }
        if ($code === null || !$texts) continue;
        $names[$code] = $texts[0] . (isset($texts[1]) ? '（' . $texts[1] . '）' : '');
        $n++;
    }
    return $n;
}
if (($_POST['act'] ?? '') === 'clients') {
    $names = json_load(data_dir() . '/_clients.json', []); $n = 0;
    try {
        if (!empty($_FILES['list']['tmp_name'])) {
            $fname = (string)$_FILES['list']['name'];
            if (preg_match('/\.xlsx$/i', $fname)) { foreach (xlsx_rows($_FILES['list']['tmp_name']) as $rows) $n += clients_from_rows($rows, $names); }
            else { $raw = (string)file_get_contents($_FILES['list']['tmp_name']); $enc = mb_detect_encoding($raw, ['UTF-8', 'SJIS-win', 'EUC-JP'], true) ?: 'SJIS-win'; $text = mb_convert_encoding($raw, 'UTF-8', $enc);
                   $n += clients_from_rows(array_map(fn($l) => str_getcsv(str_replace("\t", ',', $l)), preg_split('/\r\n|\n|\r/', $text)), $names); }
        }
        if (trim((string)($_POST['paste'] ?? '')) !== '') $n += clients_from_rows(array_map(fn($l) => str_getcsv(str_replace("\t", ',', $l)), preg_split('/\r\n|\n|\r/', (string)$_POST['paste'])), $names);
        json_save(data_dir() . '/_clients.json', $names);
        $msg = "顧問先一覧を $n 件読み込みました（登録合計 " . count($names) . " 件）";
    } catch (Throwable $e) { $msg = '一覧の読み込みに失敗: ' . $e->getMessage(); }
}
// 顧問先名の登録
if (($_POST['act'] ?? '') === 'client_name') {
    $names = json_load(data_dir() . '/_clients.json', []);
    $names[preg_replace('/\D/', '', (string)$_POST['client'])] = trim((string)$_POST['name']);
    json_save(data_dir() . '/_clients.json', $names);
}
// 従業員の追加（前年データなし）
if (($_POST['act'] ?? '') === 'add_emp') {
    $client = preg_replace('/\D/', '', (string)$_POST['client']); $emp = trim((string)$_POST['emp']);
    if (strlen($client) === 4 && $emp !== '') { emp_dir($client, $emp); $msg = "登録コード $client-$emp を作りました"; }
}
// CSV書き出し
if (($_GET['act'] ?? '') === 'export') {
    $client = preg_replace('/\D/', '', (string)$_GET['client']);
    $ey = preg_match('/^\d{4}$/', (string)($_GET['y'] ?? '')) ? (int)$_GET['y'] : $year;
    $csv = ics_export($client, ($_GET['all'] ?? '') !== '1', $ey, ($_GET['full'] ?? '') !== '1');
    header('Content-Type: text/csv; charset=Shift_JIS');
    header("Content-Disposition: attachment; filename=\"KYCSV06_{$client}_{$ey}.CSV\"");
    echo $csv; exit;
}
// 写真
if (($_GET['act'] ?? '') === 'photo') {
    $p = emp_dir(preg_replace('/\D/', '', (string)$_GET['client']), (string)$_GET['emp'], false) . '/photos/' . basename((string)$_GET['f']);
    if (file_exists($p)) { header('Content-Type: ' . mime_content_type($p)); readfile($p); } exit;
}
// 郵便番号辞書の更新
if (($_POST['act'] ?? '') === 'zipdict') {
    try { $n = zip_dict_update(); $msg = "郵便番号辞書を更新しました（$n 件）"; } catch (Throwable $e) { $msg = '辞書の更新に失敗: ' . $e->getMessage(); }
}
// 写真をまとめてZIP
if (($_GET['act'] ?? '') === 'photos_zip') {
    $client = preg_replace('/\D/', '', (string)$_GET['client']); $y = preg_replace('/\D/', '', (string)($_GET['y'] ?? $year));
    $za = new ZipArchive(); $tmp = tempnam(sys_get_temp_dir(), 'ph'); $za->open($tmp, ZipArchive::OVERWRITE);
    foreach (glob(data_dir() . "/$client/$y/*/photos/*") ?: [] as $f) { $emp = basename(dirname(dirname($f))); $za->addFile($f, "$emp/" . basename($f)); }
    foreach (glob(data_dir() . "/$client/$y/*/submitted.json") ?: [] as $f) $za->addFile($f, basename(dirname($f)) . '/submitted.json');
    $za->close();
    header('Content-Type: application/zip'); header("Content-Disposition: attachment; filename=\"nencho_{$client}_{$y}_photos.zip\""); readfile($tmp); unlink($tmp); exit;
}
// 過年度の封印：パスワード付きZIP（AES-256）を作って、サーバーから消す
if (($_POST['act'] ?? '') === 'seal') {
    $sy = preg_replace('/\D/', '', (string)$_POST['seal_year']); $pw = (string)($_POST['seal_pw'] ?? '');
    if ((int)$sy >= $year - 1) $msg = '今年と前年は封印できません（前年は引き継ぎに使います）';
    elseif (strlen($pw) < 12) $msg = 'パスワードは12文字以上にしてください';
    elseif (!defined('ZipArchive::EM_AES_256')) $msg = 'このサーバーは暗号化ZIPに対応していません';
    else {
        $adir = data_dir() . '/_archive'; if (!is_dir($adir)) mkdir($adir, 0700, true);
        $zf = "$adir/nencho_{$sy}_" . date('Ymd') . '.zip'; $za = new ZipArchive(); $za->open($zf, ZipArchive::CREATE | ZipArchive::OVERWRITE); $za->setPassword($pw);
        $n = 0;
        foreach (glob(data_dir() . "/*/$sy", GLOB_ONLYDIR) ?: [] as $yd) {
            $client = basename(dirname($yd));
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($yd, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $f) { $rel = "$client/$sy/" . substr($f->getPathname(), strlen($yd) + 1); $za->addFile($f->getPathname(), $rel); $za->setEncryptionName($rel, ZipArchive::EM_AES_256); $n++; }
        }
        $za->close();
        if ($n === 0) { @unlink($zf); $msg = "$sy 年のデータがありません"; }
        else {
            foreach (glob(data_dir() . "/*/$sy", GLOB_ONLYDIR) ?: [] as $yd) { $rit = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($yd, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($rit as $f) $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname()); rmdir($yd); }
            audit("sealed year $sy ($n files)");
            $msg = "$sy 年分を封印しました（$n ファイル）。下の「封印済み」からダウンロードして手元に保管し、サーバーからも消してください";
        }
    }
}
if (($_GET['act'] ?? '') === 'archive_dl') { $f = data_dir() . '/_archive/' . basename((string)$_GET['f']); if (file_exists($f)) { header('Content-Type: application/zip'); header('Content-Disposition: attachment; filename="' . basename($f) . '"'); readfile($f); } exit; }
if (($_POST['act'] ?? '') === 'archive_rm') { $f = data_dir() . '/_archive/' . basename((string)$_POST['f']); if (file_exists($f)) { unlink($f); audit('archive removed ' . basename($f)); $msg = '封印ファイルをサーバーから消しました'; } }
// バックアップコードの発行（8個。1回ずつ使える。表示は1度だけ）
if (($_POST['act'] ?? '') === 'backup_codes') {
    $plain = []; $hashes = []; $al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($i = 0; $i < 8; $i++) { $c = ''; for ($j = 0; $j < 10; $j++) $c .= $al[random_int(0, 31)]; $plain[] = substr($c, 0, 5) . '-' . substr($c, 5); $hashes[] = password_hash($c, PASSWORD_DEFAULT); }
    json_save(data_dir() . '/_backup_codes.json', $hashes); audit('backup codes issued');
    $msg = 'バックアップコードを発行しました（古いコードは無効）。この画面を閉じると二度と表示されません：' . implode('　', $plain);
}
// 5年を過ぎた年の削除
if (($_POST['act'] ?? '') === 'purge') {
    $py = preg_replace('/\D/', '', (string)$_POST['purge_year']);
    if ((int)$py > $year - 5) $msg = '5年を過ぎた年だけ削除できます';
    else { $n = 0; foreach (glob(data_dir() . "/*/$py", GLOB_ONLYDIR) ?: [] as $yd) { $rit = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($yd, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($rit as $f) { $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname()); $n++; } rmdir($yd); } audit("purged year $py ($n)"); $msg = "$py 年分を削除しました"; }
}
// 会社用ページの合言葉を発行
if (($_POST['act'] ?? '') === 'company_key') {
    $client = preg_replace('/\D/', '', (string)$_POST['client']);
    $keys = json_load(data_dir() . '/_company_keys.json', []);
    if (strlen($client) === 4) { $keys[$client] = ['key' => bin2hex(random_bytes(16)), 'issued_at' => date('c')]; json_save(data_dir() . '/_company_keys.json', $keys); audit("company key issued $client"); $msg = "会社用ページのURLを用意しました（$client）。有効期限は90日です"; }
}
// 会社が追加した人（Nコード）に日本ICSの個人コードを割り当てる
if (($_POST['act'] ?? '') === 'assign_code') {
    $client = preg_replace('/\D/', '', (string)$_POST['client']); $old = (string)$_POST['old']; $new = trim((string)$_POST['new']);
    $od = emp_dir($client, $old, false); $nd = emp_dir($client, $new, false);
    if (!is_dir($od)) $msg = '元のフォルダがありません';
    elseif (is_dir($nd)) $msg = 'その個人コードは既にあります';
    elseif ($new === '') $msg = '個人コードを入れてください';
    else { rename($od, $nd); $r = json_load("$nd/answers.json"); if ($r) { $r['emp'] = $new; json_save("$nd/answers.json", $r); } $msg = "$old → $new に割り当てました。登録コード：$client" . code_digits($new); }
}
// 状態の手動変更・メモ
if (($_POST['act'] ?? '') === 'reset_emp') {
    $client = preg_replace('/\D/', '', (string)$_POST['client']); $emp = (string)$_POST['emp'];
    $r = load_record($client, $emp); $dir = emp_dir($client, $emp);
    foreach (glob("$dir/photos/*") ?: [] as $f) @unlink($f);
    @unlink("$dir/submitted.json");
    $n = empty_record($client, $emp); $n['prev'] = $r['prev']; $n['line_user_id'] = $r['line_user_id']; $n['reset_log'] = array_merge($r['reset_log'] ?? [], [date('c') . ' 事務所']);
    save_record($n); $msg = "$client-$emp の今年の入力を消しました";
}
if (($_POST['act'] ?? '') === 'note') {
    $r = load_record(preg_replace('/\D/', '', (string)$_POST['client']), (string)$_POST['emp']);
    $r['office_note'] = trim((string)$_POST['note']);
    if (!empty($_POST['checked'])) $r['office_checked_at'] = date('c'); else unset($r['office_checked_at']);
    save_record($r); $msg = '保存しました';
}

$clientNames = json_load(data_dir() . '/_clients.json', []);
$view = $_GET['v'] ?? 'home';
?>
<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>事務所画面 - <?= $h($cfg['app_name']) ?></title>
<style>
body{font-family:"BIZ UDPGothic","Hiragino Sans",sans-serif;margin:0;background:#f4f6f5;color:#222;font-size:15px}
header{background:#007A67;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center}header a{color:#fff}
.wrap{max-width:1000px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{margin:0 0 10px;font-size:17px;color:#007A67}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid #eee;padding:7px 6px;text-align:left;vertical-align:top}th{background:#E3F4F0;font-weight:700}
.st{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;background:#eee}.st.submitted{background:#00A88E;color:#fff}.st.in_progress{background:#FFF2CC}
input[type=text],input[type=file],textarea{font-size:15px;padding:7px;border:1px solid #ccc;border-radius:6px}
button,.btn{font-size:14px;padding:8px 14px;background:#00A88E;color:#fff;border:0;border-radius:8px;cursor:pointer;text-decoration:none;display:inline-block}.btn.g{background:#888}
.msg{background:#FFF8E1;border-left:4px solid #F2B705;padding:8px 12px;margin-bottom:12px;font-size:14px}
.ph{max-width:260px;border:1px solid #ddd;border-radius:6px;margin:4px}
.chg td{background:#FFF8E1}
small{color:#666}
</style></head><body>
<header><b><?= $h($cfg['app_name']) ?>　事務所画面（<?= $year ?>年分）</b><span><small><?= file_exists(__DIR__ . '/../version.txt') ? '版: ' . $h(trim((string)file_get_contents(__DIR__ . '/../version.txt'))) : '' ?></small>　<a href="./">一覧</a>　<?php if (!empty($cfg['deploy_key']) && !empty($cfg['github_repo'])): ?><a href="../deploy.php?key=<?= rawurlencode($cfg['deploy_key']) ?>" target="_blank" onclick="return confirm('GitHubの最新版に更新します。よろしいですか？')">アプリを更新</a>　<?php endif; ?><a href="?act=logout">ログアウト</a></span></header>
<div class="wrap">
<?php if ($msg): ?><div class="msg"><?= $h($msg) ?></div><?php endif; ?>
<?php
// 顧問先ごとの集計
function client_rows(string $client, string $cdir): array {
    $rows = []; $cnt = ['submitted' => 0, 'in_progress' => 0, 'new' => 0, 'retired' => 0];
    foreach (glob("$cdir/*", GLOB_ONLYDIR) ?: [] as $ed) {
        $emp = basename($ed); $r = json_load("$ed/answers.json"); $prev = json_load("$ed/prev.json"); $ro = json_load("$ed/roster.json", []);
        $code = $r['emp'] ?? ($prev['code'] ?? $emp);
        $st = $r['status'] ?? 'new';
        if (($ro['status'] ?? 'active') === 'retired') $cnt['retired']++; else $cnt[$st] = ($cnt[$st] ?? 0) + 1;
        $name = $r['answers']['name'] ?? ($prev ? $prev['sei'] . ' ' . $prev['mei'] : ($ro['name'] ?? ''));
        $rows[] = [$code, $name, $st, $r['submitted_at'] ?? ($r['updated_at'] ?? ''), count(array_filter($r['certs'] ?? [], fn($c) => ($c['status'] ?? '') !== 'deleted')), !empty($r['office_checked_at']), $ro, !empty($r['answers']['has_other_income']) && $r['answers']['has_other_income'] === 'unknown', ($r['answers']['other_employer_decl'] ?? '') === 'other'];
    }
    usort($rows, fn($a, $b) => strcmp($a[0], $b[0]));
    return [$rows, $cnt];
}
$ckeys = json_load(data_dir() . '/_company_keys.json', []);
$base = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . preg_replace('#/admin/.*$#', '', $_SERVER['REQUEST_URI']);
$years = array_values(array_unique(array_filter(array_map(fn($d) => basename($d), glob(data_dir() . '/*/*', GLOB_ONLYDIR) ?: []), fn($b) => preg_match('/^\d{4}$/', $b)))); rsort($years);
?>
<?php if ($view === 'home'): ?>
<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
<div><b>対象年：<?= $viewYear ?>年分</b><?= $readonly ? '　<span class="st">閲覧のみ</span>' : '' ?>　<small>切り替え：<?php foreach ($years as $yy): ?><a href="?y=<?= $yy ?>" style="<?= $yy == $viewYear ? 'font-weight:700' : '' ?>"><?= $yy ?></a> <?php endforeach; ?></small></div>
<details><summary style="cursor:pointer;color:#007A67">設定・取り込み（顧問先一覧、前年CSV、郵便番号辞書、追加）</summary>
<div style="margin-top:10px">
<h2>1. 顧問先一覧の取り込み</h2>
<form method="post" enctype="multipart/form-data"><?= csrf_field() ?><input type="hidden" name="act" value="clients">
顧問先一覧のExcel（0.顧問先.xlsx）かCSV<input type="file" name="list" accept=".xlsx,.csv,.CSV,.txt">　または貼り付け<br>
<textarea name="paste" rows="2" style="width:100%;margin-top:6px" placeholder="0302 津守産業株式会社"></textarea>
<button style="margin-top:6px">一覧を読み込む</button>　<small>登録済み：<?= count($clientNames) ?> 件</small></form>
<h2 style="margin-top:14px">2. 前年CSVの取り込み（複数ファイル可）</h2>
<form method="post" enctype="multipart/form-data" id="impform"><?= csrf_field() ?><input type="hidden" name="act" value="import">
<div id="drop" style="border:2px dashed #00A88E;border-radius:10px;padding:22px;text-align:center;background:#E3F4F0;color:#007A67;font-weight:700;cursor:pointer">ここに日本ICSのCSVをドラッグ＆ドロップ（複数可）<br><small style="font-weight:400">またはクリックして選ぶ。落とすと、すぐ取り込みが始まります</small></div>
<input type="file" name="csv[]" accept=".csv,.CSV" multiple required style="display:none" id="csvin">　<button style="margin-top:6px">選んだファイルを取り込む</button>　<small>顧問先コードはファイル名（KYCSV06 0101<u>0307</u>.CSV）から。違う場合だけ4桁：<input type="text" name="client" size="6"></small></form>
<small>日本ICS：業務選択 → 表形式 → 給与マスター表形式処理 → ファイル作成（タイプ6）</small>
<h2 style="margin-top:14px">郵便番号 → 市区町村コード</h2>
<?php $zd = json_load(data_dir() . '/_zip2city.json'); ?>
<form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="act" value="zipdict"><button class="g">日本郵便から辞書を取り込む（年1回）</button></form>　<small><?= $zd ? '取込済み：' . $h(date('Y-m-d', strtotime($zd['updated_at']))) . '（' . count($zd['map']) . '件）' : '未取込' ?></small>
<h2 style="margin-top:14px">事務所画面の2段階認証</h2>
<?php if (!empty($cfg['admin_totp_secret'])): ?><p><small>有効です（ログイン時に認証アプリの6桁が必要）。</small></p>
<p><small>スマホを失くしたときの備え：バックアップコード（1回ずつ使える10文字のコード8個）。認証アプリの6桁の代わりに入れます。残り <?= count(json_load(data_dir() . '/_backup_codes.json', [])) ?> 個。</small>
<form method="post" style="display:inline" onsubmit="return confirm('新しいコードを8個発行し、古いコードは無効になります。印刷して金庫などに保管してください。')"><?= csrf_field() ?><input type="hidden" name="act" value="backup_codes"><button class="g" style="font-size:12px;padding:4px 8px">バックアップコードを発行</button></form></p>
<p><small>もう1つの備え：同じ秘密の文字列を2台の認証アプリ（代表と職員のスマホ）に登録しておくと、どちらの6桁でも通ります。</small></p>
<?php else: ?>
<?php $sug = ''; $al = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; for ($i = 0; $i < 20; $i++) $sug .= $al[random_int(0, 31)]; ?>
<p><small>未設定。有効にするには、config.php の <code>'admin_totp_secret' => ''</code> に次の文字列を入れ、スマホの認証アプリ（Google Authenticator など）で「手動で入力」→ この文字列を登録します。<br>秘密の文字列（この画面を開くたびに違うものが出ます。使うものを1つ控える）：<b><?= $sug ?></b><br>認証アプリ側の名前は「メーティス年調」、種類は「時間ベース」。</small></p><?php endif; ?>
<h2 style="margin-top:14px">保管と削除</h2>
<p><small>データはこのサーバーに <b>5年間</b> 保管し、それより古い年は削除する運用です。今年：<?= $year ?>年分。削除できる年：<?= implode('、', array_filter($years, fn($yy) => (int)$yy <= $year - 5)) ?: 'なし' ?></small></p>
<form method="post" onsubmit="return confirm('この年のデータをサーバーから完全に消します。元に戻せません。よろしいですか？')"><?= csrf_field() ?><input type="hidden" name="act" value="purge">年<select name="purge_year"><?php foreach ($years as $yy) if ((int)$yy <= $year - 5) echo "<option>$yy</option>"; ?></select>　<button class="g" style="background:#C8372D">5年を過ぎた年を削除する</button></form>
<details style="margin-top:8px"><summary style="cursor:pointer"><small>別の選択：封印して手元に移す（暗号化ZIP）</small></summary>
<form method="post" onsubmit="return confirm('この年のデータをパスワード付きZIPにまとめ、サーバーの元データを消します。よろしいですか？')"><?= csrf_field() ?><input type="hidden" name="act" value="seal">
年<select name="seal_year"><?php foreach ($years as $yy) if ((int)$yy < $year - 1) echo "<option>$yy</option>"; ?></select>　パスワード（12文字以上）<input type="text" name="seal_pw" size="24">　<button class="g" style="background:#C8372D">封印する</button>
<br><small>暗号化ZIP（AES-256）にしてから元データを消します。パスワードは事務所で別に保管してください（忘れると開けません）。</small></form>
<?php $arcs = glob(data_dir() . '/_archive/*.zip') ?: []; if ($arcs): ?><p><small>封印済み：</small><?php foreach ($arcs as $af): ?><br><a href="?act=archive_dl&f=<?= rawurlencode(basename($af)) ?>"><?= $h(basename($af)) ?></a>（<?= round(filesize($af) / 1048576, 1) ?> MB）<form method="post" style="display:inline" onsubmit="return confirm('ダウンロード済みですか？サーバーから消します')"><?= csrf_field() ?><input type="hidden" name="act" value="archive_rm"><input type="hidden" name="f" value="<?= $h(basename($af)) ?>"><button class="g" style="font-size:11px;padding:2px 6px">サーバーから消す</button></form><?php endforeach; ?></p><?php endif; ?></details>
<h2 style="margin-top:14px">3. 前年データのない人を追加</h2>
<form method="post"><?= csrf_field() ?><input type="hidden" name="act" value="add_emp">顧問先コード<input type="text" name="client" size="6">　個人コード（日本ICSと同じ）<input type="text" name="emp" size="10" placeholder="**000021">　<button>作る</button></form>
</div></details>
</div>
<script>
(function(){ const d=document.getElementById('drop'), inp=document.getElementById('csvin'), f=document.getElementById('impform'); if(!d) return;
  d.onclick=()=>inp.click(); inp.onchange=()=>{ if(inp.files.length) f.submit(); };
  ['dragenter','dragover'].forEach(e=>d.addEventListener(e,ev=>{ev.preventDefault(); d.style.background='#c9ece4';}));
  ['dragleave','drop'].forEach(e=>d.addEventListener(e,ev=>{ev.preventDefault(); d.style.background='#E3F4F0';}));
  d.addEventListener('drop',ev=>{ const files=[...ev.dataTransfer.files].filter(x=>/\.csv$/i.test(x.name)); if(!files.length){ alert('CSVファイルを落としてください'); return; } const dt=new DataTransfer(); files.forEach(x=>dt.items.add(x)); inp.files=dt.files; d.textContent=files.length+' 件を取り込んでいます…'; f.submit(); });
  // ページ全体に落としても受ける
  document.addEventListener('dragover',ev=>ev.preventDefault()); document.addEventListener('drop',ev=>{ if(ev.target.closest('#drop')) return; ev.preventDefault(); const files=[...ev.dataTransfer.files].filter(x=>/\.csv$/i.test(x.name)); if(files.length){ const dt=new DataTransfer(); files.forEach(x=>dt.items.add(x)); inp.files=dt.files; document.querySelector('details').open=true; f.submit(); } });
})();
</script>
<div class="card"><h2>顧問先の一覧（<?= $viewYear ?>年分）</h2>
<?php
$clients = array_filter(glob(data_dir() . '/*', GLOB_ONLYDIR) ?: [], fn($d) => preg_match('/\/\d{4}$/', $d) && is_dir("$d/$viewYear"));
if (!$clients) echo '<p>この年のデータがありません。「設定・取り込み」から前年CSVを取り込んでください。</p>';
else {
    $tot = ['n' => 0, 'submitted' => 0, 'in_progress' => 0, 'new' => 0];
    echo '<table><tr><th>コード</th><th>顧問先</th><th>人数</th><th>提出済み</th><th>入力中</th><th>未着手</th><th>退職</th><th>会社用ページ</th><th></th></tr>';
    foreach ($clients as $cd) {
        $client = basename($cd); [$rows, $cnt] = client_rows($client, "$cd/$viewYear"); $n = count($rows) - $cnt['retired'];
        $tot['n'] += $n; foreach (['submitted', 'in_progress', 'new'] as $k) $tot[$k] += $cnt[$k];
        $done = $n > 0 && $cnt['submitted'] === $n;
        echo '<tr' . ($done ? ' style="background:#E3F4F0"' : '') . '><td>' . $h($client) . '</td><td><a href="?v=client&client=' . $client . '&y=' . $viewYear . '"><b>' . $h($clientNames[$client] ?? '（名前未登録）') . '</b></a></td><td>' . $n . '</td><td>' . ($cnt['submitted'] ?: '') . '</td><td>' . ($cnt['in_progress'] ?: '') . '</td><td>' . ($cnt['new'] ?: '') . '</td><td>' . ($cnt['retired'] ?: '') . '</td><td>' . (!empty($ckeys[$client]['key']) ? '発行済み' : '—') . '</td><td><a class="btn" style="font-size:12px;padding:4px 8px" href="?v=client&client=' . $client . '&y=' . $viewYear . '">開く</a></td></tr>';
    }
    echo '<tr style="font-weight:700"><td></td><td>合計</td><td>' . $tot['n'] . '</td><td>' . $tot['submitted'] . '</td><td>' . $tot['in_progress'] . '</td><td>' . $tot['new'] . '</td><td></td><td></td><td></td></tr></table>';
    echo '<small>緑の行＝全員提出済み。顧問先名を押すと従業員の一覧に進みます。</small>';
}
?>
</div>

<?php elseif ($view === 'client'):
    $client = preg_replace('/\D/', '', (string)$_GET['client']); $cdir = data_dir() . "/$client/$viewYear"; [$rows, $cnt] = client_rows($client, $cdir);
?>
<p><a href="?y=<?= $viewYear ?>">← 顧問先の一覧</a></p>
<div class="card"><h2><?= $h($client) ?> <?= $h($clientNames[$client] ?? '') ?>　<small><?= $viewYear ?>年分　提出 <?= $cnt['submitted'] ?> ／ 入力中 <?= $cnt['in_progress'] ?> ／ 未着手 <?= $cnt['new'] ?> ／ 退職 <?= $cnt['retired'] ?></small></h2>
<p><a class="btn" href="?act=export&client=<?= $client ?>&y=<?= $viewYear ?>">提出済みをCSVで出す</a> <a class="btn g" href="?act=export&client=<?= $client ?>&all=1&y=<?= $viewYear ?>">全員分を出す</a> <a class="btn g" href="?act=photos_zip&client=<?= $client ?>&y=<?= $viewYear ?>">写真をまとめて保存</a>　<small>CSVは年調項目の列だけを出します（給与実績・口座は含めない）。540列すべてが要る場合：<a href="?act=export&client=<?= $client ?>&y=<?= $viewYear ?>&full=1">全列で出す</a></small></p>
<p><small>日本ICSの取込では「該当社員が存在しない場合は取り込みを行わない」の☑を外すと、新しい個人コードの人が新規社員として登録されます。</small></p>
<?php if (!$readonly): ?>
<p><?php if (!empty($ckeys[$client]['key'])): ?><small>会社用ページ（<?= $h(date('m/d', strtotime($ckeys[$client]['issued_at']) + 90 * 86400)) ?>まで有効）：<input type="text" readonly value="<?= $h("$base/company/?c=$client&k=" . $ckeys[$client]['key']) ?>" size="70" onclick="this.select()"></small> <form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="act" value="company_key"><input type="hidden" name="client" value="<?= $client ?>"><button class="g" style="font-size:11px;padding:3px 6px" onclick="return confirm('URLを作り直します。古いURLは使えなくなります')">作り直す</button></form><?php else: ?><form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="act" value="company_key"><input type="hidden" name="client" value="<?= $client ?>"><button class="g" style="font-size:12px;padding:4px 8px">会社用ページのURLを作る</button></form><?php endif; ?></p>
<?php endif; ?>
<table><tr><th>登録コード<br><small>（下はICSの個人コード）</small></th><th>氏名</th><th>在籍</th><th>状態</th><th>最終更新</th><th>写真</th><th>注意</th><th>事務所確認</th><th></th></tr>
<?php foreach ($rows as $w): ?>
<tr><td><?php if (str_starts_with($w[0], 'N')): ?><form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="act" value="assign_code"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="old" value="<?= $h($w[0]) ?>"><small>会社が追加</small><br><input type="text" name="new" size="9" value="<?= $h(next_emp_code($client)) ?>"><button style="font-size:12px;padding:3px 6px">この番号で割当</button></form><?php else: ?><b><?= $h($client . code_digits($w[0])) ?></b><br><small><?= $h($w[0]) ?></small><?php endif; ?></td><td><?= $h($w[1]) ?></td><td><?= ($w[6]['status'] ?? 'active') === 'retired' ? '<span class="st" style="background:#fdecea;color:#C8372D">退職 ' . $h($w[6]['retire'] ?? '') . '</span>' : '在籍' ?><?= !empty($w[6]['hire']) ? '<br><small>入社 ' . $h($w[6]['hire']) . '</small>' : '' ?></td><td><span class="st <?= $w[2] ?>"><?= ['submitted' => '提出済み', 'in_progress' => '入力中', 'new' => '未着手'][$w[2]] ?? $w[2] ?></span></td><td><?= $w[3] ? $h(date('m/d H:i', strtotime($w[3]))) : '' ?></td><td><?= $w[4] ?>枚</td><td><?= $w[7] ? '<small style="color:#C8372D">確定申告へ</small>' : '' ?><?= $w[8] ? '<small style="color:#C8372D">乙欄・年調しない</small>' : '' ?></td><td><?= $w[5] ? '✓' : '' ?></td><td><a href="?v=emp&client=<?= $client ?>&emp=<?= rawurlencode($w[0]) ?>&y=<?= $viewYear ?>">開く</a></td></tr>
<?php endforeach; ?></table>
</div>

<?php elseif ($view === 'emp'):
    $client = preg_replace('/\D/', '', (string)$_GET['client']); $emp = (string)$_GET['emp'];
    $r = load_record($client, $emp); $c = compute($r); $a = $r['answers']; $p = $r['prev'] ?? [];
    $row = ics_row_from_record($r); $meta = json_load(data_dir() . "/$client/$year/_ics_meta.json"); $hdr = $meta['header'] ?? [];
?>
<div class="card"><h2><?= $h("$client-$emp") ?>　<?= $h($a['name'] ?? (($p['sei'] ?? '') . ' ' . ($p['mei'] ?? ''))) ?>　<span class="st <?= $r['status'] ?>"><?= $r['status'] ?></span></h2>
<p><small>同意 <?= $h($r['consent_at'] ?? '—') ?>　提出 <?= $h($r['submitted_at'] ?? '—') ?>　LINE連携 <?= $r['line_user_id'] ? 'あり' : 'なし' ?></small></p>
<form method="post"><?= csrf_field() ?><input type="hidden" name="act" value="note"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="emp" value="<?= $h($emp) ?>">
<label><input type="checkbox" name="checked" <?= !empty($r['office_checked_at']) ? 'checked' : '' ?>> 事務所で確認した</label>　<input type="text" name="note" value="<?= $h($r['office_note'] ?? '') ?>" placeholder="メモ" size="40">　<button>保存</button></form>
<form method="post" style="margin-top:8px" onsubmit="return confirm('この人の今年の入力と写真をすべて消します。前年は残ります。よろしいですか？')"><?= csrf_field() ?><input type="hidden" name="act" value="reset_emp"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="emp" value="<?= $h($emp) ?>"><button class="g" style="background:#C8372D">今年の入力をリセット</button></form>
</div>
<div class="card"><h2>本人が訂正した項目</h2><?php if (empty($r['changes'])) echo '<p><small>なし</small></p>'; else { echo '<ul>'; foreach ($r['changes'] as $ch) echo '<li><small>' . $h(date('m/d H:i', strtotime($ch['at']))) . '</small> ' . $h($ch['what']) . '</li>'; echo '</ul>'; } ?></div>
<div class="card"><h2>判定結果</h2>
<table><tr><th>本人の所得</th><td><?= number_format($c['self']['total_income']) ?>円（給与 <?= number_format($c['self']['salary_revenue']) ?>円）</td></tr>
<tr><th>配偶者</th><td><?= isset($c['spouse']) ? $h(($a['spouse']['name'] ?? '') . '　区分 ' . $c['spouse']['kubun'] . '　源泉控除対象 ' . $c['spouse']['gensen'] . '　所得 ' . number_format($c['spouse']['income']['total_income']) . '円') : 'なし' ?></td></tr>
<tr><th>扶養親族</th><td><?php foreach ($c['family'] as $f) echo $h(($f['name'] ?? '') . '（' . ($f['relation'] ?? '') . '・' . ($f['age'] ?? '?') . '歳）→ ' . $f['class'] . '　所得 ' . number_format($f['income']['total_income'] ?? 0) . '円'), '<br>'; ?><b><?= $h($row[C['dep_kubun']]) ?></b></td></tr>
<tr><th>所得金額調整控除</th><td><?= $c['adjust'] ? $h($c['adjust']['kind']) : '—' ?></td></tr>
<tr><th>保険料・掛金</th><td><?php $t = cert_totals($r); foreach (['life_new' => '新生命', 'life_old' => '旧生命', 'kaigo' => '介護医療', 'nenkin_new' => '新個人年金', 'nenkin_old' => '旧個人年金', 'jishin' => '地震', 'old_songai' => '旧長期', 'kokumin_nenkin' => '国民年金', 'shaho_self' => '社保（自払い計）', 'kyosai' => '共済・iDeCo', 'zandaka1' => '住宅残高'] as $k => $l) if ($t[$k]) echo "$l " . number_format($t[$k]) . '円　'; ?></td></tr></table>
</div>
<div class="card"><h2>証明書・写真</h2>
<?php foreach ($r['certs'] ?? [] as $ct): if (($ct['status'] ?? '') === 'deleted') continue; ?>
<div style="display:flex;gap:12px;border-bottom:1px solid #eee;padding:8px 0"><a href="?act=photo&client=<?= $client ?>&emp=<?= rawurlencode($emp) ?>&f=<?= rawurlencode($ct['file']) ?>" target="_blank"><img class="ph" src="?act=photo&client=<?= $client ?>&emp=<?= rawurlencode($emp) ?>&f=<?= rawurlencode($ct['file']) ?>"></a>
<div><b><?= $h($ct['kind']) ?> <?= $h($ct['cat'] ?? '') ?></b> <?= $h($ct['issuer'] ?? '') ?> <span class="st"><?= $h($ct['status']) ?><?= !empty($ct['confirmed']) ? '・本人確認済' : '' ?></span><br>
<?php foreach ($ct['items'] ?? [] as $it) echo $h(($it['category'] ?? '') . ' ' . ($it['contract'] ?? '') . ' ' . number_format((int)($it['amount'] ?? 0)) . '円 ' . ($it['confidence'] ?? '')), '<br>'; ?>
<?php if (!empty($ct['ai']['notes'])) echo '<small>AI: ' . $h($ct['ai']['notes']) . '</small><br>'; ?>
<?php if (!empty($ct['error'])) echo '<small style="color:#C8372D">' . $h($ct['error']) . '</small><br>'; ?>
<small>ドライブ <?= $ct['drive_id'] ? '保存済' : ($ct['drive_error'] ?? '未設定') ?></small></div></div>
<?php endforeach; ?>
</div>
<div class="card"><h2>CSVに出る内容（空でない列のみ）</h2>
<table><tr><th>列</th><th>項目</th><th>前年</th><th>今年</th></tr>
<?php foreach ($row as $i => $v) { $pv = $p['raw'][$i] ?? ''; if ($v === '' && $pv === '') continue; if ($i >= 24 && $i <= 125) continue; $chg = (string)$v !== (string)$pv; echo '<tr class="' . ($chg ? 'chg' : '') . '"><td>' . ($i + 1) . '</td><td>' . $h($hdr[$i] ?? '') . '</td><td>' . $h($pv) . '</td><td>' . $h($v) . '</td></tr>'; } ?>
</table></div>
<p><a class="btn g" href="?v=client&client=<?= $client ?>&y=<?= $viewYear ?>">この顧問先の一覧に戻る</a></p>
<?php endif; ?>
</div></body></html>

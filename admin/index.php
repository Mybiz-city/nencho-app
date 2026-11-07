<?php
// 事務所画面：前年CSV取込、提出状況、内容確認、CSV書き出し
declare(strict_types=1);
require_once __DIR__ . '/../lib/common.php';
require_once __DIR__ . '/../lib/judge.php';
require_once __DIR__ . '/../lib/ics.php';
require_once __DIR__ . '/../lib/xlsx.php';
session_start();
$cfg = cfg();
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);

// ログイン
if (($_POST['act'] ?? '') === 'login') {
    if (hash_equals((string)$cfg['admin_password'], (string)($_POST['pw'] ?? ''))) $_SESSION['admin'] = true;
    header('Location: ./'); exit;
}
if (($_GET['act'] ?? '') === 'logout') { unset($_SESSION['admin']); header('Location: ./'); exit; }
if (empty($_SESSION['admin'])) {
    echo '<!DOCTYPE html><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>事務所ログイン</title><body style="font-family:sans-serif;max-width:360px;margin:60px auto;padding:0 16px"><h2>事務所画面</h2><form method="post"><input type="hidden" name="act" value="login"><input type="password" name="pw" placeholder="パスワード" style="width:100%;font-size:18px;padding:10px"><button style="width:100%;font-size:18px;padding:10px;margin-top:10px;background:#00A88E;color:#fff;border:0;border-radius:8px">ログイン</button></form>';
    exit;
}

$year = $cfg['year'];
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
    $csv = ics_export($client, ($_GET['all'] ?? '') !== '1');
    header('Content-Type: text/csv; charset=Shift_JIS');
    header("Content-Disposition: attachment; filename=\"KYCSV06_{$client}_{$year}.CSV\"");
    echo $csv; exit;
}
// 写真
if (($_GET['act'] ?? '') === 'photo') {
    $p = emp_dir(preg_replace('/\D/', '', (string)$_GET['client']), (string)$_GET['emp'], false) . '/photos/' . basename((string)$_GET['f']);
    if (file_exists($p)) { header('Content-Type: ' . mime_content_type($p)); readfile($p); } exit;
}
// 会社用ページの合言葉を発行
if (($_POST['act'] ?? '') === 'company_key') {
    $client = preg_replace('/\D/', '', (string)$_POST['client']);
    $keys = json_load(data_dir() . '/_company_keys.json', []);
    if (strlen($client) === 4) { $keys[$client] = $keys[$client] ?? bin2hex(random_bytes(12)); json_save(data_dir() . '/_company_keys.json', $keys); $msg = "会社用ページのURLを用意しました（$client）"; }
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
<?php if ($view === 'home'): ?>
<div class="card"><h2>1. 顧問先一覧の取り込み（名前の表示に使う。一覧が変わったら同じExcelを上げ直す）</h2>
<form method="post" enctype="multipart/form-data">
<input type="hidden" name="act" value="clients">
顧問先一覧のExcel（0.顧問先.xlsx）かCSV<input type="file" name="list" accept=".xlsx,.csv,.CSV,.txt">　または貼り付け（1行に「コード4桁 名前」。Excelからコピーした列でも可）<br>
<textarea name="paste" rows="3" style="width:100%;margin-top:6px" placeholder="0302 津守産業株式会社&#10;0307 ○○株式会社"></textarea>
<button style="margin-top:6px">一覧を読み込む</button>　<small>登録済み：<?= count($clientNames) ?> 件</small>
</form>
</div>
<div class="card"><h2>2. 前年CSVの取り込み（複数ファイルをまとめて選べる）</h2>
<form method="post" enctype="multipart/form-data">
<input type="hidden" name="act" value="import">
日本ICSの前年CSV<input type="file" name="csv[]" accept=".csv,.CSV" multiple required>　<button>取り込む</button><br>
<small>顧問先コードはファイル名から自動で読みます（KYCSV06<b>0101</b><u>0307</u>.CSV → 0307）。ファイル名を変えている場合だけ、ここに4桁を入れる：<input type="text" name="client" size="6" placeholder="任意"></small>
</form>
<small>登録コードは「顧問先コード4桁＋個人コードの数字6桁」です（例：0307000001）。従業員にはこの10桁をLINEなどで送ります。<br>日本ICS：業務選択 → 表形式 → 給与マスター表形式処理 → ファイル作成（タイプ6）で出したファイルです。</small>
</div>
<div class="card"><h2>3. 前年データのない人を追加</h2>
<form method="post" style="display:inline"><input type="hidden" name="act" value="add_emp">顧問先コード<input type="text" name="client" size="6">　個人コード（日本ICSと同じ）<input type="text" name="emp" size="10" placeholder="**000021">　<button>作る</button></form>
</div>
<div class="card"><h2>提出状況</h2>
<?php
$clients = array_filter(glob(data_dir() . '/*', GLOB_ONLYDIR) ?: [], fn($d) => preg_match('/\/\d{4}$/', $d));
if (!$clients) echo '<p>まだ顧問先がありません。上から前年CSVを取り込んでください。</p>';
foreach ($clients as $cd):
    $client = basename($cd); $cdir = "$cd/$year";
    $emps = glob("$cdir/*", GLOB_ONLYDIR) ?: [];
    $rows = []; $cnt = ['submitted' => 0, 'in_progress' => 0, 'new' => 0];
    foreach ($emps as $ed) {
        $emp = basename($ed); $r = json_load("$ed/answers.json"); $prev = json_load("$ed/prev.json");
        $code = $r['emp'] ?? ($prev['code'] ?? $emp);
        $st = $r['status'] ?? 'new'; $cnt[$st] = ($cnt[$st] ?? 0) + 1;
        $name = $r['answers']['name'] ?? ($prev ? $prev['sei'] . ' ' . $prev['mei'] : '');
        $ro = json_load("$ed/roster.json", []);
        $rows[] = [$code, $name, $st, $r['submitted_at'] ?? ($r['updated_at'] ?? ''), count(array_filter($r['certs'] ?? [], fn($c) => ($c['status'] ?? '') !== 'deleted')), !empty($r['office_checked_at']), $ro];
    }
?>
<?php $ckeys = json_load(data_dir() . '/_company_keys.json', []); $base = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . preg_replace('#/admin/.*$#', '', $_SERVER['REQUEST_URI']); ?>
<h3 style="margin:14px 0 6px"><?= $h($client) ?> <?= $h($clientNames[$client] ?? '') ?>　<small>提出 <?= $cnt['submitted'] ?> ／ 入力中 <?= $cnt['in_progress'] ?> ／ 未着手 <?= $cnt['new'] ?></small>
　<?php if (!empty($ckeys[$client])): ?><small>会社用ページ：<input type="text" readonly value="<?= $h("$base/company/?c=$client&k=" . $ckeys[$client]) ?>" size="60" onclick="this.select()"></small><?php else: ?><form method="post" style="display:inline"><input type="hidden" name="act" value="company_key"><input type="hidden" name="client" value="<?= $client ?>"><button class="g" style="font-size:12px;padding:4px 8px">会社用ページのURLを作る</button></form><?php endif; ?>
　<a class="btn" href="?act=export&client=<?= $client ?>">提出済みをCSVで出す</a> <a class="btn g" href="?act=export&client=<?= $client ?>&all=1">全員分を出す</a></h3>
<table><tr><th>登録コード<br><small>（下はICSの個人コード）</small></th><th>氏名</th><th>在籍</th><th>状態</th><th>最終更新</th><th>写真</th><th>事務所確認</th><th></th></tr>
<?php foreach ($rows as $w): ?>
<tr><td><?php if (str_starts_with($w[0], 'N')): ?><form method="post" style="display:inline"><input type="hidden" name="act" value="assign_code"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="old" value="<?= $h($w[0]) ?>"><small>会社が追加</small><br><input type="text" name="new" size="9" placeholder="**000021"><button style="font-size:12px;padding:3px 6px">割当</button></form><?php else: ?><b><?= $h($client . code_digits($w[0])) ?></b><br><small><?= $h($w[0]) ?></small><?php endif; ?></td><td><?= $h($w[1]) ?></td><td><?= ($w[6]['status'] ?? 'active') === 'retired' ? '<span class="st" style="background:#fdecea;color:#C8372D">退職 ' . $h($w[6]['retire'] ?? '') . '</span>' : '在籍' ?><?= !empty($w[6]['hire']) ? '<br><small>入社 ' . $h($w[6]['hire']) . '</small>' : '' ?></td><td><span class="st <?= $w[2] ?>"><?= ['submitted' => '提出済み', 'in_progress' => '入力中', 'new' => '未着手'][$w[2]] ?? $w[2] ?></span></td><td><?= $w[3] ? $h(date('m/d H:i', strtotime($w[3]))) : '' ?></td><td><?= $w[4] ?>枚</td><td><?= $w[5] ? '✓' : '' ?></td><td><a href="?v=emp&client=<?= $client ?>&emp=<?= rawurlencode($w[0]) ?>">開く</a></td></tr>
<?php endforeach; ?></table>
<?php endforeach; ?>
</div>

<?php elseif ($view === 'emp'):
    $client = preg_replace('/\D/', '', (string)$_GET['client']); $emp = (string)$_GET['emp'];
    $r = load_record($client, $emp); $c = compute($r); $a = $r['answers']; $p = $r['prev'] ?? [];
    $row = ics_row_from_record($r); $meta = json_load(data_dir() . "/$client/$year/_ics_meta.json"); $hdr = $meta['header'] ?? [];
?>
<div class="card"><h2><?= $h("$client-$emp") ?>　<?= $h($a['name'] ?? (($p['sei'] ?? '') . ' ' . ($p['mei'] ?? ''))) ?>　<span class="st <?= $r['status'] ?>"><?= $r['status'] ?></span></h2>
<p><small>同意 <?= $h($r['consent_at'] ?? '—') ?>　提出 <?= $h($r['submitted_at'] ?? '—') ?>　LINE連携 <?= $r['line_user_id'] ? 'あり' : 'なし' ?></small></p>
<form method="post"><input type="hidden" name="act" value="note"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="emp" value="<?= $h($emp) ?>">
<label><input type="checkbox" name="checked" <?= !empty($r['office_checked_at']) ? 'checked' : '' ?>> 事務所で確認した</label>　<input type="text" name="note" value="<?= $h($r['office_note'] ?? '') ?>" placeholder="メモ" size="40">　<button>保存</button></form>
<form method="post" style="margin-top:8px" onsubmit="return confirm('この人の今年の入力と写真をすべて消します。前年は残ります。よろしいですか？')"><input type="hidden" name="act" value="reset_emp"><input type="hidden" name="client" value="<?= $client ?>"><input type="hidden" name="emp" value="<?= $h($emp) ?>"><button class="g" style="background:#C8372D">今年の入力をリセット</button></form>
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
<p><a class="btn g" href="./">一覧に戻る</a></p>
<?php endif; ?>
</div></body></html>

<?php
// 会社（経営者）用：在籍者の確認。入社日・退職日の登録、新しい従業員の追加
// URL: company/?c=顧問先コード&k=合言葉（事務所画面で発行）
declare(strict_types=1);
require_once __DIR__ . '/../lib/common.php';
$cfg = cfg(); $year = $cfg['year'];
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$client = preg_replace('/\D/', '', (string)($_GET['c'] ?? $_POST['c'] ?? ''));
$key = (string)($_GET['k'] ?? $_POST['k'] ?? '');
$keys = json_load(data_dir() . '/_company_keys.json', []);
if (strlen($client) !== 4 || empty($keys[$client]) || !hash_equals((string)$keys[$client], $key)) { http_response_code(403); exit('<meta charset="UTF-8"><p style="font-family:sans-serif;padding:30px">このページは開けません。事務所から届いたURLをそのまま開いてください。</p>'); }
$names = json_load(data_dir() . '/_clients.json', []);
$cdir = data_dir() . "/$client/$year";
if (!is_dir($cdir)) mkdir($cdir, 0700, true);
$msg = '';

function roster_path(string $client, string $emp): string { return emp_dir($client, $emp) . '/roster.json'; }

if (($_POST['act'] ?? '') === 'roster') {
    $emp = (string)$_POST['emp'];
    $ro = json_load(roster_path($client, $emp), []);
    $ro['status'] = ($_POST['status'] ?? 'active') === 'retired' ? 'retired' : 'active';
    $ro['hire'] = trim((string)($_POST['hire'] ?? ''));
    $ro['retire'] = $ro['status'] === 'retired' ? trim((string)($_POST['retire'] ?? '')) : '';
    $ro['updated_at'] = date('c'); $ro['updated_by'] = 'company';
    json_save(roster_path($client, $emp), $ro);
    $msg = '保存しました';
}
if (($_POST['act'] ?? '') === 'add') {
    $name = trim((string)$_POST['name']); $kana = trim((string)$_POST['kana']); $birth = (string)$_POST['birth']; $hire = (string)$_POST['hire']; $sex = (string)$_POST['sex'];
    if ($name === '' || $birth === '') $msg = '氏名と生年月日は必須です';
    else {
        $n = 1; while (is_dir("$cdir/N" . sprintf('%03d', $n))) $n++;
        $emp = 'N' . sprintf('%03d', $n);
        emp_dir($client, $emp);
        json_save(roster_path($client, $emp), ['status' => 'active', 'hire' => $hire, 'retire' => '', 'added_by' => 'company', 'added_at' => date('c'), 'name' => $name, 'kana' => $kana, 'birth' => $birth, 'sex' => $sex]);
        $r = empty_record($client, $emp); $r['answers'] = ['name' => $name, 'kana' => $kana, 'birth' => $birth, 'sex' => $sex]; save_record($r);
        $msg = "$name さんを追加しました。登録コードは事務所が発行してお知らせします";
    }
}

// 一覧
$rows = [];
foreach (glob("$cdir/*", GLOB_ONLYDIR) ?: [] as $ed) {
    $emp = basename($ed); $r = json_load("$ed/answers.json"); $prev = json_load("$ed/prev.json"); $ro = json_load("$ed/roster.json", []);
    $code = $r['emp'] ?? ($prev['code'] ?? $emp);
    $rows[] = [
        'emp' => $code, 'name' => $r['answers']['name'] ?? ($prev ? $prev['sei'] . ' ' . $prev['mei'] : ($ro['name'] ?? '')),
        'birth' => $r['answers']['birth'] ?? ($prev['birth'] ?? ($ro['birth'] ?? '')),
        'hire' => $ro['hire'] ?? (isset($prev['raw'][8]) ? (wareki_to_iso($prev['raw'][8]) ?? '') : ''),
        'retire' => $ro['retire'] ?? '', 'status' => $ro['status'] ?? 'active',
        'app' => $r['status'] ?? 'new', 'pending' => str_starts_with($code, 'N'),
    ];
}
usort($rows, fn($a, $b) => strcmp($a['emp'], $b['emp']));
?>
<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>在籍者の確認 - <?= $h($names[$client] ?? $client) ?></title>
<style>
body{font-family:"BIZ UDPGothic","Hiragino Sans",sans-serif;margin:0;background:#f4f6f5;color:#222;font-size:15px}
header{background:#007A67;color:#fff;padding:12px 16px}header b{font-size:17px}
.wrap{max-width:760px;margin:0 auto;padding:14px}
.card{background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{margin:0 0 8px;font-size:16px;color:#007A67}
.it{border-bottom:1px solid #eee;padding:10px 0}.it:last-child{border:0}
.it b{font-size:16px}.note{color:#666;font-size:13px}
input[type=text],input[type=date],select{font-size:15px;padding:8px;border:1px solid #ccc;border-radius:8px}
button{font-size:14px;padding:8px 14px;background:#00A88E;color:#fff;border:0;border-radius:8px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}
.st{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;background:#eee;margin-left:6px}.st.r{background:#fdecea;color:#C8372D}.st.g{background:#00A88E;color:#fff}
.msg{background:#FFF8E1;border-left:4px solid #F2B705;padding:8px 12px;margin-bottom:12px;font-size:14px}
label{font-size:13px;color:#444}
</style></head><body>
<header><b><?= $h($names[$client] ?? ('顧問先 ' . $client)) ?></b><br><small><?= $year ?>年 年末調整　在籍者の確認</small></header>
<div class="wrap">
<?php if ($msg): ?><div class="msg"><?= $h($msg) ?></div><?php endif; ?>
<div class="card"><h2>お願い</h2>
<p style="margin:0;font-size:14px">今年の年末調整の対象者を確認してください。<b>今年中に退職した方</b>は「退職」にして退職日を、<b>今年入社した方</b>で一覧にない方は下の欄から追加してください。入社日・退職日は分かる範囲で結構です。</p></div>
<div class="card"><h2>従業員の一覧（<?= count($rows) ?>人）</h2>
<?php foreach ($rows as $w): ?>
<div class="it"><b><?= $h($w['name']) ?></b> <span class="note"><?= $w['birth'] ? $h(wareki_to_iso($w['birth']) ? $w['birth'] : $w['birth']) : '' ?></span>
<?= $w['status'] === 'retired' ? '<span class="st r">退職</span>' : '<span class="st g">在籍</span>' ?><?= $w['pending'] ? '<span class="st">コード発行待ち</span>' : '' ?>
<span class="note" style="float:right"><?= ['submitted' => '入力済み', 'in_progress' => '入力中', 'new' => '未入力'][$w['app']] ?? '' ?></span>
<form method="post" class="row"><input type="hidden" name="act" value="roster"><input type="hidden" name="c" value="<?= $client ?>"><input type="hidden" name="k" value="<?= $h($key) ?>"><input type="hidden" name="emp" value="<?= $h($w['emp']) ?>">
<label>状態 <select name="status" onchange="this.form.querySelector('[name=retire]').style.display=this.value==='retired'?'inline-block':'none'"><option value="active" <?= $w['status'] !== 'retired' ? 'selected' : '' ?>>在籍</option><option value="retired" <?= $w['status'] === 'retired' ? 'selected' : '' ?>>退職</option></select></label>
<label>入社日 <input type="date" name="hire" value="<?= $h($w['hire']) ?>"></label>
<input type="date" name="retire" value="<?= $h($w['retire']) ?>" style="display:<?= $w['status'] === 'retired' ? 'inline-block' : 'none' ?>" title="退職日">
<button>保存</button></form></div>
<?php endforeach; ?>
</div>
<div class="card"><h2>一覧にない従業員を追加する</h2>
<form method="post"><input type="hidden" name="act" value="add"><input type="hidden" name="c" value="<?= $client ?>"><input type="hidden" name="k" value="<?= $h($key) ?>">
<div class="row"><label>氏名<br><input type="text" name="name" placeholder="山田 太郎" required></label><label>フリガナ<br><input type="text" name="kana" placeholder="ヤマダ タロウ"></label></div>
<div class="row"><label>生年月日<br><input type="date" name="birth" required></label><label>性別<br><select name="sex"><option value="">—</option><option>男</option><option>女</option></select></label><label>入社日<br><input type="date" name="hire"></label></div>
<div class="row"><button>追加する</button></div>
<p class="note">追加した方の登録コードは、事務所が発行してお知らせします。</p></form></div>
</div></body></html>

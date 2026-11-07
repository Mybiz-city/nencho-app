<?php
// 会社（経営者）用：在籍者の確認。入社日・退職日の登録、新しい従業員の追加
// URL: company/?c=顧問先コード&k=合言葉（事務所画面で発行）
declare(strict_types=1);
require_once __DIR__ . '/../lib/common.php';
secure_session('nencho_co', 7200);
$cfg = cfg(); $year = $cfg['year'];
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$client = preg_replace('/\D/', '', (string)($_GET['c'] ?? $_POST['c'] ?? ''));
$key = (string)($_GET['k'] ?? $_POST['k'] ?? '');
$keys = json_load(data_dir() . '/_company_keys.json', []);
$kk = $keys[$client] ?? null; $expired = $kk && (time() - strtotime($kk['issued_at'] ?? '2000-01-01') > 90 * 86400);
if (strlen($client) !== 4 || !$kk || $expired || !hash_equals((string)($kk['key'] ?? ''), $key)) { if (!throttle_ok('company:' . client_ip(), 10)) exit('試行回数が多すぎます'); throttle_fail('company:' . client_ip(), 10); audit("company page denied $client"); http_response_code(403); exit('<meta charset="UTF-8"><p style="font-family:sans-serif;padding:30px">このページは開けません。事務所から届いたURLをそのまま開いてください。</p>'); }
$names = json_load(data_dir() . '/_clients.json', []);
$cdir = data_dir() . "/$client/$year";
if (!is_dir($cdir)) mkdir($cdir, 0700, true);
csrf_check();
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

// CSVで一括更新（氏名と生年月日で照合。見つからなければ追加）
if (($_POST['act'] ?? '') === 'bulk' && !empty($_FILES['csv']['tmp_name'])) {
    $raw = (string)file_get_contents($_FILES['csv']['tmp_name']); $enc = mb_detect_encoding($raw, ['UTF-8', 'SJIS-win'], true) ?: 'SJIS-win'; $text = mb_convert_encoding($raw, 'UTF-8', $enc);
    $lines = array_values(array_filter(preg_split('/\r\n|\n|\r/', $text), fn($l) => trim($l) !== ''));
    $hdr = array_map(fn($c) => trim(mb_convert_kana($c, 's')), str_getcsv($lines[0] ?? ''));
    $col = fn(array $names) => (function () use ($hdr, $names) { foreach ($names as $n) { $i = array_search($n, $hdr, true); if ($i !== false) return $i; } return null; })();
    $iName = $col(['氏名', '名前', '社員名']); $iKana = $col(['フリガナ', 'ふりがな', 'カナ']); $iBirth = $col(['生年月日']); $iHire = $col(['入社日', '入社年月日']); $iRet = $col(['退職日', '退職年月日']); $iSex = $col(['性別']);
    if ($iName === null || $iBirth === null) $msg = '1行目に「氏名」と「生年月日」の見出しが必要です（入社日・退職日・フリガナ・性別は任意）';
    else {
        $existing = [];
        foreach (glob("$cdir/*", GLOB_ONLYDIR) ?: [] as $ed) { $r = json_load("$ed/answers.json"); $p = json_load("$ed/prev.json"); $ro = json_load("$ed/roster.json", []); $nm = str_replace([' ', '　'], '', $r['answers']['name'] ?? ($p ? $p['sei'] . $p['mei'] : ($ro['name'] ?? ''))); $bd = $r['answers']['birth'] ?? ($p['birth'] ?? ($ro['birth'] ?? '')); $existing["$nm|$bd"] = basename($ed); }
        $upd = 0; $add = 0; $skip = 0;
        foreach (array_slice($lines, 1) as $line) {
            $c = str_getcsv($line); $name = trim((string)($c[$iName] ?? '')); $birth = wareki_to_iso((string)($c[$iBirth] ?? '')) ?? '';
            if ($name === '' || $birth === '') { $skip++; continue; }
            $hire = $iHire !== null ? (wareki_to_iso((string)($c[$iHire] ?? '')) ?? '') : ''; $ret = $iRet !== null ? (wareki_to_iso((string)($c[$iRet] ?? '')) ?? '') : '';
            $key = str_replace([' ', '　'], '', $name) . "|$birth";
            if (isset($existing[$key])) { $emp = $existing[$key]; $ro = json_load(roster_path($client, $emp), []); if ($hire) $ro['hire'] = $hire; if ($ret) { $ro['status'] = 'retired'; $ro['retire'] = $ret; } $ro['updated_at'] = date('c'); $ro['updated_by'] = 'company-csv'; json_save(roster_path($client, $emp), $ro); $upd++; }
            else { $n = 1; while (is_dir("$cdir/N" . sprintf('%03d', $n))) $n++; $emp = 'N' . sprintf('%03d', $n); emp_dir($client, $emp);
                   json_save(roster_path($client, $emp), ['status' => $ret ? 'retired' : 'active', 'hire' => $hire, 'retire' => $ret, 'added_by' => 'company-csv', 'added_at' => date('c'), 'name' => $name, 'birth' => $birth]);
                   $r = empty_record($client, $emp); $r['answers'] = ['name' => $name, 'kana' => trim((string)($c[$iKana] ?? '')), 'birth' => $birth, 'sex' => trim((string)($c[$iSex] ?? ''))]; save_record($r); $add++; }
        }
        $msg = "更新 $upd 人、追加 $add 人、読み飛ばし $skip 行";
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
</style>
<script>
const YEAR=<?= (int)$year ?>;
const eras=[['令',2019],['平',1989],['昭',1926],['大',1912],['明',1868]];
function yl(y){ for(const [g,e] of eras){ if(y>=e){ const n=y-e+1; return y+'年（'+g+(n===1?'元':n)+'）'; } } return y+'年'; }
function dsel(name,val,y0,y1){ const [y,m,d]=(val||'').split('-').map(Number); let h='<span class="dsel" data-name="'+name+'" style="display:inline-flex;gap:4px"><select class="y"><option value="">年</option>'; for(let i=y1;i>=y0;i--) h+='<option value="'+i+'"'+(i===y?' selected':'')+'>'+yl(i)+'</option>'; h+='</select><select class="m"><option value="">月</option>'; for(let i=1;i<=12;i++) h+='<option value="'+i+'"'+(i===m?' selected':'')+'>'+i+'月</option>'; h+='</select><select class="d"><option value="">日</option>'; for(let i=1;i<=31;i++) h+='<option value="'+i+'"'+(i===d?' selected':'')+'>'+i+'日</option>'; h+='</select><input type="hidden" name="'+name+'" value="'+(val||'')+'"></span>'; return h; }
document.addEventListener('DOMContentLoaded',()=>{ document.querySelectorAll('input[type=date]').forEach(inp=>{ const isBirth=inp.name==='birth'; const span=document.createElement('span'); span.innerHTML=dsel(inp.name, inp.value, isBirth?1930:YEAR-3, YEAR); const el=span.firstChild; el.style.display=inp.style.display||'inline-flex'; inp.replaceWith(el); el.querySelectorAll('select').forEach(s=>s.addEventListener('change',()=>{ const y=el.querySelector('.y').value,m=el.querySelector('.m').value,d=el.querySelector('.d').value; el.querySelector('input').value=(y&&m&&d)?y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):''; })); });
  document.querySelectorAll('select[name=status]').forEach(st=>st.addEventListener('change',()=>{ const el=st.form.querySelector('.dsel[data-name=retire]'); if(el) el.style.display=st.value==='retired'?'inline-flex':'none'; })); });
</script></head><body>
<header><b><?= $h($names[$client] ?? ('顧問先 ' . $client)) ?></b><br><small><?= $year ?>年 年末調整　在籍者の確認</small></header>
<div class="wrap">
<?php if ($msg): ?><div class="msg"><?= $h($msg) ?></div><?php endif; ?>
<div class="card"><h2>お願い</h2>
<p style="margin:0;font-size:14px">今年の年末調整の対象者を確認してください。<b>今年中に退職した方</b>は「退職」にして退職日を、<b>今年入社した方</b>で一覧にない方は下の欄から追加してください。入社日・退職日は分かる範囲で結構です。</p></div>
<div class="card"><h2>従業員の一覧（<?= count($rows) ?>人）</h2>
<?php foreach ($rows as $w): ?>
<div class="it"><b><?= $h($w['name']) ?></b> <span class="note"><?= $w['birth'] ? $h(substr($w['birth'], 0, 4)) . '年生まれ' : '' ?></span>
<?= $w['status'] === 'retired' ? '<span class="st r">退職</span>' : '<span class="st g">在籍</span>' ?><?= $w['pending'] ? '<span class="st">コード発行待ち</span>' : '' ?>
<span class="note" style="float:right"><?= ['submitted' => '入力済み', 'in_progress' => '入力中', 'new' => '未入力'][$w['app']] ?? '' ?></span>
<form method="post" class="row"><?= csrf_field() ?><input type="hidden" name="act" value="roster"><input type="hidden" name="c" value="<?= $client ?>"><input type="hidden" name="k" value="<?= $h($key) ?>"><input type="hidden" name="emp" value="<?= $h($w['emp']) ?>">
<label>状態 <select name="status"><option value="active" <?= $w['status'] !== 'retired' ? 'selected' : '' ?>>在籍</option><option value="retired" <?= $w['status'] === 'retired' ? 'selected' : '' ?>>退職</option></select></label>
<label>入社日 <input type="date" name="hire" value="<?= $h($w['hire']) ?>"></label>
<input type="date" name="retire" value="<?= $h($w['retire']) ?>" style="display:<?= $w['status'] === 'retired' ? 'inline-block' : 'none' ?>" title="退職日">
<button>保存</button></form></div>
<?php endforeach; ?>
</div>
<div class="card"><h2>人数が多い場合：CSVでまとめて更新</h2>
<form method="post" enctype="multipart/form-data"><?= csrf_field() ?><input type="hidden" name="act" value="bulk"><input type="hidden" name="c" value="<?= $client ?>"><input type="hidden" name="k" value="<?= $h($key) ?>">
<input type="file" name="csv" accept=".csv,.CSV" required>　<button>読み込む</button>
<p class="note">Excelで作った表をCSVで保存して上げてください。1行目は見出し：<b>氏名、生年月日</b>（必須）、入社日、退職日、フリガナ、性別（任意）。氏名と生年月日が同じ人は更新、いない人は追加します。社員番号は不要です（事務所側で決めます）。</p></form></div>
<div class="card"><h2>一覧にない従業員を追加する</h2>
<form method="post"><?= csrf_field() ?><input type="hidden" name="act" value="add"><input type="hidden" name="c" value="<?= $client ?>"><input type="hidden" name="k" value="<?= $h($key) ?>">
<div class="row"><label>氏名<br><input type="text" name="name" placeholder="山田 太郎" required></label><label>フリガナ<br><input type="text" name="kana" placeholder="ヤマダ タロウ"></label></div>
<div class="row"><label>生年月日<br><input type="date" name="birth" required></label><label>性別<br><select name="sex"><option value="">—</option><option>男</option><option>女</option></select></label><label>入社日<br><input type="date" name="hire"></label></div>
<div class="row"><button>追加する</button></div>
<p class="note">追加した方の登録コードは、事務所が発行してお知らせします。</p></form></div>
</div></body></html>

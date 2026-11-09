<?php
// 個人事業主向けシミュレーション：推移試算表（損益）の写真をAIで読む（確定申告書の読み取りは2026-11-09に廃止）
// POST multipart: file, kind=suii, year=対象年（西暦）
// ファイルはサーバーに残さない（読み取り後に消す）
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/common.php';
require_once dirname(__DIR__) . '/lib/claude.php';

header('Referrer-Policy: no-referrer');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POSTで送ってください', 405);
if (empty(cfg()['anthropic_api_key'])) fail('AI読み取りは設定されていません');
$tk = 'furusato_ocr:' . client_ip();
if (!throttle_ok($tk, 30, 3600)) fail('読み取りの回数が多すぎます。1時間ほど待ってからやり直してください', 429);
if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) fail('ファイルを受け取れませんでした');
if ($_FILES['file']['size'] > 15 * 1024 * 1024) fail('ファイルが大きすぎます（15MBまで）');
$kind = 'suii';
$year = (int)($_POST['year'] ?? date('Y'));

$SUII = <<<TXT
写真（またはPDF）は、日本の会計ソフト（日本ICSなど）が印刷した個人事業主の「推移試算表（損益）」です。列が月、行が科目の表です。次のJSONだけを返してください。説明文は不要です。

{
  "doc_type": "suii" | "other",
  "name": "事業者名（表の上部にあれば）",
  "year": 対象年（西暦の数値。令和N年なら 2018+N。不明なら null）,
  "from_month": 最初の月（数値）, "to_month": 最後の月（数値。実績がある最後の月）,
  "sales": [1月〜12月の売上高。その月の列が無ければ null。12要素],
  "income": [1月〜12月の所得金額。その月の列が無ければ null。12要素],
  "income_label": "所得金額に使った行の名前",
  "notes": "迷った点があれば短く"
}

決まりごと:
- income は「《所得金額》」の行。無ければ「《青申特典控除前所得》」「青色申告特別控除前の所得金額」「当期純利益」など、青色申告特別控除を引く前の最終利益の行を使う。
- 月ごとの列の値を使う。「累計」「合計」「構成比」の列は使わない。
- 「△」「-」「▲」や赤字表記はマイナスの数値にする。桁区切りのカンマは除いて整数にする。
- 写真が横向き・逆さまでも、そのまま読む。数字が読めない月は null。
- 推移試算表でないもの（残高試算表、元帳、領収書など）なら doc_type を other にする。
TXT;


$tmp = $_FILES['file']['tmp_name'];
try {
    $out = claude_read_json($tmp, $SUII, 3500);
} catch (Throwable $e) {
    throttle_fail($tk, 30, 3600, 600);
    @unlink($tmp);
    fail($e->getMessage());
}
@unlink($tmp);
audit("furusato ocr $kind ok");
unset($out['usage']);
json_out(['ok' => true, 'kind' => $kind, 'year' => $year, 'data' => $out]);

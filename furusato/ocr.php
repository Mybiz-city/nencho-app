<?php
// 個人事業主向けシミュレーション：推移試算表（損益）の写真、前年の確定申告書（写真・PDF）をAIで読む
// POST multipart: file, kind=suii|shinkoku, year=対象年（西暦）
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
$kind = ($_POST['kind'] ?? '') === 'shinkoku' ? 'shinkoku' : 'suii';
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

$SHINKOKU = <<<TXT
写真（またはPDF）は、日本の「所得税の確定申告書」（第一表・第二表。e-Tax出力または手書き）です。写っているページから読める項目だけを埋め、読めない項目は null にして、次のJSONだけを返してください。説明文は不要です。金額はすべて整数（円）。

{
  "doc_type": "shinkoku" | "other",
  "year": 「令和N年分」の西暦（2018+N）。不明なら null,
  "name": "氏名",
  "pages": ["first" | "second"  写っているページ],
  "first": {
    "shaho": 社会保険料控除, "kyosai": 小規模企業共済等掛金控除, "seimei": 生命保険料控除, "jishin": 地震保険料控除,
    "kafu_hitorioya": 寡婦・ひとり親控除, "gakusei_shogai": 勤労学生・障害者控除,
    "haigu": 配偶者（特別）控除, "fuyo": 扶養控除, "kiso": 基礎控除, "zasson": 雑損控除, "iryo": 医療費控除, "kifu": 寄附金控除,
    "total_deduction": 所得から差し引かれる金額の合計, "kazei": 課税される所得金額,
    "jigyo_income": 事業所得（営業等）の所得金額, "salary_income": 給与の所得金額
  },
  "second": {
    "premiums": {"new": 新生命保険料, "old": 旧生命保険料, "care": 介護医療保険料, "pnew": 新個人年金保険料, "pold": 旧個人年金保険料, "jishin": 地震保険料, "long": 旧長期損害保険料},
    "shaho_items": [{"type": "社会保険の種類（国民健康保険・国民年金・健康保険・厚生年金・介護保険など、書かれているとおり）", "amount": 支払保険料}],
    "furusato": 寄附金控除に関する事項の寄附金（ふるさと納税の合計額）,
    "spouse": {"name": "配偶者の氏名", "birth": "生年月日 YYYY-MM-DD（和暦は西暦に直す）", "income": 配偶者の合計所得（書いてあれば）} または null,
    "dependents": [{"name": "扶養親族の氏名", "birth": "YYYY-MM-DD", "relation": "続柄", "note": "障害者・同居などの記載"}]
  },
  "notes": "迷った点があれば短く"
}

決まりごと:
- 第一表の「所得から差し引かれる金額」の各欄は、欄に書かれた金額をそのまま。空欄は null。
- 第二表の「保険料等の種類」「支払保険料等の計」から premiums と shaho_items を埋める。
- 「配偶者や親族に関する事項」から spouse と dependents を埋める。16歳未満の子も dependents に入れる。
- 写真が横向き・逆さまでも、そのまま読む。確定申告書でなければ doc_type を other にする。
TXT;

$tmp = $_FILES['file']['tmp_name'];
try {
    $out = claude_read_json($tmp, $kind === 'suii' ? $SUII : $SHINKOKU, 3500);
} catch (Throwable $e) {
    throttle_fail($tk, 30, 3600, 600);
    @unlink($tmp);
    fail($e->getMessage());
}
@unlink($tmp);
audit("furusato ocr $kind ok");
unset($out['usage']);
json_out(['ok' => true, 'kind' => $kind, 'year' => $year, 'data' => $out]);

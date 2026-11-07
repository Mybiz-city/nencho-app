<?php
// 控除証明書の写真 → 項目の読み取り（Claude API）
declare(strict_types=1);
require_once __DIR__ . '/common.php';

const CERT_PROMPT = <<<'TXT'
あなたは日本の年末調整の控除証明書を読み取る係です。写真に写っている証明書から、次のJSONだけを返してください。説明文は不要です。

{
  "doc_type": "life" | "jishin" | "kokumin_nenkin" | "kyosai" | "ideco" | "jutaku" | "other",
  "issuer": "発行した保険会社・団体の名前",
  "year": 対象年（西暦の数値。不明なら null）,
  "items": [
    {
      "category": "life" | "kaigo" | "nenkin" | "jishin" | "old_songai" | "kokumin_nenkin" | "kyosai" | "ideco" | "jutaku",
      "contract": "new" | "old" | "",
      "amount": 申告額（整数円）,
      "label": "証明書に書かれた区分の文字（例：一般生命保険料・新制度）",
      "start_date": "住宅ローンの居住開始年月日（YYYY-MM-DD）。住宅以外は空",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "notes": "読み取りで迷った点があれば短く"
}

決まりごと:
- 写真が横向き・逆さまでも、そのまま読む。
- 1枚の写真に複数の証明書（契約）が写っていれば、証券番号ごとに items を分ける。1契約に一般と介護医療の両方があれば、それも別の item にする。
- 「申告額（12月末までの払込見込額）」があればそれを amount にする。申告額が「***」「****」や空欄なら「証明額」を使う（払込停止・年払いなど）。
- 「新生命保険料控除制度」「新制度」「新契約」なら contract=new、「旧…」なら old。表示がなければ、契約日が2011年以前なら old、それ以外は new。介護医療は常に new。
- 共済（こくみん共済・JA共済など）は、生命共済の一般・介護医療を取り、損害保険（火災・傷害）の分は items に入れない。
- 地震保険は「控除対象保険料」の欄の金額。備考の「1回分保険料」や「一回分」は使わない。旧長期損害保険は category=old_songai。
- 国民年金の控除証明書は category=kokumin_nenkin。小規模企業共済は kyosai、iDeCo（個人型確定拠出年金）は ideco。
- 住宅ローンの年末残高証明書は category=jutaku、amount は年末残高（予定額）。
- year には証明書に書かれた対象年（「令和6年分」なら 2024）を入れる。
- 数字が読めない・写真が不鮮明なら confidence を low にし、amount は読めた範囲で入れる。
- 証明書でないもの（口座振替のお知らせ、契約内容の通知、レシートなど）が写っている場合は doc_type を other にし、items は空にする。
TXT;

/** 画像ファイル → 読み取り結果（配列）。失敗は例外 */
function claude_read_cert(string $imagePath): array {
    $c = cfg();
    if (empty($c['anthropic_api_key'])) throw new RuntimeException('AI読み取りは設定されていません');
    $mime = mime_content_type($imagePath) ?: 'image/jpeg';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) throw new RuntimeException('対応していない画像形式です');
    $b64 = base64_encode((string)file_get_contents($imagePath));
    $body = [
        'model' => $c['anthropic_model'],
        'max_tokens' => 1500,
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mime, 'data' => $b64]],
                ['type' => 'text', 'text' => CERT_PROMPT],
            ],
        ]],
    ];
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $c['anthropic_api_key'], 'anthropic-version: 2023-06-01'],
        CURLOPT_POSTFIELDS => json_encode($body),
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($res === false) throw new RuntimeException('通信に失敗しました: ' . $err);
    $j = json_decode((string)$res, true);
    if ($code !== 200) throw new RuntimeException('AIの応答エラー(' . $code . '): ' . ($j['error']['message'] ?? substr((string)$res, 0, 200)));
    $text = '';
    foreach ($j['content'] ?? [] as $blk) if (($blk['type'] ?? '') === 'text') $text .= $blk['text'];
    // JSON部分だけ取り出す
    if (preg_match('/\{.*\}/s', $text, $m)) $text = $m[0];
    $out = json_decode($text, true);
    if (!is_array($out)) throw new RuntimeException('読み取り結果を解釈できませんでした');
    $out['items'] = array_values(array_filter($out['items'] ?? [], fn($i) => is_array($i)));
    foreach ($out['items'] as &$it) { $it['amount'] = yen((string)($it['amount'] ?? 0)); $it['contract'] = $it['contract'] ?? ''; $it['confidence'] = $it['confidence'] ?? 'medium'; }
    $out['usage'] = $j['usage'] ?? null;
    return $out;
}

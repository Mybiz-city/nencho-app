// 控除証明書の写真 → 項目の読み取り（Claude API）
var CERT_PROMPT = "あなたは日本の年末調整の控除証明書を読み取る係です。写真に写っている証明書から、次のJSONだけを返してください。説明文は不要です。\n\n{\n  \"doc_type\": \"life\" | \"jishin\" | \"kokumin_nenkin\" | \"kyosai\" | \"ideco\" | \"jutaku\" | \"other\",\n  \"issuer\": \"発行した保険会社・団体の名前\",\n  \"year\": 対象年（西暦の数値。不明なら null）,\n  \"items\": [\n    {\n      \"category\": \"life\" | \"kaigo\" | \"nenkin\" | \"jishin\" | \"old_songai\" | \"kokumin_nenkin\" | \"kyosai\" | \"ideco\" | \"jutaku\",\n      \"contract\": \"new\" | \"old\" | \"\",\n      \"amount\": 申告額（整数円）,\n      \"label\": \"証明書に書かれた区分の文字（例：一般生命保険料・新制度）\",\n      \"start_date\": \"住宅ローンの居住開始年月日（YYYY-MM-DD）。住宅以外は空\",\n      \"confidence\": \"high\" | \"medium\" | \"low\"\n    }\n  ],\n  \"notes\": \"読み取りで迷った点があれば短く\"\n}\n\n決まりごと:\n- 写真が横向き・逆さまでも、そのまま読む。\n- 1枚の写真に複数の証明書（契約）が写っていれば、証券番号ごとに items を分ける。1契約に一般と介護医療の両方があれば、それも別の item にする。\n- 「申告額（12月末までの払込見込額）」があればそれを amount にする。申告額が「***」「****」や空欄なら「証明額」を使う（払込停止・年払いなど）。\n- 「新生命保険料控除制度」「新制度」「新契約」なら contract=new、「旧…」なら old。表示がなければ、契約日が2011年以前なら old、それ以外は new。介護医療は常に new。\n- 共済（こくみん共済・JA共済など）は、生命共済の一般・介護医療を取り、損害保険（火災・傷害）の分は items に入れない。\n- 地震保険は「控除対象保険料」の欄の金額。備考の「1回分保険料」や「一回分」は使わない。旧長期損害保険は category=old_songai。\n- 国民年金の控除証明書は category=kokumin_nenkin。小規模企業共済は kyosai、iDeCo（個人型確定拠出年金）は ideco。\n- 住宅ローンの年末残高証明書は category=jutaku、amount は年末残高（予定額）。\n- year には証明書に書かれた対象年（「令和6年分」なら 2024）を入れる。\n- 数字が読めない・写真が不鮮明なら confidence を low にし、amount は読めた範囲で入れる。\n- 証明書でないもの（口座振替のお知らせ、契約内容の通知、レシートなど）が写っている場合は doc_type を other にし、items は空にする。";
var TECHO_PROMPT = "写真は日本の障害者手帳（身体障害者手帳・療育手帳・精神障害者保健福祉手帳）または障害者控除に使う書類です。次のJSONだけを返してください。\n{\"techo\": {\"holder\": \"手帳の氏名\", \"type\": \"身体障害者手帳\" | \"療育手帳\" | \"精神障害者保健福祉手帳\" | \"その他\", \"grade\": \"等級（例：1級、A、2級）\", \"class\": \"種別（例：第1種）。無ければ空\", \"special\": true | false, \"confidence\": \"high\" | \"medium\" | \"low\"}}\nspecial は、特別障害者に当たる可能性（身体1級・2級、療育A、精神1級など）なら true。写真が手帳でなければ type を \"その他\" にする。";

/** 画像（base64, mime）→ 読み取り結果。失敗は例外 */
function claudeReadCert(b64, mime, kind) {
  var c = cfg();
  if (!c.anthropic_api_key) throw new Error('AI読み取りは設定されていません');
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(mime) < 0) throw new Error('対応していない画像形式です');
  var body = { model: c.anthropic_model, max_tokens: 1500, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
    { type: 'text', text: kind === 'techo' ? TECHO_PROMPT : CERT_PROMPT } ] }] };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'x-api-key': c.anthropic_api_key, 'anthropic-version': '2023-06-01' }, muteHttpExceptions: true });
  var code = res.getResponseCode(), txt = res.getContentText(); var j = {}; try { j = JSON.parse(txt); } catch (e) {}
  if (code !== 200) throw new Error('AIの応答エラー(' + code + '): ' + ((j.error && j.error.message) || txt.substr(0, 200)));
  var text = ''; (j.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
  var m = /\{[\s\S]*\}/.exec(text); if (m) text = m[0];
  var out; try { out = JSON.parse(text); } catch (e) { throw new Error('読み取り結果を解釈できませんでした'); }
  out.usage = j.usage || null;
  if (kind === 'techo') { out.items = []; return out; }
  out.items = (out.items || []).filter(function (i) { return i && typeof i === 'object'; });
  out.items.forEach(function (it) { it.amount = yen(it.amount); it.contract = it.contract || ''; it.confidence = it.confidence || 'medium'; });
  return out;
}

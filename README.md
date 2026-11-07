# メーティス 年末調整アプリ（v1）

従業員がスマホで1画面1問ずつ答え、控除証明書を撮って送り、前年との比較を見て提出する。
事務所は提出状況を見て、日本ICS（タイプ6・540列）の取込CSVを書き出す。

## フォルダの中身

| ファイル | 役割 |
|---|---|
| index.php | 従業員の画面（1画面1問） |
| api.php | 従業員画面の裏側（保存・写真・提出） |
| admin/index.php | 事務所の画面（前年CSV取込、提出状況、内容確認、CSV書き出し） |
| lib/common.php | 設定の読み込み、JSONの保存、和暦の変換 |
| lib/judge.php | 年齢区分・所得・扶養区分・配偶者区分の判定 |
| lib/ics.php | 日本ICSのCSVの読み込みと書き出し |
| lib/claude.php | 証明書の写真をAIで読む |
| lib/drive.php | Googleドライブへ写真と提出内容を保存（任意） |
| config.sample.php | 設定の見本。config.php にコピーして使う |

## さくらに置く手順（初回）

1. ファイルマネージャーで `www/metis` の中に `nencho` フォルダを作り、このZIPの中身をすべて上げる
   （`www/metis/nencho/index.php` になる形）
2. `config.sample.php` を同じ場所に `config.php` という名前でコピーし、次の3つを書き換える
   - `data_dir` → `/home/chosa/nencho_data`（www の外。ブラウザから見えない）
   - `admin_password` → 事務所画面のパスワード（長めに）
   - `anthropic_api_key` → Claude APIのキー（空なら読み取りなしで、金額は本人が手入力）
3. ブラウザで `https://metis.tax/nencho/admin/` を開き、パスワードでログイン
4. 「前年CSVの取り込み」で、顧問先コード4桁と日本ICSのCSVを選んで取り込む
   → 一覧に登録コード（10桁の数字。例 `0302000001`）が出る。これを従業員にLINEなどで送る
5. 従業員は `https://metis.tax/nencho/` を開き、登録コードを入れて始める

前年データのない人（新入社員）は、事務所画面の「前年データのない人を追加」で個人コードを決めて作る。
番号は先に日本ICSで登録して、同じ番号を使う。

## LINEから開く（LIFF）

1. LINE Developers で年末調整用の公式アカウントの「LINEログイン」チャネルを作り、LIFFアプリを追加
   - エンドポイントURL：`https://metis.tax/nencho/`
   - サイズ：Full
   - スコープ：profile
2. できた LIFF ID を `config.php` の `liff_id` に入れる
3. 公式アカウントのリッチメニューに `https://liff.line.me/（LIFF ID）` を登録

初回だけ登録コードを入れると、LINEのIDと結びつき、2回目からはコード入力なしで開く。

## Googleドライブに保存する（任意）

1. Google Cloud でサービスアカウントを作り、JSONの鍵を落とす
2. 鍵ファイルを `/home/chosa/nencho_data/sa.json` に置く（www の外）
3. 保存先のフォルダ（work@metis.tax のドライブ）を、サービスアカウントのメールアドレスに「編集者」で共有
4. `config.php` の `drive_service_account_json` に鍵のパス、`drive_root_folder_id` にフォルダのID（URLの末尾）を入れる

保存先の形：`保存先フォルダ／顧問先コード／年／個人コード／写真…、submitted.json`

## 日本ICSへの取込

事務所画面の「提出済みをCSVで出す」→ 日本ICSの 給与マスター表形式処理 → データ取込 → タイプ6 で読む。
初回は1人だけで試し、画面で区分（本人区分・配偶者区分・扶養親族区分）が正しく入ったか確かめる。

## 年が変わったら

`config.php` の `year` と `tax`（所得の計算に使う数字）と `deadline_text` を直す。
`data_dir` の中は年ごとに分かれるので、前年のデータは残る。

## データの置き方

- 入力途中・提出済み：`data_dir/顧問先/年/個人コード/answers.json`
- 前年：同じ場所の `prev.json`
- 写真：同じ場所の `photos/`
- LINEのIDと登録コードの対応：`data_dir/_line_map.json`

年末調整が終わったら、`data_dir` の中身をドライブに移して、さくらからは消す運用を勧める。

## 判定の数字（令和8年分）

`config.php` の `tax` にまとめてある。ご案内の数字に合わせてある。

| 項目 | 値 |
|---|---|
| 給与所得控除の最低額 | 74万円（年収219万円未満は 年収−74万円） |
| 扶養・配偶者控除の所得上限 | 62万円（年収136万円） |
| 配偶者特別控除の所得上限 | 133万円（年収207万円） |
| 特定親族特別控除の所得上限 | 123万円（年収197万円） |
| 年金の控除 | 65歳以上 110万円、65歳未満 60万円 |

控除額そのもの（特定親族特別控除額など）はアプリでは計算しない。年調ソフトに任せる。

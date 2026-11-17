#!/usr/bin/env python3
# 使い方のページ（docs/manual-company.html・docs/manual-emp.html）を作る。文面を直すときはこのファイルを直して実行する。架空の名前・番号だけを使う
import os
CSS = '''
:root{--c:#00A88E;--cd:#007A67;--cl:#E3F4F0;--y:#FFF8E1;--yb:#F2B705;--r:#C8372D}
*{box-sizing:border-box}
body{font-family:"BIZ UDPGothic","Hiragino Sans","Yu Gothic",sans-serif;margin:0;background:#f4f6f5;color:#222;font-size:16px;line-height:1.75}
header{background:var(--cd);color:#fff;padding:14px 16px}header b{font-size:19px}header small{opacity:.9}
.wrap{max-width:720px;margin:0 auto;padding:14px}
.card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{margin:0 0 10px;font-size:18px;color:var(--cd);display:flex;align-items:center;gap:8px}
h2 .n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:16px}
h3{font-size:16px;margin:14px 0 4px}
p{margin:6px 0}ul,ol{margin:6px 0;padding-left:22px}li{margin:3px 0}
.note{color:#666;font-size:13.5px}
.toc{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.toc a{display:block;background:var(--cl);color:var(--cd);text-decoration:none;border-radius:10px;padding:9px 10px;font-size:14.5px;font-weight:700}
@media(max-width:480px){.toc{grid-template-columns:1fr}.flow{display:grid;grid-template-columns:1fr 1fr}.flow .a{display:none}}
.flow{display:flex;gap:6px;align-items:stretch;margin:10px 0;flex-wrap:wrap}
.flow .b{flex:1 1 0;min-width:92px;background:var(--cl);border-radius:10px;padding:10px 6px;text-align:center;font-size:14px;font-weight:700;color:var(--cd)}
.flow .b small{display:block;font-weight:400;color:#444;font-size:12px;line-height:1.4;margin-top:2px}
.flow .a{flex:none;align-self:center;color:var(--c);font-weight:700}
.warn{background:var(--y);border-left:4px solid var(--yb);border-radius:6px;padding:9px 12px;margin:10px 0;font-size:15px}
.ng{background:#fdecea;border-left:4px solid var(--r);border-radius:6px;padding:9px 12px;margin:10px 0;font-size:15px}
/* 画面の見本 */
.scr{border:2px solid #cfd8d5;border-radius:14px;background:#f4f6f5;padding:10px;margin:10px 0;font-size:14px;line-height:1.5}
.scr .cap{font-size:12px;color:#777;margin:-2px 0 6px}
.scr .in{background:#fff;border-radius:10px;padding:10px}
.scr .ttl{color:var(--cd);font-weight:700;margin-bottom:4px}
.btn{display:inline-block;background:var(--c);color:#fff;border-radius:8px;padding:4px 10px;font-size:13px;font-weight:700;white-space:nowrap}
.btn.g{background:#888}.btn.l{background:#06C755}.btn.r{background:var(--r)}.btn.w{background:#fff;color:#333;border:1px solid #bbb}
.pill{display:inline-block;background:var(--c);color:#fff;border-radius:999px;padding:1px 10px;font-size:12px;font-weight:700}.pill.r{background:var(--r)}
.fld{display:inline-block;border:1px solid #bbb;border-radius:8px;padding:3px 8px;background:#fff;min-width:40px;color:#555;font-size:13px}
.big{font-family:monospace;font-size:20px;letter-spacing:.12em;border:1px solid #bbb;border-radius:8px;padding:4px 10px;background:#fff;display:inline-block}
.pin{font-family:monospace;font-size:16px;letter-spacing:.15em;background:var(--cl);padding:1px 8px;border-radius:6px}
.box{border:1px solid #cfe5df;background:#F6FBFA;border-radius:10px;padding:8px;margin-top:6px}
.st{float:right;color:#666;font-size:12px}
.pt{display:flex;gap:10px;margin:8px 0}.pt .k{flex:none;width:26px;height:26px;border-radius:50%;background:var(--cl);color:var(--cd);font-weight:700;display:flex;align-items:center;justify-content:center;font-size:14px;margin-top:2px}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:8px 0}th,td{border:1px solid #dde5e2;padding:7px 8px;text-align:left;vertical-align:top}th{background:var(--cl);color:var(--cd);white-space:nowrap}
details{border-top:1px solid #eee;padding:8px 0}details:first-of-type{border-top:0}summary{cursor:pointer;font-weight:700;color:var(--cd)}
.ox{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.ox div{border-radius:10px;padding:10px;font-size:14px}.ox .o{background:var(--cl)}.ox .x{background:#fdecea}.ox b{font-size:20px;display:block}
footer{text-align:center;color:#777;font-size:12.5px;padding:8px 14px 30px}
.top{position:fixed;right:12px;bottom:14px;background:var(--cd);color:#fff;text-decoration:none;border-radius:999px;padding:8px 14px;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
@media print{.top{display:none}body{background:#fff}.card{box-shadow:none;border:1px solid #ddd;break-inside:avoid}}
'''
def page(title, sub, body):
    return f'''<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>{title}</title><style>{CSS}</style></head><body id="top">
<header><b>{title}</b><br><small>{sub}</small></header>
<div class="wrap">
{body}
</div>
<footer>※この使い方に出てくる会社名・氏名・番号はすべて架空のものです。<br>メーティス税理士法人</footer>
<a class="top" href="#top">↑ 上へ</a>
</body></html>'''
def h(n,t,i): return f'<h2 id="{i}"><span class="n">{n}</span>{t}</h2>'

company = f'''
<div class="card"><p style="margin-top:0">このページは、会社用ページ（在籍者の確認）の使い方です。していただくことは3つです。</p>
<div class="flow"><div class="b">① 確かめる<small>退職した人・<br>入社日</small></div><div class="a">→</div><div class="b">② 足す<small>一覧に<br>いない人</small></div><div class="a">→</div><div class="b">③ 送る<small>1人ずつ<br>LINEで案内</small></div></div>
<p class="note">従業員の生年月日・住所・家族・保険料は、本人がスマホで入力します。会社で入れる必要はありません。</p>
<div class="toc"><a href="#s1">1 最初に番号を決める</a><a href="#s2">2 在籍者を確かめる</a><a href="#s3">3 いない人を足す</a><a href="#s4">4 案内を送る</a><a href="#s5">5 進み具合を見る</a><a href="#s6">6 案内文を変える</a><a href="#s7">7 CSVでまとめて直す</a><a href="#s8">8 こんなときは</a></div></div>

<div class="card">{h(1,'最初に番号を決める','s1')}
<p>事務所から届いたURLを開くと、最初に<b>数字6桁の番号</b>を決める画面が出ます。このページには従業員の登録コードと暗証番号が並ぶため、URLがほかの人に渡っても開かないようにする番号です。</p>
<div class="scr"><div class="cap">画面の見本</div><div class="in"><div class="ttl">最初に番号を決めてください</div><span class="big">●●●●●●</span>　<span class="big">●●●●●●</span><br><span class="btn" style="margin-top:8px">この番号に決める</span></div></div>
<ul><li>同じ番号を2回入れて「この番号に決める」を押します</li><li>同じ数字が6つ並ぶ番号や 123456 は使えません</li><li>決めた端末では、次から番号を聞かれません</li><li>別のスマホやパソコンで開くと、決めた番号を聞かれます</li></ul>
<div class="warn">番号を忘れたとき、間違いが続いてページが止まったときは、事務所にご連絡ください。事務所で白紙に戻すと、もう一度決め直せます。</div>
<p class="note">URLは発行から90日で使えなくなります。URLをメールやLINEで社外の人に転送しないでください。</p></div>

<div class="card">{h(2,'在籍者を確かめる','s2')}
<p>「従業員の一覧」に、今年の年末調整の対象者が並んでいます。1人ずつ見て、次の2つを直します。</p>
<div class="scr"><div class="cap">画面の見本（1人分）</div><div class="in"><b>山田 太郎</b> <span class="pill">在籍 ▾</span><span class="st">未入力</span><br>入社日 <span class="fld">2022年（令4）</span> <span class="fld">4月</span> <span class="fld">1日</span><br><span class="btn" style="margin-top:6px">保存</span>
<div class="box">登録コード <b>9999000001</b>　暗証番号 <span class="pin">482913</span> <span class="btn g">再発行</span><br><span class="btn l" style="margin-top:6px">プレビューしてLINEで送信</span> <span class="btn w">確認せずLINEで送信</span> <span class="btn g">案内文をコピー</span></div></div></div>
<div class="pt"><div class="k">A</div><div><b>退職した方</b><br>緑の「在籍」を押して「退職」に変える → 退職日を選ぶ → 「保存」。退職した方には案内を送るボタンが出なくなります。</div></div>
<div class="pt"><div class="k">B</div><div><b>入社日が空欄の方</b><br>年・月・日を選んで「保存」。日が分からなければ、年と月だけで保存できます。</div></div>
<div class="warn">年の途中で退職した方は、この会社の年末調整の対象外です。必ず「退職」にしてください。</div></div>

<div class="card">{h(3,'いない人を足す','s3')}
<p>今年入社した方など、一覧にいない方は「一覧にない従業員を追加する」から足します。</p>
<div class="scr"><div class="cap">画面の見本</div><div class="in"><div class="ttl">一覧にない従業員を追加する</div>氏名 <span class="fld">佐藤 次郎</span>　フリガナ <span class="fld">サトウ ジロウ</span><br>入社日 <span class="fld">2026年（令8）</span> <span class="fld">9月</span> <span class="fld">日</span><br><span class="btn" style="margin-top:6px">追加する</span></div></div>
<ul><li>入れるのは、氏名・フリガナ・入社日（年と月）の3つです</li><li>姓と名の間に空白を入れてください</li><li>追加すると、その方の登録コードと暗証番号がすぐ一覧に出ます</li><li>追加した方には「氏名を直す」「削除」のボタンが出ます。入れ間違えたときに使います</li></ul>
<p class="note">前から一覧にいる方は削除できません。退職した方は「退職」にしてください。</p></div>

<div class="card">{h(4,'案内を送る','s4')}
<p>案内文は、その方専用の<b>入力ページのリンク</b>と、<b>登録コード</b>・<b>暗証番号</b>を伝える文です。リンクを押すだけでその方の入力画面に入れるため、送り方に決まりがあります。</p>
<div class="ox"><div class="o"><b>○</b>本人との1対1のトークに送る</div><div class="x"><b>×</b>グループLINEに送る・ほかの人に頼んで転送する</div></div>
<p>各人の欄に、送るためのボタンが3つあります。</p>
<table><tr><th>ボタン</th><th>動き</th></tr>
<tr><td>プレビューしてLINEで送信</td><td>送る文を画面で確かめてから「LINEで送信」を押す。初めて送るとき、案内文を変えたあとに</td></tr>
<tr><td>確認せずLINEで送信</td><td>文を見ずに、すぐLINEが開く。続けて何人にも送るときに</td></tr>
<tr><td>案内文をコピー</td><td>文をコピーする。メールなど、LINE以外で送るときに貼り付ける</td></tr></table>
<p>LINEが開いたら、送り先に<b>本人</b>を選び、送信します。</p>
<p>送った方には「送信済み ✓」の印が付きます。この印は、送った端末だけに出ます。</p>
<div class="warn"><b>送り先を間違えたとき・本人がスマホを替えたとき</b><br>その方の「再発行」を押してください。暗証番号が新しくなり、前の番号は使えなくなります。新しい番号で、もう一度本人に送ります。</div></div>

<div class="card">{h(5,'進み具合を見る','s5')}
<p>名前の右に、その方の進み具合が出ます。</p>
<table><tr><th>表示</th><th>意味</th></tr><tr><td>未入力</td><td>まだ始めていない</td></tr><tr><td>入力中</td><td>途中まで入れている</td></tr><tr><td>入力済み</td><td>提出まで終わった</td></tr><tr><td>スマホ登録 1台</td><td>本人が暗証番号を使って入った（案内が届いている）</td></tr></table>
<p>期限が近いのに「未入力」の方には、声をかけてください。入力した中身（家族・保険料など）は、このページには出ません。</p></div>

<div class="card">{h(6,'案内文を変える','s6')}
<p>「案内文を編集する」を開くと、あいさつ文などを足せます。</p>
<ul><li>｛ ｝で囲んだ5つの言葉は、送るときにその方の内容に置き換わります<br><b>{{氏名}}　{{URL}}　{{登録コード}}　{{暗証番号}}　{{期限}}</b></li><li>{{URL}}・{{登録コード}}・{{暗証番号}} を消すと、従業員が入力を始められません</li><li>「元の文に戻す」で、最初の文に戻せます</li></ul></div>

<div class="card">{h(7,'CSVでまとめて直す','s7')}
<p class="note">表計算ソフト（Excelなど）に慣れた方向けです。人数が少なければ使わなくて構いません。</p>
<p>一番下の「人数が多い場合：CSVで出す・読み込む」を開きます。</p>
<ol><li>「<b>いまの名簿をCSVで出す</b>」を押す。社員番号・氏名・フリガナ・入社日・退職日の表が保存されます</li><li>Excelで開いて、入社日・退職日を入れる。新しい方は行を足す</li><li><b>CSVのまま</b>保存して、「ファイルを選択」→「<b>読み込む</b>」</li></ol>
<table><tr><th>入れ方</th><th>読み込んだ結果</th></tr><tr><td>退職日を入れる</td><td>その方が「退職」になる</td></tr><tr><td>空欄のまま</td><td>何も変えない</td></tr><tr><td>行を足す（氏名は必須）</td><td>その方が追加される</td></tr></table>
<p class="note">このCSVに、登録コードと暗証番号は入りません。氏名や入社日が入るので、保存した場所に気をつけてください。</p></div>

<div class="card">{h(8,'こんなときは','s8')}
<details><summary>「このページは開けません」と出る</summary><p>URLが途中で切れているか、発行から90日を過ぎています。事務所から届いたURLをそのまま開いてください。開けなければ事務所にご連絡ください。</p></details>
<details><summary>社長用の番号を忘れた</summary><p>事務所にご連絡ください。番号を白紙に戻します。次にページを開いたときに、決め直せます。</p></details>
<details><summary>従業員から「暗証番号が違うと言われる」と聞かれた</summary><p>一覧でその方の暗証番号を確かめてください。「再発行」を押したあとは、前の番号は使えません。新しい番号を送り直します。</p></details>
<details><summary>従業員がスマホを持っていない</summary><p>会社のパソコンやタブレットでも入力できます。本人が入力し終わったら、右上の「…」から「ログアウト」をしてもらってください。</p></details>
<details><summary>パートやアルバイトも対象か</summary><p>12月の給与を支払う時点で在籍していて、扶養控除等申告書をこの会社に出している方が対象です。判断に迷う方は事務所にお尋ねください。</p></details>
<details><summary>入力の中身を会社で見たい</summary><p>このページには出ません。年末調整が終わったあと、事務所から結果をお渡しします。</p></details>
</div>
'''

emp = f'''
<div class="card"><p style="margin-top:0">スマホで年末調整の内容を入力するアプリの使い方です。時間の目安は<b>10分ほど</b>です。途中で閉じても、続きから再開できます。</p>
<div class="flow"><div class="b">① 入る<small>届いたリンクを<br>押す</small></div><div class="a">→</div><div class="b">② 答える<small>本人・配偶者・<br>家族</small></div><div class="a">→</div><div class="b">③ 撮る<small>保険の<br>証明書</small></div><div class="a">→</div><div class="b">④ 提出<small>内容を見て<br>ボタンを押す</small></div></div>
<div class="toc"><a href="#s1">1 用意するもの</a><a href="#s2">2 入り方</a><a href="#s3">3 質問に答える</a><a href="#s4">4 証明書を撮る</a><a href="#s5">5 提出する</a><a href="#s6">6 途中でやめる・直す</a><a href="#s7">7 こんなときは</a></div></div>

<div class="card">{h(1,'用意するもの','s1')}
<table><tr><th>もの</th><th>だれが要るか</th></tr>
<tr><td>会社から届いた案内（入力ページのリンク）</td><td>全員</td></tr>
<tr><td>生命保険・医療保険・個人年金の控除証明書</td><td>入っている方</td></tr>
<tr><td>地震保険の控除証明書</td><td>入っている方</td></tr>
<tr><td>国民年金・国民健康保険を自分で払った分の金額</td><td>払った方（国民年金は証明書も）</td></tr>
<tr><td>iDeCo・小規模企業共済の払込証明書</td><td>入っている方</td></tr>
<tr><td>住宅ローン控除の申告書と、年末残高の証明書</td><td>控除が2年目以降の方</td></tr>
<tr><td>配偶者・家族の今年の収入の見込み</td><td>扶養する家族がいる方</td></tr>
<tr><td>前の勤務先の源泉徴収票</td><td>今年、転職して入社した方</td></tr></table>
<p class="note">証明書は10月〜11月ごろに、保険会社などからハガキや封書で届きます。まだ届いていないものは、届いてからで構いません。</p></div>

<div class="card">{h(2,'入り方','s2')}
<ol><li>会社から届いた案内の「<b>入力ページ</b>」のリンクを押す</li><li>「はじめに」を読んで「<b>同意して始める</b>」を押す</li></ol>
<p>リンクには、あなた専用の番号が入っています。番号を打つ必要はありません。</p>
<h3>番号を聞かれたとき</h3>
<p>パソコンで開いたとき、リンクが途中で切れたときは、番号を入れる画面が出ます。案内に書いてある<b>登録コード</b>（数字10桁）と<b>暗証番号</b>（数字6桁）を入れてください。</p>
<div class="scr"><div class="cap">画面の見本（番号を聞かれたとき）</div><div class="in" style="text-align:center"><div class="ttl" style="text-align:left">登録コードを入力</div><span class="big">9999000001</span><br><span style="font-size:12px;color:#666">暗証番号（会社から渡された6桁）</span><br><span class="big">482913</span></div></div>
<ul><li>一度入ったスマホは、その後3日間はそのまま開けます</li><li>3日を過ぎたら、同じリンクをもう一度押します</li></ul>
<div class="warn">届いた案内は、ほかの人に見せたり転送したりしないでください。リンクを押すだけで、あなたの入力画面に入れます。</div></div>

<div class="card">{h(3,'質問に答える','s3')}
<p>1画面に1つずつ質問が出ます。選ぶか入力して「<b>次へ</b>」を押します。「戻る」で前の質問に戻れます。</p>
<table><tr><th>順番</th><th>聞かれること</th></tr>
<tr><td>本人</td><td>氏名・住所、世帯主、今年の給与の見込み、給与以外の収入、ほかの勤務先、障害・寡婦・ひとり親・勤労学生、今年1月からの在籍</td></tr>
<tr><td>配偶者</td><td>いるかどうか、氏名・生年月日、今年の収入</td></tr>
<tr><td>家族</td><td>扶養する家族を1人ずつ（16歳未満のお子さんも入れます）、今年の収入</td></tr>
<tr><td>保険料</td><td>証明書の写真、自分で払った社会保険料</td></tr>
<tr><td>確認</td><td>前年との違いを見て、提出</td></tr></table>
<div class="scr"><div class="cap">画面の見本（前年の登録がある方）</div><div class="in"><div class="ttl">ご本人の情報</div><div style="background:var(--cl);border-radius:8px;padding:6px 8px;font-size:13px"><b>前年の登録</b><br>山田 太郎<br>〒590-0000 大阪府泉南郡サンプル町1-2-3</div>氏名・フリガナ・性別・住所に変わりはありませんか？<br><span class="btn w" style="margin-top:6px">変わりない</span> <span class="btn w">変わった</span></div></div>
<ul><li>前年の登録がある方は、変わっていなければ「変わりない」を選ぶだけです</li><li>前年の登録がない方（今年入社した方など）は、氏名・フリガナ・性別・生年月日・住所を入力します</li><li>住所は、<b>来年1月1日に住んでいる所</b>を入れます</li><li>収入は<b>見込み</b>で構いません。1月から12月までに受け取る合計です</li></ul>
<p class="note">給与以外の収入の金額が自分で分からない方は、その旨を選べます。その場合は、ご自身で確定申告をしていただくことがあります。</p></div>

<div class="card">{h(4,'証明書を撮る','s4')}
<p>「証明書はありますか？」に「ある」と答えると、カメラで撮る画面になります。<b>1枚ずつ</b>撮ってください。</p>
<div class="ox"><div class="o"><b>○</b>証明書の全体が入っている／明るい所で、文字が読める</div><div class="x"><b>×</b>端が切れている／影や光の反射で文字が読めない／2枚を重ねて撮る</div></div>
<ul><li>撮ると、保険会社の名前や金額を自動で読み取ります。<b>読み取った内容が証明書と合っているか</b>を見て、違っていれば直してください</li><li>自動で読み取れなかったときは、金額を自分で入力します</li><li>入れる金額は、証明書に書かれた<b>支払った保険料</b>（年間）です</li><li>撮り直したいときは、その写真を消して、もう一度撮れます</li></ul>
<div class="warn">証明書の原本は、会社から指示があるまで捨てずに取っておいてください。</div></div>

<div class="card">{h(5,'提出する','s5')}
<ol><li>最後に「内容の確認」の画面が出ます。前年と今年が並び、変わった所に印が付きます</li><li>内容を見て、合っていれば「<b>この内容で提出する</b>」を押す</li><li>「提出が完了しました」と出れば終わりです</li></ol>
<p class="note">入力した内容と写真は、メーティス税理士法人が年末調整の計算に使い、お勤め先の会社に渡します。それ以外の目的には使いません。</p></div>

<div class="card">{h(6,'途中でやめる・直す','s6')}
<table><tr><th>したいこと</th><th>やり方</th></tr>
<tr><td>途中でやめる</td><td>そのまま閉じて構いません。入力は自動で保存されます。次に開くと続きから始まります</td></tr>
<tr><td>提出したあとで直す</td><td>もう一度開いて、直したい質問まで進んで直し、最後にもう一度「この内容で提出する」を押します</td></tr>
<tr><td>最初の質問に戻る</td><td>右上の「…」→「最初の画面に戻る」。入力は残ります</td></tr>
<tr><td>全部消してやり直す</td><td>右上の「…」→「今年の入力をすべて消してやり直す」。写真も消えます</td></tr>
<tr><td>家族や会社のスマホ・パソコンで入力した</td><td>終わったら右上の「…」→「ログアウト」。次に開く人に中身が見えなくなります</td></tr></table></div>

<div class="card">{h(7,'こんなときは','s7')}
<details><summary>「このリンクの暗証番号は使えなくなっています」「暗証番号が違う」と出る</summary><p>会社が番号を作り直すと、前の案内のリンクと番号は使えなくなります。会社から届いた一番新しい案内のリンクを押してください。届いていなければ、会社に案内の送り直しを頼んでください。</p></details>
<details><summary>スマホを替えた</summary><p>新しいスマホで、同じ案内のリンクを押せば続きから入力できます。入れないときは、会社に暗証番号の再発行を頼んでください。</p></details>
<details><summary>家族の収入が分からない</summary><p>本人に聞いて、1月から12月までの見込みを入れてください。パートやアルバイトの方は、給与明細の「総支給額」の合計が目安です。16歳未満のお子さんは入力不要です。</p></details>
<details><summary>証明書がまだ届いていない</summary><p>届いている分だけ先に入れて、提出まで進めて構いません。届いたら、もう一度開いて写真を足し、再度「この内容で提出する」を押します。</p></details>
<details><summary>証明書をなくした</summary><p>保険会社などに再発行を頼んでください。再発行が期限に間に合わないときは、会社にご相談ください。</p></details>
<details><summary>「退職された方は対象外です」と出る</summary><p>年の途中で退職した方は、この会社の年末調整の対象になりません。会社から届く源泉徴収票をもとに、ご自身で確定申告をしてください。心当たりがなければ会社にお尋ねください。</p></details>
<details><summary>画面が進まない・動かない</summary><p>電波の良い所で、ページを開き直してください。入力した所までは保存されています。</p></details>
</div>
'''
out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'docs')
open(os.path.join(out,'manual-company.html'),'w',encoding='utf-8').write(page('会社用ページの使い方','年末調整　経営者・ご担当者さま向け',company))
open(os.path.join(out,'manual-emp.html'),'w',encoding='utf-8').write(page('年末調整アプリの使い方','従業員のみなさま向け',emp))
print('ok')

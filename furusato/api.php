<?php
// ふるさと納税シミュレーションの裏側
// a=nencho : 年末調整アプリにログイン中の本人の入力を、シミュレーションの欄の形に詰め替えて返す
//            （ログインしていなければ ok:false。画面は手入力に切り替わる）
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/common.php';
require_once dirname(__DIR__) . '/lib/judge.php';

secure_session('nencho_emp', 28800);
$action = $_GET['a'] ?? '';

switch ($action) {
    case 'nencho':
        if (empty($_SESSION['client']) || empty($_SESSION['emp'])) json_out(['ok' => false, 'error' => '年末調整アプリにログインしていません']);
        $r = load_record($_SESSION['client'], $_SESSION['emp']);
        $c = compute($r);
        $a = $r['answers'];

        // 本人の収入
        $salary = yen((string)($a['salary'] ?? 0));
        $pension = 0; $other = 0;
        foreach ($a['other_incomes'] ?? [] as $oi) {
            $amt = yen((string)($oi['amount'] ?? 0));
            if (($oi['type'] ?? '') === 'pension') $pension += $amt;
            elseif (($oi['type'] ?? '') === 'salary') $salary += $amt;
            else $other += $amt; // 事業・不動産・その他は「所得」で聞いている
        }
        $age = $c['self_age'] ?? null;

        // 証明書（本人が確認済みのものだけ）を区分ごとに合計
        $sum = [];
        foreach ($r['certs'] ?? [] as $ct) {
            if (($ct['kind'] ?? '') !== 'cert' || ($ct['status'] ?? '') === 'deleted') continue;
            foreach ($ct['items'] ?? [] as $it) {
                $k = ($it['category'] ?? '') . (($it['contract'] ?? '') === 'old' ? '_old' : '');
                $sum[$k] = ($sum[$k] ?? 0) + yen((string)($it['amount'] ?? 0));
            }
        }
        $certsRead = !empty($sum);

        // 自分で払った社会保険料
        $sh = ['kokuho' => 0, 'nenkin' => 0, 'etc' => 0];
        foreach ($a['shaho'] ?? [] as $row) {
            $amt = yen((string)($row['amount'] ?? 0));
            if (($row['type'] ?? '') === 'kokumin_nenkin') $sh['nenkin'] += $amt;
            elseif (in_array($row['type'] ?? '', ['kokuho', 'kaigo'], true)) $sh['kokuho'] += $amt;
            else $sh['etc'] += $amt;
        }
        if ($sh['nenkin'] === 0 && !empty($sum['kokumin_nenkin'])) $sh['nenkin'] = $sum['kokumin_nenkin'];

        // 配偶者
        $spouseIncome = null; $spouseOver70 = false;
        if (($a['has_spouse'] ?? 'no') === 'yes' && !empty($c['spouse'])) {
            $spouseIncome = (int)($c['spouse']['income']['total_income'] ?? 0);
            $spouseOver70 = (int)($c['spouse']['age'] ?? 0) >= 70;
        }

        // 扶養親族（本人の扶養に入る人だけ）と障害者
        $dep = ['ippan' => 0, 'tokutei' => 0, 'rojin' => 0, 'doukyo' => 0];
        $per = ['shogai' => 0, 'tokubetsu' => 0, 'doukyoTokubetsu' => 0, 'kafu' => 0, 'hitorioya' => 0, 'gakusei' => 0];
        $adjust = !empty($c['adjust']);
        $spr = []; // 特定親族特別控除の対象者の所得
        foreach ($c['family'] ?? [] as $f) {
            $cls = $f['class'] ?? '';
            if ($cls === '特定親族') $spr[] = (int)($f['income']['total_income'] ?? 0);
            if ($cls === '一般') $dep['ippan']++; elseif ($cls === '特定') $dep['tokutei']++; elseif ($cls === '老人') $dep['rojin']++; elseif ($cls === '同老') $dep['doukyo']++;
            if (in_array($cls, ['一般', '特定', '老人', '同老', '年少', '特定親族'], true)) {
                $d = $f['disability'] ?? 'none';
                if ($d === 'general') $per['shogai']++; elseif ($d === 'special') $per['tokubetsu']++; elseif ($d === 'special_together') $per['doukyoTokubetsu']++;
            }
        }
        $sp = $a['spouse'] ?? [];
        if ($spouseIncome !== null && $spouseIncome <= 580000) {
            $d = $sp['disability'] ?? 'none';
            if ($d === 'general') $per['shogai']++; elseif ($d === 'special') $per['tokubetsu']++; elseif ($d === 'special_together') $per['doukyoTokubetsu']++;
        }
        $sf = $a['self_flags'] ?? [];
        if (($sf['disability'] ?? 'none') === 'general') $per['shogai']++; elseif (($sf['disability'] ?? '') === 'special') $per['tokubetsu']++;
        if (!empty($sf['kafu'])) $per['kafu'] = 1;
        if (!empty($sf['hitorioya'])) $per['hitorioya'] = 1;
        if (!empty($sf['student'])) $per['gakusei'] = 1;

        $name = $a['name'] ?? ((($r['prev']['sei'] ?? '') . ' ' . ($r['prev']['mei'] ?? '')));
        json_out(['ok' => true, 'year' => (int)cfg()['year'], 'name' => trim((string)$name), 'certs_read' => $certsRead, 'submitted' => ($r['status'] ?? '') === 'submitted',
            'inputs' => [
                'salary' => $salary, 'pension' => $pension, 'over65' => $age !== null && $age >= 65, 'otherIncome' => $other, 'adjustApplies' => $adjust,
                'shaho' => ['kyuyo' => null, 'kokuho' => $sh['kokuho'], 'nenkin' => $sh['nenkin'], 'etc' => $sh['etc']], // 給与天引きは画面で 年収×15.5% を初期値にする
                'kyosai' => ($sum['kyosai'] ?? 0) + ($sum['ideco'] ?? 0),
                'life' => ['new' => $sum['life'] ?? 0, 'old' => $sum['life_old'] ?? 0, 'care' => $sum['kaigo'] ?? 0, 'pnew' => $sum['nenkin'] ?? 0, 'pold' => $sum['nenkin_old'] ?? 0],
                'jishin' => $sum['jishin'] ?? 0, 'oldLong' => $sum['old_songai'] ?? 0,
                'spouseIncome' => $spouseIncome, 'spouseOver70' => $spouseOver70,
                'dependents' => $dep, 'specialRelatives' => $spr, 'personal' => $per,
                'loanBalance' => $sum['jutaku'] ?? 0,
            ]]);

    default:
        fail('不明な操作', 404);
}

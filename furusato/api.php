<?php
// ふるさと納税シミュレーションの裏側
// a=nencho : 年末調整アプリにログイン中の本人の入力を、シミュレーションの欄の形に詰め替えて返す
//            （ログインしていなければ ok:false。画面は手入力に切り替わる）
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/common.php';

secure_session('nencho_emp', 28800);
$action = $_GET['a'] ?? '';

switch ($action) {
    case 'nencho':
        if (empty($_SESSION['client']) || empty($_SESSION['emp'])) json_out(['ok' => false, 'error' => '年末調整アプリにログインしていません']);
        $r = load_record($_SESSION['client'], $_SESSION['emp']);
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

        // ---- ここから先の判定は年調アプリの設定（ご案内の数字）を使わず、法令の数字で判定する ----
        // 給与所得控除 最低65万、扶養・配偶者の所得要件 58万、特定親族 58万超〜123万
        $fuAge = function (?string $iso) use ($r): ?int { if (!$iso) return null; [$y, $m, $d] = array_map('intval', explode('-', $iso)); return (int)cfg()['year'] - $y; };
        $fuSalary = function (int $g): int { if ($g <= 0) return 0; $ded = $g <= 1900000 ? 650000 : ($g <= 3600000 ? $g * 0.3 + 80000 : ($g <= 6600000 ? $g * 0.2 + 440000 : ($g <= 8500000 ? $g * 0.1 + 1100000 : 1950000))); return (int)max(0, $g - $ded); };
        $fuPension = function (int $p, bool $over65): int { if ($p <= 0) return 0; if ($over65) { if ($p < 3300000) return max(0, $p - 1100000); } else { if ($p < 1300000) return max(0, $p - 600000); } if ($p < 4100000) return (int)($p * 0.75 - 275000); if ($p < 7700000) return (int)($p * 0.85 - 685000); if ($p < 10000000) return (int)($p * 0.95 - 1455000); return $p - 1955000; };
        $fuIncome = function (array $incomes, ?int $age) use ($fuSalary, $fuPension): int { $sal = 0; $pen = 0; $oth = 0; foreach ($incomes as $i) { $amt = yen((string)($i['amount'] ?? 0)); $t = $i['type'] ?? 'salary'; if ($t === 'salary') $sal += $amt; elseif ($t === 'pension') $pen += $amt; else $oth += $amt; } return $fuSalary($sal) + $fuPension($pen, $age !== null && $age >= 65) + $oth; };

        // 配偶者
        $spouseIncome = null; $spouseOver70 = false;
        if (($a['has_spouse'] ?? 'no') === 'yes' && !empty($a['spouse'])) {
            $spAge = $fuAge($a['spouse']['birth'] ?? null);
            $spouseIncome = $fuIncome($a['spouse']['incomes'] ?? [], $spAge);
            $spouseOver70 = $spAge !== null && $spAge >= 70;
        }

        // 扶養親族（本人の扶養に入る人だけ）と障害者
        $dep = ['ippan' => 0, 'tokutei' => 0, 'rojin' => 0, 'doukyo' => 0];
        $per = ['shogai' => 0, 'tokubetsu' => 0, 'doukyoTokubetsu' => 0, 'kafu' => 0, 'hitorioya' => 0, 'gakusei' => 0];
        $spr = []; $adjust = false; $salaryForAdjust = $salary;
        foreach ($r['family'] ?? [] as $f) {
            if (($f['change']['kind'] ?? '') === 'out') continue;
            if (($f['supporter'] ?? 'self') !== 'self') continue;
            if (($f['living'] ?? '') === 'apart' && ($f['remit_domestic'] ?? '') === 'no') continue; // 生計を一にしない
            $age = $fuAge($f['birth'] ?? null); if ($age === null) continue;
            $inc = $fuIncome($f['incomes'] ?? [], $age);
            $cls = '';
            if ($age < 16) $cls = '年少';
            elseif ($inc <= 580000) { if ($age >= 70) { $parentLike = preg_match('/父|母|祖父|祖母|義父|義母/u', $f['relation'] ?? ''); $cls = ($parentLike && ($f['living'] ?? '') === 'together') ? '同老' : '老人'; } elseif ($age >= 19 && $age <= 22) $cls = '特定'; else $cls = '一般'; }
            elseif ($age >= 19 && $age <= 22 && $inc <= 1230000) { $cls = '特定親族'; $spr[] = $inc; }
            else continue; // 所得が多く扶養の対象外
            if ($cls === '一般') $dep['ippan']++; elseif ($cls === '特定') $dep['tokutei']++; elseif ($cls === '老人') $dep['rojin']++; elseif ($cls === '同老') $dep['doukyo']++;
            $d = $f['disability'] ?? 'none';
            if ($d === 'general') $per['shogai']++; elseif ($d === 'special') $per['tokubetsu']++; elseif ($d === 'special_together') $per['doukyoTokubetsu']++;
            if ($age < 23 && $salaryForAdjust > 8500000) $adjust = true; // 所得金額調整控除
        }
        $sp = $a['spouse'] ?? [];
        if ($spouseIncome !== null && $spouseIncome <= 580000) {
            $d = $sp['disability'] ?? 'none';
            if ($d === 'general') $per['shogai']++; elseif ($d === 'special') $per['tokubetsu']++; elseif ($d === 'special_together') $per['doukyoTokubetsu']++;
        }
        $age = $fuAge($a['birth'] ?? ($r['prev']['birth'] ?? null));
        $sf = $a['self_flags'] ?? [];
        if (($sf['disability'] ?? '') === 'special' && $salary > 8500000) $adjust = true;
        if (($sf['disability'] ?? 'none') === 'general') $per['shogai']++; elseif (($sf['disability'] ?? '') === 'special') $per['tokubetsu']++;
        if (!empty($sf['kafu'])) $per['kafu'] = 1;
        if (!empty($sf['hitorioya'])) $per['hitorioya'] = 1;
        if (!empty($sf['student']) && $fuSalary($salary) + $other <= 850000) $per['gakusei'] = 1;

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

<?php
// 判定：年齢区分・所得・扶養区分・配偶者区分
declare(strict_types=1);
require_once __DIR__ . '/common.php';

/** その年の12/31時点の満年齢 */
function age_at_year_end(?string $iso, ?int $year = null): ?int {
    if (!$iso) return null;
    $year = $year ?? cfg()['year'];
    [$y, $m, $d] = array_map('intval', explode('-', $iso));
    $age = $year - $y;
    if ($m * 100 + $d > 1231) $age--;
    // 年齢は誕生日の前日に加算（1/1生まれは前年12/31に加算）→ 12/31判定では m/d<=12/31 なので常に加算済み
    return $age;
}

/** 収入（種類ごと）→ 所得。incomes = [['type'=>'salary'|'pension'|'business'|'other','amount'=>int], ...] */
function income_to_shotoku(array $incomes, ?int $age): array {
    $t = cfg()['tax'];
    $salary = 0; $pension = 0; $other = 0;
    foreach ($incomes as $i) {
        $a = yen((string)($i['amount'] ?? 0));
        switch ($i['type'] ?? 'salary') {
            case 'salary': $salary += $a; break;
            case 'pension': $pension += $a; break;
            default: $other += $a; // 事業・不動産などは「所得」をそのまま聞く
        }
    }
    $salaryIncome = 0;
    if ($salary > 0) {
        if ($salary < $t['salary_deduction_flat_upto']) $salaryIncome = max(0, $salary - $t['salary_deduction_min']);
        else $salaryIncome = salary_income_table($salary);
    }
    $pensionIncome = 0;
    if ($pension > 0) {
        $ded = ($age !== null && $age >= 65) ? $t['pension_deduction_over65'] : $t['pension_deduction_under65'];
        if ($pension < $t['pension_simple_upto'] || ($age !== null && $age >= 65 && $pension < 3300000)) $pensionIncome = max(0, $pension - $ded);
        else $pensionIncome = pension_income_table($pension, $age ?? 64);
    }
    return [
        'salary_revenue' => $salary, 'pension_revenue' => $pension,
        'salary_income' => $salaryIncome, 'pension_income' => $pensionIncome, 'other_income' => $other,
        'total_income' => $salaryIncome + $pensionIncome + $other,
        'estimate' => $salary >= $t['salary_deduction_flat_upto'] || $pension >= $t['pension_simple_upto'],
    ];
}

/** 給与所得の簡易計算（219万以上）。細かい端数処理は年調ソフトに任せるので概算 */
function salary_income_table(int $s): int {
    if ($s < 3600000) return (int)floor($s * 0.7) - 80000;
    if ($s < 6600000) return (int)floor($s * 0.8) - 440000;
    if ($s < 8500000) return (int)floor($s * 0.9) - 1100000;
    return $s - 1950000;
}
function pension_income_table(int $p, int $age): int {
    if ($age >= 65) {
        if ($p < 4100000) return (int)floor($p * 0.75) - 275000;
        if ($p < 7700000) return (int)floor($p * 0.85) - 685000;
        if ($p < 10000000) return (int)floor($p * 0.95) - 1455000;
        return $p - 1955000;
    }
    if ($p < 4100000) return (int)floor($p * 0.75) - 275000;
    if ($p < 7700000) return (int)floor($p * 0.85) - 685000;
    if ($p < 10000000) return (int)floor($p * 0.95) - 1455000;
    return $p - 1955000;
}

/**
 * 家族1人の扶養区分
 * 戻り: 一般／特定／老人／同老／年少／特定親族／対象外
 */
function dependent_class(array $f, int $selfIncome): string {
    $t = cfg()['tax'];
    $age = age_at_year_end($f['birth'] ?? null);
    $inc = income_to_shotoku($f['incomes'] ?? [], $age)['total_income'];
    if ($age === null) return '対象外';
    if ($age < 16) return '年少';
    if ($inc <= $t['dependent_income_max']) {
        if ($age >= 70) {
            $parentLike = preg_match('/父|母|祖父|祖母|義父|義母/u', $f['relation'] ?? '');
            return ($parentLike && ($f['living'] ?? '') === 'together') ? '同老' : '老人';
        }
        if ($age >= 19 && $age <= 22) return '特定';
        return '一般';
    }
    if ($age >= 19 && $age <= 22 && $inc <= $t['special_relative_income_max']) return '特定親族';
    return '対象外';
}

/** 配偶者の区分 */
function spouse_class(array $sp, int $selfIncome): array {
    $t = cfg()['tax'];
    $age = age_at_year_end($sp['birth'] ?? null);
    $sh = income_to_shotoku($sp['incomes'] ?? [], $age);
    $inc = $sh['total_income'];
    $kubun = '対象外'; $gensen = '非該当';
    if ($selfIncome <= $t['self_income_max_for_spouse']) {
        if ($inc <= $t['dependent_income_max']) $kubun = ($age !== null && $age >= 70) ? '老人' : '一般';
        elseif ($inc <= $t['spouse_special_income_max']) $kubun = '特別'; // 配偶者特別控除（ICSでは「対象外」+所得で判定）
    }
    if ($selfIncome <= $t['self_income_max_for_gensen'] && $inc <= $t['spouse_income_max_for_gensen']) $gensen = '該当';
    return ['kubun' => $kubun, 'gensen' => $gensen, 'income' => $sh, 'age' => $age];
}

function disability_code(?string $v): string {
    return match ($v) { 'general' => '一般', 'special' => '特別', 'special_together' => '同特', default => '非該当' };
}

/** 記録全体から判定結果を作る */
function compute(array $r): array {
    $a = $r['answers'];
    $t = cfg()['tax'];
    $selfAge = age_at_year_end($a['birth'] ?? ($r['prev']['birth'] ?? null));
    $selfIncomes = [['type' => 'salary', 'amount' => $a['salary'] ?? 0]];
    foreach ($a['other_incomes'] ?? [] as $oi) $selfIncomes[] = $oi;
    $self = income_to_shotoku($selfIncomes, $selfAge);

    $out = ['self' => $self, 'self_age' => $selfAge];

    // 配偶者
    if (($a['has_spouse'] ?? 'no') === 'yes') {
        $out['spouse'] = spouse_class($a['spouse'] ?? [], $self['total_income']);
    }

    // 家族
    $fam = [];
    $counts = [];
    $adjustTarget = null;
    foreach ($r['family'] ?? [] as $f) {
        if (($f['change']['kind'] ?? '') === 'out') continue; // 今年扶養から出た人
        if (($f['supporter'] ?? 'self') !== 'self') { $f['class'] = '他者'; $fam[] = $f; continue; }
        $cls = dependent_class($f, $self['total_income']);
        if (($f['living'] ?? '') === 'apart' && ($f['remit_domestic'] ?? '') === 'no' && $cls !== '対象外') { $cls = '対象外'; $f['note'] = '別居で仕送りがないため、扶養の条件（生計を一にする）を満たしません'; }
        $f['class'] = $cls;
        $f['age'] = age_at_year_end($f['birth'] ?? null);
        $f['income'] = income_to_shotoku($f['incomes'] ?? [], $f['age']);
        $fam[] = $f;
        $key = match ($cls) {
            '一般' => '扶一般', '特定' => '扶特定', '老人' => '扶老人', '同老' => '扶同老',
            '年少' => '扶年少', '特定親族' => '扶特親(源)', default => null,
        };
        if ($key === '扶特親(源)' && $f['income']['total_income'] > $t['special_relative_gensen_income_max']) $key = '扶特親';
        if ($key) $counts[$key] = ($counts[$key] ?? 0) + 1;
        $dis = $f['disability'] ?? 'none';
        if ($dis !== 'none' && $cls !== '対象外') {
            $dk = match ($dis) { 'special' => '扶特障', 'special_together' => '扶同特', default => '扶障害' };
            $counts[$dk] = ($counts[$dk] ?? 0) + 1;
        }
        if ($adjustTarget === null && $f['age'] !== null && $f['age'] < 23 && $cls !== '対象外') $adjustTarget = $f;
    }
    $out['family'] = $fam;
    $out['dependent_summary'] = $counts;

    // 所得金額調整控除（年収850万超 かつ 23歳未満の扶養親族 or 特別障害者）
    $out['adjust'] = null;
    if ($self['salary_revenue'] > $t['adjust_income_threshold']) {
        if ($adjustTarget) $out['adjust'] = ['kind' => '２３歳未満 扶養親族', 'target' => $adjustTarget];
        elseif (($a['self_flags']['disability'] ?? '') === 'special') $out['adjust'] = ['kind' => '特別障害者 本人', 'target' => null];
    }

    // 生命保険料の6万円特例の対象（23歳未満の扶養親族がいる）
    $out['life_ins_6man'] = $adjustTarget !== null;
    return $out;
}

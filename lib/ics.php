<?php
// 日本ICS 給与マスター表形式（タイプ6・540列）の読み込みと書き出し
declare(strict_types=1);
require_once __DIR__ . '/common.php';
require_once __DIR__ . '/judge.php';
require_once __DIR__ . '/zipcode.php';

const ICS_COLS = 540;
// 列番号（0始まり）
const C = [
    'code' => 0, 'kubun' => 1, 'sei' => 2, 'mei' => 3, 'sei_k' => 4, 'mei_k' => 5, 'sex' => 6, 'birth' => 7,
    'hire' => 8, 'retire' => 9, 'zip' => 10, 'city_code' => 11, 'addr1' => 16, 'addr2' => 17,
    'self_kubun' => 18, 'gensen_sp' => 19, 'spouse_kubun' => 20, 'dep_kubun' => 21,
    'dep_decl' => 129, 'shaho_self' => 132, 'kokumin_nenkin' => 133, 'kyosai' => 134,
    'life_old' => 135, 'nenkin_old' => 136, 'jishin' => 137, 'old_songai' => 138,
    'sp_salary_income' => 139, 'sp_other_income' => 140, 'jutaku_koujo' => 141,
    'kyojuu1' => 143, 'jkubun1' => 144, 'tokutei1' => 145, 'zandaka1' => 146,
    'kyojuu2' => 147, 'jkubun2' => 148, 'tokutei2' => 149, 'zandaka2' => 150,
    'life_new' => 152, 'kaigo' => 153, 'nenkin_new' => 154, 'self_other_income' => 155,
    'sp_salary_revenue' => 156, 'adjust_req' => 157,
    'adj_sei' => 158, 'adj_mei' => 159, 'adj_sei_k' => 160, 'adj_mei_k' => 161, 'adj_rel' => 162, 'adj_birth' => 163, 'adj_addr' => 164, 'adj_income' => 165, 'adj_fact' => 166,
    'self_income' => 170, 'head_sei' => 171, 'head_mei' => 172, 'head_rel' => 174,
    'sp_sei' => 176, 'sp_mei' => 177, 'sp_sei_k' => 178, 'sp_mei_k' => 179, 'sp_birth' => 182, 'sp_addr' => 183,
    'sp_gensen' => 184, 'sp_kubun2' => 185, 'sp_dis' => 187, 'sp_job' => 188, 'sp_salary_income2' => 189, 'sp_other_income2' => 190,
    'sp_nonres' => 191, 'sp_fact' => 192, 'sp_income_ex' => 193,
    'fam_base' => 194, 'fam_stride' => 16, 'fam_max' => 20,
    'self_dis_text' => 514, 'other_base' => 516, 'other_stride' => 12, 'other_max' => 2,
];
// 扶養親族ブロック内のオフセット
const F = ['sei' => 0, 'mei' => 1, 'sei_k' => 2, 'mei_k' => 3, 'rel' => 5, 'birth' => 6, 'addr' => 7, 'together' => 8, 'kubun' => 9, 'dis' => 10, 'job' => 11, 'income' => 12, 'nonres' => 13, 'fact' => 14, 'income_ex' => 15];
// 他者控除扶養親族ブロック内のオフセット
const O = ['sei' => 0, 'mei' => 1, 'sei_k' => 2, 'mei_k' => 3, 'rel' => 4, 'birth' => 5, 'addr' => 6, 'o_sei' => 7, 'o_mei' => 8, 'o_rel' => 9, 'o_addr' => 10];

/** Shift-JIS の CSV を読み、[header_rows(2行), 項目名, 社員行の配列] を返す */
function ics_read(string $path): array {
    $raw = file_get_contents($path);
    $utf = mb_convert_encoding($raw, 'UTF-8', 'SJIS-win');
    $lines = preg_split('/\r\n|\n|\r/', $utf);
    $rows = [];
    foreach ($lines as $l) { if ($l === '') continue; $rows[] = str_getcsv($l); }
    if (count($rows) < 4) throw new RuntimeException('CSVの行数が足りません');
    return ['meta' => [$rows[0], $rows[1]], 'header' => $rows[2], 'rows' => array_slice($rows, 3)];
}

function rel_key(string $rel): string { return $rel; }

/** 社員1行 → prev.json の形 */
function ics_row_to_prev(array $r): array {
    $g = fn(int $i) => $r[$i] ?? '';
    $p = [
        'code' => $g(C['code']), 'raw' => $r,
        'sei' => $g(C['sei']), 'mei' => $g(C['mei']), 'sei_k' => $g(C['sei_k']), 'mei_k' => $g(C['mei_k']),
        'sex' => $g(C['sex']), 'birth' => wareki_to_iso($g(C['birth'])), 'zip' => $g(C['zip']),
        'addr' => $g(C['addr1']) . $g(C['addr2']),
        'self_kubun' => $g(C['self_kubun']), 'spouse_kubun' => $g(C['spouse_kubun']), 'dep_kubun' => $g(C['dep_kubun']),
        'head' => ['sei' => $g(C['head_sei']), 'mei' => $g(C['head_mei']), 'rel' => $g(C['head_rel'])],
        'spouse' => null, 'family' => [],
        'amounts' => [
            'life_new' => yen($g(C['life_new'])), 'life_old' => yen($g(C['life_old'])), 'kaigo' => yen($g(C['kaigo'])),
            'nenkin_new' => yen($g(C['nenkin_new'])), 'nenkin_old' => yen($g(C['nenkin_old'])),
            'jishin' => yen($g(C['jishin'])), 'old_songai' => yen($g(C['old_songai'])),
            'kyosai' => yen($g(C['kyosai'])), 'shaho_self' => yen($g(C['shaho_self'])), 'kokumin_nenkin' => yen($g(C['kokumin_nenkin'])),
            'jutaku_koujo' => yen($g(C['jutaku_koujo'])), 'zandaka1' => yen($g(C['zandaka1'])),
        ],
        'self_income' => yen($g(C['self_income'])),
        // 前年の給与・賞与の課税支給額（月給12か月＋賞与6回、非課税分を除く）
        'salary_total' => array_sum(array_map(fn($k) => yen($g($k)), range(24, 35))) - array_sum(array_map(fn($k) => yen($g($k)), range(36, 47)))
                        + array_sum(array_map(fn($k) => yen($g($k)), range(102, 107))) - array_sum(array_map(fn($k) => yen($g($k)), range(96, 101))),
    ];
    if ($g(C['sp_sei']) !== '' || $g(C['sp_mei']) !== '') {
        $p['spouse'] = [
            'sei' => $g(C['sp_sei']), 'mei' => $g(C['sp_mei']), 'sei_k' => $g(C['sp_sei_k']), 'mei_k' => $g(C['sp_mei_k']),
            'birth' => wareki_to_iso($g(C['sp_birth'])), 'addr' => $g(C['sp_addr']), 'kubun' => $g(C['sp_kubun2']),
            'dis' => $g(C['sp_dis']), 'job' => $g(C['sp_job']), 'salary_income' => yen($g(C['sp_salary_income2'])),
            'nonres' => $g(C['sp_nonres']),
        ];
    }
    for ($k = 0; $k < C['fam_max']; $k++) {
        $b = C['fam_base'] + $k * C['fam_stride'];
        if ($g($b + F['sei']) === '' && $g($b + F['mei']) === '') continue;
        $p['family'][] = [
            'sei' => $g($b + F['sei']), 'mei' => $g($b + F['mei']), 'sei_k' => $g($b + F['sei_k']), 'mei_k' => $g($b + F['mei_k']),
            'rel' => $g($b + F['rel']), 'birth' => wareki_to_iso($g($b + F['birth'])), 'addr' => $g($b + F['addr']),
            'kubun' => $g($b + F['kubun']), 'dis' => $g($b + F['dis']), 'job' => $g($b + F['job']),
            'income' => yen($g($b + F['income'])), 'nonres' => $g($b + F['nonres']), 'supporter' => 'self',
        ];
    }
    for ($k = 0; $k < C['other_max']; $k++) {
        $b = C['other_base'] + $k * C['other_stride'];
        if ($g($b + O['sei']) === '' && $g($b + O['mei']) === '') continue;
        $p['family'][] = [
            'sei' => $g($b + O['sei']), 'mei' => $g($b + O['mei']), 'sei_k' => $g($b + O['sei_k']), 'mei_k' => $g($b + O['mei_k']),
            'rel' => $g($b + O['rel']), 'birth' => wareki_to_iso($g($b + O['birth'])), 'addr' => $g($b + O['addr']),
            'supporter' => 'other', 'supporter_name' => $g($b + O['o_sei']) . ' ' . $g($b + O['o_mei']), 'supporter_rel' => $g($b + O['o_rel']),
        ];
    }
    return $p;
}

/** 前年CSVを顧問先フォルダに取り込む。戻り: 取り込んだ個人コードの配列 */
function ics_import(string $client, string $csvPath): array {
    $d = ics_read($csvPath);
    $cdir = data_dir() . "/$client/" . cfg()['year'];
    if (!is_dir($cdir)) mkdir($cdir, 0700, true);
    json_save("$cdir/_ics_meta.json", ['meta' => $d['meta'], 'header' => $d['header'], 'imported_at' => date('c')]);
    $codes = [];
    foreach ($d['rows'] as $row) {
        $code = trim($row[C['code']] ?? '');
        if ($code === '') continue;
        $prev = ics_row_to_prev($row);
        json_save(emp_dir($client, $code) . '/prev.json', $prev);
        $codes[] = $code;
    }
    return $codes;
}

/** 家族の入力 → 住所。同居なら本人の住所 */
function fam_addr(array $f, string $selfAddr): string {
    return ($f['living'] ?? 'together') === 'together' ? '同上' : (string)($f['addr'] ?? '');
}

/** 氏名「山田 太郎」→ [姓, 名] */
function split_name(string $full): array {
    $full = trim(mb_convert_kana($full, 's'));
    $parts = preg_split('/[\s　]+/u', $full, 2);
    return [$parts[0] ?? '', $parts[1] ?? ''];
}

/** 記録 → CSV 1行（540列） */
function ics_row_from_record(array $r): array {
    $row = $r['prev']['raw'] ?? array_fill(0, ICS_COLS, '');
    $row = array_pad(array_slice($row, 0, ICS_COLS), ICS_COLS, '');
    $a = $r['answers']; $c = compute($r); $prev = $r['prev'] ?? [];
    $set = function (int $i, $v) use (&$row) { $row[$i] = is_int($v) ? ($v === 0 ? '' : (string)$v) : (string)$v; };

    $row[C['code']] = $r['emp'];
    // 本人
    [$sei, $mei] = isset($a['name']) ? split_name($a['name']) : [$prev['sei'] ?? '', $prev['mei'] ?? ''];
    [$sk, $mk] = isset($a['kana']) ? split_name($a['kana']) : [$prev['sei_k'] ?? '', $prev['mei_k'] ?? ''];
    $set(C['sei'], $sei); $set(C['mei'], $mei); $set(C['sei_k'], to_hankaku_kana($sk)); $set(C['mei_k'], to_hankaku_kana($mk));
    if (!empty($a['birth'])) $set(C['birth'], iso_to_wareki($a['birth']));
    if (!empty($a['sex'])) $set(C['sex'], $a['sex']);
    $zip = $a['zip'] ?? ($prev['zip'] ?? ''); $addr = $a['addr'] ?? ($prev['addr'] ?? '');
    $set(C['zip'], $zip);
    $set(C['addr1'], mb_substr($addr, 0, 20)); $set(C['addr2'], mb_substr($addr, 20, 20));
    // 市区町村コード：住所が変わった（または空）なら郵便番号から引く
    $prevZip = $prev['zip'] ?? '';
    if ($zip !== '' && ($row[C['city_code']] === '' || preg_replace('/\D/', '', $zip) !== preg_replace('/\D/', '', $prevZip))) {
        $cc = zip_to_city($zip);
        if ($cc) $set(C['city_code'], $cc[0]);
    }
    // 本人区分
    $flags = [];
    $sf = $a['self_flags'] ?? [];
    if (($sf['disability'] ?? '') === 'general') $flags[] = '障害者';
    if (($sf['disability'] ?? '') === 'special') $flags[] = '特障者';
    if (!empty($sf['student'])) $flags[] = '勤労学生';
    if (!empty($sf['hitorioya'])) $flags[] = 'ひとり親';
    elseif (!empty($sf['kafu'])) $flags[] = '寡婦';
    $set(C['self_kubun'], implode('/', $flags));
    // 障害者又は勤労学生の内容（本人：…\\妻：…\\子：… の形）
    $dtexts = [];
    if (($sf['disability'] ?? 'none') !== 'none' || !empty($sf['student'])) $dtexts[] = '本人：' . ($sf['disability_text'] ?? '');
    if (($a['has_spouse'] ?? 'no') === 'yes' && (($a['spouse']['disability'] ?? 'none') !== 'none')) $dtexts[] = ($a['spouse']['relation'] ?? '配偶者') . '：' . ($a['spouse']['disability_text'] ?? '');
    foreach ($r['family'] ?? [] as $ff) if (($ff['disability'] ?? 'none') !== 'none') $dtexts[] = ($ff['relation'] ?? '') . '：' . ($ff['disability_text'] ?? '');
    $set(C['self_dis_text'], implode('\\\\', $dtexts)); // 区切りは半角の \\ 2つ（日本ICSの形）
    $set(C['dep_decl'], ($a['other_employer_decl'] ?? 'here') === 'other' ? '無' : '有');
    $set(C['self_income'], $c['self']['total_income']);
    $set(C['self_other_income'], $c['self']['other_income'] + $c['self']['pension_income']);
    // 世帯主
    if (($a['head_is_self'] ?? 'yes') === 'yes') { $set(C['head_sei'], $sei); $set(C['head_mei'], $mei); $set(C['head_rel'], '本人'); }
    else { [$hs, $hm] = split_name($a['head_name'] ?? ''); $set(C['head_sei'], $hs); $set(C['head_mei'], $hm); $set(C['head_rel'], $a['head_rel'] ?? ''); }
    // 配偶者
    $spCols = [C['sp_sei'], C['sp_mei'], C['sp_sei_k'], C['sp_mei_k'], C['sp_birth'], C['sp_addr'], C['sp_gensen'], C['sp_kubun2'], C['sp_dis'], C['sp_job'], C['sp_salary_income2'], C['sp_other_income2'], C['sp_nonres'], C['sp_fact'], C['sp_income_ex'], C['sp_salary_income'], C['sp_other_income'], C['sp_salary_revenue']];
    foreach ($spCols as $i) $row[$i] = '';
    if (($a['has_spouse'] ?? 'no') === 'yes' && isset($c['spouse'])) {
        $sp = $a['spouse']; $cs = $c['spouse'];
        [$ss, $sm] = split_name($sp['name'] ?? ''); [$ssk, $smk] = split_name($sp['kana'] ?? '');
        $set(C['sp_sei'], $ss); $set(C['sp_mei'], $sm); $set(C['sp_sei_k'], to_hankaku_kana($ssk)); $set(C['sp_mei_k'], to_hankaku_kana($smk));
        $set(C['sp_birth'], iso_to_wareki($sp['birth'] ?? null));
        $set(C['sp_addr'], fam_addr($sp, $addr));
        $set(C['sp_gensen'], $cs['gensen']); $set(C['gensen_sp'], $cs['gensen']);
        $k2 = match ($cs['kubun']) { '一般' => '一般', '老人' => '老人', default => '対象外' };
        $set(C['sp_kubun2'], $k2);
        $disc = disability_code($sp['disability'] ?? null);
        $set(C['sp_dis'], $disc);
        $sk20 = '配/' . $k2 . ($disc !== '非該当' ? '/' . ($disc === '一般' ? '障害' : ($disc === '特別' ? '特障' : '同特')) : '');
        $set(C['spouse_kubun'], $sk20);
        $set(C['sp_job'], mb_substr(income_label($sp['incomes'] ?? []), 0, 5));
        $set(C['sp_salary_income2'], $cs['income']['salary_income']); $set(C['sp_salary_income'], $cs['income']['salary_income']);
        $oth = $cs['income']['pension_income'] + $cs['income']['other_income'];
        $set(C['sp_other_income2'], $oth); $set(C['sp_other_income'], $oth);
        $set(C['sp_salary_revenue'], $cs['income']['salary_revenue']);
        $set(C['sp_income_ex'], $cs['income']['total_income']);
        if (($sp['living'] ?? '') === 'abroad') { $set(C['sp_nonres'], '非居住者'); $set(C['sp_fact'], $sp['remit'] ?? ''); }
    } else {
        $set(C['spouse_kubun'], '配/無');
    }
    // 家族
    for ($k = 0; $k < C['fam_max']; $k++) for ($o = 0; $o < C['fam_stride']; $o++) $row[C['fam_base'] + $k * C['fam_stride'] + $o] = '';
    for ($k = 0; $k < C['other_max']; $k++) for ($o = 0; $o < C['other_stride']; $o++) $row[C['other_base'] + $k * C['other_stride'] + $o] = '';
    $fi = 0; $oi = 0;
    foreach ($c['family'] as $f) {
        [$fs, $fm] = split_name($f['name'] ?? ''); [$fsk, $fmk] = split_name($f['kana'] ?? '');
        if (($f['supporter'] ?? 'self') !== 'self') {
            if ($oi >= C['other_max']) continue;
            $b = C['other_base'] + $oi++ * C['other_stride'];
            $set($b + O['sei'], $fs); $set($b + O['mei'], $fm); $set($b + O['sei_k'], to_hankaku_kana($fsk)); $set($b + O['mei_k'], to_hankaku_kana($fmk));
            $set($b + O['rel'], $f['relation'] ?? ''); $set($b + O['birth'], iso_to_wareki($f['birth'] ?? null)); $set($b + O['addr'], fam_addr($f, $addr));
            [$os, $om] = split_name($f['supporter_name'] ?? ''); $set($b + O['o_sei'], $os); $set($b + O['o_mei'], $om);
            $set($b + O['o_rel'], $f['supporter_rel'] ?? ''); $set($b + O['o_addr'], $f['supporter_addr'] ?? $addr);
            continue;
        }
        if ($fi >= C['fam_max']) continue;
        $b = C['fam_base'] + $fi++ * C['fam_stride'];
        $set($b + F['sei'], $fs); $set($b + F['mei'], $fm); $set($b + F['sei_k'], to_hankaku_kana($fsk)); $set($b + F['mei_k'], to_hankaku_kana($fmk));
        $set($b + F['rel'], $f['relation'] ?? ''); $set($b + F['birth'], iso_to_wareki($f['birth'] ?? null)); $set($b + F['addr'], fam_addr($f, $addr));
        $set($b + F['kubun'], $f['class']); $set($b + F['dis'], disability_code($f['disability'] ?? null));
        $set($b + F['job'], mb_substr(income_label($f['incomes'] ?? []), 0, 5));
        $set($b + F['income'], $f['income']['total_income']); $set($b + F['income_ex'], $f['income']['total_income']);
        if (($f['living'] ?? '') === 'abroad') { $set($b + F['nonres'], '非居住者'); $set($b + F['fact'], $f['remit'] ?? ''); }
    }
    // 扶養親族区分（列22）
    $parts = [];
    foreach ($c['dependent_summary'] as $k => $n) $parts[] = "$k $n";
    $set(C['dep_kubun'], implode(' ', $parts));
    // 所得金額調整控除
    foreach ([C['adjust_req'], C['adj_sei'], C['adj_mei'], C['adj_sei_k'], C['adj_mei_k'], C['adj_rel'], C['adj_birth'], C['adj_addr'], C['adj_income'], C['adj_fact']] as $i) $row[$i] = '';
    if ($c['adjust']) {
        $set(C['adjust_req'], $c['adjust']['kind']);
        if ($tg = $c['adjust']['target']) {
            [$ts, $tm] = split_name($tg['name'] ?? ''); [$tsk, $tmk] = split_name($tg['kana'] ?? '');
            $set(C['adj_sei'], $ts); $set(C['adj_mei'], $tm); $set(C['adj_sei_k'], to_hankaku_kana($tsk)); $set(C['adj_mei_k'], to_hankaku_kana($tmk));
            $set(C['adj_rel'], $tg['relation'] ?? ''); $set(C['adj_birth'], iso_to_wareki($tg['birth'] ?? null)); $set(C['adj_addr'], fam_addr($tg, $addr));
            $set(C['adj_income'], $tg['income']['total_income'] ?? 0);
        }
    }
    $row[167] = ''; // 特定親族特別控除額は年調ソフトが計算する
    // 保険料・掛金（証明書の読み取り結果の合計）
    $sum = cert_totals($r);
    foreach (['life_new', 'life_old', 'kaigo', 'nenkin_new', 'nenkin_old', 'jishin', 'old_songai', 'kyosai', 'kokumin_nenkin', 'shaho_self', 'jutaku_koujo', 'zandaka1'] as $key) $set(C[$key], $sum[$key] ?? 0);
    if (!empty($sum['kyojuu1'])) $set(C['kyojuu1'], iso_to_wareki($sum['kyojuu1']));
    return $row;
}

function income_label(array $incomes): string {
    $m = ['salary' => '給与', 'pension' => '年金', 'business' => '事業', 'other' => 'その他'];
    $l = [];
    foreach ($incomes as $i) if (yen((string)($i['amount'] ?? 0)) > 0) $l[] = $m[$i['type'] ?? 'salary'] ?? 'その他';
    return implode('・', array_unique($l));
}

/** 証明書の読み取り結果 + 手入力 → 列ごとの合計 */
function cert_totals(array $r): array {
    $s = array_fill_keys(['life_new', 'life_old', 'kaigo', 'nenkin_new', 'nenkin_old', 'jishin', 'old_songai', 'kyosai', 'kokumin_nenkin', 'shaho_self', 'jutaku_koujo', 'zandaka1'], 0);
    foreach ($r['certs'] ?? [] as $c) {
        if (($c['status'] ?? '') === 'deleted') continue;
        foreach ($c['items'] ?? [] as $it) {
            $amt = yen((string)($it['amount'] ?? 0));
            $key = cert_key($it['category'] ?? '', $it['contract'] ?? '');
            if ($key) $s[$key] += $amt;
            if ($key === 'zandaka1' && !empty($it['start_date'])) $s['kyojuu1'] = $it['start_date'];
        }
    }
    // 自分で払った社会保険料（手入力）
    foreach ($r['answers']['shaho'] ?? [] as $sh) {
        $amt = yen((string)($sh['amount'] ?? 0));
        $s['shaho_self'] += $amt;
        if (($sh['type'] ?? '') === 'kokumin_nenkin') $s['kokumin_nenkin'] += $amt;
    }
    return $s;
}

function cert_key(string $cat, string $contract): ?string {
    $old = $contract === 'old';
    return match ($cat) {
        'life' => $old ? 'life_old' : 'life_new',
        'kaigo' => 'kaigo',
        'nenkin' => $old ? 'nenkin_old' : 'nenkin_new',
        'jishin' => 'jishin', 'old_songai' => 'old_songai',
        'kyosai', 'ideco' => 'kyosai',
        'kokumin_nenkin' => 'kokumin_nenkin',
        'jutaku' => 'zandaka1',
        default => null,
    };
}

/** 顧問先の提出済み（または全員）をCSVにして返す（Shift-JIS, CRLF） */
function ics_export(string $client, bool $onlySubmitted = true, ?int $year = null): string {
    $cdir = data_dir() . "/$client/" . ($year ?? cfg()['year']);
    $meta = json_load("$cdir/_ics_meta.json");
    $lines = [];
    if ($meta) { $lines[] = $meta['meta'][0]; $lines[] = $meta['meta'][1]; $lines[] = $meta['header']; }
    else { $lines[] = ['給与', '12', '月分', 'FMT', '1', 'DBVER', '1,10,4,3']; $lines[] = ['タイプ６', 'SL=4', '個人コードタイプ', '0', '6']; $lines[] = array_fill(0, ICS_COLS, ''); }
    foreach (glob("$cdir/*/answers.json") ?: [] as $f) {
        $r = json_load($f);
        $ro = json_load(dirname($f) . '/roster.json', []);
        if (($ro['status'] ?? 'active') === 'retired') continue; // 退職者は出さない
        if (str_starts_with((string)($r['emp'] ?? ''), 'N')) continue;   // 個人コード未割当
        if ($onlySubmitted && ($r['status'] ?? '') !== 'submitted') continue;
        $lines[] = ics_row_from_record($r);
    }
    $out = '';
    foreach ($lines as $l) {
        $out .= implode(',', array_map(fn($v) => '"' . str_replace('"', '""', (string)$v) . '"', $l)) . "\r\n";
    }
    return mb_convert_encoding($out, 'SJIS-win', 'UTF-8');
}

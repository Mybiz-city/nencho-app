// 判定：年齢区分・所得・扶養区分・配偶者区分（控除額そのものは年調ソフトが計算する）

function ageAtYearEnd(iso, year) {
  if (!iso) return null; year = year || cfg().year;
  var p = iso.split('-').map(Number); return year - p[0];
}
/** 収入（種類ごと）→ 所得。incomes=[{type:'salary'|'pension'|'business'|'other', amount}] */
function incomeToShotoku(incomes, age) {
  var t = cfg().tax, salary = 0, pension = 0, other = 0;
  (incomes || []).forEach(function (i) {
    var a = yen(i.amount);
    if ((i.type || 'salary') === 'salary') salary += a; else if (i.type === 'pension') pension += a; else other += a;
  });
  var si = 0;
  if (salary > 0) si = salary < t.salary_deduction_flat_upto ? Math.max(0, salary - t.salary_deduction_min) : salaryIncomeTable(salary);
  var pi = 0;
  if (pension > 0) {
    var ded = (age !== null && age >= 65) ? t.pension_deduction_over65 : t.pension_deduction_under65;
    if (pension < t.pension_simple_upto || (age !== null && age >= 65 && pension < 3300000)) pi = Math.max(0, pension - ded);
    else pi = pensionIncomeTable(pension);
  }
  return { salary_revenue: salary, pension_revenue: pension, salary_income: si, pension_income: pi, other_income: other,
    total_income: si + pi + other, estimate: salary >= t.salary_deduction_flat_upto || pension >= t.pension_simple_upto };
}
function salaryIncomeTable(s) {
  if (s < 3600000) return Math.floor(s * 0.7) - 80000;
  if (s < 6600000) return Math.floor(s * 0.8) - 440000;
  if (s < 8500000) return Math.floor(s * 0.9) - 1100000;
  return s - 1950000;
}
function pensionIncomeTable(p) {
  if (p < 4100000) return Math.floor(p * 0.75) - 275000;
  if (p < 7700000) return Math.floor(p * 0.85) - 685000;
  if (p < 10000000) return Math.floor(p * 0.95) - 1455000;
  return p - 1955000;
}
/** 家族1人の扶養区分：一般／特定／老人／同老／年少／特定親族／対象外 */
function dependentClass(f) {
  var t = cfg().tax, age = ageAtYearEnd(f.birth), inc = incomeToShotoku(f.incomes || [], age).total_income;
  if (age === null) return '対象外';
  if (age < 16) return '年少';
  if (inc <= t.dependent_income_max) {
    if (age >= 70) { var parentLike = /父|母|祖父|祖母|義父|義母/.test(f.relation || ''); return (parentLike && f.living === 'together') ? '同老' : '老人'; }
    if (age >= 19 && age <= 22) return '特定';
    return '一般';
  }
  if (age >= 19 && age <= 22 && inc <= t.special_relative_income_max) return '特定親族';
  return '対象外';
}
function spouseClass(sp, selfIncome) {
  var t = cfg().tax, age = ageAtYearEnd(sp.birth), sh = incomeToShotoku(sp.incomes || [], age), inc = sh.total_income;
  var kubun = '対象外', gensen = '非該当';
  if (selfIncome <= t.self_income_max_for_spouse) {
    if (inc <= t.dependent_income_max) kubun = (age !== null && age >= 70) ? '老人' : '一般';
    else if (inc <= t.spouse_special_income_max) kubun = '特別';
  }
  if (selfIncome <= t.self_income_max_for_gensen && inc <= t.spouse_income_max_for_gensen) gensen = '該当';
  return { kubun: kubun, gensen: gensen, income: sh, age: age };
}
function disabilityCode(v) { return { general: '一般', special: '特別', special_together: '同特' }[v] || '非該当'; }

/** 記録全体から判定結果を作る */
function compute(r) {
  var a = r.answers || {}, t = cfg().tax;
  var selfAge = ageAtYearEnd(a.birth || (r.prev && r.prev.birth) || null);
  var selfIncomes = [{ type: 'salary', amount: a.salary || 0 }].concat(a.other_incomes || []);
  var self = incomeToShotoku(selfIncomes, selfAge);
  var out = { self: self, self_age: selfAge };
  if (a.has_spouse === 'yes') out.spouse = spouseClass(a.spouse || {}, self.total_income);
  var fam = [], counts = {}, adjustTarget = null;
  (r.family || []).forEach(function (f0) {
    var f = JSON.parse(JSON.stringify(f0));
    if (f.change && f.change.kind === 'out') { f['class'] = '除外'; fam.push(f); return; }
    if ((f.supporter || 'self') !== 'self') { f['class'] = '他者'; fam.push(f); return; }
    var cls = dependentClass(f);
    if (f.living === 'apart' && f.remit_domestic === 'no' && cls !== '対象外') { cls = '対象外'; f.note = '別居で仕送りがないため、扶養の条件（生計を一にする）を満たしません'; }
    f['class'] = cls; f.age = ageAtYearEnd(f.birth); f.income = incomeToShotoku(f.incomes || [], f.age);
    fam.push(f);
    var key = { '一般': '扶一般', '特定': '扶特定', '老人': '扶老人', '同老': '扶同老', '年少': '扶年少', '特定親族': '扶特親(源)' }[cls] || null;
    if (key === '扶特親(源)' && f.income.total_income > t.special_relative_gensen_income_max) key = '扶特親';
    if (key) counts[key] = (counts[key] || 0) + 1;
    var dis = f.disability || 'none';
    if (dis !== 'none' && cls !== '対象外') { var dk = dis === 'special' ? '扶特障' : dis === 'special_together' ? '扶同特' : '扶障害'; counts[dk] = (counts[dk] || 0) + 1; }
    if (adjustTarget === null && f.age !== null && f.age < 23 && cls !== '対象外') adjustTarget = f;
  });
  out.family = fam; out.dependent_summary = counts;
  out.adjust = null;
  if (self.salary_revenue > t.adjust_income_threshold) {
    if (adjustTarget) out.adjust = { kind: '２３歳未満 扶養親族', target: adjustTarget };
    else if ((a.self_flags || {}).disability === 'special') out.adjust = { kind: '特別障害者 本人', target: null };
  }
  out.life_ins_6man = adjustTarget !== null;
  var w = [], sf = a.self_flags || {};
  if ((sf.kafu || sf.hitorioya) && self.total_income > 5000000) w.push('寡婦・ひとり親控除は、本人の所得が500万円以下の方が対象です。今年の所得見込みが500万円を超えているため、対象外になる見込みです。');
  if (sf.student && self.total_income > t.working_student_income_max) w.push('勤労学生控除は、所得' + fmt(t.working_student_income_max) + '円以下の方が対象です。今年の見込みでは対象外です。');
  if (a.has_spouse === 'yes' && self.total_income > t.self_income_max_for_spouse) w.push('本人の所得が1,000万円を超えるため、配偶者控除・配偶者特別控除は受けられません（配偶者の情報は提出してください）。');
  if (a.has_other_income === 'unknown') w.push('給与以外の所得の見積もりが難しいとのことなので、年末調整は給与分で行い、ご自身で確定申告をしてください。');
  for (var i = 0; i < fam.length; i++) { var f = fam[i]; if (f.living === 'abroad' && f['class'] !== '対象外' && (f.supporter || 'self') === 'self') { w.push('国外に住む家族を扶養にするには、親族関係書類と送金関係書類の提出が必要です（写真の画面があります）。'); break; } }
  out.warnings = w;
  return out;
}

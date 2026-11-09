// ふるさと納税 限度額の計算部品（給与の人・個人事業主の両方で使う純粋な計算）
// 入力はすべて「年間・円」。戻り値は内訳つき。画面（DOM）には触らない。
// 限度額の定義：住民税の「特例分」が所得割額の20%に収まる寄附額（自己負担2,000円）
(function (root) {
  'use strict';

  // ---------- 所得 ----------
  // 給与所得控除（令和7年分以降。最低65万円）
  function salaryDeduction(g) { if (g <= 0) return 0; if (g <= 1.9e6) return 650000; if (g <= 3.6e6) return g * 0.3 + 80000; if (g <= 6.6e6) return g * 0.2 + 440000; if (g <= 8.5e6) return g * 0.1 + 1.1e6; return 1.95e6; }
  function salaryIncome(g) { return Math.max(0, g - salaryDeduction(g)); }
  // 公的年金等の雑所得（概算。他の所得1,000万円以下の表）
  function pensionIncome(p, over65) {
    if (p <= 0) return 0;
    if (over65) { if (p < 3.3e6) return Math.max(0, p - 1.1e6); if (p < 4.1e6) return p * 0.75 - 275000; if (p < 7.7e6) return p * 0.85 - 685000; if (p < 1e7) return p * 0.95 - 1455000; return p - 1955000; }
    if (p < 1.3e6) return Math.max(0, p - 600000); if (p < 4.1e6) return p * 0.75 - 275000; if (p < 7.7e6) return p * 0.85 - 685000; if (p < 1e7) return p * 0.95 - 1455000; return p - 1955000;
  }
  // 所得金額調整控除（年収850万円超で23歳未満の扶養親族・特別障害者がいる）
  function adjustDeduction(g, applies) { if (!applies || g <= 8.5e6) return 0; return Math.floor((Math.min(g, 1e7) - 8.5e6) * 0.1); }

  // ---------- 所得控除 ----------
  const lifeNew = p => p <= 0 ? 0 : p <= 20000 ? p : p <= 40000 ? Math.ceil(p / 2 + 10000) : p <= 80000 ? Math.ceil(p / 4 + 20000) : 40000;
  const lifeOld = p => p <= 0 ? 0 : p <= 25000 ? p : p <= 50000 ? Math.ceil(p / 2 + 12500) : p <= 100000 ? Math.ceil(p / 4 + 25000) : 50000;
  const lifeNewJ = p => p <= 0 ? 0 : p <= 12000 ? p : p <= 32000 ? Math.ceil(p / 2 + 6000) : p <= 56000 ? Math.ceil(p / 4 + 14000) : 28000;
  const lifeOldJ = p => p <= 0 ? 0 : p <= 15000 ? p : p <= 40000 ? Math.ceil(p / 2 + 7500) : p <= 70000 ? Math.ceil(p / 4 + 17500) : 35000;
  function combo(n, o, capNew, capOld) { if (o > capNew) return Math.min(o, capOld); return Math.min(capNew, Math.max(n, o, Math.min(n + o, capNew))); }
  // 生命保険料控除 {s:所得税, j:住民税}。引数は支払保険料
  function lifeDeduction(p) {
    const n = p.new || 0, o = p.old || 0, pn = p.pnew || 0, po = p.pold || 0, c = p.care || 0;
    const gen = combo(lifeNew(n), lifeOld(o), 40000, 50000), pen = combo(lifeNew(pn), lifeOld(po), 40000, 50000), care = lifeNew(c);
    const genJ = combo(lifeNewJ(n), lifeOldJ(o), 28000, 35000), penJ = combo(lifeNewJ(pn), lifeOldJ(po), 28000, 35000), careJ = lifeNewJ(c);
    return { s: Math.min(120000, gen + pen + care), j: Math.min(70000, genJ + penJ + careJ) };
  }
  // 地震保険料控除
  function quakeDeduction(q, l) {
    q = q || 0; l = l || 0;
    const qs = Math.min(50000, q), ls = l <= 0 ? 0 : l <= 10000 ? l : l <= 20000 ? Math.ceil(l / 2 + 5000) : 15000;
    const qj = Math.min(25000, Math.ceil(q / 2)), lj = l <= 0 ? 0 : l <= 5000 ? l : l <= 15000 ? Math.ceil(l / 2 + 2500) : 10000;
    return { s: Math.min(50000, qs + ls), j: Math.min(25000, qj + lj) };
  }
  // 基礎控除（所得税。令和7・8年分は上乗せあり）
  function kiso(g, year) {
    if (g <= 1.32e6) return 950000;
    if (year === 2025 || year === 2026) { if (g <= 3.36e6) return 880000; if (g <= 4.89e6) return 680000; if (g <= 6.55e6) return 630000; }
    if (g <= 2.35e7) return 580000; if (g <= 2.4e7) return 480000; if (g <= 2.45e7) return 320000; if (g <= 2.5e7) return 160000; return 0;
  }
  function kisoJ(g) { if (g <= 2.4e7) return 430000; if (g <= 2.45e7) return 290000; if (g <= 2.5e7) return 150000; return 0; }
  // 配偶者控除・配偶者特別控除 {s, j, diff:人的控除差}
  //   spouseIncome: 配偶者の合計所得、selfIncome: 本人の合計所得、over70: 配偶者が70歳以上
  function spouseDeduction(spouseIncome, selfIncome, over70) {
    if (spouseIncome == null || selfIncome > 1e7) return { s: 0, j: 0, diff: 0, kind: 'なし' };
    const band = selfIncome <= 9e6 ? 0 : selfIncome <= 9.5e6 ? 1 : 2; // 本人所得による逓減
    if (spouseIncome <= 580000) { // 配偶者控除
      const s = over70 ? [480000, 320000, 160000][band] : [380000, 260000, 130000][band];
      const j = over70 ? [380000, 260000, 130000][band] : [330000, 220000, 110000][band];
      return { s, j, diff: s - j, kind: over70 ? '配偶者控除（70歳以上）' : '配偶者控除' };
    }
    if (spouseIncome > 1.33e6) return { s: 0, j: 0, diff: 0, kind: '対象外' };
    // 配偶者特別控除（所得税／住民税）。本人所得900万以下の額
    const tbl = [[950000, 380000, 330000], [1e6, 360000, 330000], [1.05e6, 310000, 310000], [1.1e6, 260000, 260000], [1.15e6, 210000, 210000], [1.2e6, 160000, 160000], [1.25e6, 110000, 110000], [1.3e6, 60000, 60000], [1.33e6, 30000, 30000]];
    let s = 0, j = 0; for (const [u, a, b] of tbl) if (spouseIncome <= u) { s = a; j = b; break; }
    const f = [1, 2 / 3, 1 / 3][band]; s = Math.ceil(s * f / 10000) * 10000; j = Math.ceil(j * f / 10000) * 10000;
    // 人的控除差（調整控除用）：配偶者所得95万以下 5万／95〜100万 3万（本人所得の帯で 4・2万、2・1万）
    const diff = spouseIncome <= 950000 ? [50000, 40000, 20000][band] : spouseIncome <= 1e6 ? [30000, 20000, 10000][band] : 0;
    return { s, j, diff, kind: '配偶者特別控除' };
  }
  // 扶養控除 {s, j, diff}。人数：一般・特定・老人・同居老親
  function dependentDeduction(c) {
    const a = c.ippan || 0, t = c.tokutei || 0, r = c.rojin || 0, d = c.doukyo || 0;
    return { s: a * 380000 + t * 630000 + r * 480000 + d * 580000, j: a * 330000 + t * 450000 + r * 380000 + d * 450000, diff: a * 50000 + t * 180000 + r * 100000 + d * 130000 };
  }
  // 特定親族特別控除（令和7年分〜）：19〜22歳で所得58万円超123万円以下の親族。incomes は各人の合計所得の配列
  function specialRelativeDeduction(incomes) {
    let s = 0, j = 0, diff = 0;
    const tbl = [[850000, 630000, 450000], [900000, 610000, 450000], [950000, 510000, 450000], [1e6, 410000, 410000], [1.05e6, 310000, 310000], [1.1e6, 210000, 210000], [1.15e6, 110000, 110000], [1.2e6, 60000, 60000], [1.23e6, 30000, 30000]];
    for (const inc of incomes || []) { if (inc <= 580000 || inc > 1.23e6) continue; for (const [u, a, b] of tbl) if (inc <= u) { s += a; j += b; diff += a - b; break; } }
    return { s, j, diff };
  }
  // 障害者・寡婦・ひとり親・勤労学生 {s, j, diff}。人数
  function personalDeduction(c) {
    const items = [['shogai', 270000, 260000], ['tokubetsu', 400000, 300000], ['doukyoTokubetsu', 750000, 530000], ['kafu', 270000, 260000], ['hitorioya', 350000, 300000], ['gakusei', 270000, 260000]];
    let s = 0, j = 0; for (const [k, a, b] of items) { const n = c[k] || 0; s += n * a; j += n * b; }
    return { s, j, diff: s - j };
  }
  // 所得税（復興税なし）と限界税率
  function incomeTax(k) { const t = [[1.95e6, .05, 0], [3.3e6, .1, 97500], [6.95e6, .2, 427500], [9e6, .23, 636000], [1.8e7, .33, 1536000], [4e7, .4, 2796000], [Infinity, .45, 4796000]]; for (const [u, r, d] of t) if (k <= u) return { tax: Math.max(0, k * r - d), rate: r }; }
  // 住宅ローン控除のうち住民税から引く額（概算）。残高×0.7%を上限に、所得税で引き切れない分を住民税へ（上限 課税所得×5%・97,500円）
  function loanToResident(balance, incomeTaxAmount, kazei) {
    if (!balance) return 0;
    const credit = Math.min(Math.floor(balance * 0.007), 350000);
    const rest = Math.max(0, credit - incomeTaxAmount);
    return Math.min(rest, Math.min(Math.floor(kazei * 0.05), 97500));
  }

  // ---------- 本体 ----------
  // in = {
  //   year, salary, pension, over65, otherIncome(所得), businessIncome(事業所得・控除後), adjustApplies,
  //   shaho:{kyuyo, kokuho, nenkin, etc}, kyosai, life:{new,old,pnew,pold,care}, jishin, oldLong, iryo, zasson,
  //   spouseIncome(null=なし), spouseOver70, dependents:{ippan,tokutei,rojin,doukyo}, personal:{...}, loanBalance, loanJ(直接指定)
  // }
  function calcLimit(i) {
    const year = +i.year || 2026;
    const sal = salaryIncome(i.salary || 0) - adjustDeduction(i.salary || 0, i.adjustApplies);
    const pen = pensionIncome(i.pension || 0, !!i.over65);
    const gokei = Math.max(0, sal + pen + (i.otherIncome || 0) + (i.businessIncome || 0));
    const sh = i.shaho || {}; const shaho = (sh.kyuyo || 0) + (sh.kokuho || 0) + (sh.nenkin || 0) + (sh.etc || 0);
    const life = lifeDeduction(i.life || {}), quake = quakeDeduction(i.jishin, i.oldLong);
    const sp = spouseDeduction(i.spouseIncome, gokei, !!i.spouseOver70);
    const dep = dependentDeduction(i.dependents || {}), per = personalDeduction(i.personal || {}), spr = specialRelativeDeduction(i.specialRelatives || []);
    const k = kiso(gokei, year), kj = kisoJ(gokei);
    const common = shaho + (i.kyosai || 0) + (i.iryo || 0) + (i.zasson || 0);
    const ded = common + life.s + quake.s + sp.s + dep.s + spr.s + per.s + k;
    const dedJ = common + life.j + quake.j + sp.j + dep.j + spr.j + per.j + kj;
    const kazei = Math.max(0, Math.floor((gokei - ded) / 1000) * 1000), kazeiJ = Math.max(0, Math.floor((gokei - dedJ) / 1000) * 1000);
    const jinDiff = 50000 + sp.diff + dep.diff + spr.diff + per.diff; // 基礎控除差5万を含む
    let chosei; if (kazeiJ <= 2e6) chosei = Math.min(jinDiff, kazeiJ) * 0.05; else chosei = Math.max(2500, (jinDiff - (kazeiJ - 2e6)) * 0.05);
    const it = incomeTax(kazei);
    const loanJ = i.loanJ != null ? i.loanJ : loanToResident(i.loanBalance || 0, it.tax, kazei);
    const shotokuwari = Math.max(0, kazeiJ * 0.10 - chosei - loanJ);
    const rate = incomeTax(Math.max(0, kazeiJ - jinDiff)).rate;
    // 特例分の上限：所得割の20%。2027年（令和9年）の寄附からは 193万円 の定額上限も加わる（令和8年度税制改正）
    const capped = year >= 2027 && shotokuwari * 0.2 > 1930000;
    const tokurei = capped ? 1930000 : shotokuwari * 0.2;
    const limitRaw = shotokuwari > 0 ? tokurei / (0.9 - rate * 1.021) + 2000 : 0;
    const limit = Math.floor(limitRaw / 1000) * 1000;
    const warnings = [];
    if (capped || shotokuwari * 0.2 > 1500000) warnings.push('<b>所得が高い方は、この画面の目安は使わないでください。</b>2027年の寄附からの控除上限（193万円）や返礼品の一時所得課税など、個別の判断が要ります。税理士にシミュレーションを依頼してください。');
    if (loanJ > 0) warnings.push('住宅ローン控除が住民税に回る見込みです。所得割から差し引いた後の額で計算しました。');
    if ((sh.kyuyo || 0) > 0 && (sh.kokuho || 0) > 0) warnings.push('給与天引きの社会保険料と国民健康保険料の両方が入っています。年の途中で切り替わった場合だけ両方になります。');
    if (kazeiJ - jinDiff > 0 && incomeTax(Math.max(0, kazeiJ - jinDiff)).rate !== incomeTax(Math.max(0, kazeiJ - jinDiff - limitRaw)).rate) warnings.push('寄附後に所得税率の境目をまたぐ可能性があります。限度額は少なめに見てください。');
    if (sp.kind === '対象外' && i.spouseIncome != null) warnings.push('配偶者の所得が133万円を超えるため、配偶者控除・配偶者特別控除は0円で計算しました。');
    return {
      limit, limitRaw, safe: r => Math.floor(limitRaw * r / 1000) * 1000,
      salaryIncome: sal, pensionIncome: pen, gokei, shaho, life, quake, spouse: sp, dependents: dep, specialRelatives: spr, personal: per, kiso: k, kisoJ: kj,
      ded, dedJ, kazei, kazeiJ, jinDiff, chosei, loanJ, shotokuwari, rate, tokurei, capped,
      incomeTaxAmount: Math.floor(it.tax * 1.021 / 100) * 100, residentTax: Math.floor(shotokuwari / 100) * 100 + 5000,
      warnings,
    };
  }

  const api = { calcLimit, specialRelativeDeduction, salaryDeduction, salaryIncome, pensionIncome, lifeDeduction, quakeDeduction, kiso, kisoJ, spouseDeduction, dependentDeduction, personalDeduction, incomeTax, loanToResident, adjustDeduction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FurusatoCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

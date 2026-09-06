/**
 * 假目標與接觸查證 —— Stone (1983) §6「False Targets」、§7。
 *
 * 假目標是「偵測特性與目標幾乎相同」的物體 —— 對海上無人機 EO/IR 搜索而言就是
 * 海藻、油膜、漂浮物、白浪、其他船舶（IAMSAR 文件三(二)明列這些會被誤認為救生筏）。
 * 關鍵是 Stone 的定義：**假目標與真目標有相同的偵測函數**，所以你無法靠「搜得更久」
 * 把它們濾掉，只能逐一查證。
 *
 * ── 兩階段搜索（Stone §6）────────────────────────────────
 * 「搜索分兩個階段：廣域搜索與接觸查證……廣域搜索用掃掠寬度大、但會對假目標
 *  產生偵測的感測器；第二階段用另一個掃掠寬度較小、但能識別（分辨真假）的感測器。
 *  **進入接觸查證階段必須先終止廣域搜索。**」
 *
 * 對無人機而言兩個階段共用同一架載台（下降 / 變焦查看），因此查證時間直接從
 * 滯空時數裡扣 —— 這正是本模組的核心：**假目標吃掉的是時間預算**。
 *
 * ── 假目標分布（Stone §6）───────────────────────────────
 *   Pr{第 j 格有 n 個假目標} = δ(j)ⁿ·e^(−δ(j)) / n!
 * δ(j) 為該格假目標期望個數。Stone 假設 δ(j) 已知或可由該區地質／海況資訊估計。
 *
 * ── 接觸優先順序（Stone §6 式 5、6）──────────────────────
 * 搜完得到 n 個「像目標」的接觸，尚未查證時：
 *
 *   P  = Σⱼ p(j)·b(j,tⱼ)                                    (4) 事前發現機率
 *   γᵢ = (p(jᵢ)/δ(jᵢ)) / (1 − P + Σₖ p(jₖ)/δ(jₖ))          (5) 第 i 個接觸是目標的後驗機率
 *   p̃(j) = p(j)[1−b(j,tⱼ)] / (1 − P + Σₖ p(jₖ)/δ(jₖ)) + Σ_{jᵢ=j} γᵢ   (6)
 *
 * 「式 5 與式 6 指出應先查證哪些接觸、接下來該搜哪些格。」
 * 直覺：γ 正比於 **p(j)/δ(j)** —— 目標機率密度相對假目標密度高的地方，
 * 接觸才值得優先查。在假目標密集區（航道、漂流帶）的接觸即使機率不低也該往後排。
 *
 * 純函式、語言中立。
 */

/** 假目標環境設定 */
export interface FalseTargetModel {
  /** 假目標密度（每平方浬的期望個數）。0 = 不考慮假目標 */
  densityPerNm2: number;
  /** 查證一個接觸所需時間（小時） */
  investigationHr: number;
}

export const NO_FALSE_TARGETS: FalseTargetModel = {
  densityPerNm2: 0,
  investigationHr: 0,
};

/**
 * 搜索區內假目標的期望個數（Poisson 平均數）。
 * 注意這是「存在多少」，不是「會偵測到多少」—— 後者還要乘偵測機率。
 */
export function expectedFalseTargets(model: FalseTargetModel, areaNm2: number): number {
  return Math.max(0, model.densityPerNm2) * Math.max(0, areaNm2);
}

/**
 * Poisson 分布的 95% 區間（常態近似 + 連續性修正，λ 小時退回精確下界 0）。
 * 用來告訴規劃者「接觸數可能落在多少之間」—— 期望值 8 個但實際可能 3–14 個，
 * 對時間預算的影響差很多。
 */
export function poissonInterval95(lambda: number): [number, number] {
  if (lambda <= 0) return [0, 0];
  const sd = Math.sqrt(lambda);
  return [Math.max(0, Math.floor(lambda - 1.96 * sd)), Math.ceil(lambda + 1.96 * sd)];
}

export interface ContactBudgetInput {
  /** 可用的總載具時數（架 × 小時） */
  totalAircraftHours: number;
  /** 修正後掃掠寬度（浬） */
  sweepWidthNm: number;
  /** 搜索速度（節） */
  speedKn: number;
  /** 搜索區面積（平方浬） */
  areaNm2: number;
  model: FalseTargetModel;
}

export interface ContactBudgetResult {
  /** 扣掉查證後，實際可用於廣域搜索的時數 */
  broadSearchHours: number;
  /** 花在接觸查證的時數 */
  investigationHours: number;
  /** 預期偵測到的接觸數（假目標中被偵測到的） */
  expectedContacts: number;
  /** 接觸數的 95% 區間 */
  contacts95: [number, number];
  /** 若接觸數落在區間上緣，查證會吃掉多少時數（規劃餘裕用） */
  worstCaseInvestigationHours: number;
  /** 區內假目標總數期望值（不論是否偵測到） */
  falseTargetsInArea: number;
  /** 因假目標損失的搜索時數比例 */
  timeLostFraction: number;
  /** 查證時間超過總時數 → 連一次完整廣域搜索都做不完 */
  saturated: boolean;
}

/**
 * 解「廣域搜索時數」的不動點。
 *
 *   T_broad + n(T_broad)·τ = T_total
 *   n(T_broad) = δ·A·b(T_broad)，  b = 1 − exp(−W·v·T_broad / A)（指數偵測函數）
 *
 * 左式對 T_broad 單調遞增，故解唯一，用二分法求。
 *
 * 為什麼要解不動點而非直接扣：搜得越久偵測到越多接觸、查證越久、能搜的時間越少。
 * 直接用「總時數 × δ×A×b(總時數)」會高估查證時間、低估搜索時間。
 */
export function contactBudget(input: ContactBudgetInput): ContactBudgetResult {
  const { totalAircraftHours: T, sweepWidthNm: W, speedKn: v, areaNm2: A, model } = input;
  const lambdaArea = expectedFalseTargets(model, A);
  const tau = Math.max(0, model.investigationHr);

  const detect = (t: number) => (A > 0 && W > 0 && v > 0 ? 1 - Math.exp(-(W * v * t) / A) : 0);
  const contactsAt = (t: number) => lambdaArea * detect(t);

  if (!(T > 0)) {
    return {
      broadSearchHours: 0, investigationHours: 0, expectedContacts: 0,
      contacts95: [0, 0], worstCaseInvestigationHours: 0,
      falseTargetsInArea: lambdaArea, timeLostFraction: 0, saturated: false,
    };
  }
  if (lambdaArea <= 0 || tau <= 0) {
    const n = contactsAt(T);
    return {
      broadSearchHours: T, investigationHours: 0, expectedContacts: n,
      contacts95: poissonInterval95(n), worstCaseInvestigationHours: 0,
      falseTargetsInArea: lambdaArea, timeLostFraction: 0, saturated: false,
    };
  }

  // 二分法解 f(t) = t + n(t)·τ − T = 0
  let lo = 0, hi = T;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (mid + contactsAt(mid) * tau < T) lo = mid; else hi = mid;
  }
  const broad = (lo + hi) / 2;
  const n = contactsAt(broad);
  const invest = n * tau;
  const ci = poissonInterval95(n);

  return {
    broadSearchHours: broad,
    investigationHours: invest,
    expectedContacts: n,
    contacts95: ci,
    worstCaseInvestigationHours: ci[1] * tau,
    falseTargetsInArea: lambdaArea,
    timeLostFraction: T > 0 ? invest / T : 0,
    // 連一個接觸都查不完就用光時間 → 廣域搜索被查證排擠殆盡
    saturated: broad < T * 0.05 && invest > 0,
  };
}

// ── 接觸優先順序（Stone §6 式 5、6）──────────────────────
/** 一個尚未查證的接觸 */
export interface Contact {
  id: string;
  /** 接觸所在格的目標機率 p(j) */
  cellTargetProbability: number;
  /** 接觸所在格的假目標期望數 δ(j) */
  cellFalseTargetRate: number;
}

export interface ContactRanking {
  id: string;
  /** 式 (5)：此接觸就是目標的後驗機率 γᵢ */
  gamma: number;
  /** 排序依據 p(j)/δ(j)（值越大越該優先查） */
  ratio: number;
  /** 1 = 最該先查 */
  rank: number;
}

/**
 * 依 Stone 式 (5) 算各接觸「是目標」的後驗機率並排序。
 *
 * @param contacts  本趟搜索得到、尚未查證的接觸
 * @param priorDetectionP  式 (4) 的 P = Σⱼ p(j)·b(j,tⱼ)
 */
export function rankContacts(contacts: Contact[], priorDetectionP: number): ContactRanking[] {
  if (contacts.length === 0) return [];
  const ratios = contacts.map((c) =>
    c.cellFalseTargetRate > 0 ? c.cellTargetProbability / c.cellFalseTargetRate : 0,
  );
  const denom = 1 - Math.max(0, Math.min(1, priorDetectionP)) + ratios.reduce((s, r) => s + r, 0);
  const rows = contacts.map((c, i) => ({
    id: c.id,
    ratio: ratios[i] ?? 0,
    gamma: denom > 0 ? (ratios[i] ?? 0) / denom : 0,
    rank: 0,
  }));
  rows.sort((a, b) => b.gamma - a.gamma);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * 式 (6) 的第一項係數：未被偵測到的機率質量要除以的正規化分母
 *   1 − P + Σₖ p(jₖ)/δ(jₖ)
 *
 * 有假目標時，「沒找到」不再只是式 (2) 的單純降權 —— 分母多了接觸項，
 * 因為「偵測到但可能是假目標」也是一種結果。無接觸（n = 0）時退化回 1 − P，
 * 與式 (2) 一致。
 */
export function unsuccessfulNormaliser(contacts: Contact[], priorDetectionP: number): number {
  const sum = contacts.reduce(
    (s, c) => s + (c.cellFalseTargetRate > 0 ? c.cellTargetProbability / c.cellFalseTargetRate : 0),
    0,
  );
  return 1 - Math.max(0, Math.min(1, priorDetectionP)) + sum;
}

/**
 * 密度換算輔助：由「整個搜索區預期幾個假接觸」反推每平方浬密度。
 * 規劃者通常對「這片海大概會看到十幾個漂浮物」比對 δ 有感覺。
 */
export function densityFromExpectedCount(count: number, areaNm2: number): number {
  return areaNm2 > 0 ? Math.max(0, count) / areaNm2 : 0;
}

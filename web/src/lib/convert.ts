// Logic thuần của màn "Chuyển sang ba ngăn" (`#convert`, pocket UC-1208, pwa UC-702 AC-27, UC-711 AC-28): bước kế tiếp,
// chữ banner / hàng Cài đặt, cờ mời một lần trên máy, số bước 3 (đối chiếu Tích luỹ), điều kiện nút Tiếp của bước 2 / 4,
// thứ tự yêu cầu khi Tiếp ở bước 2, xử lý 409 theo `next`. Mọi số tiền qua bộ định dạng có che số (UC-718); "Bước 3/5",
// "15%" không phải số tiền nên không che.

import { DEFAULT_SAVINGS_PCT, goalGroups, goalOrder } from "../../../src/domain/pockets";
import { ApiError } from "./api";
import { formatVnd, moneyDigits } from "./money";
import { dueText } from "./pockets";
import { SAVINGS_SCALE_TEXT } from "./savings-scale";
import { goalAccountOptions, pocketGoal, rewardAccountOptions, type GoalAccountOption } from "./settings";
import type { IncomeStream, ReserveGoal, SettingsAccount, SettingsGoalGroup } from "./types";

/** Năm bước theo thứ tự server (`conversion_claims`). */
export const CONVERSION_STEPS = ["pockets", "goals", "savings_gap", "pay_cycle", "savings_pct"] as const;
export type ConversionStep = (typeof CONVERSION_STEPS)[number];

/** Tiến độ trong snapshot (`conversion`); null = không có / đã xong. */
export type ConversionProgress = { done: number; total: number; next: string };

/** Số đối chiếu bước 3 (`GET /v1/conversion` › `savingsGap`). */
export interface SavingsGap {
  legacyCash: number;
  legacyAssets: number;
  realSavings: number;
  diff: number;
  hasSavingsAccount: boolean;
}

/** `GET /v1/conversion` và thân 200 của `POST /v1/conversion/steps/:step`. */
export interface ConversionStatus {
  state: "pending" | "done" | null;
  steps: string[];
  next: string | null;
  savingsGap: SavingsGap | null;
}

export const isConversionStep = (s: unknown): s is ConversionStep => (CONVERSION_STEPS as readonly unknown[]).includes(s);

/** Số thứ tự 1–5 của bước; bước lạ / null → 0. */
export const stepNumber = (step: string | null | undefined): number => (CONVERSION_STEPS as readonly (string | null | undefined)[]).indexOf(step) + 1;

/** Tiêu đề màn: "Chuyển sang ba ngăn · Bước {n}/5". */
export const convertTitle = (step: ConversionStep): string => `Chuyển sang ba ngăn · Bước ${stepNumber(step)}/${CONVERSION_STEPS.length}`;

/** Banner đầu tiên ở Hôm nay (pwa UC-702): "Hoàn tất chuyển sang ba ngăn · còn {total − done} bước ›"; xong / không có → null. */
export function conversionBanner(c: { done: number; total: number; next: string } | null | undefined): string | null {
  return c ? `Hoàn tất chuyển sang ba ngăn · còn ${c.total - c.done} bước ›` : null;
}

/** Hàng ở Cài đặt › Ba ngăn khi đang chuyển đổi (pwa UC-709 AC-46): "Chuyển sang ba ngăn · còn {N} bước ›"; xong → null. */
export function conversionSettingsRow(c: { done: number; total: number } | null | undefined): string | null {
  return c ? `Chuyển sang ba ngăn · còn ${c.total - c.done} bước ›` : null;
}

// ── Mời một lần trên mỗi máy (như cờ che số, UC-718) ─────────────────

export const CONVERT_INVITED_KEY = "vi-nha:convert-invited";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * App tải xong, snapshot có `conversion` ≠ null và máy này chưa từng được mời → tự mở `#convert` một lần. localStorage bị chặn
 * (null hay ném lỗi) → không tự mở (không ghi được cờ thì lần nào cũng mời, phiền hơn là banner).
 */
export function shouldInvite(storage: FlagStorage | null, conversion: ConversionProgress | null | undefined): boolean {
  if (!conversion || !storage) return false;
  try {
    return storage.getItem(CONVERT_INVITED_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markInvited(storage: FlagStorage | null): void {
  try {
    storage?.setItem(CONVERT_INVITED_KEY, "1");
  } catch {
    // không ghi được cờ — shouldInvite cũng không đọc được, nên không mời lại
  }
}

// ── 409 theo `next` ─────────────────────────────────────────────────

/**
 * Gửi bước `sent` bị 409: vẽ lại theo `next` trong thân lỗi. `silent` = không báo lỗi — `next` đã qua bước vừa gửi (gửi lại
 * sau khi mất phản hồi, hay máy khác vừa làm) hoặc đã xong hết (`next` null, `conversion_not_pending`). Lỗi khác (không phải
 * 409 có `next`) → null: hiện lỗi như thường.
 */
export function stepConflict(sent: ConversionStep, err: unknown): { next: ConversionStep | null; silent: boolean } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (err.code === "conversion_not_pending") return { next: null, silent: true };
  const next = err.body?.next;
  if (next === null) return { next: null, silent: true };
  if (!isConversionStep(next)) return null;
  return { next, silent: stepNumber(next) > stepNumber(sent) };
}

// ── Bước 2: chọn nơi để tiền cho từng khoản (tài khoản thật, nhiều mục tiêu dùng chung được; hoặc trả từ tiền chi tiêu) ──

export const GOALS_STEP_TITLE = "Chọn nơi để tiền cho từng khoản";
export const OPERATING_CHOICE_LABEL = "Trả từ tiền chi tiêu";

/**
 * Lựa chọn của một dòng mục tiêu: gắn tài khoản · trả từ tiền chi tiêu (ADR-141) · không dùng (tắt) · để sau. "Tạo tài khoản
 * mới" lưu xong thành gắn tài khoản.
 */
export type GoalChoice = { kind: "account"; accountId: string } | { kind: "operating" } | { kind: "off" } | { kind: "later" };

/** "Trả từ tiền chi tiêu" chỉ cho mục tiêu mỗi tháng (lặp, 1 tháng một lần, không %) — server 400 `operating_goal_monthly`. */
export const canPayFromOperating = (g: ReserveGoal): boolean => g.target_pct === null && g.monthly_amount !== null && g.repeat_months === 1;

/** Dòng phụ của một mục tiêu ở bước 2: cách đặt số và hạn — "2.000.000/tháng, 3 tháng một lần · hạn 15/01/2027", "10% thu chịu thuế", "cần 4.800.000". */
export function goalTerms(g: ReserveGoal): string {
  const parts: string[] = [];
  if (g.target_pct !== null) parts.push(`${g.target_pct}% thu chịu thuế`);
  else if (g.monthly_amount !== null && g.repeat_months !== null)
    parts.push(g.repeat_months === 1 ? `${moneyDigits(g.monthly_amount)}/tháng` : `${moneyDigits(g.monthly_amount)}/tháng, ${g.repeat_months} tháng một lần`);
  else if (g.target_amount !== null) parts.push(`cần ${moneyDigits(g.target_amount)}`);
  if (g.due_date) parts.push(`hạn ${dueText(g.due_date)}`);
  return parts.join(" · ");
}

/**
 * Lựa chọn sẵn khi mở bước 2: mục tiêu đã gắn → tài khoản đó; còn lại chọn sẵn tài khoản đề xuất khi nó còn đang dùng, ở ngăn
 * Dự phòng, chưa gắn mục tiêu khác, không phải Ví Thưởng (và chưa được dòng trước chọn sẵn); không thì chưa chọn (null).
 */
export function initialGoalChoices(goals: ReserveGoal[], accounts: SettingsAccount[], rewardAccountId: string | null | undefined): Record<string, GoalChoice | null> {
  const active = goals.filter((g) => g.active);
  const out: Record<string, GoalChoice | null> = {};
  for (const g of active) {
    if (g.pays_from === "operating") out[g.id] = { kind: "operating" };
    else if (g.account_id) out[g.id] = { kind: "account", accountId: g.account_id };
  }
  for (const g of active) {
    if (g.id in out) continue;
    const taken = new Set(Object.values(out).flatMap((c) => (c?.kind === "account" ? [c.accountId] : [])));
    const ok = goalAccountOptions(accounts, goals, rewardAccountId, g.id, g.target_pct !== null).some((a) => a.id === g.suggested_account_id && !a.shared && !a.blocked && !taken.has(a.id));
    out[g.id] = ok ? { kind: "account", accountId: g.suggested_account_id! } : null;
  }
  return out;
}

/** Mục tiêu sau khi áp các lựa chọn đang chọn (chưa gửi): gắn tài khoản đã chọn, trả từ tiền chi tiêu / tắt / để sau thì chưa gắn. */
function pendingGoals(goals: ReserveGoal[], choices: Record<string, GoalChoice | null>): ReserveGoal[] {
  return goals.map((g) => {
    const c = choices[g.id];
    return !c ? g : { ...g, account_id: c.kind === "account" ? c.accountId : null, pays_from: c.kind === "operating" ? "operating" : "account" };
  });
}

/**
 * Tài khoản cho một dòng (UC-1208 bước 2, AC-11): như sheet mục tiêu — tài khoản các dòng khác đang chọn kèm "dùng chung với
 * …", luật Thuế theo lựa chọn đang chọn; Ví Thưởng đang chọn không có.
 */
export function goalRowAccounts(
  goalId: string,
  goals: ReserveGoal[],
  accounts: SettingsAccount[],
  choices: Record<string, GoalChoice | null>,
  reward: string | null,
): GoalAccountOption[] {
  const pct = goals.find((g) => g.id === goalId)?.target_pct != null;
  return goalAccountOptions(accounts, pendingGoals(goals, choices), reward, goalId, pct);
}

/** Tài khoản chọn được cho Ví Thưởng ở bước 2: Dự phòng đang dùng, không thuộc mục tiêu nào theo lựa chọn đang chọn. */
export function rewardRowAccounts(accounts: SettingsAccount[], goals: ReserveGoal[], choices: Record<string, GoalChoice | null>): SettingsAccount[] {
  return rewardAccountOptions(accounts, pendingGoals(goals, choices));
}

/** Câu dưới các dòng nhóm của bước 2. */
export const GOAL_ORDER_NOTE = "Thứ tự ưu tiên đổi ở Cài đặt › Ba ngăn";

/**
 * Dòng nhóm dưới mỗi tài khoản được từ hai dòng chọn (UC-1208 AC-11): "{tài khoản} {số dư gộp} cho {tên}, {tên} · thiếu X /
 * đủ / dư X" — luật chia chung `goalGroups` theo thứ tự mặc định (`goalOrder`): số dư gộp mẹ + khoản gửi kỳ hạn đang dùng,
 * chia trên số dư gộp − tiền lãi của nhóm (`groups` = `goal_groups` của cài đặt, QĐ2).
 */
export function goalGroupLines(
  goals: ReserveGoal[],
  accounts: SettingsAccount[],
  choices: Record<string, GoalChoice | null>,
  groups: Pick<SettingsGoalGroup, "account_id" | "interest">[] = [],
): { accountId: string; text: string }[] {
  const ordered = goals
    .filter((g) => g.active)
    .map((g) => ({ g, key: { id: g.id, sort: g.sort, dueDate: g.due_date, name: g.name } }))
    .sort((a, b) => goalOrder(a.key, b.key))
    .map((x) => x.g);
  const chosen = ordered.flatMap((g) => {
    const c = choices[g.id];
    return c?.kind === "account" ? [{ ...pocketGoal({ ...g, need: g.target_amount }, c.accountId), paysFrom: "account" as const }] : [];
  });
  const live = accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, balance: a.book_balance ?? 0, parentId: a.parent_account_id ?? null }));
  const interest = Object.fromEntries(groups.map((g) => [g.account_id, g.interest ?? 0]));
  // Dòng nhóm chỉ khi từ hai dòng cùng tài khoản; nhóm có mục tiêu % (Thuế) không dùng chung được (luật Thuế báo ở ô chọn).
  const sameAccount = (id: string | null) => chosen.filter((g) => g.accountId === id);
  const { groups: out } = goalGroups(
    live,
    chosen.filter((g) => sameAccount(g.accountId).length >= 2 && sameAccount(g.accountId).every((x) => x.targetPct === null)),
    interest,
  );
  return out.map((grp) => {
    const names = grp.goalIds.map((id) => ordered.find((g) => g.id === id)!.name);
    const state = grp.short ? `thiếu ${formatVnd(grp.short)}` : grp.extra ? `dư ${formatVnd(grp.extra)}` : "đủ";
    return { accountId: grp.accountId, text: `${grp.name} ${formatVnd(grp.balance)} cho ${names.join(", ")} · ${state}` };
  });
}

/** Nút Tiếp ở bước 2 chỉ bật khi mọi mục tiêu đang dùng đã có lựa chọn. */
export function goalsReady(goals: ReserveGoal[], choices: Record<string, GoalChoice | null>): boolean {
  return goals.filter((g) => g.active).every((g) => choices[g.id] != null);
}

export interface StepRequest {
  method: "POST" | "PATCH" | "PUT";
  path: string;
  body: Record<string, unknown>;
}

/**
 * Các yêu cầu khi bấm Tiếp ở bước 2, đúng thứ tự để server không báo trùng: (1) tắt / bỏ gắn / chuyển sang trả từ tiền chi
 * tiêu trước cho tài khoản rảnh ra (server tự bỏ tài khoản khi `pays_from: "operating"`), (2) đổi Ví Thưởng, (3) gắn tài
 * khoản, mục tiêu % gắn sau cùng (không gặp 409 `tax_account_shared` khi Thuế nhận tài khoản mà dòng khác vừa rời). Dòng
 * không đổi gì thì không gửi. Mục tiêu đang trả từ tiền chi tiêu mà chọn tài khoản / để sau → `pays_from: "account"`.
 */
export function goalStepRequests(goals: ReserveGoal[], choices: Record<string, GoalChoice | null>, reward: { current: string | null; next: string | null }): StepRequest[] {
  const path = (id: string) => `/v1/settings/goals/${encodeURIComponent(id)}`;
  const free: StepRequest[] = [];
  const attach: StepRequest[] = [];
  const attachPct: StepRequest[] = [];
  for (const g of goals.filter((x) => x.active)) {
    const c = choices[g.id];
    if (!c) continue;
    const operating = g.pays_from === "operating";
    if (c.kind === "off") free.push({ method: "PATCH", path: path(g.id), body: { active: false } });
    else if (c.kind === "operating") {
      if (!operating) free.push({ method: "PATCH", path: path(g.id), body: { pays_from: "operating" } });
    } else if (c.kind === "later" && operating) free.push({ method: "PATCH", path: path(g.id), body: { pays_from: "account" } });
    else if (c.kind === "later" && g.account_id) free.push({ method: "PATCH", path: path(g.id), body: { account_id: null } });
    else if (c.kind === "account" && c.accountId !== g.account_id) {
      // Đổi từ tài khoản này sang tài khoản khác: bỏ gắn trước để tài khoản cũ rảnh cho dòng khác.
      if (g.account_id) free.push({ method: "PATCH", path: path(g.id), body: { account_id: null } });
      (g.target_pct !== null ? attachPct : attach).push({ method: "PATCH", path: path(g.id), body: { ...(operating ? { pays_from: "account" } : {}), account_id: c.accountId } });
    }
  }
  const rewardReq: StepRequest[] = reward.next === reward.current ? [] : [{ method: "PUT", path: "/v1/settings/config", body: { surplus_reward_account: reward.next } }];
  return [...free, ...rewardReq, ...attach, ...attachPct];
}

/** Thân 201 / 200 của `POST /v1/settings/goals/:id/account` (pocket UC-1209 bước 8). */
export interface GoalAccountResult {
  goal: ReserveGoal;
  account: SettingsAccount;
  created: boolean;
}

/**
 * "Tạo tài khoản mới" cho một mục tiêu (pocket UC-1208 bước 2.2, AC-9; ADR-134): một yêu cầu vừa tạo tài khoản vừa gắn mục
 * tiêu, thân = thân sheet tài khoản, nguyên vẹn — không thêm `id`, không đổi tên. Mã tài khoản (slug tên) là khoá idempotency
 * ở server, nên Lưu lại sau lỗi mạng gửi đúng thân này và không sinh tài khoản thứ hai.
 */
export function goalAccountRequest(goalId: string, account: Record<string, unknown>): StepRequest {
  return { method: "POST", path: `/v1/settings/goals/${encodeURIComponent(goalId)}/account`, body: account };
}

/** Bước một của sheet thêm mục tiêu mới kèm "Tạo tài khoản mới": tạo mục tiêu không `account_id` (bước hai là `goalAccountRequest`). */
export function goalCreateRequest(goal: Record<string, unknown>): StepRequest {
  const { account_id: _, ...body } = goal;
  return { method: "POST", path: "/v1/settings/goals", body };
}

/** Câu khi nhà chưa có tài khoản Dự phòng nào đang dùng (bước 2). */
export const NO_RESERVE_ACCOUNT =
  "Nhà chưa có tài khoản nào ở ngăn Dự phòng: mở một tài khoản thật (tài khoản phụ, sổ tiết kiệm…) cho từng mục tiêu, hoặc để sau.";

// ── Bước 3: Tích luỹ — tiền thật khác ví cũ ─────────────────────────

export const SAVINGS_GAP_EXPLAIN =
  "Bản cũ chia lương vào ví Tích sản ngay khi lương về, kể cả khi tiền chưa chuyển sang tài khoản tích luỹ (lệnh chuyển bị bỏ qua hay chưa làm), và tính cả các lần chuyển giữa ví. Từ bản 2.0, Tích luỹ là tiền thật đang nằm ở các tài khoản ngăn Tích luỹ. Số ví cũ chỉ còn ở màn này; giao dịch cũ vẫn xem được trong Sổ với nhãn 'cách tính cũ'.";

export const SAVINGS_GAP_NO_ACCOUNT =
  "Chưa có tài khoản Tích luỹ: mở một tài khoản thật cho Tích luỹ (tài khoản phụ, sổ tích luỹ…), rồi xếp vào ngăn Tích luỹ ở Cài đặt › Ba ngăn.";

/** Chữ bước 3 (chỉ đọc). Chênh có dấu: "+500.000 ₫" / "−1.000.000 ₫" / "0 ₫". */
export function savingsGapLines(gap: SavingsGap): { legacy: string; assets: string; real: string; diff: string; noAccount: string | null } {
  return {
    legacy: `Ví Tích sản cũ (số app chia trên giấy): ${formatVnd(gap.legacyCash)}`,
    assets: `không gồm ${formatVnd(gap.legacyAssets)} tài sản đã mua`,
    real: `Tích luỹ thật hôm nay: ${formatVnd(gap.realSavings)}`,
    diff: `Chênh: ${gap.diff > 0 ? "+" : ""}${formatVnd(gap.diff)}`,
    noAccount: gap.hasSavingsAccount ? null : SAVINGS_GAP_NO_ACCOUNT,
  };
}

// ── Bước 4: bật "Mở kỳ lương" ───────────────────────────────────────

/** Nguồn thu đang dùng có công tắc "Mở kỳ lương" (nguồn cho thuê không có). */
export const cycleSwitchStreams = (streams: IncomeStream[], rentalStreamId: string | null | undefined): IncomeStream[] =>
  streams.filter((s) => s.active && s.id !== rentalStreamId);

/** "Đang bật {N} nguồn: …" khi từ hai nguồn trở lên; ít hơn → null. */
export function cycleStreamsNote(on: number): string | null {
  return on >= 2 ? `Đang bật ${on} nguồn: khoản về trước trong 7 ngày quanh ngày lương mở kỳ` : null;
}

/** Nút Tiếp ở bước 4: ≥ 1 nguồn đang dùng bật, hoặc chọn "Nhà mình không có lương cố định". */
export const payCycleReady = (on: number, noSalary: boolean): boolean => on > 0 || noSalary;

// ── Bước 5: % Tích luỹ mỗi kỳ lương ─────────────────────────────────

/** Lương mẫu cho ví dụ ở bước 5. */
const EXAMPLE_SALARY = 20_000_000;

/** Câu bước 5 theo % đang gõ (1–100); % sai → null (nút Xong khoá). */
export function savingsPctLines(pct: number | null): { line: string; example: string } | null {
  if (pct === null) return null;
  return {
    line: `Lương về, việc đầu tiên là trích ${pct}% sang Tích luỹ. Kỳ nào không trích được thì bỏ qua và ghi lý do.`,
    example: `Lương ${moneyDigits(EXAMPLE_SALARY)} → trích ${moneyDigits(Math.round((EXAMPLE_SALARY * pct) / 100))}`,
  };
}

/** Nút về số mặc định của thang ở bước 5 (ADR-142). */
export const USE_DEFAULT_PCT = { label: `Dùng ${DEFAULT_SAVINGS_PCT}% (mặc định)`, pct: DEFAULT_SAVINGS_PCT } as const;

/**
 * Bước 5 (UC-1208 AC-14): số 0038 đã điền (`savings_pct`; chưa có → 10) trên thanh thang 1 · 10 · 30 kèm câu thang. Số khác
 * mặc định 10 là số 0038 tính từ luật nạp cũ của ví Tích sản → câu "Số này lấy từ cách chia ví cũ".
 */
export function savingsPctStep(saved: number | undefined): { pct: number; legacy: string | null; scale: string } {
  const pct = saved ?? DEFAULT_SAVINGS_PCT;
  return { pct, legacy: pct === DEFAULT_SAVINGS_PCT ? null : "Số này lấy từ cách chia ví cũ", scale: SAVINGS_SCALE_TEXT };
}

export const CONVERT_DONE_TOAST = "Xong. Từ giờ Hôm nay là tiền thật của ba ngăn.";

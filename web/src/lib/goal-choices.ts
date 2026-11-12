// Hàng "Cho mục tiêu" / "Cho khoản phải trả" của khoản chi / chuyển ra và ô "Đây là tiền lãi" của khoản thu (pocket UC-1209
// bước 11, ADR-140, ADR-141; pwa UC-703, UC-705, UC-706, UC-715). Danh sách đọc từ `snapshot.pockets` đã lưu nên dùng được
// offline. Thuần để test.

import type { PocketAccountLine, PocketsView } from "../../../src/domain/pockets";

export const GOAL_CHOICE_LABEL = "Cho mục tiêu";
export const NO_GOAL_LABEL = "Không cho mục tiêu nào";
export const OPERATING_CHOICE_LABEL = "Cho khoản phải trả";
export const NO_OPERATING_LABEL = "Không cho khoản nào";
/** Chữ của ô "Cho khoản phải trả" khi chưa chọn gì: "Cho khoản phải trả: không ▾". */
export const OPERATING_UNSET_LABEL = "không";
export const FROM_INTEREST_LABEL = "Từ tiền lãi";
export const IS_INTEREST_LABEL = "Đây là tiền lãi";
/** Giá trị của "Không cho mục tiêu nào" / "Không cho khoản nào" (khác "chưa chọn" = null; cả hai đều không gửi `goal_id`). */
export const NO_GOAL = "";
/** Giá trị của chip "Từ tiền lãi" trong cùng hàng (loại trừ chọn mục tiêu): gửi `from_interest: true`, không `goal_id`. */
export const FROM_INTEREST = "@from-interest";

export interface GoalChoice {
  id: string;
  name: string;
}

/**
 * Hàng chọn của tài khoản tiền ra. `account`: mục tiêu để ở tài khoản (tài khoản mẹ hoặc con của nó) — chỉ hỏi khi có từ hai
 * mục tiêu (một mục tiêu → server tự gắn); `fromInterest` thêm chip "Từ tiền lãi". `operating`: mục tiêu trả từ tiền chi tiêu
 * (tài khoản ngăn Vận hành) — ô gọn một dòng, không chọn sẵn, không tự gắn.
 */
export interface GoalRow {
  kind: "account" | "operating";
  label: string;
  noneLabel: string;
  choices: GoalChoice[];
  fromInterest: boolean;
}

const lineOf = (p: PocketsView, id: string | null | undefined): PocketAccountLine | undefined =>
  id ? [...p.reserve.accounts, ...p.operating.accounts, ...p.savings.accounts, ...p.outside.accounts].find((a) => a.id === id) : undefined;

/** Tài khoản mẹ của nhóm (chính nó khi không phải tài khoản con). */
const rootOf = (p: PocketsView, id: string): string => lineOf(p, id)?.parentId ?? id;

/**
 * Hàng chọn cho khoản chi / chuyển ra từ `accountId`; null = không có hàng. `toAccountId`: tài khoản nhận của chuyển khoản —
 * cùng nhóm mẹ + con thì không có chip "Từ tiền lãi". `keepInterest`: sửa khoản đang "Từ tiền lãi" (UC-715) — giữ chip dù tiền
 * lãi trong snapshot đã về 0 (server tính lại không gồm khoản cũ).
 */
export function goalChoices(
  accountId: string | null | undefined,
  p: PocketsView | null | undefined,
  o: { toAccountId?: string | null; keepInterest?: boolean } = {},
): GoalRow | null {
  if (!p || !accountId) return null;
  if (p.operating.accounts.some((a) => a.id === accountId)) {
    const goals = p.operating.goals ?? [];
    if (goals.length === 0) return null;
    return { kind: "operating", label: OPERATING_CHOICE_LABEL, noneLabel: NO_OPERATING_LABEL, choices: goals.map((g) => ({ id: g.id, name: g.name })), fromInterest: false };
  }
  const root = rootOf(p, accountId);
  const group = p.reserve.groups.find((g) => g.accountId === root);
  if (!group) return null;
  const ids = p.reserve.accounts.find((a) => a.id === root)?.goalIds ?? group.goalIds;
  const choices =
    ids.length < 2
      ? []
      : ids.flatMap((id) => {
          const g = p.reserve.goals.find((x) => x.id === id);
          return g ? [{ id, name: g.name }] : [];
        });
  const sameGroup = !!o.toAccountId && rootOf(p, o.toAccountId) === root;
  const fromInterest = !sameGroup && ((group.interest ?? 0) > 0 || !!o.keepInterest);
  if (choices.length === 0 && !fromInterest) return null;
  return { kind: "account", label: GOAL_CHOICE_LABEL, noneLabel: NO_GOAL_LABEL, choices, fromInterest };
}

/**
 * Phần `goal_id` / `from_interest` của thân: chỉ khi người nhập đã chọn một mục tiêu còn thuộc hàng hiện tại, hoặc chip "Từ
 * tiền lãi" khi hàng còn chip đó (đổi tài khoản = bỏ chọn).
 */
export function goalField(value: string | null | undefined, row: GoalRow | null | undefined): { goal_id?: string; from_interest?: true } {
  if (!value || !row) return {};
  if (value === FROM_INTEREST) return row.fromInterest ? { from_interest: true } : {};
  return row.choices.some((c) => c.id === value) ? { goal_id: value } : {};
}

/** Giá trị đang chọn của hàng khi mở form sửa (UC-715): "Từ tiền lãi" nếu khoản cũ rút từ lãi, không thì mục tiêu đang gắn. */
export const goalValueOf = (d: { goal_id: string | null; from_interest: boolean }): string | null => (d.from_interest ? FROM_INTEREST : d.goal_id);

/**
 * Ô "Đây là tiền lãi" của khoản thu vào `accountId` (QĐ2): chỉ khi tài khoản là mẹ có mục tiêu hoặc con của mẹ đó; `preset` bật
 * sẵn khi tài khoản nhận là con (tiền đáo hạn). null = không có ô.
 */
export function incomeInterest(accountId: string | null | undefined, p: PocketsView | null | undefined): { preset: boolean } | null {
  if (!p || !accountId) return null;
  const line = p.reserve.accounts.find((a) => a.id === accountId);
  if (!line) return null;
  const root = line.parentId ?? line.id;
  return p.reserve.groups.some((g) => g.accountId === root) ? { preset: !!line.parentId } : null;
}

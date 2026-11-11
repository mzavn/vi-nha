// Ô "Cho mục tiêu" của khoản chi / chuyển ra từ tài khoản dùng chung cho nhiều mục tiêu Dự phòng (pocket UC-1209 bước 11,
// pwa UC-703, UC-705, UC-706, UC-715). Danh sách đọc từ `snapshot.pockets` đã lưu nên dùng được offline. Thuần để test.

import type { PocketsView } from "../../../src/domain/pockets";

export const GOAL_CHOICE_LABEL = "Cho mục tiêu";
export const NO_GOAL_LABEL = "Không cho mục tiêu nào";
/** Giá trị của chip "Không cho mục tiêu nào" (khác "chưa chọn" = null; cả hai đều không gửi `goal_id`). */
export const NO_GOAL = "";

export interface GoalChoice {
  id: string;
  name: string;
}

/**
 * Mục tiêu đang dùng của tài khoản tiền ra theo thứ tự ưu tiên; [] khi tài khoản có dưới hai mục tiêu (một mục tiêu → server
 * tự gắn, không hỏi; không mục tiêu → không có ô).
 */
export function goalChoices(accountId: string | null | undefined, p: PocketsView | null | undefined): GoalChoice[] {
  const ids = p?.reserve.accounts.find((a) => a.id === accountId)?.goalIds ?? [];
  if (ids.length < 2) return [];
  return ids.flatMap((id) => {
    const g = p!.reserve.goals.find((x) => x.id === id);
    return g ? [{ id, name: g.name }] : [];
  });
}

/** Phần `goal_id` của thân: chỉ khi người nhập đã chọn một mục tiêu còn thuộc tài khoản tiền ra (đổi tài khoản = bỏ chọn). */
export function goalField(goalId: string | null | undefined, choices: GoalChoice[]): { goal_id?: string } {
  return goalId && choices.some((c) => c.id === goalId) ? { goal_id: goalId } : {};
}

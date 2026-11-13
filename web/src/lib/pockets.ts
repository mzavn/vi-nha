// Logic thuần của Cài đặt › Ba ngăn (pwa UC-709 AC-35…39): xếp tài khoản vào ngăn, hạn của mục tiêu Dự phòng, nhóm danh
// mục và hạn mức mềm. Không đụng DOM hay mạng để test được bằng vitest. Mọi số tiền qua `moneyDigits` (che số, UC-718).

import { moneyDigits } from "./money";
import { done, type Errors, type Result } from "./settings";
import type { CategoryGroup, Pocket, SettingsAccount } from "./types";

export const POCKET_LABEL: Record<Pocket, string> = { savings: "Tích luỹ", reserve: "Dự phòng", operating: "Vận hành" };
export const OUTSIDE_LABEL = "Ngoài ngăn";
export const pocketLabel = (p: Pocket | null): string => (p ? POCKET_LABEL[p] : OUTSIDE_LABEL);

/** Thứ tự nhóm ở sheet xếp ngăn và ô chọn ngăn. */
export const POCKET_ORDER: (Pocket | null)[] = ["savings", "reserve", "operating", null];

/** Ngăn đang chọn của từng tài khoản trên sheet xếp ngăn (id → ngăn). */
export type PocketChoice = Record<string, Pocket | null>;

// ── Xếp tài khoản vào ngăn (AC-35) ─────────────────────────────────

/** "2 chưa xác nhận" = số tài khoản đang dùng chưa xác nhận ngăn; 0 (hay bản cài đặt cũ chưa có trường ngăn) → null. */
export function unconfirmedChip(accounts: SettingsAccount[]): string | null {
  const n = accounts.filter((a) => a.active && a.pocket_confirmed === false).length;
  return n > 0 ? `${n} chưa xác nhận` : null;
}

/** Tài khoản đang dùng theo 4 nhóm Tích luỹ / Dự phòng / Vận hành / Ngoài ngăn, theo ngăn đang chọn; nhóm rỗng vẫn có. */
export function groupAccountsByPocket(accounts: SettingsAccount[], choice: PocketChoice): { key: string; label: string; accounts: SettingsAccount[] }[] {
  const active = accounts.filter((a) => a.active);
  return POCKET_ORDER.map((p) => ({ key: p ?? "outside", label: pocketLabel(p), accounts: active.filter((a) => (choice[a.id] ?? null) === p) }));
}

/** Thân PUT /v1/settings/pockets: mọi tài khoản đang dùng, cả lô. */
export function pocketsPayload(accounts: SettingsAccount[], choice: PocketChoice): { accounts: { id: string; pocket: Pocket | null }[] } {
  return { accounts: accounts.filter((a) => a.active).map((a) => ({ id: a.id, pocket: choice[a.id] ?? null })) };
}

// ── Mục tiêu Dự phòng (AC-36) ──────────────────────────────────────

/** "2027-01-15" → "15/01/2027". */
export function dueText(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ── Gợi ý mục tiêu Trả nợ (AC-39) ──────────────────────────────────

/** Ngày trả kế tiếp từ hôm nay (YYYY-MM-DD): ngày trả tháng này nếu chưa qua, không thì tháng sau; tháng ít ngày lấy ngày cuối. */
export function nextDueDate(dueDay: number | null, today: string): string {
  if (!dueDay) return "";
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const at = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
  };
  const thisMonth = at(y, m);
  if (Number(thisMonth.slice(8)) >= d) return thisMonth;
  return m === 12 ? at(y + 1, 1) : at(y, m + 1);
}

// ── Nhóm danh mục & hạn mức mềm (AC-39) ────────────────────────────

export interface GroupForm {
  name: string;
  essential: boolean;
  /** Hạn mức mỗi tháng; 0 (ô trống) = không đặt. */
  monthly_limit: number;
  active: boolean;
}

export const groupToForm = (g: CategoryGroup | null): GroupForm => ({ name: g?.name ?? "", essential: g?.essential ?? false, monthly_limit: g?.monthly_limit ?? 0, active: g?.active ?? true });

/** Thân POST / PATCH nhóm danh mục; hạn mức để trống → null (không đặt). */
export function groupPayload(f: GroupForm, existing: CategoryGroup | null): Result<{ name: string; essential: boolean; monthly_limit: number | null; active?: boolean }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên nhóm.";
  else if (name.length > 60) errors.name = "Tên tối đa 60 ký tự.";
  return done(errors, () => ({ name, essential: f.essential, monthly_limit: f.monthly_limit > 0 ? f.monthly_limit : null, ...(existing ? { active: f.active } : {}) }));
}

/** "Thiết yếu · 7.000.000 mỗi tháng · 3 danh mục" · "Mong muốn · không đặt hạn mức · chưa có danh mục" (pocket UC-1204 bước 1). */
export function groupSummary(g: CategoryGroup, categories: number): string {
  return [g.essential ? "Thiết yếu" : "Mong muốn", g.monthly_limit !== null ? `${moneyDigits(g.monthly_limit)} mỗi tháng` : "không đặt hạn mức", categories ? `${categories} danh mục` : "chưa có danh mục"]
    .filter(Boolean)
    .join(" · ");
}

// Sổ đối ứng (ghi nhớ ai nợ ai, nằm ngoài sổ cái): phần chung của sổ nợ (mình nợ) và sổ phải thu (người khác nợ mình).
// Thuần, không đụng DOM hay mạng. Số còn lại = phần ghi tăng (dòng sổ + lần vay / cho vay) − phần đã trả; ≤ 0 là xong.

import { formatVnd } from "./money";
import { done, type Errors, type Result } from "./settings";

/** Một khoản trong sổ, đủ để sắp và chọn: bootstrap chỉ có chừng này. */
export interface BookRef {
  id: string;
  name: string;
  balance: number;
}

const byName = (a: BookRef, b: BookRef) => a.name.localeCompare(b.name, "vi");
const byBalance = (a: BookRef, b: BookRef) => b.balance - a.balance || byName(a, b);

/** Khoản đang mở: còn nhiều lên trước. Đã xong tách riêng, theo tên. Khoản đã tắt không hiện. */
export function groupBook<T extends BookRef & { active: boolean }>(items: T[]): { open: T[]; done: T[] } {
  const active = items.filter((x) => x.active);
  return {
    open: active.filter((x) => x.balance > 0).sort(byBalance),
    done: active.filter((x) => x.balance <= 0).sort(byName),
  };
}

/** Khoản còn số để chọn: còn nhiều nhất lên đầu. Bản bootstrap cũ thiếu trường thì rỗng. */
export const openRefs = <T extends BookRef>(refs: T[] | undefined): T[] => (refs ?? []).filter((x) => x.balance > 0).sort(byBalance);

/** Khoản chọn sẵn: khoản được mở từ (nếu có trong danh sách), không thì khoản đầu danh sách. */
export function defaultRefId(list: BookRef[], preferred?: string | null): string | null {
  return list.find((x) => x.id === preferred)?.id ?? list[0]?.id ?? null;
}

/** Phần đã trả trên tổng đã ghi tăng, 0..100, cho thanh tiến độ. Chưa ghi gì thì coi như xong. */
export const progressPct = (total: number, back: number): number => (total > 0 ? Math.round((100 * back) / total) : 100);

/**
 * Nhãn một khoản trong ô chọn: còn nợ → "· còn X"; trả dư → "· trả dư X"; 0 → chỉ tên. Người mới chưa nợ gì cũng là 0,
 * nên không viết "đã trả đủ" (chủ nhà: "sao C Mai đã trả đủ?").
 */
export const bookRefLabel = (r: BookRef): string =>
  r.balance > 0 ? `${r.name} · còn ${formatVnd(r.balance)}` : r.balance < 0 ? `${r.name} · trả dư ${formatVnd(-r.balance)}` : r.name;

/**
 * Thân POST thêm khoản (dòng mở sổ): tên và số còn lại hôm nay. `messages` là câu báo lỗi riêng của từng sổ.
 * `allowZero`: sổ cho thêm người chưa nợ gì (số 0, không dòng mở sổ) — chỉ sổ phải thu.
 */
export function bookPayload(
  f: { name: string; amount: number; note: string },
  messages: { name: string; amount: string },
  allowZero = false,
): Result<{ name: string; amount: number; note?: string }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = messages.name;
  if (!Number.isInteger(f.amount) || f.amount < 0 || (f.amount === 0 && !allowZero)) errors.amount = messages.amount;
  return done(errors, () => ({ name, amount: f.amount, ...(f.note.trim() ? { note: f.note.trim() } : {}) }));
}

export interface BookLineForm<K extends string> {
  kind: K;
  amount: number;
  /** Chỉ cho adjust: +1 tăng, −1 giảm. */
  sign: 1 | -1;
  note: string;
}

/** Thân POST thêm dòng: dòng ghi tăng luôn dương; chỉnh mang dấu theo chiều chọn. */
export function bookLinePayload<K extends string>(f: BookLineForm<K>): Result<{ kind: K; amount: number; note?: string }> {
  const errors: Errors = {};
  if (!Number.isInteger(f.amount) || f.amount <= 0) errors.amount = "Nhập số tiền.";
  return done(errors, () => ({ kind: f.kind, amount: f.kind === "adjust" ? f.sign * f.amount : f.amount, ...(f.note.trim() ? { note: f.note.trim() } : {}) }));
}

/** Lịch sử một khoản: dòng sổ và lần tiền đi / về trộn chung, mới nhất trước. */
export function mergeHistory<L extends { at: string }, M extends { at: string }>(lines: L[], movements: M[]): ({ line: L; movement: null } | { line: null; movement: M })[] {
  return [...lines.map((line) => ({ line, movement: null })), ...movements.map((movement) => ({ line: null, movement }))].sort((a, b) =>
    (b.line ?? b.movement)!.at.localeCompare((a.line ?? a.movement)!.at),
  );
}

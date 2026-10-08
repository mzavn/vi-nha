// Sổ phải thu (người khác nợ mình: cho vay, trả hộ): sổ đối ứng dùng chung lib/memo-books, cộng câu chữ riêng.
// Thuần, không đụng DOM hay mạng. Số còn phải thu = đã cho vay (dòng sổ + lần cho vay) − đã nhận lại; ≤ 0 là đã trả đủ.
// Phải thu không phải thu nhập: cho vay và nhận lại chỉ đổi tài khoản, không đụng ví nào.

import { bookLinePayload, type BookLineForm, bookPayload, defaultRefId, openRefs } from "./memo-books";
import { formatVnd } from "./money";
import { done, type Errors, type Result } from "./settings";
import type { EntryBody, ReceivableRef } from "./types";

/** Câu hệ quả sau mỗi lần ghi sổ phải thu: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ). */
export const unpaidText = (balance: number): string => (balance > 0 ? `Còn ${formatVnd(balance)} chưa trả.` : "Đã trả đủ.");

/**
 * Khoản chọn sẵn khi cho vay / nhận lại: khoản được mở từ (kể cả đã trả đủ — cho vay lại người cũ), không thì khoản còn
 * phải thu nhiều nhất. Không ai còn nợ thì không chọn ai ("không gắn khoản phải thu"): chọn sẵn người đã trả đủ là gán nhầm.
 */
export const defaultReceivableId = (refs: ReceivableRef[] | undefined, preferred?: string | null): string | null =>
  refs?.find((r) => r.id === preferred)?.id ?? defaultRefId(openRefs(refs));

/**
 * Người trong ô "Ai trả" / "Cho ai vay". Nhận lại tiền: chỉ người **còn nợ** (> 0) — người đã xong (vd nhà Hoa) không lẫn vào
 * (chủ nhà: "nhà Hoa là xong hết rồi, không nên xuất hiện ở đây"); vẫn giữ người đang chọn (vd vừa thêm bằng "+ Người mới…").
 * Cho vay: mọi người — cho người cũ vay thêm là chuyện thường.
 */
export const receivableOptions = (refs: ReceivableRef[], meaning: "lend" | "collect", selected: string | null): ReceivableRef[] =>
  meaning === "lend" ? refs : refs.filter((r) => r.balance > 0 || r.id === selected);

/** Toast sau khi nhận lại tiền: số đã nhận và người đó còn nợ bao nhiêu. */
export function collectToast(amount: number, r: Pick<ReceivableRef, "name" | "balance">): string {
  return `Đã nhận lại ${formatVnd(amount)} từ ${r.name}. ${unpaidText(r.balance - amount)}`;
}

/** Toast sau khi cho vay thêm. */
export function lendToast(amount: number, r: Pick<ReceivableRef, "name" | "balance">): string {
  return `Đã ghi cho ${r.name} vay thêm ${formatVnd(amount)}. ${unpaidText(r.balance + amount)}`;
}

/**
 * Gợi ý khi nhận lại vượt số còn nợ (`extra` = phần dư của lần trả này). Mua hộ người khác là Cho vay (ADR-84):
 * trả dư thì nhận lại đúng số còn nợ, phần dư là tiền mới của nhà — Thu nhập. Chỉ chia bill nhà mình có phần mới là Hoàn tiền.
 * `split`: màn Gán (tách được dòng); Loại khác thì ghi riêng một khoản Thu nhập.
 */
export function overpaidHint(extra: number, split: boolean): string {
  const how = split ? "Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập." : "Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập.";
  return `Trả dư ${formatVnd(extra)}? ${how} Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền.`;
}

/**
 * Dòng dưới ô "Ai trả" / "Cho ai vay": "{tên} còn nợ X · sau khoản này còn Y" (âm thì "trả dư Z", về 0 thì "trả đủ").
 * `overpaid`: nhận lại vượt số còn nợ — phần dư của riêng lần trả này (0 khi không dư), hiện kèm `overpaidHint`.
 */
export function receivableEffect(r: Pick<ReceivableRef, "name" | "balance">, meaning: "lend" | "collect", amount: number): { text: string; overpaid: number } {
  const after = meaning === "collect" ? r.balance - amount : r.balance + amount;
  const before = r.balance < 0 ? `${r.name} đang trả dư ${formatVnd(-r.balance)}` : `${r.name} còn nợ ${formatVnd(r.balance)}`;
  const then = after > 0 ? `còn ${formatVnd(after)}` : after === 0 ? "trả đủ" : `trả dư ${formatVnd(-after)}`;
  return { text: `${before} · sau khoản này ${then}`, overpaid: meaning === "collect" && after < 0 ? Math.min(amount, -after) : 0 };
}

/** Thân POST /v1/receivables: số tiền là số người đó còn nợ mình lúc mở sổ; 0 = thêm người chưa nợ gì. */
export const receivablePayload = (f: { name: string; amount: number; note: string }): Result<{ name: string; amount: number; note?: string }> =>
  bookPayload(f, { name: "Nhập tên người nợ mình.", amount: "Nhập số tiền còn phải thu." }, true);

/** Thân POST /v1/receivables/:id/lines: sổ phải thu chỉ có dòng chỉnh; cho vay thêm là giao dịch thật. */
export const receivableLinePayload = (f: Omit<BookLineForm<"adjust">, "kind">) => bookLinePayload({ ...f, kind: "adjust" });

export interface MoneyMoveForm {
  meaning: "lend" | "collect";
  amount: number;
  /** Cho vay: tài khoản tiền ra. Nhận lại: tài khoản tiền vào. */
  accountId: string | null;
  receivableId: string | null;
  /** Nhận lại: khoản cho vay được trả (ô "Trả cho khoản cho vay"). Cho vay bỏ qua. */
  linkId?: number | null;
  note: string;
}

/** Thân POST /v1/transactions cho vay / nhận lại tiền: tiền thật đi hoặc về một tài khoản, gắn vào khoản phải thu. */
export function moneyMoveBody(f: MoneyMoveForm, at: string, clientId: string): Result<EntryBody> {
  const errors: Errors = {};
  if (!Number.isInteger(f.amount) || f.amount <= 0) errors.amount = "Nhập số tiền.";
  if (!f.accountId) errors.account = "Chọn tài khoản.";
  return done(errors, () => ({
    meaning: f.meaning,
    amount: f.amount,
    at,
    client_id: clientId,
    account_id: f.accountId!,
    ...(f.receivableId ? { receivable_id: f.receivableId } : {}),
    ...(f.meaning === "collect" && f.linkId ? { link_id: f.linkId } : {}),
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
  }));
}

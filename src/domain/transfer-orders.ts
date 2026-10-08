// Phân bổ trong app là ảo cho tới khi tiền đi thật: ví trú ở tài khoản khác thì sinh lệnh chuyển tiền.

export interface Move {
  walletId: string;
  amount: number;
}

export interface TransferOrderDraft {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  walletIds: string[];
}

export function transferOrders(moves: Move[], walletAccount: Record<string, string | null>, fromAccountId: string | null): TransferOrderDraft[] {
  if (!fromAccountId) return [];
  const byAccount = new Map<string, TransferOrderDraft>();
  for (const move of moves) {
    const to = walletAccount[move.walletId];
    if (!to || to === fromAccountId || move.amount <= 0) continue;
    const order = byAccount.get(to) ?? { fromAccountId, toAccountId: to, amount: 0, walletIds: [] };
    order.amount += move.amount;
    order.walletIds.push(move.walletId);
    byAccount.set(to, order);
  }
  return [...byAccount.values()];
}

// Bỏ các ký tự dễ nhầm khi gõ tay (0/O, 1/I).
const MEMO_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Nội dung chuyển khoản cho một lệnh: `PF` + 6 ký tự ngẫu nhiên, riêng cho từng lệnh. Không đoán được, nên người ngoài
 * chuyển tiền vào tài khoản của nhà không thể giả "đã chuyển" một lệnh; và dài 6 ký tự nên không trùng khuôn
 * mã `[QE]xx` của hệ Google Sheet đang chạy song song.
 */
export function newTransferMemo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `PF ${Array.from(bytes, (b) => MEMO_ALPHABET[b % MEMO_ALPHABET.length]).join("")}`;
}

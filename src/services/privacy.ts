import { DomainError } from "../domain/types";

// Tài khoản riêng tư (access UC-504, ADR-126): người khác chỉ thấy tổng — tên và số dư tài khoản vẫn hiện (ba ngăn cộng đủ),
// không thấy từng khoản chỉ dính tới tài khoản riêng tư bị giấu. Một hàm cho mọi đường liệt kê (REST, Gán, MCP, Sổ).
// Ẩn là lịch sự, không phải bảo mật (D6).

/** Mã các tài khoản bị giấu với `viewerId`: cờ riêng tư bật, chủ còn hoạt động, chủ ≠ người xem (cron: không ai là chủ). */
export async function hiddenAccountIds(db: D1Database, viewerId: string | null): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT a.id FROM accounts a JOIN members m ON m.id = a.owner_member_id
       WHERE a.private = 1 AND m.active = 1 AND a.owner_member_id IS NOT ?`,
    )
    .bind(viewerId)
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

/**
 * Điều kiện SQL "giao dịch bí danh `t` chỉ dính tài khoản bị giấu" (mọi tài khoản của nó đều nằm trong `hidden`, có ít nhất
 * một). Khoản cũ không tài khoản nào (chuyển giữa hai ví) không bị giấu. Trả kèm tham số để nối vào câu WHERE.
 */
export function hiddenTxSql(alias: string, hidden: string[]): { sql: string; binds: string[] } {
  if (hidden.length === 0) return { sql: "0", binds: [] };
  const list = hidden.map(() => "?").join(", ");
  return {
    sql: `((${alias}.account_id IS NULL OR ${alias}.account_id IN (${list})) AND (${alias}.counter_account_id IS NULL OR ${alias}.counter_account_id IN (${list}))
      AND (${alias}.account_id IS NOT NULL OR ${alias}.counter_account_id IS NOT NULL))`,
    binds: [...hidden, ...hidden],
  };
}

type TxSides = { account_id?: unknown; counter_account_id?: unknown };

/**
 * Một giao dịch nhìn từ người xem (access UC-504 bước 3, ADR-133 (1)) — cùng luật với `hiddenTxSql`:
 * `hidden` — mọi tài khoản của nó bị giấu (có ít nhất một); `touches` — một phía bị giấu, phía kia không; `clear` — không dính.
 */
export function txVisibility(tx: TxSides, hidden: string[]): "hidden" | "touches" | "clear" {
  const sides = [tx.account_id, tx.counter_account_id].filter((a) => a !== null && a !== undefined).map(String);
  const n = sides.filter((a) => hidden.includes(a)).length;
  if (n === 0) return "clear";
  return n === sides.length ? "hidden" : "touches";
}

/** Khoản bị giấu ở mọi đường theo id: cùng lỗi, cùng chữ với id không có (ADR-133 (2)). */
export const txNotFound = () => new DomainError("not_found", "Không có giao dịch này.", 404);

/** Đọc theo id: khoản bị giấu → 404 `not_found`. */
export function assertTxReadable(tx: TxSides, hidden: string[]): void {
  if (txVisibility(tx, hidden) === "hidden") throw txNotFound();
}

/** Huỷ / sửa / gỡ gán / phân loại lại: bị giấu → 404 `not_found`; chạm tài khoản riêng tư bị giấu → 403 `private_account`. */
export function assertTxChangeable(tx: TxSides, hidden: string[]): void {
  const v = txVisibility(tx, hidden);
  if (v === "hidden") throw txNotFound();
  if (v === "touches") {
    throw new DomainError("private_account", "Khoản này liên quan Tài khoản riêng tư của người khác, chỉ chủ tài khoản sửa được.", 403);
  }
}

/** Log chờ của tài khoản riêng tư bị giấu: chỉ chủ gán / nối / ghép / bỏ qua → 403 `private_account`. */
export function assertLogChangeable(log: { account_id?: unknown }, hidden: string[]): void {
  if (log.account_id !== null && log.account_id !== undefined && hidden.includes(String(log.account_id))) {
    throw new DomainError("private_account", "Khoản này thuộc Tài khoản riêng tư của người khác, chỉ chủ tài khoản xử lý được.", 403);
  }
}

/** Ghi khoản (hoặc mẫu tự gán) có một phía là tài khoản riêng tư bị giấu với người ghi → 403 `private_account` (ADR-133 (3)). */
export function assertRowWritable(row: TxSides, hidden: string[]): void {
  if (txVisibility(row, hidden) !== "clear") {
    throw new DomainError("private_account", "Tài khoản riêng tư của người khác, chỉ chủ tài khoản mới ghi được vào đây.", 403);
  }
}

/**
 * Tiền thuê không vào tài khoản riêng tư (rental UC-805 AC-10, đóng N-1): khoản `income` mang `tenant_id` mà một phía là tài
 * khoản có cờ riêng tư → 400 `tenant_private_account`, bất kể người ghi. Gọi SAU các kiểm riêng tư (`assertRowWritable`,
 * `assertTxChangeable`, `assertLogChangeable`) để người không phải chủ vẫn nhận 403 `private_account` trước.
 */
export function assertTenantAccount(
  row: TxSides & { meaning?: unknown; tenant_id?: unknown },
  refs: { accounts: readonly { id: string; private: boolean }[] },
): void {
  if (row.meaning !== "income" || !row.tenant_id) return;
  const sides = [row.account_id, row.counter_account_id].filter((a) => a !== null && a !== undefined).map(String);
  if (refs.accounts.some((a) => a.private && sides.includes(a.id))) {
    throw new DomainError("tenant_private_account", "Tiền thuê không ghi vào Tài khoản riêng tư. Chọn tài khoản khác.", 400);
  }
}

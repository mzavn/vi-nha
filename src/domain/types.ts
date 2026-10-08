// Dữ liệu tham chiếu đọc từ D1, dùng chung cho các hàm thuần.

import type { WalletRule } from "./allocation";

export interface WalletRef {
  id: string;
  name: string;
  tier: "holding" | "wealth_building" | "tax" | "nice" | "must";
  mustGroup: "must" | "have" | null;
  kind: "envelope" | "accrual" | "bill" | "holding";
  scope: "shared" | "personal";
  memberId: string | null;
  accountId: string | null;
  /** Đang ẩn số với người khác ngoài chủ ví: ví `private` VÀ chủ ví còn hoạt động (UC-504). */
  private: boolean;
  sort: number;
}

export interface CategoryRef {
  id: string;
  name: string;
  defaultWalletId: string | null;
  icon: string | null;
  sort: number;
}

/** Tài khoản Tích sản (ADR-88): tiền chuyển vào từ tài khoản thường là Tích sản. Heo và sổ tiết kiệm khóa, phao thì không. */
export type AccountRole = "piggy_bank" | "buffer" | "term_deposit";

export interface AccountRef {
  id: string;
  name: string;
  kind: "bank" | "cash" | "ewallet" | "credit";
  ownerMemberId: string | null;
  /** SePay báo tiền vào của tài khoản này (luôn, khi đã nối). */
  sepayEnabled: boolean;
  /** SePay báo cả tiền ra (ADR-66); false khi chưa nối SePay. */
  sepayOut: boolean;
  /** Ngày mở sổ "YYYY-MM-DD" giờ VN (ADR-76): số dư đầu tính tới đầu ngày này; NULL = không có mốc. */
  openedAt: string | null;
  /** Heo đất, sổ tiết kiệm (ADR-77, ADR-88): tiền thật nhưng chưa rút ngay được. */
  locked: boolean;
  /** Tài khoản Tích sản (ADR-88); null = tài khoản thường. Không bao giờ là tài khoản mặc định khi nhập tay. */
  role: AccountRole | null;
}

export interface MemberRef {
  id: string;
  name: string;
  role: string;
}

export interface IncomeStreamRef {
  id: string;
  name: string;
  active: boolean;
  /** Phần khóa của nguồn; rỗng = toàn bộ vào dòng thác. */
  locks: { walletId: string; percent: number }[];
}

export interface TenantRef {
  id: string;
  name: string;
  active: boolean;
}

/** Một đối tác ở sổ đối ứng ngoài sổ cái (sổ nợ, sổ phải thu); `balance` = còn nợ / còn phải thu, ≤ 0 là đã xong. */
export interface BookRef {
  id: string;
  name: string;
  active: boolean;
  balance: number;
}

export interface Refs {
  wallets: WalletRef[];
  categories: CategoryRef[];
  accounts: AccountRef[];
  members: MemberRef[];
  rules: WalletRule[];
  incomeStreams: IncomeStreamRef[];
  tenants: TenantRef[];
  /** Khoản hộ đang nợ người khác (v_debt_balance). */
  debts: BookRef[];
  /** Khoản người khác đang nợ hộ (v_receivable_balance). */
  receivables: BookRef[];
  /** Nguồn thu mặc định cho tiền người thuê trả (config `rental_income_stream_id`). */
  rentalIncomeStreamId: string | null;
}

/** Ví Thu nhập: duy nhất một ví tier='holding' AND kind='holding'. */
export const isIncomeHolding = (w: Pick<WalletRef, "tier" | "kind">) => w.tier === "holding" && w.kind === "holding";
/** Ví quỹ giữ riêng (vd "Thu cho thuê"): tier='holding' nhưng không phải ví Thu nhập. */
export const isReserve = (w: Pick<WalletRef, "tier" | "kind">) => w.tier === "holding" && w.kind !== "holding";

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    /** Ô lỗi theo dạng dấu chấm (vd "members.0.name") để app tô đúng ô; chỉ đặt khi lỗi nằm ở một ô cụ thể. */
    readonly field?: string,
  ) {
    super(message);
  }
}

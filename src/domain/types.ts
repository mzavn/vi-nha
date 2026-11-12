// Dữ liệu tham chiếu đọc từ D1, dùng chung cho các hàm thuần. Không còn ví (v1.40, ADR-131): tiền thuộc ngăn của tài khoản.

export interface CategoryRef {
  id: string;
  name: string;
  icon: string | null;
  sort: number;
  /** Nhóm danh mục (pocket UC-1204); null = chưa xếp nhóm. */
  groupId: string | null;
}

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
  /** Mốc theo dõi SePay (ISO, ADR-113): khoản trước mốc nhập tay được dù tài khoản đã nối; NULL = từ ngày mở sổ. */
  feedFrom: string | null;
  /** Lúc bật "SePay báo cả tiền ra" (ISO): khoản chi trước mốc nhập tay được; NULL = không có mốc. */
  sepayOutFrom: string | null;
  /** Ngăn (pocket UC-1201): savings Tích luỹ · reserve Dự phòng · operating Vận hành · null ngoài ngăn. */
  pocket: "savings" | "reserve" | "operating" | null;
  /** Tài khoản riêng tư (access UC-504): người khác chỉ thấy tổng. */
  private: boolean;
  /** Mục tiêu tài khoản đang dùng gắn tài khoản này, theo thứ tự ưu tiên (pocket UC-1209). `loadRefs` luôn điền. */
  goalIds?: string[];
  /** Tài khoản mẹ khi đây là khoản gửi kỳ hạn (ADR-140); null = không phải tài khoản con. `loadRefs` luôn điền. */
  parentId?: string | null;
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
  /** Ngăn của tiền về (NULL = theo tài khoản nhận, access UC-506). */
  pocket: "savings" | "reserve" | "operating" | null;
  /** Khoản thu từ nguồn này mở kỳ lương (pocket UC-1205). */
  opensCycle: boolean;
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
  categories: CategoryRef[];
  accounts: AccountRef[];
  members: MemberRef[];
  incomeStreams: IncomeStreamRef[];
  tenants: TenantRef[];
  /** Khoản hộ đang nợ người khác (v_debt_balance). */
  debts: BookRef[];
  /** Khoản người khác đang nợ hộ (v_receivable_balance). */
  receivables: BookRef[];
  /** Nguồn thu mặc định cho tiền người thuê trả (config `rental_income_stream_id`). */
  rentalIncomeStreamId: string | null;
  /** Mục tiêu trả thẳng từ tiền chi tiêu đang dùng, theo thứ tự ưu tiên (ADR-141). `loadRefs` luôn điền. */
  operatingGoalIds?: string[];
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    /** Ô lỗi theo dạng dấu chấm (vd "members.0.name") để app tô đúng ô; chỉ đặt khi lỗi nằm ở một ô cụ thể. */
    readonly field?: string,
    /** Tên các trường cũ bị từ chối (400 `model_changed`, ADR-123). */
    readonly fields?: string[],
  ) {
    super(message);
  }
}

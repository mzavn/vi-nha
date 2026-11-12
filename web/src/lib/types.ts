// Hình dạng dữ liệu của /v1. Lấy thẳng kiểu từ src/domain để client không lệch hợp đồng với server.

import type { ManualMeaning } from "../../../src/domain/entry";
import type { PayCycleTask, PayCycleView, QrTarget, TaskKind } from "../../../src/domain/pay-cycle";
import type {
  CashFlow,
  CashFlowGroup,
  CashFlowLine,
  CashFlowLineKey,
  CashFlowMonth,
  IncomeStatement,
  IncomeStatementMonth,
  ReportClass,
  StatementLine,
} from "../../../src/domain/reports";
import type {
  Freedom,
  FreedomMilestone,
  FreedomParams,
  IncomeMilestone,
  IncomePlanLine,
  IncomePlanMember,
  IncomePlanSummary,
  IncomePlanVersion,
  IncomePlanYear,
  ProjectionIncomeLine,
  ProjectionStart,
  SafetyMilestone,
} from "../../../src/domain/freedom";
import type { Snapshot as DomainSnapshot } from "../../../src/domain/snapshot";
import type { BillItem } from "../../../src/domain/rental";
import type { AccountRef as DomainAccountRef, CategoryRef as DomainCategoryRef, MemberRef } from "../../../src/domain/types";

export type { ManualMeaning, MemberRef, PayCycleTask, PayCycleView, QrTarget, TaskKind };

/** Tài khoản trong bootstrap (UC-111): `private` = cờ tài khoản riêng tư, `hiddenFromMe` = riêng tư của người khác (UC-504). */
export type AccountRef = DomainAccountRef & { private?: boolean; hiddenFromMe?: boolean };
/** Danh mục trong bootstrap: không còn ví mặc định (UC-109). */
export type CategoryRef = Omit<DomainCategoryRef, "defaultWalletId">;

/**
 * GET /v1/snapshot (ledger UC-103, Đợt C): thêm kỳ lương hiện tại và danh sách việc (`payCycle`), `paySetup`, số log chờ của
 * tài khoản riêng tư bị giấu. Bản lưu offline cũ thiếu ba trường mới: coi như không kỳ / đã có nguồn mở kỳ / 0.
 */
export type Snapshot = Omit<DomainSnapshot, "attention"> & {
  attention: DomainSnapshot["attention"] & { hiddenPendingLogs?: number };
  payCycle?: PayCycleView | null;
  paySetup?: { hasCycleStream: boolean };
};

export type { CashFlow, CashFlowGroup, CashFlowLine, CashFlowLineKey, CashFlowMonth, IncomeStatement, IncomeStatementMonth, ReportClass, StatementLine };
export type {
  Freedom,
  FreedomMilestone,
  FreedomParams,
  IncomeMilestone,
  IncomePlanLine,
  IncomePlanMember,
  IncomePlanSummary,
  IncomePlanVersion,
  IncomePlanYear,
  ProjectionIncomeLine,
  ProjectionStart,
  SafetyMilestone,
};

export interface Bootstrap {
  member: MemberRef | null;
  members: MemberRef[];
  categories: CategoryRef[];
  accounts: AccountRef[];
  categoryUsage: Record<string, number>;
  /** Khoản nợ đang mở kèm số còn nợ. Bản bootstrap cũ trong cache chưa có trường này: coi như []. */
  debts?: DebtRef[];
  /** Khoản phải thu đang mở kèm số còn phải thu. Bản bootstrap cũ trong cache chưa có trường này: coi như []. */
  receivables?: ReceivableRef[];
}

/** Thân POST /v1/transactions. `at` luôn gửi kèm: khoản nhập offline phải mang giờ lúc nhập, không phải giờ đồng bộ. Không còn ví (Đợt C). */
export interface EntryBody {
  meaning: ManualMeaning;
  amount: number;
  at: string;
  client_id: string;
  category_id?: string;
  account_id?: string;
  to_account_id?: string;
  note?: string;
  taxable?: boolean;
  link_id?: number;
  asset_kind?: string;
  income_stream_id?: string;
  tenant_id?: string;
  /** Khoản chi trả cho một khoản nợ trong sổ nợ. */
  debt_id?: string;
  /** Cho vay / nhận lại tiền cho vay gắn vào một khoản trong sổ phải thu. */
  receivable_id?: string;
  /** Khoản chi trả LÃI cho một khoản nợ (chỉ spend, không cùng debt_id); thiếu category_id thì server lấy "loan-interest". */
  interest_debt_id?: string;
  /** Người nhập xác nhận khoản SePay đã báo (409 `bank_log_exists`) là khoản thật thứ hai. */
  confirm_duplicate?: boolean;
  /** Thu nhập: "Lương — mở kỳ lương" (pocket UC-1205); thiếu = theo cờ của nguồn. */
  opens_cycle?: boolean;
  /** Mục tiêu Dự phòng mà khoản chi / chuyển ra này dùng tiền (pocket UC-1209 bước 11); chỉ gửi khi người nhập chọn. */
  goal_id?: string;
  /** Khoản thu là tiền lãi (QĐ2, ADR-140): chỉ gửi khi thu vào mẹ có mục tiêu hoặc con của nó. */
  is_interest?: boolean;
  /** Khoản chi / chuyển ra khỏi nhóm mẹ + con lấy từ tiền lãi ("Từ tiền lãi"); không đi cùng `goal_id`. */
  from_interest?: boolean;
}

/** Hệ quả lên kỳ lương của một lần ghi (POST /v1/transactions, /replace, gán log). */
export interface EntryEffects {
  cycle: { opened: boolean; startedAt: string; payday: string; tasks: number } | null;
  tasksDone: { id: number; kind: TaskKind }[];
}

/** Tiền vận hành sau khi ghi — cho toast "Đã ghi · Vận hành còn …" (UC-703). */
export interface EntryNearSpend {
  amount: number;
  perDay: number | null;
}

/** Một dòng sổ (GET /v1/transactions, GET /v1/transactions/:id). */
export interface TxRow {
  id: number;
  at: string;
  amount: number;
  meaning: string;
  status: string;
  account_id: string | null;
  counter_account_id: string | null;
  category_id: string | null;
  asset_kind: string | null;
  note: string | null;
  category_name?: string | null;
  by_member_id?: string | null;
  source?: string | null;
  log_id?: string | null;
  /** Log tiền vào (chân nhận) của chuyển khoản — cả khoản nhập tay đã nối log (ADR-113). */
  log_id_2?: string | null;
  link_id?: number | null;
  taxable?: number | null;
  income_stream_id?: string | null;
  tenant_id?: string | null;
  debt_id?: string | null;
  receivable_id?: string | null;
  debt_name?: string | null;
  receivable_name?: string | null;
  tenant_name?: string | null;
  /** 1 = khoản thu này đã được chia (có lần chia). */
  allocated?: number | null;
  /** GET /v1/transactions/:id: các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về khoản này (cũ trước). */
  linked_from?: TxLinkedFrom[];
  /** GET /v1/transactions/:id: khoản gốc của khoản hoàn tiền / nhận lại có `link_id`. */
  link?: TxLink | null;
  /** Lý do lần chia khoản thu này không trả cho mình (Tích sản 0, ADR-112); null nếu không có. */
  wealth_note?: string | null;
  /** Loại chi cũ chép từ phe của ví lúc lên v2 (ADR-131); null ở khoản mới và khoản cũ không ví. */
  legacy_class?: LegacyClass | null;
  /** Khoản cũ (id ≤ `config.legacy_max_tx_id`): Sổ gắn nhãn "cách tính cũ". */
  legacy?: boolean;
  /** Mục tiêu Dự phòng của khoản chi / chuyển ra (pocket UC-1209 bước 11); null = không cho mục tiêu nào. */
  goal_id?: string | null;
  /** Khoản thu có phân loại "tiền lãi" tường minh (`passive_income`). */
  is_interest?: boolean;
  /** Khoản chi / chuyển ra lấy từ tiền lãi của nhóm. */
  from_interest?: boolean;
}

/** Loại chi (cách tính cũ) của giao dịch trước v2 (transactions.legacy_class). */
export type LegacyClass = "essential" | "flex" | "tax" | "savings" | "holding";

export interface TxLinkedFrom {
  id: number;
  at: string;
  amount: number;
  meaning: string;
}

export interface TxLink extends TxLinkedFrom {
  status: string;
  category_name: string | null;
  receivable_name: string | null;
}

/** GET /v1/transactions/summary: tổng theo loại của đúng tập dòng sổ đang lọc, chỉ khoản còn hiệu lực (ledger UC-111). */
export interface TxSummary {
  count: number;
  spend: number;
  refund: number;
  income: number;
  lend: number;
  collect: number;
  transfer: number;
  buy_asset: number;
  adjust_in: number;
  adjust_out: number;
}

/**
 * GET /v1/transactions/link-candidates: một khoản gốc còn hiệu lực (khoản chi / khoản cho vay) để nối khoản tiền về.
 * `receivable_id` là người vay (khoản chi: null).
 */
export interface LinkCandidate {
  id: number;
  at: string;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  receivable_id: string | null;
  receivable_name: string | null;
  note: string | null;
  bank_content: string | null;
}

export interface CreateEntryResult {
  tx: TxRow;
  duplicate: boolean;
  nearSpend?: EntryNearSpend | null;
  effects?: EntryEffects;
}

/** POST /v1/transactions/:id/replace: khoản mới, id khoản cũ vừa huỷ. */
export interface ReplaceEntryResult extends CreateEntryResult {
  replaced: number;
}

export interface AccountRow {
  accountId: string;
  name: string;
  kind: AccountRef["kind"];
  bookBalance: number;
  feedBalance: number | null;
  bookDrift: number | null;
  pendingNet: number | null;
  pendingCount: number | null;
  lastAt: string | null;
  lastCountAt: string | null;
}

export interface CountResult {
  accountId: string;
  book: number;
  counted: number;
  diff: number;
}

/**
 * Log ngân hàng chưa gán (GET /v1/logs?status=pending). Phase 04 chưa chốt hình dạng phản hồi;
 * đây là các cột của bảng bank_logs cộng gợi ý từ rule — xem báo cáo phase 05.
 */
export interface BankLog {
  id: string;
  at: string;
  amount: number;
  direction: "in" | "out";
  account_id: string | null;
  content: string | null;
  suggestion?: {
    meaning?: string | null;
    category_id?: string | null;
    is_salary?: boolean | null;
    /** Log khác (webhook ↔ rà soát đêm) có thể là cùng giao dịch này. */
    possible_duplicate_of?: string | null;
    label?: string | null;
    /** Rule mang người thuê: chỉ gợi ý "Thu từ <tên>", người vẫn phải bấm. */
    tenant_id?: string | null;
    /** Lời nhắc kèm gợi ý, vd log tiền ra của tài khoản SePay đang để "chỉ tiền vào" (ADR-66). */
    note?: string | null;
    /** transfer: tài khoản đầu kia (rút tiền mặt, bỏ heo đất, heo trả về — chỉ tài khoản). */
    other_account_id?: string | null;
    /** Chân còn lại của chuyển nội bộ đã ghi (ADR-81): gán Chuyển nội bộ với `other_account_id` là gắn vào giao dịch này. */
    attach_to_tx?: number | null;
    /** Log lãi tiền gửi (change 261018-lai-tien-gui): gán Lãi tiền gửi. */
    interest?: boolean | null;
  } | null;
  /** "Đã nhập tay?": khoản nhập tay khớp log (chiều, số tiền, ngày lệch ≤ 1) — Nối là gắn log vào đó, không ghi thêm. */
  manual_matches?: ManualMatch[];
}

/** Một khoản nhập tay khớp log chờ gán (GET /v1/logs, `manual_matches`). */
export interface ManualMatch {
  id: number;
  at: string;
  amount: number;
  meaning: string;
  category_id: string | null;
  note: string | null;
}

// ── Cài đặt (/v1/settings) ─────────────────────────────────────────
// Tên cột giữ đúng snake_case của API, khác các kiểu *Ref ở trên (camelCase, lấy từ src/domain).

export interface SettingsAccount {
  id: string;
  name: string;
  kind: "bank" | "cash" | "ewallet" | "credit";
  bank: string | null;
  account_no: string | null;
  sub_account: string | null;
  sepay_enabled: boolean;
  /** SePay báo cả tiền ra (ADR-66); luôn false khi chưa nối SePay. */
  sepay_out: boolean;
  /** Kết nối SePay báo giao dịch của tài khoản này; null khi chưa nối SePay. */
  sepay_connection_id: string | null;
  owner_member_id: string | null;
  opening_balance: number;
  opened_at: string | null;
  /** Mốc theo dõi SePay (ISO, ADR-113): log trước mốc như trước ngày số dư đầu; null = từ ngày số dư đầu. */
  feed_from: string | null;
  /** Lúc bật "SePay báo cả tiền ra" (ISO); log ra trước mốc không tự gán. */
  sepay_out_from: string | null;
  /** Log SePay sớm nhất của tài khoản (ISO); null khi chưa có — để gợi ý đặt mốc theo dõi. */
  first_log_at: string | null;
  active: boolean;
  /** Ngày tắt (YYYY-MM-DD giờ VN); null khi đang dùng hoặc tắt từ trước v1.31. */
  deactivated_at: string | null;
  /** Số dư sổ hiện có (ledger `v_account_book`); null khi tài khoản đã tắt. */
  book_balance: number | null;
  /** Ngăn của tài khoản (v2, UC-1201); null = ngoài ngăn. Bản cài đặt lưu offline cũ thiếu hai trường này. */
  pocket?: Pocket | null;
  /** Người đã xác nhận ngăn (bản cập nhật chỉ đề xuất). */
  pocket_confirmed?: boolean;
  /** Tài khoản riêng tư (UC-504): người khác chỉ thấy tổng. Bản cài đặt lưu offline cũ thiếu. */
  private?: boolean;
  /** Tài khoản mẹ khi đây là khoản gửi kỳ hạn (ADR-140); null = không phải tài khoản con. Bản cài đặt lưu offline cũ thiếu. */
  parent_account_id?: string | null;
}

/** Ba ngăn (v2): Tích luỹ · Dự phòng · Vận hành. */
export type Pocket = "savings" | "reserve" | "operating";

/**
 * Mục tiêu Dự phòng (GET /v1/settings › goals, UC-1209), theo thứ tự ưu tiên. `held` = đã có sau khi chia số dư tài khoản theo
 * thứ tự ưu tiên (có thể âm); null = chưa gắn tài khoản.
 */
export interface ReserveGoal {
  id: string;
  name: string;
  account_id: string | null;
  /** Nơi để tiền (ADR-141): `account` một tài khoản để dành · `operating` trả thẳng từ tiền chi tiêu. Bản lưu cũ thiếu = `account`. */
  pays_from?: "account" | "operating";
  /** Mục tiêu `operating`: còn phải trả kỳ này = max(0, mỗi tháng − đã chi từ Vận hành); null với mục tiêu `account`. */
  remaining?: number | null;
  /** Tài khoản đề xuất của bản cập nhật (chỉ gợi ý cho màn chuyển đổi, không phải gắn); null = không có. */
  suggested_account_id: string | null;
  held: number | null;
  /** Số cần (= B); null với mục tiêu % hoặc chưa gắn tài khoản. */
  need: number | null;
  /** Đã chi cho mục tiêu trong kỳ lương hiện tại. */
  spent: number;
  /** Còn thiếu = max(0, need − held − spent); null khi need null. */
  short: number | null;
  target_amount: number | null;
  target_pct: number | null;
  monthly_amount: number | null;
  repeat_months: number | null;
  /** YYYY-MM-DD; null = chưa đặt. */
  due_date: string | null;
  debt_id: string | null;
  sort: number;
  active: boolean;
}

/** Nhóm mục tiêu của một tài khoản (GET /v1/settings › goal_groups) — cùng số với `snapshot.pockets.reserve.groups`. */
export interface SettingsGoalGroup {
  account_id: string;
  balance: number;
  need: number | null;
  spent: number;
  short: number | null;
  extra: number | null;
  goal_ids: string[];
  /** Tài khoản con đang dùng của mẹ; `balance` = số dư gộp (mẹ + con). */
  child_ids?: string[];
  /** Tiền lãi của nhóm: số chia cho mục tiêu = `balance − interest`. */
  interest?: number;
}

/** Nhóm danh mục và hạn mức mềm mỗi kỳ lương (UC-1204); `cycle_limit` null = không đặt. */
export interface CategoryGroup {
  id: string;
  name: string;
  essential: boolean;
  cycle_limit: number | null;
  sort: number;
  active: boolean;
}

export interface SettingsMember {
  id: string;
  name: string;
  role: string;
  tg_chat_id: string | null;
  /** Chat Zalo đã nối (nối bằng mã nhắn cho bot, ADR-80). Bản cài đặt lưu offline từ trước khi có Zalo thì thiếu trường này. */
  zalo_chat_id?: string | null;
  active: boolean;
  /** Có mật khẩu riêng (UC-507 AC-14); server không bao giờ trả băm. Bản cài đặt lưu offline cũ thiếu trường này = dùng mật khẩu chung. */
  has_password?: boolean;
}

export interface Rule {
  id: number;
  priority: number;
  match_type: "code" | "content" | "account";
  pattern: string;
  meaning: "spend" | "transfer" | "income";
  is_salary: boolean;
  category_id: string | null;
  by_member_id: string | null;
  active: boolean;
  incomeStreamId?: string | null;
}

/** Nguồn thu (UC-506, UC-709). */
export interface IncomeStream {
  id: string;
  name: string;
  sort: number;
  active: boolean;
  /** Ngăn của tiền về (UC-506); null = theo tài khoản nhận. Bản cài đặt lưu offline cũ thiếu. */
  pocket?: Pocket | null;
  /** "Mở kỳ lương" (pocket UC-1205). Bản cài đặt lưu offline cũ thiếu. */
  opens_cycle?: boolean;
}

/** Bí mật chỉ ghi: server chỉ trả đã đặt hay chưa và 4 ký tự cuối. */
export interface Secret {
  set: boolean;
  hint: string | null;
  /** "app": đặt từ màn Cài đặt, xoá được ở đây. "server": đặt bằng wrangler secret, không xoá được từ app. */
  source?: "app" | "server" | null;
}

export interface SettingsConfig {
  salary_min_amount: number;
  /** Lãi tiền gửi: log tiền vào nhỏ hơn số này (nội dung rỗng / BankAPINotify / "lãi tiền gửi") thì máy tự ghi; 0 = tắt. */
  interest_max_amount: number;
  safety_fund_months: number;
  /** Ngày lương 1–31 (tháng ít ngày hơn lấy ngày cuối tháng; mặc định 10). Optional: bản cài đặt lưu offline cũ chưa có. */
  payday_day?: number;
  /** Tham số bảng cân đối / Mốc tự do (phần vạn: 350 = 3,5%). */
  fi_swr_bps: number;
  fi_inflation_bps: number;
  fi_fat_bps: number;
  fi_legacy_rate_bps: number;
  fi_high_interest_bps: number;
  /** Ba số tháng Mốc an tâm, tăng dần: "6,12,24". */
  fi_safety_months: string;
  /** null = theo sổ. */
  fi_expense_monthly: number | null;
  fi_expense_must_monthly: number | null;
  fi_birth_year: number | null;
  fi_target_age_f1: number | null;
  fi_target_age_f2: number | null;
  fi_target_age_f3: number | null;
  /** Dư cuối kỳ vào Tích luỹ (0–100, mặc định 50, UC-1207). Optional: bản cài đặt lưu offline cũ chưa có. */
  surplus_savings_pct?: number;
  /** Ví Thưởng: mã tài khoản Dự phòng không gắn mục tiêu (UC-1209 bước 4); null = chưa chọn. */
  surplus_reward_account?: string | null;
  /** % gợi ý trích sang Tích luỹ mỗi kỳ lương (1–100, UC-507). Optional: bản cài đặt lưu offline cũ chưa có. */
  savings_pct?: number;
}

/** Giờ nhắc của cả nhà (GET /v1/settings › notifySchedule). Giờ "HH:MM" giờ VN; weeklyDay 1 = thứ Hai .. 7 = Chủ nhật. */
export interface NotifySchedule {
  dailyTime: string;
  weeklyDay: number;
  weeklyTime: string;
  quietStart: string;
  quietEnd: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  pendingEnabled: boolean;
}

export type SecretKey = "telegram_bot_token" | "zalo_bot_token" | "zalo_webhook_secret";

/** Khoá và token riêng của từng kết nối SePay (PATCH /v1/settings/sepay/connections/:id). */
export type SepaySecretKey = "api_token" | "webhook_key";

/** Một tài khoản SePay: mỗi tài khoản một token API và một khoá webhook. Kết nối mặc định có id DEFAULT_SEPAY_CONNECTION_ID. */
export interface SepayConnection {
  id: string;
  name: string;
  active: boolean;
  api_token: Secret;
  webhook_key: Secret;
  /** id các tài khoản trong app nối qua kết nối này. */
  accounts: string[];
}

export interface Integrations {
  webhook_url: string;
  telegram_bot_token: Secret;
  /** Ba trường Zalo: bản cài đặt lưu offline từ trước khi có Zalo thì thiếu. */
  zalo_bot_token?: Secret;
  zalo_webhook_secret?: Secret;
  /** Địa chỉ Zalo gửi tin nhắn của bot về (`<origin>/webhooks/zalo`). */
  zalo_webhook_url?: string;
  /** Bản cài đặt lưu offline từ trước khi có nhiều kết nối SePay thì thiếu trường này. */
  sepay_connections?: SepayConnection[];
}

export interface SettingsData {
  accounts: SettingsAccount[];
  members: SettingsMember[];
  rules: Rule[];
  categories: { id: string; name: string; groupId?: string | null }[];
  config: SettingsConfig;
  integrations: Integrations;
  incomeStreams?: IncomeStream[];
  /** Bản cài đặt lưu offline từ trước khi có giờ nhắc thì thiếu trường này. */
  notifySchedule?: NotifySchedule;
  /** Mục tiêu Dự phòng (UC-1209) theo thứ tự ưu tiên; nhiều mục tiêu dùng chung được một tài khoản thật ngăn Dự phòng. */
  goals: ReserveGoal[];
  /** Nhóm mục tiêu theo tài khoản (mỗi tài khoản có ≥ 1 mục tiêu đang dùng, theo mục tiêu đầu tiên). */
  goal_groups: SettingsGoalGroup[];
  /** Ba ngăn (v2): bản cài đặt lưu offline cũ thiếu trường này. */
  categoryGroups?: CategoryGroup[];
}

/** Kết quả nút Gửi thử (Telegram, Zalo). */
export interface SendTestResult {
  sent: boolean;
  error?: string;
}

/** Mã nối Zalo: người đó nhắn mã cho bot trước `expires_at` (ISO). */
export interface ZaloLinkCode {
  code: string;
  expires_at: string;
}

/** Kết quả nút Đặt webhook Zalo. `verified`: Zalo gọi thử địa chỉ được không (null = Zalo không báo). */
export interface ZaloWebhookResult {
  ok: boolean;
  url: string;
  verified: boolean | null;
  error?: string;
}

export interface SepayTestResult {
  ok: boolean;
  error?: string;
  /** Tài khoản trong app nối qua kết nối này (đang bật SePay): số giao dịch đọc được 7 ngày qua. */
  accounts: { id: string; name: string; transactions: number; error?: string }[];
  /** Tài khoản ngân hàng SePay báo đang nối với token này. */
  linked: { account_number: string; bank: string | null; label: string | null }[];
}

export interface SepaySyncResult {
  from: string;
  to: string;
  added: number;
  duplicates: number;
  /** Giao dịch trước ngày mở sổ của tài khoản (ADR-76): đã nằm trong số dư đầu, không ghi vào sổ. */
  beforeOpening: number;
  /** Giao dịch trước mốc theo dõi SePay (ADR-113): đã có trong sổ, không ghi lại. */
  beforeFeed: number;
  perConnection: { id: string; name: string; added: number; duplicates: number; beforeOpening: number; beforeFeed: number; error: string | null }[];
  errors: string[];
}

// ── Thông báo đẩy (/v1/push) ───────────────────────────────────────

export interface PushDevice {
  id: number;
  memberId: string;
  memberName: string;
  /** Nhãn ngắn server rút từ user agent, vd "iPhone · Safari". */
  device: string | null;
  createdAt: string;
  lastOkAt: string | null;
  /** Thuộc người đang đăng nhập. */
  mine: boolean;
}

export interface PushInfo {
  /** Khoá công khai VAPID, base64url 65 byte. */
  publicKey: string;
  subscriptions: PushDevice[];
  /** Lượt "Thử khi tắt app" gần nhất của người đang đăng nhập, nếu hẹn trong 15 phút qua. */
  series: PushTestSeries | null;
}

export interface PushTestSeries {
  id: number;
  status: "pending" | "running" | "done" | "cancelled";
  /** Số tin đã gửi (mỗi tin tới mọi máy của người hẹn). */
  sent: number;
  count: number;
  interval_s: number;
  createdAt: string;
}

export interface PushTestResult {
  sent: number;
  failed: number;
}

// ── Nhật ký thay đổi (/v1/settings/audit, ADR-90) ─────────────────

export interface AuditEntry {
  id: number;
  /** Giờ SQLite UTC `2026-10-06 07:00:00`. */
  at: string;
  memberId: string | null;
  memberName: string | null;
  via: "session" | "token" | "mcp";
  /** vd "tx.void", "push.add", "sepay.update". */
  action: string;
  /** vd "tx:12", "account:vcb-husband", "push:3". */
  target: string | null;
  /** Tên trường đã đổi và giá trị không bí mật — không bao giờ có khoá. */
  detail: Record<string, unknown> | null;
}

// ── Claude và ứng dụng AI (/v1/settings/mcp) ──────────────────────

/** Một kết nối MCP (grant OAuth) — không bao giờ có token hay mã. */
export interface McpConnection {
  grantId: string;
  memberId: string;
  memberName: string;
  /** Tên ứng dụng lưu lúc uỷ quyền, vd "Claude". */
  clientName: string;
  /** Tên miền đã xác minh (Client ID Metadata Document), vd "claude.ai". */
  clientDomain: string | null;
  /** Máy chủ của redirect_uri, vd "claude.ai". */
  redirectHost: string | null;
  /** Quyền thô: "mcp:read", "mcp:write". */
  scopes: string[];
  /** ISO UTC lúc uỷ quyền. */
  createdAt: string;
}

export interface McpSettings {
  /** `https://<host>/mcp` — địa chỉ dán vào Claude. */
  endpoint: string;
  connections: McpConnection[];
}

// ── Người thuê (/v1/rental) ────────────────────────────────────────

export type BillStatus = "draft" | "issued";

/** Bản tính tháng trước (tháng đang tới hạn gửi) trong danh sách người thuê. */
export interface TenantBillSummary {
  id: number;
  month: string;
  status: BillStatus;
  total: number;
  revision: number;
  /** Đã sửa sau khi gửi. */
  edited: boolean;
}

export interface TenantSummary {
  id: string;
  name: string;
  active: boolean;
  /** Dương = còn nợ; âm = đã trả dư, trừ vào tháng sau. */
  balance: number;
  bill: TenantBillSummary | null;
}

export interface Rental {
  incomeStreamId: string | null;
  tenants: TenantSummary[];
}

export interface BillItemView extends BillItem {
  /** Số tháng trước của khoản cùng tên, `null` khi tháng trước không có. */
  previous: number | null;
}

export type BillQr = { payload: string; label: string; memo: string; transfer: string } | { reason: string };

/** GET /v1/rental/tenants/:id/bills/:month (rental UC-806, UC-807). */
export interface BillView {
  tenant: { id: string; name: string; active: boolean };
  /** "2026-10" — tháng ở / tháng dùng điện. */
  month: string;
  status: "none" | BillStatus;
  bill: null | {
    id: number;
    status: BillStatus;
    revision: number;
    issuedAt: string | null;
    /** ≠ null: đã sửa sau khi gửi. */
    editedAt: string | null;
    receiveAccountId: string | null;
    copiedFromMonth: string | null;
    items: BillItemView[];
  };
  /** Bản tính gần nhất trước tháng này (nguồn chép khi chưa lập). */
  previous: null | { month: string; total: number; items: BillItem[] };
  totals: { fixed: number; variable: number; total: number };
  total: number;
  /** "Các tháng trước": dương còn nợ, âm trả dư. */
  previousBalance: number;
  text: string | null;
  qrAmount: number;
  qr: BillQr | null;
  payments: { transactionId: number; at: string; amount: number }[];
  /** Số dư hiện tại ("Còn nợ tất cả"). */
  balance: number;
}

// ── Sổ nợ (/v1/debts) ──────────────────────────────────────────────

/** Khoản nợ trong bootstrap: đủ để chọn khoản khi trả nợ. */
export interface DebtRef {
  id: string;
  name: string;
  /** Số còn nợ = đã vay − đã trả; ≤ 0 là trả xong. */
  balance: number;
  /** Lãi suất %/năm (0 = không lãi). Bản bootstrap cũ trong cache thiếu các trường lãi: coi như 0 / null. */
  interestRate?: number;
  monthlyPayment?: number | null;
  dueDay?: number | null;
  interestThisMonth?: number;
  interestPaidThisMonth?: number;
}

export type Term = "short" | "long";

export type DebtLineKind = "opening" | "borrow" | "adjust";

export interface DebtLine {
  id: number;
  debtId: string;
  at: string;
  kind: DebtLineKind;
  /** Có dấu: dương = nợ thêm; chỉnh giảm thì âm. */
  amount: number;
  note: string | null;
  status: "active" | "void";
}

export interface DebtPayment {
  transactionId: number;
  at: string;
  amount: number;
  accountId: string | null;
  note: string | null;
  source: "manual" | "sepay" | "system";
}

export interface Debt {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  owed: number;
  paid: number;
  balance: number;
  done: boolean;
  createdAt: string;
  /** Dòng còn hiệu lực, mới nhất trước. */
  lines: DebtLine[];
  /** Khoản chi trả nợ, mới nhất trước. */
  payments: DebtPayment[];
  /** Lãi suất %/năm. */
  interestRate: number;
  term: Term;
  monthlyPayment: number | null;
  dueDay: number | null;
  /** floor(còn nợ × lãi suất). */
  interestPerYear: number;
  /** Lãi dự kiến tháng này theo dư nợ đầu tháng (Công thức 18). */
  interestThisMonth: number;
  interestPaidThisMonth: number;
  deactivatedAt: string | null;
}

export interface DebtsData {
  totalBalance: number;
  debts: Debt[];
}

// ── Sổ phải thu (/v1/receivables) ──────────────────────────────────

/** Khoản phải thu trong bootstrap: đủ để chọn khoản khi cho vay / nhận lại tiền. */
export interface ReceivableRef {
  id: string;
  name: string;
  /** Số còn phải thu = đã cho vay − đã nhận lại; ≤ 0 là người đó đã trả đủ. */
  balance: number;
}

export interface ReceivableLine {
  id: number;
  receivableId: string;
  at: string;
  kind: "opening" | "adjust";
  /** Có dấu: dương = người đó nợ thêm; chỉnh giảm thì âm. */
  amount: number;
  note: string | null;
  status: "active" | "void";
}

export interface ReceivableMovement {
  transactionId: number;
  at: string;
  amount: number;
  kind: "lend" | "collect";
  /** Tài khoản tiền rời đi (cho vay) hoặc tiền về (nhận lại). */
  accountId: string | null;
  note: string | null;
  source: "manual" | "sepay" | "system";
}

export interface Receivable {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  lent: number;
  collected: number;
  balance: number;
  done: boolean;
  createdAt: string;
  /** Dòng còn hiệu lực, mới nhất trước. */
  lines: ReceivableLine[];
  /** Lần cho vay / nhận lại (giao dịch còn hiệu lực), mới nhất trước. */
  movements: ReceivableMovement[];
  term: Term;
  deactivatedAt: string | null;
}

export interface ReceivablesData {
  totalBalance: number;
  receivables: Receivable[];
}

/** GET /v1/networth: tiền thật trước, sổ đối ứng (ai nợ ai) sau. */
export interface NetWorth {
  /** Σ số dư sổ của tài khoản đang dùng — tiền thật đang có. */
  cash: number;
  /** Tổng từng ngăn (pocket UC-1203 bước 2), nằm trong `cash`. */
  pockets: { savings: number; reserve: number; operating: number; outside: number };
  /** Chi tiết Tích luỹ: các tài khoản ngăn Tích luỹ. */
  savings: { accounts: { id: string; name: string; balance: number }[] };
  /** Vàng, chứng khoán… mua qua app: không phải tiền mặt. */
  assets: number;
  receivables: number;
  tenants: number;
  tenantsPrepaid: number;
  debts: number;
  /** Σ giá trị hiện tại của tài sản ngoài app (mục nhập tay ở bảng cân đối). */
  balanceItems: number;
  netWorth: number;
}

// ── Bảng cân đối (/v1/balance-sheet, /v1/balance-items…) ───────────

export type BalanceSection = "A1" | "A2" | "A3" | "A4" | "A5" | "B1" | "B2" | "B3" | "B4" | "B5" | "B6";
export type PyramidTier = "speculative" | "growth" | "income" | "protective" | "fixed";
export type AssetKind = "gold" | "stock" | "fund" | "re";
export type InterestGroup = "none" | "normal" | "high";

/** Phần trăm: một chữ số lẻ, cắt về 0 (15.5); null = "—". */
export interface BalanceRow {
  /** "cash" | "receivables:short" | "receivables:long" | "tenants" | "app:<asset_kind>" | "item:<id>" */
  key: string;
  source: "ledger" | "item";
  itemId: string | null;
  name: string;
  section: BalanceSection;
  pyramid: PyramidTier;
  liquid: boolean;
  investable: boolean;
  value: number;
  pctOfTotal: number | null;
  pctOfEquity: number | null;
  cashflowMonthly: number | null;
  expectedReturnBps: number | null;
  valuedOn: string | null;
}

export interface LiabilityRow {
  /** "debt:<id>" | "card:<accountId>" | "tenants-prepaid" */
  key: string;
  kind: "debt" | "credit_card" | "tenant_prepaid";
  refId: string | null;
  /** Thẻ tín dụng: tên tài khoản (màn tự thêm "Thẻ tín dụng · "). */
  name: string;
  term: Term;
  group: InterestGroup;
  value: number;
  interestRateBps: number;
  interestPerYear: number;
  interestThisMonth: number;
  dueDay: number | null;
  pctOfTotal: number | null;
  pctOfEquity: number | null;
}

/** Lãi / lỗ, khoảng cách tới chốt lời / cắt lỗ, trạng thái, CAGR (Công thức 17). */
export interface BalancePosition {
  pnl: number;
  pnlPct: number | null;
  toTakeProfitPct: number | null;
  /** Âm khi giá đã xuống dưới giá cắt lỗ. */
  toStopLossPct: number | null;
  status: "take_profit" | "stop_loss" | "holding";
  heldDays: number | null;
  /** null khi giữ < 365 ngày, chưa có ngày mua, hoặc giá mua / giá hiện tại 0. */
  cagrPct: number | null;
  cagrVsExpected: number | null;
}

export interface BalanceLot {
  id: number;
  itemId: string;
  boughtOn: string;
  /** Phần nghìn đơn vị: 20 chỉ = 20000. */
  quantityMilli: number;
  unitCost: number;
  soldOn: string | null;
  soldUnitPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  note: string | null;
  createdAt: string;
  held: boolean;
  /** Giá trị tại ngày xem (lô đang giữ); 0 khi đã bán. */
  value: number;
  cost: number;
  /** Lãi / lỗ đã chốt (lô đã bán). */
  realized: number | null;
  position: BalancePosition | null;
}

export interface BalanceValue {
  id: number;
  itemId: string;
  asOf: string;
  value: number | null;
  unitPrice: number | null;
  cashflow: number;
  cashflowPeriod: "month" | "year" | null;
  expectedReturnBps: number | null;
  createdAt: string;
}

export interface BalanceItem {
  id: string;
  name: string;
  section: Exclude<BalanceSection, "A3">;
  pyramid: PyramidTier;
  measure: "value" | "units";
  unit: string | null;
  liquid: boolean;
  investable: boolean;
  assetKind: AssetKind | null;
  costBasis: number | null;
  acquiredOn: string | null;
  takeProfitValue: number | null;
  stopLossValue: number | null;
  note: string | null;
  sort: number;
  createdAt: string;
  /** Có mặt ở bảng tại ngày xem (có định giá / lô đang giữ). */
  present: boolean;
  value: number | null;
  /** Mục theo lô: giá một đơn vị hiện tại; null = chưa có giá (mỗi lô tính theo giá mua). */
  unitPrice: number | null;
  priceOn: string | null;
  cashflow: number;
  cashflowPeriod: "month" | "year" | null;
  cashflowMonthly: number | null;
  expectedReturnBps: number | null;
  heldQuantityMilli: number;
  cost: number;
  /** Mục theo giá trị có giá mua; null với mục theo lô (xem từng lô). */
  position: BalancePosition | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  hitTakeProfit: number;
  hitStopLoss: number;
  /** Lô còn hiệu lực: đang giữ trước, đã bán sau. */
  lots: BalanceLot[];
  /** Định giá còn hiệu lực, mới nhất trước. */
  values: BalanceValue[];
}

export interface BalanceSheet {
  date: string;
  today: string;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  interestPerYear: number;
  /** P: Σ dòng tiền thật/tháng. */
  cashflowMonthly: number;
  /** P_ròng: sau bù lạm phát của chính tài sản sinh ra dòng tiền. */
  netCashflowMonthly: number;
  assets: { section: BalanceSection; total: number; rows: BalanceRow[] }[];
  liabilities: { term: Term; group: InterestGroup; total: number; rows: LiabilityRow[] }[];
  /** Luôn năm tầng, từ trên xuống: mạo hiểm → cố định. */
  pyramid: { tier: PyramidTier; total: number; pct: number | null }[];
  items: BalanceItem[];
}

export interface BalanceHistoryPoint {
  month: string;
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  /** Chênh vốn chủ so với điểm trước; null ở điểm đầu. */
  change: number | null;
  pyramid: Record<PyramidTier, number>;
}

export interface BalanceHistory {
  points: BalanceHistoryPoint[];
}

// ── Lưu chuyển tiền, Kết quả thu chi (/v1/reports/…) ───────────────

/** Một giao dịch của một dòng Lưu chuyển tiền (GET /v1/reports/transactions). */
export interface ReportTx {
  id: number;
  at: string;
  /** Có dấu: + tiền vào tài khoản, − tiền ra. */
  amount: number;
  meaning: string;
  note: string | null;
  categoryName: string | null;
  /** Nhóm danh mục (của khoản gốc với khoản hoàn); null = không danh mục / chưa xếp nhóm. */
  groupName: string | null;
  accountName: string | null;
  reportClass: ReportClass | null;
  defaultLine: CashFlowLineKey;
}

export interface ReportTransactions {
  period: string;
  line: CashFlowLineKey;
  group: CashFlowGroup;
  transactions: ReportTx[];
}

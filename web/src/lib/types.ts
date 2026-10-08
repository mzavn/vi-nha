// Hình dạng dữ liệu của /v1. Lấy thẳng kiểu từ src/domain để client không lệch hợp đồng với server.

import type { AllocationResult } from "../../../src/domain/allocation";
import type { ManualMeaning } from "../../../src/domain/entry";
import type { Snapshot } from "../../../src/domain/snapshot";
import type { TransferOrderDraft } from "../../../src/domain/transfer-orders";
import type { AccountRef, AccountRole, CategoryRef, MemberRef, WalletRef } from "../../../src/domain/types";

export type { AccountRef, AccountRole, CategoryRef, ManualMeaning, MemberRef, Snapshot };

export type Wallet = WalletRef & { hidden: boolean };

export interface Bootstrap {
  member: MemberRef | null;
  members: MemberRef[];
  wallets: Wallet[];
  categories: CategoryRef[];
  accounts: AccountRef[];
  categoryUsage: Record<string, number>;
  /** Khoản nợ đang mở kèm số còn nợ. Bản bootstrap cũ trong cache chưa có trường này: coi như []. */
  debts?: DebtRef[];
  /** Khoản phải thu đang mở kèm số còn phải thu. Bản bootstrap cũ trong cache chưa có trường này: coi như []. */
  receivables?: ReceivableRef[];
}

/** Thân POST /v1/transactions. `at` luôn gửi kèm: khoản nhập offline phải mang giờ lúc nhập, không phải giờ đồng bộ. */
export interface EntryBody {
  meaning: ManualMeaning;
  amount: number;
  at: string;
  client_id: string;
  category_id?: string;
  wallet_id?: string;
  from_wallet_id?: string;
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
}

/** `wallet` trong phản hồi POST /v1/transactions (ledger.walletStatus). */
export interface WalletStatus {
  walletId: string;
  name: string;
  balance: number | null;
  weekRemaining: number | null;
  monthRemaining: number | null;
}

/** Một dòng sổ (GET /v1/transactions, GET /v1/transactions/:id). */
export interface TxRow {
  id: number;
  at: string;
  amount: number;
  meaning: string;
  status: string;
  wallet_id: string | null;
  counter_wallet_id: string | null;
  account_id: string | null;
  counter_account_id: string | null;
  category_id: string | null;
  asset_kind: string | null;
  note: string | null;
  category_name?: string | null;
  wallet_name?: string | null;
  by_member_id?: string | null;
  source?: string | null;
  log_id?: string | null;
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
}

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

/** Một tài khoản Tích sản ở GET /v1/wealth-building (và, không có log chờ, ở GET /v1/networth) — ADR-88. */
export interface WealthBuildingAccount {
  accountId: string;
  name: string;
  role: AccountRole;
  memberId: string | null;
  memberName: string | null;
  balance: number;
  pendingCount: number;
  pendingNet: number;
}

/** GET /v1/wealth-building: Tích sản theo loại, chỗ nằm (heo, phao, sổ tiết kiệm), nguồn vào / ra (ledger UC-107, ADR-86, ADR-88). */
export interface WealthBuildingBreakdown {
  walletId: string;
  name: string;
  cash: number;
  assets: number;
  /** Tài khoản Tích sản: số dư sổ (có thể âm), log còn chờ gán — `pendingNet` theo phía tài khoản đó (chuyển vào +, rút về −). */
  accounts: WealthBuildingAccount[];
  /** Dòng còn hiệu lực chạm ví Tích sản, gộp theo nguồn; `count` = số lần (một lô chia / chốt tháng tính một lần). */
  flows: {
    kind: AccountRole | "fund" | "sweep" | "tax" | "opening" | "wallet" | "other" | "buy_asset";
    direction: "in" | "out";
    accountId: string | null;
    accountName: string | null;
    memberName: string | null;
    walletId: string | null;
    walletName: string | null;
    walletActive: boolean | null;
    assetKind: string | null;
    count: number;
    amount: number;
  }[];
}

/**
 * GET /v1/transactions/link-candidates: một khoản gốc còn hiệu lực (khoản chi / khoản cho vay) để nối khoản tiền về.
 * `wallet_id` là ví khoản chi đã trừ (khoản cho vay: null); `receivable_id` là người vay (khoản chi: null).
 */
export interface LinkCandidate {
  id: number;
  at: string;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  wallet_id: string | null;
  wallet_name: string | null;
  receivable_id: string | null;
  receivable_name: string | null;
  note: string | null;
  bank_content: string | null;
}

export interface CreateEntryResult {
  tx: TxRow;
  duplicate: boolean;
  wallet: WalletStatus | null;
}

/** POST /v1/transactions/:id/replace: khoản mới, id khoản cũ vừa huỷ. */
export interface ReplaceEntryResult extends CreateEntryResult {
  replaced: number;
}

export type AllocationPlan = AllocationResult & { transferOrders: TransferOrderDraft[] };

export interface BudgetLine {
  walletId: string;
  name: string;
  tier: WalletRef["tier"];
  mustGroup: WalletRef["mustGroup"];
  target: number | null;
  spent: number | null;
  remaining: number | null;
  /** Số dư hiện tại của ví (không theo kỳ); null = ví riêng tư của người khác. */
  balance?: number | null;
}

export interface Budget {
  period: string;
  kind: "week" | "month";
  weeks: number;
  lines: BudgetLine[];
}

/** Ví giữ riêng (tier holding, kind khác holding), ví dụ "Thu cho thuê". */
export type Reserve = Snapshot["reserves"][number];

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

export interface SpendByCategory {
  month: string;
  previous: string;
  categories: { categoryId: string; name: string; spent: number; previousSpent: number }[];
}

export interface TransferOrder {
  id: number;
  batch_id: string;
  from_account_id: string;
  to_account_id: string;
  from_name: string;
  to_name: string;
  amount: number;
  memo: string;
  /** Các ví nhận tiền của lệnh này (cùng lô, ở tài khoản đích), vd "Tích sản, Thuế"; null với lệnh không gắn ví. */
  wallet_names: string | null;
  status: "pending" | "done" | "skipped";
  created_at: string;
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
    wallet_id?: string | null;
    category_id?: string | null;
    is_salary?: boolean | null;
    /** Log khác (webhook ↔ rà soát đêm) có thể là cùng giao dịch này. */
    possible_duplicate_of?: string | null;
    label?: string | null;
    /** Rule mang người thuê: chỉ gợi ý "Thu từ <tên>", người vẫn phải bấm. */
    tenant_id?: string | null;
    /** Lời nhắc kèm gợi ý, vd log tiền ra của tài khoản SePay đang để "chỉ tiền vào" (ADR-66). */
    note?: string | null;
    /** transfer: tài khoản đầu kia và chuyển ví đi kèm (rút tiền mặt, bỏ heo đất — ADR-77/ADR-82; heo trả về chỉ có tài khoản). */
    other_account_id?: string | null;
    from_wallet_id?: string | null;
    /** Chân còn lại của chuyển nội bộ đã ghi (ADR-81): gán Chuyển nội bộ với `other_account_id` là gắn vào giao dịch này. */
    attach_to_tx?: number | null;
  } | null;
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
  active: boolean;
  /** Heo đất, sổ tiết kiệm (ADR-77, ADR-88): không bao giờ tính vào "Tiền chi được". */
  locked: boolean;
  /** "Tính vào tiền chi được" (ADR-85). */
  spendable: boolean;
  /** Tài khoản Tích sản (ADR-88); null = tài khoản thường. */
  role: AccountRole | null;
  /** Số dư sổ hiện có (ledger `v_account_book`); null khi tài khoản đã tắt. */
  book_balance: number | null;
}

export type AllocationMode = "flat" | "percent" | "goal" | "lump" | "remainder";

export interface Allocation {
  mode: AllocationMode;
  period: "week" | "month" | null;
  amount: number | null;
  /** Phân số như trong DB: 0.3 = 30%. */
  percent: number | null;
  target_amount: number | null;
  target_date: string | null;
  floor_amount: number | null;
  priority: number;
  /** Chỉ có trong GET: phong bì tháng chia đều theo tuần. Gửi lên bằng `split_weekly`. */
  splitWeekly?: boolean;
}

export interface SettingsWallet {
  id: string;
  name: string;
  tier: "holding" | "wealth_building" | "tax" | "nice" | "must";
  must_group: "must" | "have" | null;
  kind: "envelope" | "accrual" | "bill" | "holding";
  scope: "shared" | "personal";
  member_id: string | null;
  account_id: string | null;
  private: boolean;
  sort: number;
  active: boolean;
  allocation: Allocation | null;
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
  wallet_id: string | null;
  category_id: string | null;
  by_member_id: string | null;
  active: boolean;
  incomeStreamId?: string | null;
}

/** Nguồn thu: phần khóa riêng của từng nguồn (percent là phân số 0..1). */
export interface IncomeStream {
  id: string;
  name: string;
  sort: number;
  active: boolean;
  locks: { walletId: string; percent: number }[];
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
  safety_fund_months: number;
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
  wallets: SettingsWallet[];
  members: SettingsMember[];
  rules: Rule[];
  categories: { id: string; name: string; defaultWalletId: string | null }[];
  config: SettingsConfig;
  integrations: Integrations;
  incomeStreams?: IncomeStream[];
  /** Bản cài đặt lưu offline từ trước khi có giờ nhắc thì thiếu trường này. */
  notifySchedule?: NotifySchedule;
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
  perConnection: { id: string; name: string; added: number; duplicates: number; beforeOpening: number; error: string | null }[];
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

export interface TenantFee {
  id: number;
  name: string;
  amount: number;
  sort: number;
  active: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  active: boolean;
  /** Dương = còn nợ; âm = đã trả dư, trừ vào tháng sau. */
  balance: number;
  fees: TenantFee[];
}

export interface Rental {
  headcount: number;
  sharedCategoryIds: string[];
  incomeStreamId: string | null;
  tenants: Tenant[];
}

export type TenantLineKind = "opening" | "fixed" | "shared" | "one_off" | "paid_for_us" | "adjust";

export interface TenantLine {
  id: number;
  kind: TenantLineKind;
  name: string | null;
  amount: number;
  categoryId?: string | null;
  at?: string | null;
}

export interface TenantMonth {
  month: string;
  settled: boolean;
  openingBalance: number;
  sharedTotal: number;
  headcount: number;
  share: number;
  draft: { kind: "fixed" | "shared"; name: string; amount: number }[];
  /** Số dư đầu tháng + dòng tháng + tạm tính (chưa chốt) − đã chuyển trong tháng. */
  closingBalance: number;
  lines: TenantLine[];
  payments: { transactionId: number; at: string; amount: number }[];
  balance: number;
  text: string;
}

// ── Sổ nợ (/v1/debts) ──────────────────────────────────────────────

/** Khoản nợ trong bootstrap: đủ để chọn khoản khi trả nợ. */
export interface DebtRef {
  id: string;
  name: string;
  /** Số còn nợ = đã vay − đã trả; ≤ 0 là trả xong. */
  balance: number;
}

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
  walletId: string | null;
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
}

export interface ReceivablesData {
  totalBalance: number;
  receivables: Receivable[];
}

/** GET /v1/networth: tiền thật trước, sổ đối ứng (ai nợ ai) sau. */
export interface NetWorth {
  /** Σ số dư sổ của tài khoản đang dùng — tiền thật đang có. */
  cash: number;
  /** Phần tiền của Tích sản (đã khóa), nằm trong `cash`. */
  wealthBuildingCash: number;
  /** Tài khoản Tích sản (heo, phao, sổ tiết kiệm — ADR-82, ADR-88): nằm trong `cash`, là chỗ tiền Tích sản đang nằm; tổng và từng tài khoản. */
  wealthBuildingAccounts: { total: number; accounts: Omit<WealthBuildingAccount, "pendingCount" | "pendingNet">[] };
  spendableThisWeek: number;
  /** Vàng, chứng khoán… của Tích sản: không phải tiền mặt. */
  assets: number;
  receivables: number;
  tenants: number;
  tenantsPrepaid: number;
  debts: number;
  netWorth: number;
}

// Biến một khoản nhập tay thành đúng một dòng `transactions`:
//   account_id = tài khoản tiền RA · counter_account_id = tài khoản tiền VÀO
// Từ v2 (ADR-123) đường ghi không còn ví: cột ví của dòng mới luôn NULL; tiền thuộc ngăn của tài khoản.
// Hàm thuần: mọi dữ liệu tham chiếu được truyền vào.

import { dayKey, monthKey, weekKey } from "./period";
import { DEBT_CATEGORY_ID, LEND_CATEGORY_ID, LOAN_INTEREST_ID } from "./system-ids";
import { DomainError, type BookRef, type Refs } from "./types";

export const MANUAL_MEANINGS = ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"] as const;
export type ManualMeaning = (typeof MANUAL_MEANINGS)[number];
const ASSET_KINDS = ["stock", "gold", "re", "fund"] as const;
const MAX_AMOUNT = 1_000_000_000_000;

/**
 * Trường của mô hình ví cũ và phần giữ riêng (`earmark_id`, Đợt E): gửi lên → 400 `model_changed` kèm tên trường, không ghi gì
 * (ledger UC-101, quyết định 8; ADR-131 (7)).
 */
export const OLD_ENTRY_FIELDS = ["wallet_id", "counter_wallet_id", "from_wallet_id", "wealth_move", "allocate", "wealth_amount", "wealth_note", "amounts", "earmark_id"] as const;

/**
 * Từ chối thân yêu cầu còn trường cũ (`null`, `""`, `false` coi như không gửi — app cũ gửi trống). Một hàm cho Nhập, Gán, rule,
 * danh mục, MCP.
 */
export function rejectOldFields(body: Record<string, unknown>, names: readonly string[] = OLD_ENTRY_FIELDS): void {
  const fields = names.filter((k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== null && body[k] !== undefined && body[k] !== "" && body[k] !== false);
  if (fields.length) throw new DomainError("model_changed", `Ví nhà v2 đã bỏ ví và chia tiền: bỏ trường ${fields.join(", ")}.`, 400, undefined, fields);
}

/** Tài khoản trong input luôn là "tài khoản dính tới khoản này" — hàm tự đặt vào đúng cột tiền ra / tiền vào. */
export interface EntryInput {
  meaning: ManualMeaning;
  amount: number;
  at?: string;
  category_id?: string | null;
  account_id?: string | null;
  /** Chỉ dùng cho `transfer`: tài khoản đích. */
  to_account_id?: string | null;
  note?: string | null;
  taxable?: boolean;
  /** Chỉ dùng cho `refund` (→ khoản chi gốc) và `collect` (→ khoản cho vay gốc); kiểm ở `resolveLink` (services/ledger). */
  link_id?: number | null;
  asset_kind?: string | null;
  client_id?: string | null;
  /** Chỉ dùng cho `income`: nguồn thu (quyết `opens_cycle` mặc định và ngăn của tiền về). */
  income_stream_id?: string | null;
  /** Chỉ dùng cho `income`: tiền người thuê trả. Không chọn nguồn thì lấy nguồn cho thuê mặc định. */
  tenant_id?: string | null;
  /** Chỉ dùng cho `spend`: khoản trả nợ. Không chọn danh mục thì lấy danh mục "Trả nợ" (`debt-payment`). */
  debt_id?: string | null;
  /** Chỉ dùng cho `lend` (cho vay thêm) và `collect` (nhận lại): khoản phải thu ở sổ phải thu. */
  receivable_id?: string | null;
  /** Chỉ dùng cho `spend`, không cùng `debt_id`: trả LÃI cho khoản nợ (chi phí, không giảm nợ). Không chọn danh mục thì lấy "Lãi vay". */
  interest_debt_id?: string | null;
  /** Khoản trước mốc mà SePay đã báo và đã vào sổ (409 `bank_log_exists`): người ghi xác nhận đây là khoản thật thứ hai. */
  confirm_duplicate?: boolean;
  /** Chỉ dùng cho `income`: ghi đè "Mở kỳ lương" của nguồn (pocket UC-1205 bước 2); không gửi = cờ của nguồn. */
  opens_cycle?: boolean;
  /**
   * Chỉ dùng cho `spend` / `transfer`: mục tiêu mà khoản này dùng tiền (pocket UC-1209 bước 11) — mục tiêu tài khoản: tiền ra
   * từ tài khoản của mục tiêu hoặc con của nó; mục tiêu trả từ tiền chi tiêu: tiền ra từ một tài khoản Vận hành. Không gửi: tài
   * khoản đúng một mục tiêu tài khoản thì tự gắn khi ghi (`insertTx`), còn lại NULL — mục tiêu trả từ tiền chi tiêu không tự gắn.
   */
  goal_id?: string | null;
  /** Chỉ dùng cho `income` vào tài khoản mẹ có mục tiêu hoặc con của nó: khoản lãi (ghi phân loại `passive_income`, ADR-140). */
  is_interest?: boolean;
  /** Chỉ dùng cho `spend` / `transfer` ra khỏi nhóm mẹ có mục tiêu + con, không kèm `goal_id`: rút từ tiền lãi (trần kiểm ở services). */
  from_interest?: boolean;
}

export interface TxRow {
  at: string;
  amount: number;
  meaning: ManualMeaning | "adjust";
  account_id: string | null;
  counter_account_id: string | null;
  category_id: string | null;
  by_member_id: string | null;
  link_id: number | null;
  batch_id: string | null;
  asset_kind: string | null;
  taxable: number;
  week_key: string;
  month_key: string;
  source: "manual" | "system" | "sepay";
  note: string | null;
  client_id: string | null;
  income_stream_id?: string | null;
  tenant_id?: string | null;
  debt_id?: string | null;
  receivable_id?: string | null;
  interest_debt_id?: string | null;
  goal_id?: string | null;
  /** 1 = rút từ tiền lãi của nhóm (`transactions.from_interest`); thiếu = 0. */
  from_interest?: number;
}

export const INVALID_GOAL = "Mục tiêu này không thuộc tài khoản chi.";
export const INVALID_INTEREST = "Khoản này không lấy từ tiền lãi được: chỉ khoản chi / chuyển ra khỏi tài khoản có mục tiêu (hoặc khoản gửi của nó), không kèm mục tiêu.";
const INTEREST_INCOME_ONLY = "Tiền lãi chỉ ghi cho khoản thu vào tài khoản có mục tiêu hoặc khoản gửi của nó.";

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

export function normalizeAt(at: string | undefined, now: Date): string {
  if (!at) return now.toISOString();
  const t = Date.parse(at);
  if (Number.isNaN(t)) fail("invalid_at", "Ngày giờ không hợp lệ.");
  // Không cho ghi trước tương lai quá một ngày: gần như chắc chắn là nhập nhầm.
  if (t > now.getTime() + 86_400_000) {
    fail("future_at", "Ngày của khoản này ở tương lai. Nếu nhập lúc mất mạng, đồng hồ điện thoại có thể đang chạy nhanh: chỉnh lại giờ rồi nhập lại.");
  }
  return new Date(t).toISOString();
}

function account(refs: Refs, id: string | null | undefined, label: string) {
  if (!id) return fail("missing_account", `Thiếu ${label}.`);
  return refs.accounts.find((a) => a.id === id) ?? fail("unknown_account", `Không có tài khoản "${id}".`);
}

/** Đối tác ở sổ đối ứng (sổ nợ, sổ phải thu) mà giao dịch gắn vào: phải có và đang theo dõi. */
function bookOf(list: BookRef[], id: string | null | undefined, kind: "debt" | "receivable", noun: string): BookRef | null {
  if (!id) return null;
  const book = list.find((b) => b.id === id) ?? fail(`unknown_${kind}`, `Không có ${noun} "${id}".`);
  if (!book.active) fail(`inactive_${kind}`, `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${book.name} đã tắt.`);
  return book;
}

/** "2026-10-01" → "1/10/2026". */
const viDate = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
};

/**
 * Số dư đầu là mốc (ADR-76): `opening_balance` đã gồm mọi khoản trước ngày mở sổ `opened_at` (giờ VN), nên một giao
 * dịch chạm tài khoản mà ngày của nó trước mốc đó là đếm cùng khoản tiền hai lần. Tài khoản không có mốc thì bỏ qua.
 */
export function assertOpened(account: { name: string; openedAt: string | null }, at: string): void {
  if (account.openedAt && dayKey(at) < account.openedAt) {
    fail("before_opening", `Ngày này trước ngày mở sổ của tài khoản ${account.name} (${viDate(account.openedAt)}) — số dư đầu đã tính khoản này.`);
  }
}

/**
 * Tài khoản tiền mặt mặc định cho khoản chi nhanh: của chính người đang nhập; không có thì ví tiền mặt chung
 * (không gắn chủ), rồi bất kỳ tài khoản tiền mặt nào — nhà dùng chung một ví tiền mặt thì ai nhập cũng vào đó.
 */
export function cashAccountOf(refs: Refs, memberId: string | null): string | null {
  const cash = refs.accounts.filter((a) => a.kind === "cash");
  return (cash.find((a) => a.ownerMemberId === memberId) ?? cash.find((a) => a.ownerMemberId === null) ?? cash[0])?.id ?? null;
}

export function buildEntry(input: EntryInput, refs: Refs, memberId: string | null, now: Date): TxRow {
  if (!MANUAL_MEANINGS.includes(input.meaning)) fail("invalid_meaning", "Loại giao dịch không hợp lệ.");
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
    fail("invalid_amount", "Số tiền phải là số nguyên dương, tính bằng đồng.");
  }
  const at = normalizeAt(input.at, now);
  const note = input.note?.trim().slice(0, 500) || null;
  const row: TxRow = {
    at,
    amount: input.amount,
    meaning: input.meaning,
    account_id: null,
    counter_account_id: null,
    category_id: null,
    by_member_id: memberId,
    link_id: null,
    batch_id: null,
    asset_kind: null,
    taxable: 0,
    week_key: weekKey(at),
    month_key: monthKey(at),
    source: "manual",
    note,
    client_id: input.client_id?.trim().slice(0, 64) || null,
  };
  if (input.debt_id && input.meaning !== "spend") fail("debt_spend_only", "Khoản nợ chỉ gắn được với khoản chi (trả nợ).");
  if (input.interest_debt_id && input.meaning !== "spend") fail("interest_spend_only", "Trả lãi chỉ gắn được với khoản chi.");
  if (input.interest_debt_id && input.debt_id) {
    fail("debt_and_interest", "Một khoản chi không vừa trả gốc vừa trả lãi — ghi hai khoản: lãi (interest_debt_id) và gốc (debt_id).");
  }
  if (input.receivable_id && input.meaning !== "lend" && input.meaning !== "collect") {
    fail("receivable_only", "Khoản phải thu chỉ gắn được với cho vay hoặc nhận lại tiền cho vay.");
  }
  const debt = bookOf(refs.debts, input.debt_id, "debt", "khoản nợ");
  const interestDebt = bookOf(refs.debts, input.interest_debt_id, "debt", "khoản nợ");
  const receivable = bookOf(refs.receivables, input.receivable_id, "receivable", "khoản phải thu");
  const defaultCategoryId = debt ? DEBT_CATEGORY_ID : interestDebt ? LOAN_INTEREST_ID : input.meaning === "lend" ? LEND_CATEGORY_ID : null;
  const categoryId = input.category_id || (defaultCategoryId && refs.categories.some((c) => c.id === defaultCategoryId) ? defaultCategoryId : null);
  const category = categoryId
    ? refs.categories.find((c) => c.id === categoryId) ?? fail("unknown_category", `Không có danh mục "${categoryId}".`)
    : null;
  const defaultAccount = () => input.account_id ?? cashAccountOf(refs, memberId);

  if (input.meaning !== "income" && (input.income_stream_id || input.tenant_id)) {
    fail("income_only", "Nguồn thu và người thuê chỉ gắn được với khoản thu nhập.");
  }
  if (input.meaning !== "income" && input.opens_cycle === true) fail("invalid_input", "Mở kỳ lương chỉ dùng cho khoản thu nhập.");

  switch (input.meaning) {
    case "spend": {
      if (!category) fail("missing_category", "Khoản chi phải có danh mục.");
      row.category_id = category!.id;
      row.account_id = account(refs, defaultAccount(), "tài khoản chi").id;
      row.debt_id = debt?.id ?? null;
      row.interest_debt_id = interestDebt?.id ?? null;
      break;
    }
    case "income": {
      row.counter_account_id = account(refs, input.account_id, "tài khoản nhận tiền").id;
      row.taxable = input.taxable ? 1 : 0;
      if (input.tenant_id) {
        const tenant = refs.tenants.find((t) => t.id === input.tenant_id) ?? fail("unknown_tenant", `Không có người thuê "${input.tenant_id}".`);
        if (!tenant.active) fail("inactive_tenant", `${tenant.name} không còn ở.`);
        row.tenant_id = tenant.id;
      }
      const streamId = input.income_stream_id || (row.tenant_id ? refs.rentalIncomeStreamId : null);
      if (streamId) {
        const stream = refs.incomeStreams.find((s) => s.id === streamId) ?? fail("unknown_income_stream", `Không có nguồn thu "${streamId}".`);
        if (!stream.active) fail("inactive_income_stream", `Nguồn thu ${stream.name} đã tắt.`);
        row.income_stream_id = stream.id;
      }
      break;
    }
    case "refund": {
      row.category_id = category?.id ?? null;
      row.counter_account_id = account(refs, defaultAccount(), "tài khoản nhận tiền").id;
      row.link_id = input.link_id ?? null;
      break;
    }
    case "transfer": {
      const from = account(refs, input.account_id, "tài khoản nguồn");
      const to = account(refs, input.to_account_id, "tài khoản đích");
      if (from.id === to.id) fail("same_account", "Tài khoản nguồn và đích trùng nhau.");
      row.account_id = from.id;
      row.counter_account_id = to.id;
      break;
    }
    case "buy_asset": {
      if (!ASSET_KINDS.includes(input.asset_kind as (typeof ASSET_KINDS)[number])) {
        fail("invalid_asset_kind", "Loại tài sản phải là stock, gold, re hoặc fund.");
      }
      row.asset_kind = input.asset_kind!;
      // Mua từ tài khoản nào cũng được (chủ nhà 12/11): ngăn của tài khoản đó giảm.
      row.account_id = account(refs, input.account_id, "tài khoản trả").id;
      break;
    }
    case "lend": {
      // Tiền rời tài khoản: vẫn là tiền của nhà, chỉ đang nằm ở người khác (sổ phải thu).
      row.account_id = account(refs, defaultAccount(), "tài khoản chi").id;
      row.category_id = category?.id ?? null;
      row.receivable_id = receivable?.id ?? null;
      break;
    }
    case "collect": {
      // Tiền cho vay quay về tài khoản: trả gốc, không phải thu nhập.
      row.counter_account_id = account(refs, defaultAccount(), "tài khoản nhận tiền").id;
      row.receivable_id = receivable?.id ?? null;
      row.link_id = input.link_id ?? null;
      break;
    }
  }
  const ref = (id: string | null) => (id ? refs.accounts.find((a) => a.id === id) : undefined);
  // Nhóm mẹ + con (ADR-140): mục tiêu tài khoản gắn tài khoản mẹ.
  const rootOf = (id: string | null) => {
    const a = ref(id);
    return a?.parentId ? ref(a.parentId) : a;
  };
  const outFlow = row.meaning === "spend" || row.meaning === "transfer";
  if (input.goal_id) {
    const from = ref(row.account_id);
    const forAccount = rootOf(row.account_id)?.goalIds?.includes(input.goal_id) ?? false;
    const forOperating = from?.pocket === "operating" && (refs.operatingGoalIds ?? []).includes(input.goal_id);
    if (!outFlow || !(forAccount || forOperating)) fail("invalid_goal", INVALID_GOAL);
    row.goal_id = input.goal_id;
  }
  if (input.is_interest) {
    if (row.meaning !== "income" || input.opens_cycle === true || !rootOf(row.counter_account_id)?.goalIds?.length) fail("invalid_input", INTEREST_INCOME_ONLY);
  }
  if (input.from_interest) {
    const root = rootOf(row.account_id);
    const internal = root !== undefined && rootOf(row.counter_account_id)?.id === root.id;
    if (!outFlow || row.goal_id || !root?.goalIds?.length || internal) fail("invalid_interest", INVALID_INTEREST);
    row.from_interest = 1;
  }
  for (const id of [row.account_id, row.counter_account_id]) {
    const touched = id ? refs.accounts.find((a) => a.id === id) : undefined;
    if (touched) assertOpened(touched, row.at);
  }
  return row;
}

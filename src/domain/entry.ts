// Biến một khoản nhập tay thành đúng một dòng `transactions` theo quy ước dấu:
//   wallet_id = ví được cộng · counter_wallet_id = ví bị trừ
//   account_id = tài khoản tiền RA · counter_account_id = tài khoản tiền VÀO
// Hàm thuần: mọi dữ liệu tham chiếu được truyền vào.

import { dayKey, monthKey, weekKey } from "./period";
import { DEBT_CATEGORY_ID, LEND_CATEGORY_ID } from "./system-ids";
import { DomainError, isIncomeHolding, type BookRef, type Refs, type WalletRef } from "./types";

export const MANUAL_MEANINGS = ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"] as const;
export type ManualMeaning = (typeof MANUAL_MEANINGS)[number];
const ASSET_KINDS = ["stock", "gold", "re", "fund"] as const;
const MAX_AMOUNT = 1_000_000_000_000;

/** Tài khoản trong input luôn là "tài khoản dính tới khoản này" — hàm tự đặt vào đúng cột tiền ra / tiền vào. */
export interface EntryInput {
  meaning: ManualMeaning;
  amount: number;
  at?: string;
  category_id?: string | null;
  wallet_id?: string | null;
  /** Chỉ dùng cho `transfer`: ví nguồn khi chuyển tiền giữa hai ví. */
  from_wallet_id?: string | null;
  account_id?: string | null;
  /** Chỉ dùng cho `transfer`: tài khoản đích. */
  to_account_id?: string | null;
  note?: string | null;
  taxable?: boolean;
  /** Chỉ dùng cho `refund` (→ khoản chi gốc) và `collect` (→ khoản cho vay gốc); kiểm ở `resolveLink` (services/ledger). */
  link_id?: number | null;
  asset_kind?: string | null;
  client_id?: string | null;
  /** Chỉ dùng cho `income`: nguồn thu (quyết định phần khóa khi chia). */
  income_stream_id?: string | null;
  /** Chỉ dùng cho `income`: tiền người thuê trả. Không chọn nguồn thì lấy nguồn cho thuê mặc định. */
  tenant_id?: string | null;
  /** Chỉ dùng cho `spend`: khoản trả nợ. Không chọn danh mục thì lấy danh mục "Trả nợ" (`debt-payment`). */
  debt_id?: string | null;
  /** Chỉ dùng cho `lend` (cho vay thêm) và `collect` (nhận lại): khoản phải thu ở sổ phải thu. */
  receivable_id?: string | null;
}

export interface TxRow {
  at: string;
  amount: number;
  meaning: ManualMeaning | "adjust" | "fund";
  wallet_id: string | null;
  counter_wallet_id: string | null;
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
}

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

/** Ví cá nhân của người khác → đổi sang ví cá nhân cùng phe của người đang nhập (nếu có). */
export function walletFor(refs: Refs, walletId: string, memberId: string | null): WalletRef {
  const wallet = refs.wallets.find((w) => w.id === walletId) ?? fail("unknown_wallet", `Không có ví "${walletId}".`);
  if (wallet.scope !== "personal" || !memberId || wallet.memberId === memberId) return wallet;
  return refs.wallets.find((w) => w.scope === "personal" && w.tier === wallet.tier && w.memberId === memberId) ?? wallet;
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

/**
 * Chuyển tiền từ tài khoản thường vào tài khoản Tích sản (heo đất, phao, sổ tiết kiệm — ADR-88) là bỏ tiền vào Tích sản.
 * Rút ra, hay chuyển giữa hai tài khoản Tích sản (gửi phao → sổ, tất toán sổ → phao) chỉ là đổi chỗ.
 */
export function isWealthBuildingDeposit(accounts: Pick<Refs["accounts"][number], "id" | "role">[], fromAccountId: string | null | undefined, toAccountId: string | null | undefined): boolean {
  const from = accounts.find((a) => a.id === fromAccountId);
  const to = accounts.find((a) => a.id === toAccountId);
  return Boolean(from && !from.role && to?.role);
}

/**
 * Ví của một lần bỏ tiền vào Tích sản (`isWealthBuildingDeposit`): ví Có thì tốt (ví `remainder`) → Tích sản, như bỏ heo (ADR-82).
 * Không phải bỏ tiền vào Tích sản, hay thiếu ví Tích sản / ví Có thì tốt: null (chỉ đổi chỗ tiền).
 */
export function wealthBuildingMove(
  refs: Pick<Refs, "accounts" | "wallets" | "rules">,
  fromAccountId: string | null | undefined,
  toAccountId: string | null | undefined,
): { wallet_id: string; from_wallet_id: string } | null {
  if (!isWealthBuildingDeposit(refs.accounts, fromAccountId, toAccountId)) return null;
  const wealthBuilding = refs.wallets.find((w) => w.tier === "wealth_building");
  const remainder = refs.rules.find((r) => r.mode === "remainder");
  return wealthBuilding && remainder ? { wallet_id: wealthBuilding.id, from_wallet_id: remainder.walletId } : null;
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
    wallet_id: null,
    counter_wallet_id: null,
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
  if (input.receivable_id && input.meaning !== "lend" && input.meaning !== "collect") {
    fail("receivable_only", "Khoản phải thu chỉ gắn được với cho vay hoặc nhận lại tiền cho vay.");
  }
  const debt = bookOf(refs.debts, input.debt_id, "debt", "khoản nợ");
  const receivable = bookOf(refs.receivables, input.receivable_id, "receivable", "khoản phải thu");
  const defaultCategoryId = debt ? DEBT_CATEGORY_ID : input.meaning === "lend" ? LEND_CATEGORY_ID : null;
  const categoryId = input.category_id || (defaultCategoryId && refs.categories.some((c) => c.id === defaultCategoryId) ? defaultCategoryId : null);
  const category = categoryId
    ? refs.categories.find((c) => c.id === categoryId) ?? fail("unknown_category", `Không có danh mục "${categoryId}".`)
    : null;
  const pickWallet = () => {
    const id = input.wallet_id ?? category?.defaultWalletId ?? fail("missing_wallet", "Chưa chọn ví.");
    return walletFor(refs, id, memberId);
  };
  const defaultAccount = () => input.account_id ?? cashAccountOf(refs, memberId);

  if (input.meaning !== "income" && (input.income_stream_id || input.tenant_id)) {
    fail("income_only", "Nguồn thu và người thuê chỉ gắn được với khoản thu nhập.");
  }

  switch (input.meaning) {
    case "spend": {
      if (!category) fail("missing_category", "Khoản chi phải có danh mục.");
      const wallet = pickWallet();
      if (isIncomeHolding(wallet) || wallet.tier === "wealth_building") {
        fail("locked_wallet", `Không chi trực tiếp từ ví ${wallet.name}.`);
      }
      row.counter_wallet_id = wallet.id;
      row.category_id = category!.id;
      row.account_id = account(refs, defaultAccount(), "tài khoản chi").id;
      row.debt_id = debt?.id ?? null;
      break;
    }
    case "income": {
      const holding = refs.wallets.find(isIncomeHolding) ?? fail("config", "Chưa có ví Thu nhập.");
      row.wallet_id = holding.id;
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
      const wallet = pickWallet();
      row.wallet_id = wallet.id;
      row.category_id = category?.id ?? null;
      row.counter_account_id = account(refs, defaultAccount(), "tài khoản nhận tiền").id;
      row.link_id = input.link_id ?? null;
      break;
    }
    case "transfer": {
      if (!input.account_id && !input.to_account_id && (input.wallet_id || input.from_wallet_id)) {
        // Chuyển ngân sách: chỉ đổi tiền thuộc ví nào, tiền không rời tài khoản. Chọn đúng ví, không đổi sang ví cá nhân.
        const pick = (id: string | null | undefined, label: string) =>
          refs.wallets.find((w) => w.id === id) ?? fail(id ? "unknown_wallet" : "missing_wallet", id ? `Không có ví "${id}".` : `Thiếu ${label}.`);
        const toWallet = pick(input.wallet_id, "ví đích");
        const fromWallet = pick(input.from_wallet_id, "ví nguồn");
        if (toWallet.id === fromWallet.id) fail("same_wallet", "Ví nguồn và ví đích trùng nhau.");
        if (fromWallet.tier === "wealth_building") fail("locked_wallet", "Tích sản đã khóa, không chuyển ra.");
        if (isIncomeHolding(fromWallet) || isIncomeHolding(toWallet)) fail("locked_wallet", "Ví Thu nhập chỉ chia qua lần chia lương.");
        row.wallet_id = toWallet.id;
        row.counter_wallet_id = fromWallet.id;
        break;
      }
      const from = account(refs, input.account_id, "tài khoản nguồn");
      const to = account(refs, input.to_account_id, "tài khoản đích");
      if (from.id === to.id) fail("same_account", "Tài khoản nguồn và đích trùng nhau.");
      row.account_id = from.id;
      row.counter_account_id = to.id;
      if (input.wallet_id || input.from_wallet_id) {
        const toWallet = walletFor(refs, input.wallet_id ?? fail("missing_wallet", "Thiếu ví đích."), memberId);
        const fromWallet = walletFor(refs, input.from_wallet_id ?? fail("missing_wallet", "Thiếu ví nguồn."), memberId);
        if (toWallet.id === fromWallet.id) fail("same_wallet", "Ví nguồn và ví đích trùng nhau.");
        if (fromWallet.tier === "wealth_building") fail("locked_wallet", "Tích sản đã khóa, không chuyển ra.");
        row.wallet_id = toWallet.id;
        row.counter_wallet_id = fromWallet.id;
      } else {
        // Không chọn ví: chuyển vào tài khoản Tích sản từ tài khoản thường là bỏ tiền vào Tích sản (ADR-88).
        const move = wealthBuildingMove(refs, from.id, to.id);
        row.wallet_id = move?.wallet_id ?? null;
        row.counter_wallet_id = move?.from_wallet_id ?? null;
      }
      break;
    }
    case "buy_asset": {
      const wealthBuilding = refs.wallets.find((w) => w.tier === "wealth_building") ?? fail("config", "Chưa có ví Tích sản.");
      if (!ASSET_KINDS.includes(input.asset_kind as (typeof ASSET_KINDS)[number])) {
        fail("invalid_asset_kind", "Loại tài sản phải là stock, gold, re hoặc fund.");
      }
      row.wallet_id = wealthBuilding.id;
      row.asset_kind = input.asset_kind!;
      row.account_id = input.account_id ? account(refs, input.account_id, "tài khoản").id : null;
      break;
    }
    case "lend": {
      // Tiền rời tài khoản, không trừ ví: vẫn là tiền của nhà, chỉ đang nằm ở người khác (sổ phải thu).
      row.account_id = account(refs, defaultAccount(), "tài khoản chi").id;
      row.category_id = category?.id ?? null;
      row.receivable_id = receivable?.id ?? null;
      break;
    }
    case "collect": {
      // Tiền cho vay quay về tài khoản: trả gốc, không phải thu nhập — không cộng ví, không chia.
      row.counter_account_id = account(refs, defaultAccount(), "tài khoản nhận tiền").id;
      row.receivable_id = receivable?.id ?? null;
      row.link_id = input.link_id ?? null;
      break;
    }
  }
  for (const id of [row.account_id, row.counter_account_id]) {
    const touched = id ? refs.accounts.find((a) => a.id === id) : undefined;
    if (touched) assertOpened(touched, row.at);
  }
  return row;
}

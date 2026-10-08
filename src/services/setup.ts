// Thiết lập nhà lần đầu (UC-510): DB chỉ có docs/schema.sql → tạo thành viên, tài khoản, bộ ví mẫu "Profit First cơ bản"
// và danh mục chi mẫu trong MỘT batch. Không gọi createAccount / createWallet: hai hàm đó tự chạy batch riêng, và
// createWallet không tạo được ví Thu nhập / ví nhận phần dư. Dòng config 'setup_done' đứng đầu batch, INSERT trơn: hai yêu
// cầu cùng lúc thì yêu cầu sau vấp khoá chính `config.k` → cả batch huỷ → 409 already_setup.

import { DomainError } from "../domain/types";
import { hashPassword } from "./passwords";
import { ACCOUNT_KINDS, bankOk, MAX_ACTIVE_MEMBERS, memberName, memberPassword, nameKey, slug } from "./settings";

const ACCOUNT_NAME_MAX = 60;
const ACCOUNT_MAX = 20;

const invalid = (field: string, message: string): never => {
  throw new DomainError("invalid_input", message, 400, field);
};

export const isSetUp = async (db: D1Database) => Boolean(await db.prepare("SELECT 1 FROM config WHERE k = 'setup_done'").first());
/** 409: nhà đã thiết lập (kiểm trước khi so mật khẩu, và khi batch vấp khoá chính `setup_done`). */
export const alreadySetup = () => new DomainError("already_setup", "Nhà đã thiết lập rồi — đăng nhập để dùng.", 409);

type MustId = "food" | "housing" | "transport" | "utilities";
type Category = { id: string; name: string; icon: string; sort: number };

/** Ví Must người dùng chọn: mã ví = mã lựa chọn; kèm danh mục chi mặc định vào đúng ví đó. */
const MUST_WALLETS: Record<MustId, { name: string; kind: "envelope" | "accrual" | "bill"; sort: number; categories: Category[] }> = {
  housing: { name: "Nhà ở", kind: "accrual", sort: 40, categories: [{ id: "housing", name: "Nhà ở", icon: "home", sort: 10 }] },
  food: {
    name: "Ăn uống",
    kind: "envelope",
    sort: 41,
    categories: [
      { id: "groceries", name: "Đi chợ / nấu ăn", icon: "basket", sort: 11 },
      { id: "eating-out", name: "Ăn ngoài", icon: "utensils", sort: 12 },
    ],
  },
  transport: {
    name: "Đi lại",
    kind: "envelope",
    sort: 42,
    categories: [
      { id: "fuel-parking", name: "Xăng xe / gửi xe", icon: "fuel", sort: 14 },
      { id: "ride-hailing", name: "Grab / taxi", icon: "car", sort: 15 },
    ],
  },
  utilities: { name: "Điện nước", kind: "bill", sort: 43, categories: [{ id: "utilities", name: "Điện nước mạng", icon: "zap", sort: 13 }] },
};
const MUST_IDS = Object.keys(MUST_WALLETS) as MustId[];

/** Danh mục luôn có, ví mặc định là Có thì tốt; 'debt-payment' và 'lending' là mã hệ thống (system-ids.ts). */
const ALWAYS_CATEGORIES: Category[] = [
  { id: "health", name: "Y tế", icon: "pill", sort: 22 },
  { id: "lending", name: "Cho vay / trả hộ", icon: "swap", sort: 27 },
  { id: "debt-payment", name: "Trả nợ", icon: "credit-card", sort: 29 },
  { id: "shopping", name: "Mua sắm", icon: "bag", sort: 30 },
];

export interface SetupInput {
  members: { id: string; name: string; password: string | null }[];
  accounts: { id: string; name: string; kind: (typeof ACCOUNT_KINDS)[number]; bank: string | null; owner: number | null }[];
  taxable: boolean;
  must: MustId[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Kiểm body `POST /v1/setup` (UC-510 AC-4). Lỗi: 400 invalid_input, `field` dạng dấu chấm chỉ đúng ô ("members.0.name"). */
export function parseSetup(body: unknown): SetupInput {
  const b = isObject(body) ? body : {};
  if (!Array.isArray(b.members) || b.members.length === 0 || b.members.length > MAX_ACTIVE_MEMBERS) {
    invalid("members", `Nhà có từ 1 đến ${MAX_ACTIVE_MEMBERS} người.`);
  }
  const members: SetupInput["members"] = [];
  (b.members as unknown[]).forEach((raw, i) => {
    const m = isObject(raw) ? raw : {};
    const { name, id } = memberName(m.name, `members.${i}.name`);
    if (members.some((x) => nameKey(x.name) === nameKey(name))) invalid(`members.${i}.name`, "Trùng tên với người khác.");
    const twin = members.find((x) => x.id === id);
    if (twin) invalid(`members.${i}.name`, `Tên này ra cùng mã với “${twin.name}” — đặt tên khác đi một chút.`);
    members.push({ id, name, password: memberPassword(m.password, `members.${i}.password`) });
  });

  if (!Array.isArray(b.accounts) || b.accounts.length === 0) invalid("accounts", "Thêm ít nhất một tài khoản (ngân hàng, tiền mặt…).");
  if ((b.accounts as unknown[]).length > ACCOUNT_MAX) invalid("accounts", `Lúc thiết lập thêm tối đa ${ACCOUNT_MAX} tài khoản.`);
  const accounts: SetupInput["accounts"] = [];
  (b.accounts as unknown[]).forEach((raw, i) => {
    const a = isObject(raw) ? raw : {};
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name) invalid(`accounts.${i}.name`, "Nhập tên tài khoản.");
    if (name.length > ACCOUNT_NAME_MAX) invalid(`accounts.${i}.name`, `Tên tài khoản tối đa ${ACCOUNT_NAME_MAX} ký tự.`);
    const id = slug(name);
    if (!id) invalid(`accounts.${i}.name`, "Tên tài khoản cần có chữ hoặc số.");
    if (accounts.some((x) => nameKey(x.name) === nameKey(name))) invalid(`accounts.${i}.name`, "Trùng tên với tài khoản khác.");
    const twin = accounts.find((x) => x.id === id);
    if (twin) invalid(`accounts.${i}.name`, `Tên này ra cùng mã với “${twin.name}” — đặt tên khác đi một chút.`);
    const kind = a.kind as SetupInput["accounts"][number]["kind"];
    if (!ACCOUNT_KINDS.includes(kind)) invalid(`accounts.${i}.kind`, "Chọn loại tài khoản.");
    if (a.bank !== undefined && a.bank !== null && typeof a.bank !== "string") invalid(`accounts.${i}.bank`, "Ngân hàng phải là chuỗi.");
    const bank = typeof a.bank === "string" && a.bank.trim() ? a.bank.trim().slice(0, 40) : null;
    if (!bankOk(kind, bank)) invalid(`accounts.${i}.bank`, "Ngân hàng phải chọn trong danh sách.");
    const owner = a.owner ?? null;
    if (owner !== null && !(typeof owner === "number" && Number.isInteger(owner) && owner >= 0 && owner < members.length)) {
      invalid(`accounts.${i}.owner`, "Chủ tài khoản phải là một người trong danh sách, hoặc để chung.");
    }
    accounts.push({ id, name, kind, bank, owner: owner as number | null });
  });

  if (!isObject(b.template)) return invalid("template", "Chọn mẫu ví.");
  const t = b.template;
  if (t.taxable !== undefined && typeof t.taxable !== "boolean") invalid("template.taxable", "taxable phải là true hoặc false.");
  const must = t.must ?? [];
  if (!Array.isArray(must) || must.some((m) => !MUST_IDS.includes(m as MustId)) || new Set(must).size !== must.length) {
    invalid("template.must", `Ví Must chọn trong: ${MUST_IDS.join(", ")}, mỗi ví một lần.`);
  }
  return { members, accounts, taxable: t.taxable === true, must: must as MustId[] };
}

/**
 * Tạo nhà trong một batch: thành viên theo thứ tự gửi (người đầu `owner`, sau `adult`), tài khoản, bộ ví mẫu, danh mục mẫu,
 * `setup_done`, nhật ký `setup.done` (người làm là chủ hộ vừa tạo, qua phiên). Đã thiết lập (kể cả do yêu cầu chạy song
 * song) → 409 already_setup, không đổi gì. Trả chủ hộ và cách vào của chủ hộ để cấp cookie.
 */
export async function createHousehold(db: D1Database, input: SetupInput): Promise<{ id: string; name: string; mode: "h" | "p" }> {
  const hashes = await Promise.all(input.members.map((m) => (m.password ? hashPassword(m.password) : null)));
  const owner = input.members[0]!;
  const home = (input.accounts.find((a) => a.kind === "bank") ?? input.accounts[0]!).id;
  const wallet = db.prepare("INSERT INTO wallets (id, name, tier, must_group, kind, account_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const allocation = db.prepare("INSERT INTO allocations (wallet_id, mode, period, percent, priority) VALUES (?, ?, 'month', ?, ?)");
  const category = db.prepare("INSERT INTO categories (id, name, default_wallet_id, icon, sort) VALUES (?, ?, ?, ?, ?)");
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO config (k, v) VALUES ('setup_done', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"),
    ...input.members.map((m, i) =>
      db.prepare("INSERT INTO members (id, name, role, password_hash) VALUES (?, ?, ?, ?)").bind(m.id, m.name, i === 0 ? "owner" : "adult", hashes[i]),
    ),
    ...input.accounts.map((a) =>
      db
        .prepare("INSERT INTO accounts (id, name, kind, bank, owner_member_id, opened_at, spendable) VALUES (?, ?, ?, ?, ?, date('now'), ?)")
        // Thẻ tín dụng không tính vào tiền chi được (số dư thẻ là nợ phải trả — ADR-85), như khi thêm ở Cài đặt.
        .bind(a.id, a.name, a.kind, a.bank, a.owner === null ? null : input.members[a.owner]!.id, a.kind === "credit" ? 0 : 1),
    ),
    // Bất biến: một ví Thu nhập, một Tích sản, một ví nhận phần dư.
    wallet.bind("income", "Thu nhập", "holding", null, "holding", home, 0),
    wallet.bind("wealth-building", "Tích sản", "wealth_building", null, "accrual", home, 10),
    allocation.bind("wealth-building", "percent", 0.1, 10),
    ...(input.taxable ? [wallet.bind("tax", "Thuế", "tax", null, "accrual", home, 20), allocation.bind("tax", "percent", 0.1, 20)] : []),
    ...input.must.flatMap((id) => {
      const w = MUST_WALLETS[id];
      return [wallet.bind(id, w.name, "must", "must", w.kind, home, w.sort), ...w.categories.map((c) => category.bind(c.id, c.name, id, c.icon, c.sort))];
    }),
    wallet.bind("nice-to-have", "Có thì tốt", "must", "have", "envelope", home, 50),
    allocation.bind("nice-to-have", "remainder", null, 99),
    ...ALWAYS_CATEGORIES.map((c) => category.bind(c.id, c.name, "nice-to-have", c.icon, c.sort)),
    db
      .prepare("INSERT INTO audit_log (member_id, via, action, target, detail) VALUES (?, 'session', 'setup.done', NULL, ?)")
      .bind(owner.id, JSON.stringify({ members: input.members.length, accounts: input.accounts.length, taxable: input.taxable, must: input.must })),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (await isSetUp(db)) throw alreadySetup();
    throw err;
  }
  return { id: owner.id, name: owner.name, mode: hashes[0] ? "p" : "h" };
}

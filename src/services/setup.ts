// Thiết lập nhà lần đầu (UC-510, ADR-129, ADR-132): DB chỉ có docs/schema.sql → tạo thành viên, tài khoản theo ngăn, ngày
// lương, % Tích luỹ, nhóm + danh mục chi mẫu, nguồn "Lương" mở kỳ, mục tiêu Dự phòng (mỗi mục tiêu gắn một tài khoản ngăn
// Dự phòng của thân, hoặc chưa gắn) trong MỘT batch. Không ghi ví / luật nạp / `conversion_state`. Không gọi createAccount /
// createGoal: hai hàm đó tự chạy câu riêng. Dòng config 'setup_done' đứng đầu batch, INSERT trơn: hai yêu cầu cùng lúc thì
// yêu cầu sau vấp khoá chính `config.k` → cả batch huỷ → 409 already_setup.

import { rejectOldFields } from "../domain/entry";
import { checkGoal, DEFAULT_SAVINGS_PCT, MONEY_MAX, POCKETS, type GoalDraft, type Pocket } from "../domain/pockets";
import { DEFAULT_PAYDAY_DAY } from "../domain/snapshot";
import { DomainError } from "../domain/types";
import { hashPassword } from "./passwords";
import { ACCOUNT_KINDS, bankOk, MAX_ACTIVE_MEMBERS, memberName, memberPassword, nameKey, slug } from "./settings";

const ACCOUNT_NAME_MAX = 60;
const ACCOUNT_MAX = 20;
const GOAL_NAME_MAX = 60;
const GOAL_MAX = 10;

const invalid = (field: string, message: string): never => {
  throw new DomainError("invalid_input", message, 400, field);
};

export const isSetUp = async (db: D1Database) => Boolean(await db.prepare("SELECT 1 FROM config WHERE k = 'setup_done'").first());
/** 409: nhà đã thiết lập (kiểm trước khi so mật khẩu, và khi batch vấp khoá chính `setup_done`). */
export const alreadySetup = () => new DomainError("already_setup", "Nhà đã thiết lập rồi — đăng nhập để dùng.", 409);

type GroupChoice = "food" | "housing" | "transport" | "utilities";
type Category = { id: string; name: string; icon: string; sort: number };
type StarterGroup = { id: string; name: string; essential: boolean; sort: number; categories: Category[] };

/** Nhóm Thiết yếu người chọn (mã lựa chọn → nhóm); danh mục giữ mã cũ của bộ mẫu trước. Thứ tự = thứ tự gửi lên. */
const STARTER_GROUPS: Record<GroupChoice, StarterGroup> = {
  food: {
    id: "an-uong",
    name: "Ăn uống",
    essential: true,
    sort: 10,
    categories: [
      { id: "groceries", name: "Đi chợ / nấu ăn", icon: "basket", sort: 11 },
      { id: "eating-out", name: "Ăn ngoài", icon: "utensils", sort: 12 },
    ],
  },
  housing: { id: "nha-o", name: "Nhà ở", essential: true, sort: 20, categories: [{ id: "housing", name: "Nhà ở", icon: "home", sort: 10 }] },
  transport: {
    id: "di-lai",
    name: "Đi lại",
    essential: true,
    sort: 30,
    categories: [
      { id: "fuel-parking", name: "Xăng xe / gửi xe", icon: "fuel", sort: 14 },
      { id: "ride-hailing", name: "Grab / taxi", icon: "car", sort: 15 },
    ],
  },
  utilities: { id: "dien-nuoc", name: "Điện nước", essential: true, sort: 40, categories: [{ id: "utilities", name: "Điện nước mạng", icon: "zap", sort: 13 }] },
};
const GROUP_CHOICES = Object.keys(STARTER_GROUPS) as GroupChoice[];

/** Nhóm luôn có: Y tế (Thiết yếu), Mua sắm (Mong muốn). */
const ALWAYS_GROUPS: StarterGroup[] = [
  { id: "y-te", name: "Y tế", essential: true, sort: 50, categories: [{ id: "health", name: "Y tế", icon: "pill", sort: 22 }] },
  { id: "mua-sam", name: "Mua sắm", essential: false, sort: 60, categories: [{ id: "shopping", name: "Mua sắm", icon: "bag", sort: 30 }] },
];
/** Danh mục hệ thống (system-ids.ts), không nhóm. */
const SYSTEM_CATEGORIES: Category[] = [
  { id: "lending", name: "Cho vay / trả hộ", icon: "swap", sort: 27 },
  { id: "debt-payment", name: "Trả nợ", icon: "credit-card", sort: 29 },
];

/** Mục tiêu thiết lập tự tạo khi tự nộp thuế: "Thuế" 10% thu chịu thuế, chưa gắn tài khoản. */
const TAX_GOAL = { id: "thue", name: "Thuế", pct: 10 };
const SALARY_STREAM = { id: "luong", name: "Lương" };

type AccountKind = (typeof ACCOUNT_KINDS)[number];
export interface SetupGoal {
  id: string;
  name: string;
  monthlyAmount: number;
  repeatMonths: number;
  targetAmount: number;
  dueDate: string | null;
  /** Mã tài khoản của mục tiêu (ngăn Dự phòng, trong thân); null = chưa gắn. */
  accountId: string | null;
}
export interface SetupInput {
  members: { id: string; name: string; password: string | null }[];
  accounts: { id: string; name: string; kind: AccountKind; bank: string | null; owner: number | null; pocket: Pocket | null }[];
  paydayDay: number;
  savingsPct: number;
  taxable: boolean;
  groups: GroupChoice[];
  goals: SetupGoal[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (b: Record<string, unknown>, k: string) => b[k] !== undefined;

/** Số nguyên trong [min, max]; không gửi → mặc định. */
function intIn(b: Record<string, unknown>, field: string, min: number, max: number, fallback: number, message: string): number {
  if (!has(b, field)) return fallback;
  const v = b[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) invalid(field, message);
  return v as number;
}

/**
 * Một mục tiêu của thân. `account` = chỉ số trong `accounts[]` của thân: tài khoản ngăn Dự phòng, chưa gắn mục tiêu khác
 * (`linked`); không gửi / null = chưa gắn.
 */
function parseGoal(raw: unknown, i: number, taken: Map<string, string>, accounts: SetupInput["accounts"], linked: Set<string>): SetupGoal {
  const g = isObject(raw) ? raw : {};
  const field = (k: string) => `goals.${i}.${k}`;
  const name = typeof g.name === "string" ? g.name.trim() : "";
  if (!name || name.length > GOAL_NAME_MAX) invalid(field("name"), `Tên mục tiêu từ 1 đến ${GOAL_NAME_MAX} ký tự.`);
  const id = slug(name);
  if (!id) invalid(field("name"), "Tên mục tiêu cần có chữ hoặc số.");
  const clash = taken.get(id);
  if (clash) invalid(field("name"), clash);
  const monthly = g.monthly_amount;
  if (typeof monthly !== "number" || !Number.isInteger(monthly) || monthly <= 0 || monthly > MONEY_MAX) {
    invalid(field("monthly_amount"), "Số mỗi tháng là số nguyên lớn hơn 0, tối đa 1.000.000.000.000.");
  }
  if (g.due_date !== undefined && g.due_date !== null && typeof g.due_date !== "string") invalid(field("due_date"), "Hạn có dạng 2027-01-15.");
  const repeat = g.repeat_months ?? 1;
  if (typeof repeat !== "number") invalid(field("repeat_months"), "Mấy tháng một lần: từ 1 đến 12.");
  let draft: GoalDraft;
  try {
    draft = checkGoal({
      target_amount: null,
      target_pct: null,
      monthly_amount: monthly as number,
      repeat_months: repeat as number,
      due_date: typeof g.due_date === "string" && g.due_date ? g.due_date : null,
      debt_id: null,
    });
  } catch (err) {
    if (err instanceof DomainError && err.field) invalid(field(err.field), err.message);
    throw err;
  }
  const index = g.account ?? null;
  let accountId: string | null = null;
  if (index !== null) {
    const account = typeof index === "number" && Number.isInteger(index) ? accounts[index] : undefined;
    if (!account) return invalid(field("account"), "Tài khoản của mục tiêu phải là một tài khoản trong danh sách, hoặc để chưa có.");
    if (account.pocket !== "reserve") invalid(field("account"), "Tài khoản của mục tiêu phải ở ngăn Dự phòng.");
    if (linked.has(account.id)) invalid(field("account"), "Tài khoản này đã gắn mục tiêu khác: mỗi mục tiêu một tài khoản riêng.");
    linked.add(account.id);
    accountId = account.id;
  }
  taken.set(id, `Trùng tên với mục tiêu “${name}”.`);
  return { id, name, monthlyAmount: draft.monthly_amount!, repeatMonths: draft.repeat_months!, targetAmount: draft.target_amount!, dueDate: draft.due_date, accountId };
}

/**
 * Kiểm body `POST /v1/setup` (UC-510 AC-4, E4). Lỗi: 400 invalid_input, `field` dạng dấu chấm chỉ đúng ô ("members.0.name");
 * còn `template` của bộ ví mẫu cũ → 400 model_changed.
 */
export function parseSetup(body: unknown): SetupInput {
  const b = isObject(body) ? body : {};
  rejectOldFields(b, ["template"]);
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
    const kind = a.kind as AccountKind;
    if (!ACCOUNT_KINDS.includes(kind)) invalid(`accounts.${i}.kind`, "Chọn loại tài khoản.");
    if (a.bank !== undefined && a.bank !== null && typeof a.bank !== "string") invalid(`accounts.${i}.bank`, "Ngân hàng phải là chuỗi.");
    const bank = typeof a.bank === "string" && a.bank.trim() ? a.bank.trim().slice(0, 40) : null;
    if (!bankOk(kind, bank)) invalid(`accounts.${i}.bank`, "Ngân hàng phải chọn trong danh sách.");
    const owner = a.owner ?? null;
    if (owner !== null && !(typeof owner === "number" && Number.isInteger(owner) && owner >= 0 && owner < members.length)) {
      invalid(`accounts.${i}.owner`, "Chủ tài khoản phải là một người trong danh sách, hoặc để chung.");
    }
    // Không gửi → Vận hành (mọi loại, kể cả thẻ tín dụng, tiền mặt); null = ngoài ngăn.
    const pocket = a.pocket === undefined ? "operating" : a.pocket;
    if (pocket !== null && !(POCKETS as readonly unknown[]).includes(pocket)) invalid(`accounts.${i}.pocket`, "Ngăn là Tích luỹ, Dự phòng, Vận hành hoặc ngoài ngăn.");
    accounts.push({ id, name, kind, bank, owner: owner as number | null, pocket: pocket as Pocket | null });
  });

  const paydayDay = intIn(b, "payday_day", 1, 31, DEFAULT_PAYDAY_DAY, "Ngày lương là số nguyên từ 1 đến 31.");
  const savingsPct = intIn(b, "savings_pct", 1, 100, DEFAULT_SAVINGS_PCT, "% Tích luỹ là số nguyên từ 1 đến 100.");
  if (has(b, "taxable") && typeof b.taxable !== "boolean") invalid("taxable", "taxable phải là true hoặc false.");
  const taxable = b.taxable === true;

  const groups = b.groups ?? [];
  if (!Array.isArray(groups) || groups.some((g) => !GROUP_CHOICES.includes(g as GroupChoice)) || new Set(groups).size !== groups.length) {
    invalid("groups", `Nhóm chọn trong: ${GROUP_CHOICES.join(", ")}, mỗi nhóm một lần.`);
  }

  const rawGoals = b.goals ?? [];
  if (!Array.isArray(rawGoals)) return invalid("goals", "goals là danh sách mục tiêu.");
  if (rawGoals.length > GOAL_MAX) invalid("goals", `Lúc thiết lập thêm tối đa ${GOAL_MAX} mục tiêu.`);
  // Mã đã có trước khi đọc mục tiêu: mục tiêu thiết lập tự tạo (không để batch vấp khoá chính rồi bị hiểu là already_setup).
  const taken = new Map<string, string>();
  if (taxable) taken.set(TAX_GOAL.id, "Trùng tên với mục tiêu có sẵn.");
  const linked = new Set<string>();
  const goals = rawGoals.map((g, i) => parseGoal(g, i, taken, accounts, linked));

  return {
    members,
    accounts,
    paydayDay,
    savingsPct,
    taxable,
    groups: GROUP_CHOICES.filter((g) => (groups as string[]).includes(g)),
    goals,
  };
}

/**
 * Tạo nhà trong một batch (UC-510 bước 4–5): thành viên theo thứ tự gửi (người đầu `owner`, sau `adult`), tài khoản theo ngăn
 * đã xác nhận, ngày lương + % Tích luỹ, nhóm + danh mục mẫu (không hạn mức), nguồn "Lương" mở kỳ, mục tiêu Dự phòng (+ "Thuế"
 * 10%, chưa gắn), `setup_done`, nhật ký `setup.done` (người làm là chủ hộ vừa tạo, qua phiên). Đã thiết lập
 * (kể cả do yêu cầu chạy song song) → 409 already_setup, không đổi gì. Trả chủ hộ và cách vào của chủ hộ để cấp cookie.
 */
export async function createHousehold(db: D1Database, input: SetupInput): Promise<{ id: string; name: string; mode: "h" | "p" }> {
  const hashes = await Promise.all(input.members.map((m) => (m.password ? hashPassword(m.password) : null)));
  const owner = input.members[0]!;
  const config = db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v");
  const group = db.prepare("INSERT INTO category_groups (id, name, essential, sort) VALUES (?, ?, ?, ?)");
  const category = db.prepare("INSERT INTO categories (id, name, icon, sort, group_id) VALUES (?, ?, ?, ?, ?)");
  const goal = db.prepare(
    `INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const groups = [...input.groups.map((g) => STARTER_GROUPS[g]), ...ALWAYS_GROUPS];
  const pockets = { savings: 0, reserve: 0, operating: 0, outside: 0 };
  for (const a of input.accounts) pockets[a.pocket ?? "outside"] += 1;
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO config (k, v) VALUES ('setup_done', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"),
    ...input.members.map((m, i) =>
      db.prepare("INSERT INTO members (id, name, role, password_hash) VALUES (?, ?, ?, ?)").bind(m.id, m.name, i === 0 ? "owner" : "adult", hashes[i]),
    ),
    ...input.accounts.map((a) =>
      db
        .prepare(
          "INSERT INTO accounts (id, name, kind, bank, owner_member_id, opened_at, pocket, pocket_confirmed) VALUES (?, ?, ?, ?, ?, date('now'), ?, 1)",
        )
        .bind(a.id, a.name, a.kind, a.bank, a.owner === null ? null : input.members[a.owner]!.id, a.pocket),
    ),
    config.bind("payday_day", String(input.paydayDay)),
    config.bind("savings_pct", String(input.savingsPct)),
    ...groups.flatMap((g) => [group.bind(g.id, g.name, g.essential ? 1 : 0, g.sort), ...g.categories.map((c) => category.bind(c.id, c.name, c.icon, c.sort, g.id))]),
    ...SYSTEM_CATEGORIES.map((c) => category.bind(c.id, c.name, c.icon, c.sort, null)),
    // Nguồn "Lương" mở kỳ; ngăn theo tài khoản nhận (pocket UC-1205).
    db.prepare("INSERT INTO income_streams (id, name, sort, pocket, opens_cycle) VALUES (?, ?, 10, NULL, 1)").bind(SALARY_STREAM.id, SALARY_STREAM.name),
    // Mục tiêu sau tài khoản trong cùng batch: trigger thấy tài khoản ngăn Dự phòng vừa tạo.
    ...input.goals.map((g, i) => goal.bind(g.id, g.name, g.accountId, g.targetAmount, null, g.monthlyAmount, g.repeatMonths, g.dueDate, 10 + i)),
    ...(input.taxable ? [goal.bind(TAX_GOAL.id, TAX_GOAL.name, null, null, TAX_GOAL.pct, null, null, null, 50)] : []),
    db
      .prepare("INSERT INTO audit_log (member_id, via, action, target, detail) VALUES (?, 'session', 'setup.done', NULL, ?)")
      .bind(
        owner.id,
        JSON.stringify({
          members: input.members.length,
          accounts: input.accounts.length,
          pockets,
          payday_day: input.paydayDay,
          savings_pct: input.savingsPct,
          groups: input.groups,
          goals: input.goals.length,
          taxable: input.taxable,
        }),
      ),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (await isSetUp(db)) throw alreadySetup();
    throw err;
  }
  return { id: owner.id, name: owner.name, mode: hashes[0] ? "p" : "h" };
}

// Tầng dịch vụ: đọc/ghi D1 rồi gọi các hàm thuần trong src/domain.
// REST (/v1), MCP và cron đều đi qua đây — không route nào tự viết SQL nghiệp vụ.

import { buildEntry, INVALID_GOAL, INVALID_INTEREST, MANUAL_MEANINGS, type EntryInput, type TxRow } from "../domain/entry";
import { groupSpend, type CategoryGroupRef, type CycleRef, type LookBack, type LookBackCategory, type LookBackCycle, type LookBackInterestLine, type LookBackSavings } from "../domain/look-back";
import { cycleDays, cycleRanges, savingsDone, vnMidnight, type CycleRange, type QrTarget, type TaskFigures, type TaskKind } from "../domain/pay-cycle";
import { dayKey, monthKey, weekKey } from "../domain/period";
import { normalizeContent } from "../domain/rules";
import { buildSnapshot, DEFAULT_PAYDAY_DAY, type Snapshot } from "../domain/snapshot";
import { INTEREST_MAX_AMOUNT_DEFAULT, INTEREST_MAX_AMOUNT_LIMIT } from "../domain/interest-deposit";
import { DomainError, type AccountRef, type Refs } from "../domain/types";
import { DEFAULT_SAVINGS_PCT, goalOrder, pocketsView, type Pocket, type PocketDebt, type PocketGoalInput } from "../domain/pockets";
import { goalSpentMap, goalSpentStatement, operatingExtrasFrom, operatingExtrasStatements } from "./pockets";
import { groupInterestFrom, groupInterests, groupInterestStatements } from "./goal-groups";
import { formatMoney } from "../notify/format";
import { itemsTotal } from "./balance";
import { debtInterest } from "./debts";
import { closest, feedMark, linkColumn } from "./manual-links";
import { afterWrite, incomeStatements, payCycleView, resolveOpensCycle, voidTxStatements, type IncomePlan } from "./pay-cycles";
import { conversionProgress } from "./conversion";
import { assertRowWritable, assertTenantAccount, assertTxChangeable, assertTxReadable, hiddenAccountIds, hiddenTxSql, txNotFound, txVisibility } from "./privacy";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const toMap = (list: { w: string; s: number | null }[]) => Object.fromEntries(list.map((x) => [x.w, Number(x.s ?? 0)]));

// ── Dữ liệu tham chiếu ─────────────────────────────────────────────

export async function loadRefs(db: D1Database): Promise<Refs> {
  const [categories, accounts, members, streams, tenants, rental, debts, receivables, goals] = await db.batch([
    db.prepare(`SELECT id, name, icon, sort, group_id AS groupId FROM categories WHERE active = 1 ORDER BY sort, name`),
    db.prepare(
      `SELECT id, name, kind, owner_member_id AS ownerMemberId, sepay_enabled AS sepayEnabled, sepay_out AS sepayOut, opened_at AS openedAt,
              feed_from AS feedFrom, sepay_out_from AS sepayOutFrom, pocket, private, parent_account_id AS parentId
       FROM accounts WHERE active = 1 ORDER BY kind, name`,
    ),
    db.prepare(`SELECT id, name, role FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, name`),
    db.prepare(`SELECT id, name, active, pocket, opens_cycle AS opensCycle FROM income_streams ORDER BY sort, name`),
    db.prepare(`SELECT id, name, active FROM tenants ORDER BY name`),
    db.prepare(`SELECT v FROM config WHERE k = 'rental_income_stream_id'`),
    db.prepare(`SELECT debt_id AS id, name, active, balance FROM v_debt_balance ORDER BY balance DESC, name`),
    db.prepare(`SELECT receivable_id AS id, name, active, balance FROM v_receivable_balance ORDER BY balance DESC, name`),
    db.prepare(`SELECT id, name, account_id AS accountId, sort, due_date AS dueDate, pays_from AS paysFrom FROM reserve_goals WHERE active = 1 AND (account_id IS NOT NULL OR pays_from = 'operating')`),
  ]);
  const goalIdsOf = new Map<string, string[]>();
  const operatingGoalIds: string[] = [];
  for (const g of rows<{ id: string; name: string; accountId: string | null; sort: number; dueDate: string | null; paysFrom: string }>(goals!).sort(goalOrder)) {
    if (g.paysFrom === "operating") operatingGoalIds.push(g.id);
    else if (g.accountId !== null) goalIdsOf.set(g.accountId, [...(goalIdsOf.get(g.accountId) ?? []), g.id]);
  }
  const books = (res: D1Result) =>
    rows<{ id: string; name: string; active: number; balance: number }>(res).map((b) => ({ ...b, active: Boolean(b.active), balance: Number(b.balance) }));
  return {
    categories: rows(categories!) as unknown as Refs["categories"],
    accounts: rows<Omit<Refs["accounts"][number], "sepayEnabled" | "sepayOut" | "private"> & { sepayEnabled: number; sepayOut: number; private: number }>(accounts!).map((a) => ({
      ...a,
      sepayEnabled: Boolean(a.sepayEnabled),
      sepayOut: Boolean(a.sepayEnabled) && Boolean(a.sepayOut),
      private: Boolean(a.private),
      goalIds: goalIdsOf.get(a.id) ?? [],
    })),
    members: rows(members!) as unknown as Refs["members"],
    incomeStreams: rows<{ id: string; name: string; active: number; pocket: Pocket | null; opensCycle: number }>(streams!).map((s) => ({
      ...s,
      active: Boolean(s.active),
      opensCycle: Boolean(s.opensCycle),
    })),
    tenants: rows<{ id: string; name: string; active: number }>(tenants!).map((t) => ({ ...t, active: Boolean(t.active) })),
    debts: books(debts!),
    receivables: books(receivables!),
    rentalIncomeStreamId: rows<{ v: string }>(rental!)[0]?.v || null,
    operatingGoalIds,
  };
}

const TX_COLUMNS = [
  "at", "amount", "meaning", "account_id", "counter_account_id", "category_id",
  "by_member_id", "link_id", "batch_id", "asset_kind", "taxable", "week_key", "month_key", "source", "note", "client_id",
  "income_stream_id", "tenant_id", "debt_id", "receivable_id", "interest_debt_id",
] as const;

/** Log ngân hàng gắn vào khoản tay lúc ghi (261017-webhook-truoc-moc): `log_id` chân ra / khoản một chiều, `log_id_2` chân nhận. */
export interface TxLogs {
  log_id: string | null;
  log_id_2: string | null;
}
const NO_LOGS: TxLogs = { log_id: null, log_id_2: null };

/**
 * `goal_id` ghi vào dòng mới (pocket UC-1209 bước 11): gửi thì giữ (đã kiểm ở `buildEntry`, trigger 0044 là chốt cuối); không
 * gửi mà khoản là chi / chuyển ra khỏi tài khoản có đúng một mục tiêu tài khoản đang dùng, không rút từ tiền lãi, không chuyển
 * sang khoản gửi của chính nó → tự gắn mục tiêu đó, lúc ghi — một luật cho mọi đường ghi (nhập tay, sửa, Gán, rule, ghép cặp,
 * MCP). Mục tiêu trả từ tiền chi tiêu không bao giờ tự gắn (ADR-141).
 */
const GOAL_VALUE = `COALESCE(?, (SELECT MIN(g.id) FROM reserve_goals g WHERE g.account_id = ? AND g.active = 1 AND g.pays_from = 'account'
  AND ? IN ('spend', 'transfer') AND ? = 0
  AND COALESCE((SELECT COALESCE(c.parent_account_id, c.id) FROM accounts c WHERE c.id = ?), '') <> g.account_id HAVING COUNT(*) = 1))`;
const goalBinds = (row: TxRow) => [row.goal_id ?? null, row.account_id, row.meaning, row.from_interest ?? 0, row.counter_account_id, row.from_interest ?? 0];
const TX_INSERT_COLUMNS = `log_id, log_id_2, ${TX_COLUMNS.join(", ")}, goal_id, from_interest`;
const TX_INSERT_VALUES = `?, ?, ${TX_COLUMNS.map(() => "?").join(", ")}, ${GOAL_VALUE}, ?`;

export function insertTx(db: D1Database, row: TxRow, logs: TxLogs = NO_LOGS): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO transactions (${TX_INSERT_COLUMNS}) VALUES (${TX_INSERT_VALUES})`)
    .bind(logs.log_id, logs.log_id_2, ...TX_COLUMNS.map((c) => row[c] ?? null), ...goalBinds(row));
}

/** Trigger 0044 huỷ câu ghi có `goal_id` / `from_interest` sai (máy khác vừa đổi tài khoản / tắt mục tiêu) → 400 như bước kiểm ở code. */
export function rethrowEntryTrigger(err: unknown): void {
  if (/invalid_goal/.test(String(err))) throw new DomainError("invalid_goal", INVALID_GOAL);
  if (/invalid_interest/.test(String(err))) throw new DomainError("invalid_interest", INVALID_INTEREST);
}

/**
 * Trần "Từ tiền lãi" (pocket UC-1209 bước 9, AC-19; ledger UC-102 AC-29): số rút không vượt tiền lãi hiện có của nhóm mẹ + con,
 * tính tới lúc ghi và không gồm khoản đang được thay (`excludeTxId`). Luật loại khoản / nhóm đã kiểm ở `buildEntry`.
 */
export async function assertInterestCap(db: D1Database, refs: Refs, row: TxRow, excludeTxId: number | null = null): Promise<void> {
  if (row.from_interest !== 1) return;
  const from = refs.accounts.find((a) => a.id === row.account_id);
  const rootId = from?.parentId ?? row.account_id!;
  const available = (await groupInterests(db, excludeTxId))[rootId] ?? 0;
  if (row.amount > available) {
    const name = refs.accounts.find((a) => a.id === rootId)?.name ?? rootId;
    throw new DomainError("invalid_interest", `Tiền lãi của ${name} chỉ còn ${formatMoney(available)} — không rút ${formatMoney(row.amount)} từ tiền lãi được.`);
  }
}

/** Dòng phân loại `passive_income` cho khoản lãi (`is_interest`) — đứng ngay sau câu ghi khoản đó (last_insert_rowid). */
const passiveIncomeClass = (db: D1Database, memberId: string | null, guardTxId: number | null = null) =>
  db
    .prepare(
      `INSERT INTO transaction_report_classes (transaction_id, report_class, by_member_id) SELECT last_insert_rowid(), 'passive_income', ?1
       WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM transactions WHERE id = ?2 AND status = 'active')`,
    )
    .bind(memberId, guardTxId);

const linkedIds = (logs: TxLogs) => [logs.log_id, logs.log_id_2].filter((x): x is string => x !== null);

/** Đổi các log vừa gắn vào khoản tay sang 'assigned' — cùng batch với lệnh ghi khoản đó, và chỉ khi khoản đó thật sự được ghi. */
const markLinked = (db: D1Database, ids: string[]) =>
  db
    .prepare(
      `UPDATE bank_logs SET status = 'assigned' WHERE status = 'pending' AND id IN (${ids.map(() => "?").join(", ")})
         AND EXISTS (SELECT 1 FROM transactions t WHERE t.status = 'active' AND bank_logs.id IN (t.log_id, t.log_id_2))`,
    )
    .bind(...ids);

const BANK_LOG_EXISTS = "SePay đã báo khoản này và đã có trong sổ — ghi nữa là hai lần.";

/**
 * Khoản tay trước mốc theo dõi SePay của một tài khoản (ADR-113) mà SePay đã báo bằng log webhook trước mốc khớp (cùng chiều,
 * cùng số tiền, ngày VN lệch ≤ 1 ngày): log còn chờ → gắn luôn vào khoản này (gần giờ nhất; hoà thì không đoán); log đã gán
 * (đã vào sổ) → 409 `bank_log_exists`, trừ khi người ghi xác nhận là hai khoản thật (`confirm_duplicate`).
 */
async function bankLogsFor(db: D1Database, refs: Refs, row: TxRow, confirmDuplicate: boolean): Promise<TxLogs> {
  const logs: TxLogs = { ...NO_LOGS };
  const sides = [
    { accountId: row.account_id, direction: "out" as const },
    { accountId: row.counter_account_id, direction: "in" as const },
  ];
  for (const side of sides) {
    const account = side.accountId ? refs.accounts.find((a) => a.id === side.accountId && a.sepayEnabled) : undefined;
    const mark = account ? feedMark(side.direction, account.feedFrom, account.sepayOutFrom) : null;
    if (!account || !mark || Date.parse(row.at) >= Date.parse(mark)) continue;
    const found = rows<{ id: string; at: string; status: string }>(
      await db
        .prepare(
          `SELECT id, at, status FROM bank_logs
           WHERE account_id = ?1 AND source = 'webhook' AND direction = ?2 AND amount = ?3 AND status IN ('pending', 'assigned')
             AND julianday(at) < julianday(?4)
             AND abs(julianday(date(at, '+7 hours')) - julianday(date(?5, '+7 hours'))) <= 1`,
        )
        .bind(account.id, side.direction, row.amount, mark, row.at)
        .all(),
    );
    const hit = closest(found.filter((l) => l.status === "pending"), row.at);
    if (hit) logs[linkColumn(side.direction, row.meaning)] = hit.id;
    else if (!confirmDuplicate && found.some((l) => l.status === "assigned")) throw new DomainError("bank_log_exists", BANK_LOG_EXISTS, 409);
  }
  return logs;
}

export const getTransaction = (db: D1Database, id: number) => db.prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first<Row>();

// ── Nhập tay ────────────────────────────────────────────────────────

/**
 * Tài khoản đã nối SePay mà khoản nhập tay chạm đúng chiều SePay báo về (ADR-66): ghi thêm là đếm hai lần. Khoản trước
 * mốc theo dõi SePay (`feedFrom`, ADR-113) — với tiền ra, cả trước lúc bật "báo cả tiền ra" (`sepayOutFrom`) — SePay không
 * đưa vào sổ nữa nên ghi tay được.
 */
function fedAccount(refs: Refs, row: TxRow): AccountRef | undefined {
  const at = Date.parse(row.at);
  const since = (from: string | null) => from === null || at >= Date.parse(from);
  return (
    refs.accounts.find((a) => a.sepayEnabled && a.id === row.counter_account_id && since(a.feedFrom)) ??
    refs.accounts.find((a) => a.sepayOut && a.id === row.account_id && since(a.feedFrom) && since(a.sepayOutFrom))
  );
}

/** Kỳ mở / nhập và các việc vừa tự xong sau một lần ghi — cho toast PWA ("Kỳ lương mới từ 10/11 · 5 việc"), MCP. */
export interface WriteEffects {
  cycle: { opened: boolean; startedAt: string; payday: string; tasks: number } | null;
  tasksDone: { id: number; kind: TaskKind }[];
}
const NO_EFFECTS: WriteEffects = { cycle: null, tasksDone: [] };

export function writeEffects(plan: IncomePlan, tasksDone: WriteEffects["tasksDone"]): WriteEffects {
  const cycle = plan.decision === "open" || plan.decision === "join" ? { opened: plan.decision === "open", startedAt: plan.startedAt!, payday: plan.payday!, tasks: plan.tasks } : null;
  return { cycle, tasksDone };
}

/** Tiền vận hành sau khi ghi một khoản chi — toast "Đã ghi · Vận hành còn … ≈ …/ngày" (pwa UC-703). */
async function nearSpendAfter(db: D1Database, viewerId: string | null, now: Date): Promise<{ amount: number; perDay: number | null }> {
  const { nearSpend } = await getSnapshot(db, viewerId, now);
  return { amount: nearSpend.amount, perDay: nearSpend.perDay };
}

/**
 * Ghi một khoản nhập tay. `memberId` là người ghi; `viewerId` là người làm (mặc định chính người ghi — MCP: người đã uỷ quyền,
 * dù gửi `by_member_id` khác): khoản có một phía là tài khoản riêng tư bị giấu với người làm → 403 `private_account`; gửi lại
 * `client_id` của một khoản bị giấu → 404 như không có, không trả bản trùng (access UC-504 AC-14, ADR-133).
 */
export async function createEntry(db: D1Database, input: EntryInput, memberId: string | null, now: Date, viewerId: string | null = memberId) {
  const clientId = input.client_id?.trim() || null;
  const hidden = await hiddenAccountIds(db, viewerId);
  const existing = async () => {
    const tx = clientId ? await db.prepare("SELECT * FROM transactions WHERE client_id = ?").bind(clientId).first<Row>() : null;
    if (tx && txVisibility(tx, hidden) === "hidden") throw txNotFound();
    return tx;
  };
  const duplicate = (tx: Row) => ({ tx, duplicate: true, nearSpend: null, effects: NO_EFFECTS, linkedLogs: [] as string[] });

  const already = await existing();
  if (already) return duplicate(already);

  const refs = await loadRefs(db);
  const row = buildEntry(input, refs, memberId, now);
  assertRowWritable(row, hidden);
  assertTenantAccount(row, refs);

  // Chiều tiền mà SePay báo về thì tự về từ ngân hàng. Ghi tay thêm chiều đó là đếm cùng một khoản tiền hai lần
  // (nhập tay rồi lại gán log), và đối soát không bắt được vì nó chỉ so log với log (ADR-48, tinh chỉnh ADR-66):
  // tiền VÀO tài khoản đã nối SePay luôn bị chặn; tiền RA chỉ bị chặn khi SePay báo cả tiền ra (`sepay_out`).
  // Khoản trước mốc theo dõi SePay (ADR-113) thì SePay không đưa vào sổ nữa: ghi tay được.
  const fed = fedAccount(refs, row);
  if (fed) {
    throw new DomainError("fed_account", `${fed.name} đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán thay vì nhập tay.`);
  }
  await resolveLink(db, row, undefined, hidden);
  await assertInterestCap(db, refs, row);
  // Khoản lãi (`is_interest`, ADR-140): không mở kỳ, không việc; phân loại `passive_income` ngay sau câu ghi.
  const interest = input.is_interest === true;
  const opensCycle = interest ? false : resolveOpensCycle(refs, row, input.opens_cycle);
  const logs = await bankLogsFor(db, refs, row, input.confirm_duplicate === true);
  const linked = linkedIds(logs);
  // Khoản thu + kỳ + việc: cùng một batch (pocket UC-1205 bước 5).
  const income = await incomeStatements(db, refs, row, { opensCycle, interest, memberId });

  let id: number;
  try {
    const [res] = await db.batch([
      insertTx(db, row, logs),
      ...(interest ? [passiveIncomeClass(db, memberId)] : []),
      ...income.statements,
      ...(linked.length ? [markLinked(db, linked)] : []),
    ]);
    id = Number(res!.meta.last_row_id);
  } catch (err) {
    // Hai lần gửi cùng client_id chạy song song: lần thua đọc lại bản đã ghi.
    const raced = await existing();
    if (raced) return duplicate(raced);
    // Log định gắn vừa được gán ở request khác: khoản này giờ đã có trong sổ.
    if (/log_not_pending/.test(String(err))) throw new DomainError("bank_log_exists", BANK_LOG_EXISTS, 409);
    rethrowEntryTrigger(err);
    throw err;
  }
  const { tasksDone } = await afterWrite(db);
  return {
    tx: await getTransaction(db, id),
    duplicate: false,
    nearSpend: row.meaning === "spend" ? await nearSpendAfter(db, memberId, now) : null,
    effects: writeEffects(income.plan, tasksDone),
    linkedLogs: linked,
  };
}

/**
 * Kiểm một giao dịch có huỷ / sửa tay được không: chỉ khoản ghi tay. Giao dịch ngân hàng đi đường gỡ gán (ingest UC-306).
 * Riêng tư kiểm trước mọi lỗi khác (access UC-504 AC-11): khoản bị giấu → 404, không lộ "đã huỷ" / "từ ngân hàng".
 */
function manualTxOrThrow(tx: Row | null, hidden: string[]): Row {
  if (!tx) throw txNotFound();
  assertTxChangeable(tx, hidden);
  if (tx.status !== "active") throw new DomainError("already_void", "Giao dịch đã huỷ trước đó.", 409);
  if (tx.source === "system" || tx.meaning === "fund") {
    throw new DomainError("system_tx", "Bút toán do hệ thống sinh ra không huỷ lẻ được.", 409);
  }
  if (tx.source === "sepay" || tx.log_id || tx.log_id_2) {
    throw new DomainError("bank_tx", "Giao dịch từ ngân hàng không xoá được — gỡ gán để gán lại.", 409);
  }
  return tx;
}

/** Kỳ do khoản `txId` mở (còn hiệu lực) — để nhật ký ghi `pay_cycle.void`. */
export const cycleOpenedBy = (db: D1Database, txId: number) =>
  db.prepare("SELECT id, payday FROM pay_cycles WHERE income_tx_id = ? AND status = 'active'").bind(txId).first<{ id: number; payday: string }>();

/**
 * Huỷ khoản ghi tay (ledger UC-102): cùng batch huỷ kỳ / việc khoản lương đó mở, `fund` cùng lô của khoản thu cũ đã chia.
 * Trả kèm kỳ vừa huỷ (nếu có).
 */
export async function voidTransaction(db: D1Database, id: number, viewerId: string | null) {
  manualTxOrThrow(await getTransaction(db, id), await hiddenAccountIds(db, viewerId));
  const cycle = await cycleOpenedBy(db, id);
  await db.batch([...(await voidTxStatements(db, [id])), db.prepare("UPDATE transactions SET status = 'void' WHERE id = ? AND status = 'active'").bind(id)]);
  return { tx: await getTransaction(db, id), voidedCycle: cycle };
}

/**
 * Sửa một khoản ghi tay (ADR-73): kiểm khoản mới đầy đủ như khi nhập, rồi trong MỘT batch huỷ khoản cũ (cùng kỳ / việc gắn
 * nó) và ghi khoản mới (khoản thu mới theo kỳ lương) — sổ vẫn chỉ ghi thêm, không lúc nào thiếu khoản đó. Khoản mới không có
 * loại chi cũ. Người ghi giữ là người ghi khoản cũ. Gửi lại cùng
 * `client_id` trả đúng khoản đã ghi — sau bước kiểm riêng tư của khoản cũ; bản trùng bị giấu → 404 (access UC-504 AC-11).
 */
export async function replaceTransaction(db: D1Database, id: number, input: EntryInput, memberId: string | null, now: Date) {
  const clientId = input.client_id?.trim() || null;
  const hidden = await hiddenAccountIds(db, memberId);
  // Trả về dạng dòng sổ (kèm tên danh mục…) để PWA nói được "Đã sửa thành 120.000 ₫ Xăng xe".
  const existing = async () => {
    const r = clientId ? await db.prepare(`${TX_VIEW} WHERE t.client_id = ?`).bind(clientId).first<Row>() : null;
    if (r && txVisibility(r, hidden) === "hidden") throw txNotFound();
    return r ? txOut(withoutHiddenNote(r, hidden)) : null;
  };
  const duplicate = (tx: Row) => ({ tx, replaced: id, duplicate: true, nearSpend: null, effects: NO_EFFECTS, voidedCycle: null, linkedLogs: [] as string[] });
  // Riêng tư của khoản cũ kiểm trước nhánh trả bản trùng; "đã huỷ" thì để sau — gửi lại sau khi sửa xong vẫn nhận bản trùng.
  const current = await getTransaction(db, id);
  if (!current) throw txNotFound();
  assertTxChangeable(current, hidden);
  const already = await existing();
  if (already) return duplicate(already);

  const old = manualTxOrThrow(current, hidden);
  if (!(MANUAL_MEANINGS as readonly unknown[]).includes(old.meaning)) {
    throw new DomainError("not_editable", "Khoản điều chỉnh sau đếm ví không sửa được — xoá rồi đếm lại.", 409);
  }
  if (old.meaning === "transfer" && !old.account_id && !old.counter_account_id) {
    throw new DomainError("not_editable", "Khoản chuyển giữa hai ví (cách tính cũ) không sửa được — chỉ huỷ được.", 409);
  }
  const author = (old.by_member_id as string | null) ?? memberId;
  // Sổ đối ứng / người thuê đã tắt sau khi ghi: khoản cũ vẫn sửa được mà giữ nguyên chỗ gắn.
  const keep = <T extends { id: string; active: boolean }>(list: T[], linked: unknown) => list.map((b) => (b.id === linked ? { ...b, active: true } : b));
  const loaded = await loadRefs(db);
  const refs: Refs = {
    ...loaded,
    debts: keep(keep(loaded.debts, old.debt_id), old.interest_debt_id),
    receivables: keep(loaded.receivables, old.receivable_id),
    tenants: keep(loaded.tenants, old.tenant_id),
  };
  const row = buildEntry(input, refs, author, now);
  assertRowWritable(row, hidden);
  assertTenantAccount(row, refs);

  const fed = fedAccount(refs, row);
  if (fed) {
    throw new DomainError("fed_account", `${fed.name} đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán thay vì nhập tay.`);
  }
  await resolveLink(db, row, id, hidden, old.link_id as number | null);
  // Khoản gốc đang có khoản hoàn tiền / nhận lại trỏ về: khoản mới thay nó phải còn là khoản gốc hợp lệ của chúng
  // (cùng meaning; khoản cho vay đổi người thì không khác người của khoản nhận lại) — rồi chúng trỏ sang khoản mới.
  const returns = rows<{ receivable_id: string | null }>(await db.prepare(`SELECT receivable_id FROM ${LINKED_RETURNS}`).bind(id).all());
  const otherPerson = returns.some((r) => row.receivable_id && r.receivable_id && r.receivable_id !== row.receivable_id);
  if (returns.length > 0 && (row.meaning !== old.meaning || otherPerson)) {
    throw new DomainError("invalid_link", "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước.");
  }
  await assertInterestCap(db, refs, row, id);
  const interest = input.is_interest === true;
  const opensCycle = interest ? false : resolveOpensCycle(refs, row, input.opens_cycle);
  const logs = await bankLogsFor(db, refs, row, input.confirm_duplicate === true);
  const linked = linkedIds(logs);
  const cycle = await cycleOpenedBy(db, id);
  // Huỷ kèm theo của khoản cũ đứng TRƯỚC: kỳ nó mở phải void trước khi khoản mới mở lại kỳ cùng ngày lương.
  const undo = await voidTxStatements(db, [id]);
  const income = await incomeStatements(db, refs, row, { opensCycle, interest, memberId: author, excludeTxId: id, guardTxId: id });
  // Khoản mới chỉ được ghi khi khoản cũ còn hiệu lực ngay trong batch: huỷ chen ở request khác thì không ghi gì mới.
  const insert = db
    .prepare(`INSERT INTO transactions (${TX_INSERT_COLUMNS}) SELECT ${TX_INSERT_VALUES} WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'active')`)
    .bind(logs.log_id, logs.log_id_2, ...TX_COLUMNS.map((c) => row[c] ?? null), ...goalBinds(row), id);
  // Ngay sau INSERT cùng điều kiện: last_insert_rowid() là khoản mới; khoản cũ đã huỷ chen thì không ghi, không trỏ.
  const relink = db
    .prepare(
      `UPDATE transactions SET link_id = last_insert_rowid()
       WHERE id IN (SELECT id FROM ${LINKED_RETURNS}) AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'active')`,
    )
    .bind(id, id);
  // Phân loại lại cho báo cáo (BR-15) đi theo khoản mới — khi khoản mới vẫn xếp được: đúng một phía tài khoản, Thu nhập thụ
  // động chỉ cho khoản thu, và không khi người sửa bỏ "Đây là tiền lãi" (`is_interest: false`). `is_interest: true` → đúng
  // một dòng `passive_income`. Đặt ngay sau relink: last_insert_rowid() vẫn là khoản mới (UPDATE không đổi nó).
  const singleSide = (row.account_id === null) !== (row.counter_account_id === null);
  const classes = interest
    ? [passiveIncomeClass(db, memberId, id)]
    : singleSide
      ? [
          db
            .prepare(
              `INSERT INTO transaction_report_classes (transaction_id, report_class, by_member_id)
               SELECT last_insert_rowid(), report_class, by_member_id FROM transaction_report_classes
               WHERE transaction_id = ?1 AND (report_class <> 'passive_income' OR (?2 = 'income' AND ?3 = 1))
                 AND EXISTS (SELECT 1 FROM transactions WHERE id = ?1 AND status = 'active')`,
            )
            .bind(id, row.meaning, input.is_interest === false ? 0 : 1),
        ]
      : [];
  let results: D1Result[];
  try {
    results = await db.batch([
      ...undo,
      insert,
      relink,
      ...classes,
      ...income.statements,
      ...(linked.length ? [markLinked(db, linked)] : []),
      db.prepare("UPDATE transactions SET status = 'void' WHERE id = ? AND status = 'active'").bind(id),
    ]);
  } catch (err) {
    // Hai lần gửi cùng client_id chạy song song: lần thua đọc lại bản đã ghi.
    const raced = await existing();
    if (raced) return duplicate(raced);
    if (/log_not_pending/.test(String(err))) throw new DomainError("bank_log_exists", BANK_LOG_EXISTS, 409);
    rethrowEntryTrigger(err);
    throw err;
  }
  const written = results[undo.length]!.meta;
  if (!written.changes) throw new DomainError("already_void", "Giao dịch đã huỷ trước đó.", 409);
  const newId = Number(written.last_row_id);
  const { tasksDone } = await afterWrite(db);
  return {
    tx: await transactionView(db, newId, memberId),
    replaced: id,
    duplicate: false,
    nearSpend: row.meaning === "spend" ? await nearSpendAfter(db, memberId, now) : null,
    effects: writeEffects(income.plan, tasksDone),
    voidedCycle: cycle,
    linkedLogs: linked,
  };
}

/**
 * Ngưỡng tối thiểu để một khoản khớp mẫu lương được tự ghi và tự chia; dưới ngưỡng thì hỏi như mọi tiền vào khác.
 * Đặt 0 để bỏ ngưỡng.
 */
export async function salaryMinAmount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT v FROM config WHERE k = 'salary_min_amount'").first<{ v: string }>();
  const n = row ? Number(row.v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 1_000_000;
}

/** Ngưỡng log lãi tiền gửi (config `interest_max_amount`, access UC-507): 0 = tắt; thiếu / hỏng → 10.000. */
export async function interestMaxAmount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT v FROM config WHERE k = 'interest_max_amount'").first<{ v: string }>();
  const n = row ? Number(row.v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= INTEREST_MAX_AMOUNT_LIMIT ? n : INTEREST_MAX_AMOUNT_DEFAULT;
}

/** Các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về một khoản gốc (`link_id` = ?, ledger UC-101 bước 4b). */
const LINKED_RETURNS = `transactions WHERE link_id = ? AND status = 'active' AND meaning IN ('refund', 'collect')`;

/** Một dòng sổ để xem: kèm tên danh mục, sổ đối ứng, người thuê, cờ khoản thu đã được chia chưa (cách tính cũ) và cờ khoản cũ. */
const TX_FROM = `FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN debts d ON d.id = t.debt_id
  LEFT JOIN receivables r ON r.id = t.receivable_id
  LEFT JOIN tenants tn ON tn.id = t.tenant_id`;
/**
 * `legacy`: khoản cũ trước v2 (`id` ≤ `config.legacy_max_tx_id`, ADR-131); không có khoá → không khoản nào cũ. `is_interest`:
 * khoản thu có phân loại `passive_income` tường minh (khoản lãi, ADR-140).
 */
const TX_VIEW = `SELECT t.*, c.name AS category_name,
         d.name AS debt_name, r.name AS receivable_name, tn.name AS tenant_name,
         EXISTS (SELECT 1 FROM allocation_runs ar WHERE ar.income_tx_id = t.id) AS allocated,
         (SELECT ar.wealth_note FROM allocation_runs ar WHERE ar.income_tx_id = t.id) AS wealth_note,
         t.id <= COALESCE((SELECT CAST(v AS INTEGER) FROM config WHERE k = 'legacy_max_tx_id'), 0) AS legacy,
         t.meaning = 'income' AND EXISTS (SELECT 1 FROM transaction_report_classes rc WHERE rc.transaction_id = t.id AND rc.report_class = 'passive_income') AS is_interest
  ${TX_FROM}`;
/** Dòng `TX_VIEW` trả ra API: `legacy`, `is_interest`, `from_interest` là boolean (ledger UC-111, UC-101). */
const txOut = (r: Row): Row => ({ ...r, legacy: Boolean(r.legacy), is_interest: Boolean(r.is_interest), from_interest: Boolean(r.from_interest) });

/** Các loại xem được trong sổ (mọi loại trừ `fund` — bút toán nạp ví của lần chia không hiện, ledger UC-111). */
export const BOOK_MEANINGS = ["spend", "income", "refund", "transfer", "lend", "collect", "buy_asset", "adjust"] as const;

/** Bộ lọc sổ giao dịch (pwa UC-716): mọi trường tuỳ chọn, các trường có mặt cùng phải khớp. */
export interface TxFilter {
  /** `YYYY-MM`, so với `month_key`. Bị bỏ qua khi có fromDate hoặc toDate. */
  month?: string;
  /** Mốc giờ `[start, end)` của một kỳ lương (`cycle`, ledger UC-111); `end` null = kỳ đang chạy. */
  range?: { start: string; end: string | null };
  /** `YYYY-MM-DD` ngày VN. */
  fromDate?: string;
  /** `YYYY-MM-DD` ngày VN. */
  toDate?: string;
  meanings?: string[];
  categoryId?: string;
  /** Khớp tài khoản tiền ra hoặc tiền vào. */
  accountId?: string;
  /** Người ghi (`by_member_id`). */
  memberId?: string;
  /** `bank`: từ ngân hàng (`source='sepay'` hoặc có log); `manual`: ghi tay. */
  source?: "manual" | "bank";
  /** Chữ cần tìm (đã cắt khoảng trắng, ≥ 2 ký tự): ghi chú, nội dung ngân hàng, tên danh mục / người. */
  q?: string;
  includeVoid?: boolean;
}

/**
 * Một chỗ dựng WHERE cho cả danh sách lẫn tổng — hai thứ luôn cùng một tập dòng. Dùng các bí danh của `TX_FROM`. `hidden`:
 * tài khoản riêng tư bị giấu với người xem (access UC-504) — bỏ giao dịch chỉ dính các tài khoản đó.
 */
function txWhere(f: TxFilter, hidden: string[]): { sql: string; binds: unknown[] } {
  const priv = hiddenTxSql("t", hidden);
  const parts = ["t.meaning <> 'fund'", `NOT ${priv.sql}`];
  const binds: unknown[] = [...priv.binds];
  if (!f.includeVoid) parts.push("t.status = 'active'");
  if (f.fromDate) {
    const fromAt = new Date(`${f.fromDate}T00:00:00+07:00`).toISOString();
    parts.push("t.at >= ?");
    binds.push(fromAt);
  }
  if (f.toDate) {
    const toAt = new Date(Date.parse(`${f.toDate}T00:00:00+07:00`) + 86_400_000).toISOString();
    parts.push("t.at < ?");
    binds.push(toAt);
  }
  if (f.range) {
    parts.push("t.at >= ?");
    binds.push(f.range.start);
    if (f.range.end) {
      parts.push("t.at < ?");
      binds.push(f.range.end);
    }
  }
  if (!f.fromDate && !f.toDate && f.month) {
    parts.push("t.month_key = ?");
    binds.push(f.month);
  }
  if (f.meanings?.length) {
    parts.push(`t.meaning IN (${f.meanings.map(() => "?").join(", ")})`);
    binds.push(...f.meanings);
  }
  if (f.categoryId) {
    parts.push("t.category_id = ?");
    binds.push(f.categoryId);
  }
  if (f.accountId) {
    parts.push("(t.account_id = ? OR t.counter_account_id = ?)");
    binds.push(f.accountId, f.accountId);
  }
  if (f.memberId) {
    parts.push("t.by_member_id = ?");
    binds.push(f.memberId);
  }
  if (f.source === "bank") parts.push("(t.source = 'sepay' OR t.log_id IS NOT NULL OR (t.source = 'manual' AND t.log_id_2 IS NOT NULL))");
  if (f.source === "manual") parts.push("(t.source = 'manual' AND t.log_id IS NULL AND t.log_id_2 IS NULL)");
  if (f.q) {
    // LIKE so chữ đã lưu (không phân biệt hoa thường với chữ không dấu); % và _ người gõ là chữ thường. Thêm dạng bỏ dấu
    // của chữ tìm (`normalizeContent`) để "thuốc" khớp nội dung ngân hàng không dấu "CHUYEN TIEN THUOC".
    const likes = [...new Set([f.q, normalizeContent(f.q)])].map((s) => `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const cols = ["t.note", "c.name", "d.name", "r.name", "tn.name"];
    const hit = (col: string) => likes.map(() => `${col} LIKE ? ESCAPE '\\'`).join(" OR ");
    parts.push(`(${cols.map(hit).join(" OR ")} OR EXISTS (SELECT 1 FROM bank_logs l WHERE l.id IN (t.log_id, t.log_id_2) AND (${hit("l.content")})))`);
    binds.push(...cols.flatMap(() => likes), ...likes);
  }
  return { sql: parts.join(" AND "), binds };
}

/**
 * Sổ giao dịch, mới nhất trước, theo bộ lọc. `before` là id của dòng cuối trang trước: trang sau bắt đầu ngay sau dòng
 * đó theo (at, id). Mặc định ẩn khoản đã xoá (`status='void'`) — chúng vẫn nằm trong sổ (luật ghi thêm, ADR-02), chỉ
 * không hiện; `includeVoid` để xem lại.
 */
export async function listTransactions(db: D1Database, filter: TxFilter, limit: number, before: number | undefined, viewerId: string | null) {
  const hidden = await hiddenAccountIds(db, viewerId);
  const where = txWhere(filter, hidden);
  const res = await db
    .prepare(
      `${TX_VIEW}
       WHERE ${where.sql}
         AND (? IS NULL OR (t.at, t.id) < (SELECT at, id FROM transactions WHERE id = ?))
       ORDER BY t.at DESC, t.id DESC LIMIT ?`,
    )
    .bind(...where.binds, before ?? null, before ?? null, Math.min(Math.max(limit, 1), 200))
    .all();
  return rows(res).map((r) => txOut(withoutHiddenNote(r, hidden)));
}

/** Chuyển giữa tài khoản riêng tư bị giấu và tài khoản chung vẫn hiện (tiền của cả nhà đi / về) nhưng không có ghi chú. */
function withoutHiddenNote(r: Row, hidden: string[]): Row {
  return hidden.includes(String(r.account_id)) || hidden.includes(String(r.counter_account_id)) ? { ...r, note: null } : r;
}

export interface TxSummary {
  count: number;
  spend: number;
  refund: number;
  income: number;
  lend: number;
  collect: number;
  transfer: number;
  buy_asset: number;
  /** Điều chỉnh sau đếm ví: tiền thật nhiều hơn sổ (tiền vào tài khoản). */
  adjust_in: number;
  /** … ít hơn sổ (tiền ra khỏi tài khoản). */
  adjust_out: number;
}

/**
 * Tổng của đúng tập dòng mà sổ đang lọc, theo loại — một truy vấn GROUP BY. Chỉ khoản còn hiệu lực: khoản đã xoá
 * không tính vào số nào, kể cả khi đang bật xem chúng.
 */
export async function transactionSummary(db: D1Database, filter: TxFilter, viewerId: string | null): Promise<TxSummary> {
  const where = txWhere({ ...filter, includeVoid: false }, await hiddenAccountIds(db, viewerId));
  const res = await db
    .prepare(
      `SELECT CASE WHEN t.meaning <> 'adjust' THEN t.meaning WHEN t.counter_account_id IS NOT NULL THEN 'adjust_in' ELSE 'adjust_out' END AS k,
              COUNT(*) AS n, SUM(t.amount) AS s
       ${TX_FROM}
       WHERE ${where.sql}
       GROUP BY k`,
    )
    .bind(...where.binds)
    .all();
  const out: TxSummary = { count: 0, spend: 0, refund: 0, income: 0, lend: 0, collect: 0, transfer: 0, buy_asset: 0, adjust_in: 0, adjust_out: 0 };
  for (const g of rows<{ k: Exclude<keyof TxSummary, "count">; n: number; s: number }>(res)) {
    out.count += Number(g.n);
    out[g.k] = Number(g.s);
  }
  return out;
}

/**
 * Khoản tiền về nối về khoản gốc (`link_id`, ledger UC-101 bước 4b): `refund` → `spend` còn hiệu lực (không chọn danh mục
 * thì lấy danh mục của khoản chi), `collect` → `lend` còn hiệu lực (không chọn khoản phải thu thì lấy của khoản cho vay;
 * chọn khác người thì `invalid_link`). Khoản gốc khác chính khoản đang được thay `selfId`. Chỉ là liên kết để đọc: không đổi
 * số dư nào. Dùng chung cho nhập tay, sửa, và gán log (ingest UC-305 bước 6.7). Khoản gốc bị giấu với người làm (`hidden`)
 * như không có — cùng lỗi, cùng chữ, không thừa hưởng danh mục — trừ khi sửa mà giữ đúng `link_id` cũ `keepLinkId`
 * (access UC-504 AC-16, ADR-133).
 */
export async function resolveLink(
  db: D1Database,
  row: Pick<TxRow, "meaning" | "link_id" | "category_id" | "receivable_id">,
  selfId?: number,
  hidden: string[] = [],
  keepLinkId?: number | null,
) {
  if (row.link_id === null) return;
  const found = row.link_id === selfId ? null : await getTransaction(db, row.link_id);
  const linked = found && (row.link_id === keepLinkId || txVisibility(found, hidden) !== "hidden") ? found : null;
  const valid = linked?.status === "active";
  if (row.meaning === "collect") {
    if (!valid || linked!.meaning !== "lend") {
      throw new DomainError("invalid_link", "Khoản nhận lại phải trỏ về một khoản cho vay còn hiệu lực.");
    }
    const lentTo = (linked!.receivable_id as string | null) ?? null;
    if (row.receivable_id && lentTo !== null && row.receivable_id !== lentTo) {
      throw new DomainError("invalid_link", "Khoản nhận lại phải cùng người với khoản cho vay gốc.");
    }
    row.receivable_id ??= lentTo;
    return;
  }
  if (!valid || linked!.meaning !== "spend") {
    throw new DomainError("invalid_link", "Khoản hoàn tiền phải trỏ về một khoản chi còn hiệu lực.");
  }
  row.category_id ??= (linked!.category_id as string | null) ?? null;
}

/**
 * Khoản gốc còn hiệu lực `days` ngày gần nhất để nối khoản tiền về (pwa UC-705, UC-706): `spend` cho "Trả lại cho khoản chi",
 * `lend` cho "Trả cho khoản cho vay". Mới nhất trước, tối đa 500. Kèm tên danh mục, người vay, ghi chú và nội dung ngân hàng
 * của log (nếu có); bỏ khoản của tài khoản riêng tư bị giấu (access UC-504). PWA tự xếp theo số tiền đang gõ (và người đang
 * chọn) — một lần tải, đổi số không hỏi lại.
 */
export async function linkCandidates(db: D1Database, meaning: "spend" | "lend", now: Date, days: number, viewerId: string | null) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const priv = hiddenTxSql("t", await hiddenAccountIds(db, viewerId));
  const res = await db
    .prepare(
      `SELECT t.id, t.at, t.amount, t.category_id, c.name AS category_name, t.receivable_id, r.name AS receivable_name, t.note, l.content AS bank_content
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN receivables r ON r.id = t.receivable_id
       LEFT JOIN bank_logs l ON l.id = t.log_id
       WHERE t.meaning = ? AND t.status = 'active' AND t.at >= ? AND NOT ${priv.sql}
       ORDER BY t.at DESC, t.id DESC LIMIT 500`,
    )
    .bind(meaning, since, ...priv.binds)
    .all();
  return rows(res);
}

/**
 * Một giao dịch theo id, cùng hình dạng một dòng của sổ giao dịch — để mở chi tiết từ bất kỳ danh sách nào (pwa UC-715).
 * Kèm liên kết hai chiều trong cùng một batch: `linked_from` — các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về khoản này
 * (cũ trước); `link` — tóm tắt khoản gốc của một khoản hoàn tiền / nhận lại có `link_id` (null nếu không có). Khoản chỉ dính
 * tài khoản riêng tư bị giấu với người xem → 404 như không có; `link` tới khoản bị giấu → null (giữ `link_id`), `linked_from`
 * bỏ khoản bị giấu (access UC-504 AC-12).
 */
export async function transactionView(db: D1Database, id: number, viewerId: string | null) {
  const hidden = await hiddenAccountIds(db, viewerId);
  const fromPriv = hiddenTxSql("transactions", hidden);
  const linkPriv = hiddenTxSql("o", hidden);
  const [tx, from, link] = await db.batch([
    db.prepare(`${TX_VIEW} WHERE t.id = ?`).bind(id),
    db.prepare(`SELECT id, at, amount, meaning FROM ${LINKED_RETURNS} AND NOT ${fromPriv.sql} ORDER BY at, id`).bind(id, ...fromPriv.binds),
    db
      .prepare(
        `SELECT o.id, o.at, o.amount, o.meaning, o.status, c.name AS category_name, r.name AS receivable_name
         FROM transactions t
         JOIN transactions o ON o.id = t.link_id
         LEFT JOIN categories c ON c.id = o.category_id
         LEFT JOIN receivables r ON r.id = o.receivable_id
         WHERE t.id = ? AND t.meaning IN ('refund', 'collect') AND NOT ${linkPriv.sql}`,
      )
      .bind(id, ...linkPriv.binds),
  ]);
  const row = rows(tx!)[0];
  if (!row) throw txNotFound();
  assertTxReadable(row, hidden);
  return { ...txOut(withoutHiddenNote(row, hidden)), linked_from: rows(from!), link: rows(link!)[0] ?? null };
}

// ── Đếm ví / nhập số dư thật ────────────────────────────────────────

export async function countAccount(db: D1Database, accountId: string, counted: number, memberId: string | null, now: Date) {
  if (!Number.isInteger(counted) || counted < 0) throw new DomainError("invalid_amount", "Số dư đếm được phải là số nguyên không âm.");
  const refs = await loadRefs(db);
  const account = refs.accounts.find((a) => a.id === accountId);
  if (!account) throw new DomainError("unknown_account", "Không có tài khoản này.", 404);
  if ((await hiddenAccountIds(db, memberId)).includes(accountId)) {
    throw new DomainError("private_account", `${account.name} là tài khoản riêng tư: chỉ chủ tài khoản đối soát được.`, 403);
  }
  if (account.sepayEnabled) {
    // Log chưa gán là tiền đã đi thật nhưng chưa vào sổ: đếm lúc này, chênh lệch sẽ thành bút toán điều chỉnh,
    // rồi gán log về sau là trừ khoản đó lần thứ hai.
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM bank_logs WHERE account_id = ? AND status = 'pending'").bind(accountId).first<{ n: number }>();
    if (Number(pending?.n ?? 0) > 0) {
      throw new DomainError("pending_logs", `${account.name} còn ${pending!.n} giao dịch chưa gán. Gán hết rồi mới đối soát số dư.`, 409);
    }
  }
  const book = Number((await db.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").bind(accountId).first<{ book_balance: number }>())?.book_balance ?? 0);
  const diff = counted - book;
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (diff !== 0) {
    statements.push(
      insertTx(db, {
        at,
        amount: Math.abs(diff),
        meaning: "adjust",
        // Tiền thật nhiều hơn sổ: tiền vào tài khoản; ít hơn: tiền ra — ngăn của tài khoản đổi đúng số lệch (ledger UC-105).
        account_id: diff < 0 ? accountId : null,
        counter_account_id: diff > 0 ? accountId : null,
        category_id: null,
        by_member_id: memberId,
        link_id: null,
        batch_id: null,
        asset_kind: null,
        taxable: 0,
        week_key: weekKey(at),
        month_key: monthKey(at),
        source: "manual",
        note: `Đối soát số dư: sổ ${formatMoney(book)}, thật ${formatMoney(counted)}`,
        client_id: null,
      }),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO cash_counts (at, account_id, counted, book, adjust_tx_id)
         VALUES (?, ?, ?, ?, CASE WHEN ? THEN last_insert_rowid() ELSE NULL END)`,
      )
      .bind(at, accountId, counted, book, diff !== 0 ? 1 : 0),
  );
  await db.batch(statements);
  return { accountId, book, counted, diff };
}

// ── Đọc số liệu ─────────────────────────────────────────────────────

export async function getSnapshot(db: D1Database, viewerId: string | null, now: Date): Promise<Snapshot> {
  const today = dayKey(now);
  // `payCycle.tasks[].source` nhìn theo người xem: khoản thu bị giấu → `{ hidden: true }` (access UC-504 AC-18).
  const [cycle, cycles] = await Promise.all([payCycleView(db, today, viewerId), loadCycles(db, now, today)]);
  const { paydayDay } = cycles;
  // Kỳ hiện tại / kỳ trước (Tích luỹ theo kỳ, UC-1203 bước 9) và ba kỳ trọn gần nhất (tháng vận hành, bước 11): `cycleRanges`.
  const current = cycles.ranges.at(-1)!;
  const prevRange = cycles.ranges.at(-2) ?? null;
  const done = cycles.ranges.filter((r) => r.end !== null).slice(-3);
  const mark = (r: CycleRange) => (r.stored ? r.start : r.payday);
  const since = mark(current);
  const t0 = current.start;
  const prevSince = prevRange ? mark(prevRange) : since;
  const t1 = prevRange ? prevRange.start : t0;
  const lo = done[0]?.start ?? t0;
  const hi = done.at(-1)?.end ?? t0;
  const hidden = await hiddenAccountIds(db, viewerId);
  const OPERATING = "SELECT id FROM accounts WHERE pocket = 'operating'";
  const [interestAccounts, interestTxs] = groupInterestStatements(db);
  // Khoá của số kỳ này (ADR-143): kỳ lưu → `pay_cycles.id`, chưa có kỳ lưu → ngày lương danh nghĩa (như `currentCycle`).
  const cycleKey = current.stored && cycle.view ? String(cycle.view.id) : current.payday;
  const [config, pending, drift, accounts, goals, debts, accountsAt, flowsSince, opSpend, dataStart, hiddenLogs, claims, goalSpent, groupAccounts, groupTxs, topUpTarget, cycleAmounts, goalCategories] = await db.batch([
    db.prepare("SELECT k, v FROM config WHERE k IN ('safety_fund_months', 'savings_pct', 'surplus_reward_account', 'conversion_state')"),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS net FROM bank_logs WHERE status = 'pending'"),
    db.prepare("SELECT account_id AS accountId, name, book_drift AS bookDrift FROM v_reconcile"),
    db.prepare(
      `SELECT b.account_id AS id, b.name, b.book_balance AS balance, a.pocket, a.pocket_confirmed AS confirmed, a.parent_account_id AS parentId
       FROM v_account_book b JOIN accounts a ON a.id = b.account_id ORDER BY a.kind, a.name`,
    ),
    db.prepare(
      `SELECT id, name, account_id AS accountId, target_amount AS target, target_pct AS targetPct, monthly_amount AS monthly,
              repeat_months AS repeatMonths, due_date AS dueDate, debt_id AS debtId, sort, pays_from AS paysFrom
       FROM reserve_goals WHERE active = 1`,
    ),
    db.prepare(
      `SELECT d.id, d.name, d.term, d.active, b.balance, d.monthly_payment AS monthlyPayment, d.due_day AS dueDay
       FROM debts d JOIN v_debt_balance b ON b.debt_id = d.id`,
    ),
    // Tài khoản ở hai mốc (ADR-100): đang dùng, hoặc tắt sau ngày đầu kỳ trước; số trong sổ của chính nó (kể cả đã tắt).
    db
      .prepare(
        `SELECT a.id, a.pocket, a.active, a.deactivated_at AS deactivatedAt,
                a.opening_balance + COALESCE((SELECT SUM(CASE WHEN t.account_id = a.id THEN -t.amount ELSE t.amount END) FROM transactions t
                  WHERE t.status = 'active' AND (t.account_id = a.id OR t.counter_account_id = a.id)), 0) AS book
         FROM accounts a WHERE a.active = 1 OR a.deactivated_at > ?`,
      )
      .bind(dayKey(prevSince)),
    // Σ giao dịch từ đầu kỳ trước trở đi theo tài khoản (theo khoảng `at`, idx_tx_at), tách phần từ đầu kỳ này.
    db
      .prepare(
        `SELECT acc, SUM(d) AS fromPrev, SUM(CASE WHEN at >= ? THEN d ELSE 0 END) AS fromSince FROM (
           SELECT account_id AS acc, -amount AS d, at FROM transactions WHERE status = 'active' AND at >= ? AND account_id IS NOT NULL
           UNION ALL
           SELECT counter_account_id, amount, at FROM transactions WHERE status = 'active' AND at >= ? AND counter_account_id IS NOT NULL
         ) GROUP BY acc`,
      )
      .bind(t0, t1, t1),
    // Chi vận hành các kỳ trọn gần nhất (mốc `cycleRanges`): chi theo tài khoản trả, hoàn theo tài khoản nhận (UC-1203 bước 11).
    db
      .prepare(
        `SELECT ${done.length ? `CASE ${done.map((_, i) => `WHEN at < ? THEN ${i}`).join(" ")} END` : "NULL"} AS cycle,
                SUM(CASE WHEN meaning = 'spend' AND account_id IN (${OPERATING}) THEN amount
                         WHEN meaning = 'refund' AND counter_account_id IN (${OPERATING}) THEN -amount ELSE 0 END) AS amount
         FROM transactions WHERE status = 'active' AND meaning IN ('spend', 'refund') AND at >= ? AND at < ? GROUP BY cycle`,
      )
      .bind(...done.map((r) => r.end), lo, hi),
    db.prepare(`SELECT at FROM transactions WHERE status = 'active' AND (account_id IN (${OPERATING}) OR counter_account_id IN (${OPERATING})) ORDER BY at LIMIT 1`),
    db.prepare(`SELECT COUNT(*) AS n FROM bank_logs WHERE status = 'pending' AND account_id IN (${hidden.map(() => "?").join(", ") || "NULL"})`).bind(...hidden),
    db.prepare("SELECT step FROM conversion_claims"),
    // Đã chi cho từng mục tiêu từ đầu kỳ lương hiện tại (pocket UC-1209 bước 11): mốc `started_at` / ngày lương danh nghĩa.
    goalSpentStatement(db, t0),
    // Tiền lãi của các nhóm mẹ + con có mục tiêu (QĐ2, ADR-140).
    interestAccounts,
    interestTxs,
    // Đích nhắc chuyển thêm (ADR-141): tài khoản ngân hàng ngăn Vận hành có số tài khoản đầu tiên — cùng luật QR của UC-1206 bước 10;
    // bỏ tài khoản riêng tư bị giấu với người xem (access UC-504 AC-19), không còn thì không đích.
    db
      .prepare(
        `SELECT id AS accountId, name, bank, account_no AS accountNo, sub_account AS subAccount FROM accounts
         WHERE active = 1 AND kind = 'bank' AND pocket = 'operating' AND account_no IS NOT NULL AND account_no <> ''
           ${hidden.length ? `AND id NOT IN (${hidden.map(() => "?").join(", ")})` : ""} ORDER BY kind, name LIMIT 1`,
      )
      .bind(...hidden),
    // Số kỳ này và danh mục của khoản phải trả (ADR-143).
    ...operatingExtrasStatements(db, cycleKey),
  ]);
  const first = <T>(r: D1Result) => rows<T>(r)[0] ?? null;
  const cfg = new Map(rows<{ k: string; v: string }>(config!).map((r) => [r.k, r.v]));
  const accountRows = rows<{ id: string; name: string; balance: number; pocket: Pocket | null; confirmed: number; parentId: string | null }>(accounts!);
  const savings = Number(cfg.get("savings_pct"));
  const flows = new Map(rows<{ acc: string; fromPrev: number; fromSince: number }>(flowsSince!).map((f) => [f.acc, f]));
  const cycleSpend = new Map(rows<{ cycle: number; amount: number }>(opSpend!).map((c) => [Number(c.cycle), Number(c.amount)]));
  const firstAt = first<{ at: string }>(dataStart!)?.at;
  const spentOf = goalSpentMap(goalSpent!);
  const extras = operatingExtrasFrom(cycleAmounts!, goalCategories!);
  const pockets = pocketsView({
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, pocket: a.pocket, confirmed: a.confirmed === 1, balance: Number(a.balance), parentId: a.parentId })),
    goals: rows<Omit<PocketGoalInput, "spent">>(goals!).map((g) => ({ ...g, sort: Number(g.sort), spent: spentOf.get(g.id) ?? 0, ...extras(g.id) })),
    rewardAccountId: cfg.get("surplus_reward_account") || null,
    debts: rows<Omit<PocketDebt, "active"> & { active: number }>(debts!).map((d) => ({ ...d, active: d.active === 1, balance: Number(d.balance) })),
    savingsPct: cfg.has("savings_pct") && Number.isInteger(savings) ? savings : DEFAULT_SAVINGS_PCT,
    history: {
      since,
      prevSince,
      accounts: rows<{ id: string; pocket: Pocket | null; active: number; deactivatedAt: string | null; book: number }>(accountsAt!).map((a) => {
        const f = flows.get(a.id);
        const counted = (day: string) => a.active === 1 || (a.deactivatedAt !== null && a.deactivatedAt > day);
        return {
          id: a.id,
          pocket: a.pocket,
          since: counted(dayKey(since)) ? Number(a.book) - Number(f?.fromSince ?? 0) : null,
          prevSince: Number(a.book) - Number(f?.fromPrev ?? 0),
        };
      }),
    },
    operatingSpend: {
      cycles: done.map((r, i) => ({ start: dayKey(r.start), amount: cycleSpend.get(i) ?? 0, days: cycleDays(r, paydayDay, today).days })),
      dataStart: firstAt ? dayKey(firstAt) : null,
    },
    peaceTarget: Number(cfg.get("safety_fund_months") ?? 6),
    interest: groupInterestFrom(groupAccounts!, groupTxs!),
  });
  return buildSnapshot({
    now,
    pending: first(pending!) ?? { count: 0, net: 0 },
    drift: rows(drift!) as Snapshot["attention"]["drift"],
    hiddenPendingLogs: Number(first<{ n: number }>(hiddenLogs!)?.n ?? 0),
    hiddenAccountIds: hidden,
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, pocket: a.pocket })),
    pockets,
    paydayDay,
    payCycle: cycle.view,
    pendingTasks: cycle.pendingTasks,
    topUpTo: first<QrTarget>(topUpTarget!),
    hasCycleStream: cycle.hasCycleStream,
    conversion: conversionProgress(cfg.get("conversion_state") ?? null, rows<{ step: string }>(claims!).map((r) => r.step)),
  });
}

/**
 * Bức tranh tiền thật (UC-1005): tiền thật trước, ghi nhớ ai nợ ai sau. Chỉ cộng lại số các view đã có.
 * `cash` = Σ số dư theo sổ của mọi tài khoản đang dùng (tiền mặt + tài khoản) — con số quyết định. `pockets` = tổng ba ngăn
 * và ngoài ngăn (pocket UC-1203 bước 2); `savings.accounts` = các tài khoản ngăn Tích luỹ — chỗ tiền Tích luỹ đang nằm, đã nằm
 * trong `cash`. Tài sản (vàng, chứng khoán…) không phải tiền. Phải thu / nợ / người thuê là sổ đối ứng ngoài sổ cái: chỉ cộng
 * phần dương của khoản đang theo dõi, không bao giờ vào `cash`.
 */
export async function netWorth(db: D1Database, viewerId: string | null, now: Date) {
  const { pockets } = await getSnapshot(db, viewerId, now);
  const balanceItems = await itemsTotal(db, dayKey(now));
  const [cash, receivables, debts, tenants, assets] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(book_balance), 0) AS n FROM v_account_book"),
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM v_receivable_balance WHERE active = 1 AND balance > 0"),
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM v_debt_balance WHERE active = 1 AND balance > 0"),
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS owed, COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0) AS prepaid
       FROM v_tenant_balance WHERE active = 1`,
    ),
    // Tài sản mua qua app chưa gắn mục: loại đã có mục nhập tay thì tính theo định giá của mục (ADR nháp A).
    db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
       WHERE status = 'active' AND meaning = 'buy_asset'
         AND (asset_kind IS NULL OR asset_kind NOT IN (SELECT asset_kind FROM balance_items WHERE asset_kind IS NOT NULL))`,
    ),
  ]);
  const sum = (r: D1Result) => Number(rows<{ n: number }>(r)[0]?.n ?? 0);
  const tenant = rows<{ owed: number; prepaid: number }>(tenants!)[0];
  const statement = {
    cash: sum(cash!),
    pockets: { savings: pockets.savings.total, reserve: pockets.reserve.total, operating: pockets.operating.total, outside: pockets.outside.total },
    savings: { accounts: pockets.savings.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance })) },
    assets: sum(assets!),
    balanceItems,
    receivables: sum(receivables!),
    tenants: Number(tenant?.owed ?? 0),
    tenantsPrepaid: Number(tenant?.prepaid ?? 0),
    debts: sum(debts!),
  };
  return {
    ...statement,
    netWorth:
      statement.cash + statement.assets + statement.balanceItems + statement.receivables + statement.tenants - statement.debts - statement.tenantsPrepaid,
  };
}

// ── Nhìn lại theo kỳ lương (ledger UC-108, pocket UC-1204 — ADR-127) ─

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const invalidCycle = (message: string): never => {
  throw new DomainError("invalid_cycle", message);
};

/** Các kỳ lương (kỳ lưu `active` + kỳ danh nghĩa trước kỳ lưu đầu), `payday_day`, thời điểm giao dịch còn hiệu lực sớm nhất. */
export interface CycleContext {
  ranges: CycleRange[];
  paydayDay: number;
  earliestAt: string | null;
}

/** Mốc kỳ đủ xa để có kỳ của ngày `anchor` và kỳ trước nó: từ giao dịch sớm nhất hoặc 400 ngày trước `anchor`. */
export async function loadCycles(db: D1Database, now: Date, anchor: string): Promise<CycleContext> {
  const [cfg, stored, first] = await db.batch([
    db.prepare("SELECT v FROM config WHERE k = 'payday_day'"),
    db.prepare("SELECT payday, started_at AS startedAt FROM pay_cycles WHERE status = 'active'"),
    db.prepare("SELECT MIN(at) AS at FROM transactions WHERE status = 'active'"),
  ]);
  const paydayDay = Number(rows<{ v: string }>(cfg!)[0]?.v ?? DEFAULT_PAYDAY_DAY);
  const earliestAt = rows<{ at: string | null }>(first!)[0]?.at ?? null;
  const back = vnMidnight(addDays(anchor, -400));
  const since = earliestAt !== null && earliestAt < back ? earliestAt : back;
  return { ranges: cycleRanges(rows<{ payday: string; startedAt: string }>(stored!), paydayDay, now, since), paydayDay, earliestAt };
}

/** Kỳ có ngày lương `cycle` (kỳ lưu, hoặc danh nghĩa trước kỳ lưu đầu) đã bắt đầu; không có → 400 `invalid_cycle`. */
export async function cycleRangeOf(db: D1Database, cycle: string, now: Date): Promise<CycleContext & { index: number }> {
  if (!DAY_RE.test(cycle) || Number.isNaN(Date.parse(`${cycle}T00:00:00Z`)) || new Date(`${cycle}T00:00:00Z`).toISOString().slice(0, 10) !== cycle) {
    invalidCycle("Kỳ phải là ngày lương dạng 2026-11-10.");
  }
  const ctx = await loadCycles(db, now, cycle);
  const index = ctx.ranges.findIndex((r) => r.payday === cycle);
  if (index < 0) invalidCycle("Không có kỳ lương bắt đầu ngày này.");
  return { ...ctx, index };
}

const cycleRef = ({ payday, start, end, stored }: CycleRange): CycleRef => ({ payday, start, end, stored });

/** Chi ròng của một khoảng theo danh mục / lãi từng khoản nợ / trả gốc; `p` = 0 kỳ chọn, 1 kỳ trước. */
type SpendSum = { p: number; k: "c" | "i" | "d"; id: string | null; s: number };
const SPEND_KIND = "CASE WHEN interest_debt_id IS NOT NULL THEN 'i' WHEN debt_id IS NOT NULL THEN 'd' ELSE 'c' END";
const SPEND_SUM = "SUM(CASE meaning WHEN 'spend' THEN amount ELSE -amount END)";

/**
 * Nhìn lại (ledger UC-108): `cycle` = ngày lương của kỳ, `period` = tháng lịch, không gửi gì = kỳ hiện tại. Chi ròng theo
 * danh mục của mọi tài khoản, mọi ngăn (kể cả tài khoản riêng tư — người khác thấy tổng, ADR-126), gộp theo nhóm hiện tại so
 * hạn mức mềm hiện tại; lãi vay là khối riêng (dự kiến tháng theo sổ nợ, đã trả trong kỳ); trả gốc đứng ngoài.
 */
export async function spendByCategory(db: D1Database, q: { cycle?: string | null; period?: string | null }, now: Date): Promise<LookBack> {
  const cycle = q.cycle || null;
  const period = q.period || null;
  if (cycle && period) throw new DomainError("invalid_input", "Chỉ gửi một trong cycle hoặc period.");
  if (period !== null && !MONTH_REGEX.test(period)) throw new DomainError("invalid_period", "Tháng phải có dạng 2026-09.");

  let head:
    | { kind: "cycle"; cycle: LookBackCycle; previous: CycleRef | null; next: CycleRef | null; savings: LookBackSavings | null }
    | { kind: "month"; month: string; previous: string };
  let sumSql: D1PreparedStatement;
  let interestMonth: string;
  const select = (p: string) => `SELECT ${p} AS p, ${SPEND_KIND} AS k, COALESCE(interest_debt_id, category_id) AS id, ${SPEND_SUM} AS s FROM transactions`;
  if (period !== null) {
    const [y, m] = period.split("-").map(Number) as [number, number];
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    head = { kind: "month", month: period, previous: prev };
    interestMonth = period;
    sumSql = db
      .prepare(`${select("CASE WHEN month_key = ?1 THEN 0 ELSE 1 END")} WHERE status = 'active' AND meaning IN ('spend', 'refund') AND month_key IN (?1, ?2) GROUP BY p, k, id`)
      .bind(period, prev);
  } else {
    const today = dayKey(now);
    const { index, ...ctx } = cycle ? await cycleRangeOf(db, cycle, now) : { ...(await loadCycles(db, now, today)), index: -1 };
    const at = index < 0 ? ctx.ranges.length - 1 : index;
    const range = ctx.ranges[at]!;
    const before = ctx.ranges[at - 1];
    const previous = before && ctx.earliestAt !== null && before.end! > ctx.earliestAt ? before : null;
    const next = ctx.ranges[at + 1] ?? null;
    head = {
      kind: "cycle",
      cycle: { ...cycleRef(range), ...cycleDays(range, ctx.paydayDay, today) },
      previous: previous && cycleRef(previous),
      next: next && cycleRef(next),
      savings: range.stored ? await cycleSavings(db, range.payday) : null,
    };
    interestMonth = range.payday.slice(0, 7);
    sumSql = db
      .prepare(`${select("CASE WHEN at >= ?2 THEN 0 ELSE 1 END")} WHERE status = 'active' AND meaning IN ('spend', 'refund') AND at >= ?1 AND at < ?3 GROUP BY p, k, id`)
      .bind(previous?.start ?? range.start, range.start, range.end ?? "9999");
  }

  const [sums, groupRows, categoryRows] = await db.batch([
    sumSql,
    db.prepare("SELECT id, name, essential, cycle_limit AS cycleLimit FROM category_groups WHERE active = 1 ORDER BY sort, name"),
    db.prepare("SELECT id, name, group_id AS groupId FROM categories"),
  ]);
  const interest = await debtInterest(db, interestMonth);
  const list = rows<SpendSum>(sums!).map((r) => ({ ...r, p: Number(r.p), s: Number(r.s) }));
  const pick = (k: SpendSum["k"], id: string | null, p: number) => list.filter((r) => r.k === k && r.id === id && r.p === p).reduce((s, r) => s + r.s, 0);
  const total = (k: SpendSum["k"], p: number) => list.filter((r) => r.k === k && r.p === p).reduce((s, r) => s + r.s, 0);

  const cats = new Map(rows<{ id: string; name: string; groupId: string | null }>(categoryRows!).map((c) => [c.id, c]));
  const categories = [...new Set(list.filter((r) => r.k === "c").map((r) => r.id))].map((id) => ({
    categoryId: id,
    name: id === null ? "Không danh mục" : (cats.get(id)?.name ?? id),
    groupId: id === null ? null : (cats.get(id)?.groupId ?? null),
    spent: pick("c", id, 0),
    previousSpent: pick("c", id, 1),
  }));
  const groups: CategoryGroupRef[] = rows<{ id: string; name: string; essential: number; cycleLimit: number | null }>(groupRows!).map((g) => ({
    id: g.id,
    name: g.name,
    essential: g.essential === 1,
    limit: g.cycleLimit === null ? null : Number(g.cycleLimit),
  }));
  const grouped = groupSpend(categories, groups, head.kind === "cycle");

  // Khối Lãi vay (ADR-127): khoản đang bật có lãi suất > 0, cộng khoản nào có chi lãi trong kỳ (tắt / 0% → dự kiến 0).
  const paidIds = new Set(list.filter((r) => r.k === "i" && r.p === 0).map((r) => r.id));
  const lines: LookBackInterestLine[] = interest
    .filter((d) => (d.active && d.rateBps > 0) || paidIds.has(d.debtId))
    .map((d) => ({ debtId: d.debtId, name: d.name, expected: d.active && d.rateBps > 0 ? d.expected : 0, paid: pick("i", d.debtId, 0), dueDay: d.dueDay }));
  const interestBlock = { spent: total("i", 0), previousSpent: total("i", 1), expected: lines.reduce((s, l) => s + l.expected, 0), lines };

  const flat: LookBackCategory[] = categories.map(({ groupId: _, ...c }) => c).sort((a, b) => b.spent - a.spent || b.previousSpent - a.previousSpent);
  const sumGroups = (k: "spent" | "previousSpent") => grouped.groups.reduce((s, g) => s + g[k], 0) + grouped.ungrouped[k] + interestBlock[k];
  return {
    ...head,
    total: sumGroups("spent"),
    previousTotal: sumGroups("previousSpent"),
    groups: grouped.groups,
    ungrouped: grouped.ungrouped,
    interest: interestBlock,
    excluded: { debtPrincipal: total("d", 0) },
    categories: flat,
  } as LookBack;
}

/**
 * Tích luỹ của kỳ lưu có ngày lương `payday` (ledger UC-108, ADR-142): `savingsDone` trên các việc ① chưa void của chính kỳ đó
 * (liên kết chuyển khoản còn hiệu lực, khoản lương sinh việc); `reason` = lý do của ① bỏ qua / sửa về 0 khi mức là `zero`.
 */
async function cycleSavings(db: D1Database, payday: string): Promise<LookBackSavings> {
  const tasks = rows<{ status: TaskFigures["status"]; amount: number; linked: number; sourceAmount: number | null; reason: string | null }>(
    await db
      .prepare(
        `SELECT k.status, k.amount, k.reason, (SELECT s.amount FROM transactions s WHERE s.id = k.source_tx_id) AS sourceAmount,
                COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.task_id = k.id), 0) AS linked
         FROM pay_cycle_tasks k JOIN pay_cycles c ON c.id = k.cycle_id
         WHERE c.status = 'active' AND c.payday = ? AND k.kind = 'savings' AND k.status <> 'void' ORDER BY k.id`,
      )
      .bind(payday)
      .all(),
  );
  const done = savingsDone(
    tasks.map((t) => ({
      kind: "savings" as const,
      status: t.status,
      amount: Number(t.amount),
      linked: Number(t.linked),
      sourceAmount: t.sourceAmount === null ? null : Number(t.sourceAmount),
      toPocket: "savings" as const,
    })),
  );
  const reason = done.level === "zero" ? (tasks.find((t) => (t.status === "skipped" || Number(t.amount) === 0) && t.reason)?.reason ?? null) : null;
  return { amount: done.amount, base: done.base, level: done.level, reason };
}

/** Chi trong tuần `week` cho tin tuần (notify UC-406 bước 3): tổng mọi tài khoản, chi từ Vận hành, chi ròng theo danh mục. */
export async function spendInWeek(db: D1Database, week: string) {
  const OPERATING = "SELECT id FROM accounts WHERE pocket = 'operating'";
  const res = await db
    .prepare(
      `SELECT t.category_id AS categoryId, c.name, SUM(CASE t.meaning WHEN 'spend' THEN t.amount ELSE -t.amount END) AS spent,
              SUM(CASE WHEN t.meaning = 'spend' AND t.account_id IN (${OPERATING}) THEN t.amount
                       WHEN t.meaning = 'refund' AND t.counter_account_id IN (${OPERATING}) THEN -t.amount ELSE 0 END) AS operating
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.status = 'active' AND t.meaning IN ('spend', 'refund') AND t.week_key = ?
       GROUP BY t.category_id ORDER BY spent DESC`,
    )
    .bind(week)
    .all<{ categoryId: string | null; name: string | null; spent: number; operating: number }>();
  const list = res.results ?? [];
  return {
    totalSpent: list.reduce((s, r) => s + Number(r.spent), 0),
    operatingSpent: list.reduce((s, r) => s + Number(r.operating), 0),
    categories: list.map((r) => ({ categoryId: r.categoryId, name: r.name ?? r.categoryId ?? "Không danh mục", spent: Number(r.spent) })),
  };
}

export async function reconcile(db: D1Database) {
  return rows(
    await db
      .prepare(
        `SELECT r.account_id AS accountId, r.name, r.kind, r.book_balance AS bookBalance, r.feed_balance AS feedBalance,
                r.book_drift AS bookDrift,
                r.pending_net AS pendingNet, r.pending_count AS pendingCount, r.last_at AS lastAt,
                (SELECT MAX(at) FROM cash_counts c WHERE c.account_id = r.account_id) AS lastCountAt
         FROM v_reconcile r`,
      )
      .all(),
  );
}

/**
 * Tích luỹ và Dự phòng (ledger UC-107, MCP `get_goals`): cùng số `snapshot.pockets` (BR-05) — tổng và thay đổi Tích luỹ theo
 * kỳ, % trích, kỳ này đã trích; mục tiêu tài khoản (đã có sau khi chia số dư gộp − tiền lãi của nhóm, đã chi trong kỳ), nhóm
 * theo tài khoản mẹ (kèm `interest`, `childIds`), phần an tâm; mục tiêu trả từ tiền chi tiêu (`operating`: mỗi tháng, đã chi,
 * còn phải trả kỳ này, ADR-141); nợ ngắn hạn. Không đọc view theo ví.
 */
export async function goals(db: D1Database, viewerId: string | null, now: Date) {
  const s = await getSnapshot(db, viewerId, now);
  const { savings, reserve, operating, savingsPct, shortDebt } = s.pockets;
  return {
    savings: { total: savings.total, change: savings.change, pct: savingsPct, savingsDone: s.payCycle?.savingsDone ?? null },
    reserve: {
      total: reserve.total,
      goals: reserve.goals.map((g) => ({
        id: g.id,
        name: g.name,
        accountId: g.accountId,
        held: g.held,
        need: g.need,
        spent: g.spent,
        short: g.short,
        target: g.target,
        targetPct: g.targetPct,
        monthlyAmount: g.monthly,
        repeatMonths: g.repeatMonths,
        dueDate: g.dueDate,
        debtId: g.debtId,
      })),
      groups: reserve.groups,
      peace: reserve.peace,
      peaceMonths: reserve.peaceMonths,
    },
    operating: { goals: operating.goals, remaining: operating.remaining },
    shortDebt,
  };
}

// ── Danh mục ────────────────────────────────────────────────────────

/** Tần suất dùng 30 ngày gần nhất — lưới danh mục đưa 6 cái hay dùng nhất lên đầu. */
export async function categoryUsage(db: D1Database, now: Date) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return toMap(
    rows(
      await db
        .prepare("SELECT category_id AS w, COUNT(*) AS s FROM transactions WHERE status = 'active' AND meaning = 'spend' AND at >= ? GROUP BY category_id")
        .bind(since)
        .all(),
    ),
  );
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export async function saveCategory(
  db: D1Database,
  input: { id?: string; name?: string; icon?: string | null; sort?: number; active?: boolean; group_id?: string | null },
  existingId?: string,
) {
  // Nhóm danh mục (pocket UC-1204): null = bỏ nhóm; chỉ gán vào nhóm đang dùng.
  if (input.group_id && !(await db.prepare("SELECT 1 FROM category_groups WHERE id = ? AND active = 1").bind(input.group_id).first())) {
    throw new DomainError("unknown_group", "Không có nhóm danh mục đang dùng này.", 400, "group_id");
  }
  if (!existingId) {
    const name = input.name?.trim();
    if (!name) throw new DomainError("missing_name", "Danh mục cần có tên.");
    const id = input.id?.trim() || slug(name);
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new DomainError("invalid_id", "Mã danh mục chỉ gồm chữ thường, số và gạch nối.");
    try {
      await db
        .prepare("INSERT INTO categories (id, name, icon, sort, group_id) VALUES (?, ?, ?, ?, ?)")
        .bind(id, name.slice(0, 60), input.icon ?? null, input.sort ?? 100, input.group_id ?? null)
        .run();
    } catch {
      throw new DomainError("duplicate", "Đã có danh mục với mã này.", 409);
    }
    return db.prepare(CATEGORY_SQL).bind(id).first();
  }
  const current = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(existingId).first<Row>();
  if (!current) throw new DomainError("not_found", "Không có danh mục này.", 404);
  await db
    .prepare("UPDATE categories SET name = ?, icon = ?, sort = ?, active = ?, group_id = ? WHERE id = ?")
    .bind(
      input.name?.trim().slice(0, 60) || current.name,
      input.icon === undefined ? current.icon : input.icon,
      input.sort ?? current.sort,
      input.active === undefined ? current.active : input.active ? 1 : 0,
      input.group_id === undefined ? current.group_id : input.group_id,
      existingId,
    )
    .run();
  return db.prepare(CATEGORY_SQL).bind(existingId).first();
}

/** Danh mục trả ra API: không còn ví mặc định (ledger UC-109, ADR-123) — cột giữ làm lịch sử. */
const CATEGORY_SQL = "SELECT id, name, icon, sort, active, group_id FROM categories WHERE id = ?";

// ── Quyết toán thuế năm (ledger UC-110, ADR-125, ADR-131) ───────────
// Khoản cũ (`id` ≤ `config.legacy_max_tx_id`) chỉ đọc `legacy_class = 'tax'`: đã trích = `fund`, đã nộp = khoản chi. Khoản mới
// theo tài khoản của các mục tiêu Thuế (mục tiêu đang dùng theo % thu chịu thuế, đã gắn tài khoản): đã trích = chuyển khoản vào
// tài khoản đó từ tài khoản khác, đã nộp = khoản chi từ tài khoản đó. Một khoản không bao giờ vào cả hai tập.
// Đang giữ = Σ số dư các tài khoản đó. Thừa → gợi ý chuyển phần đó sang Tích luỹ; quyết toán không ghi dòng nào vào sổ.

async function taxFigures(db: D1Database, year: number) {
  const LEGACY_MAX = "COALESCE((SELECT CAST(v AS INTEGER) FROM config WHERE k = 'legacy_max_tx_id'), 0)";
  const TAX_ACCOUNTS = "SELECT account_id FROM reserve_goals WHERE active = 1 AND target_pct IS NOT NULL AND account_id IS NOT NULL";
  const [accounts, sums, legacyTax, settled] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(book_balance), 0) AS held FROM v_account_book WHERE account_id IN (${TAX_ACCOUNTS})`),
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN id <= ${LEGACY_MAX} THEN (CASE WHEN meaning = 'fund' AND legacy_class = 'tax' THEN amount END)
                             ELSE (CASE WHEN meaning = 'transfer' AND counter_account_id IN (${TAX_ACCOUNTS})
                                         AND (account_id IS NULL OR account_id NOT IN (${TAX_ACCOUNTS})) THEN amount END) END), 0) AS provisioned,
           COALESCE(SUM(CASE WHEN id <= ${LEGACY_MAX} THEN (CASE WHEN meaning = 'spend' AND legacy_class = 'tax' THEN amount END)
                             ELSE (CASE WHEN meaning = 'spend' AND account_id IN (${TAX_ACCOUNTS}) THEN amount END) END), 0) AS paid
         FROM transactions WHERE status = 'active' AND month_key LIKE ?`,
      )
      .bind(`${year}-%`),
    db.prepare(`SELECT 1 AS s FROM transactions WHERE id <= ${LEGACY_MAX} AND legacy_class = 'tax' LIMIT 1`),
    db.prepare("SELECT * FROM tax_settlements WHERE year = ?").bind(year),
  ]);
  const acc = rows<{ n: number; held: number }>(accounts!)[0];
  const sum = rows<{ provisioned: number; paid: number }>(sums!)[0];
  // E4: cần ít nhất một mục tiêu Thuế đã gắn tài khoản, hoặc khoản cũ có loại chi Thuế.
  if (Number(acc?.n ?? 0) === 0 && rows(legacyTax!).length === 0) throw new DomainError("config", "Chưa có mục tiêu Thuế.");
  return {
    provisioned: Number(sum?.provisioned ?? 0),
    paid: Number(sum?.paid ?? 0),
    held: Number(acc?.held ?? 0),
    settlement: rows(settled!)[0] ?? null,
  };
}

const validYear = (year: number) => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError("invalid_year", "Năm không hợp lệ.");
};

export async function getTax(db: D1Database, year: number) {
  validYear(year);
  const f = await taxFigures(db, year);
  return { year, provisioned: f.provisioned, paid: f.paid, difference: f.provisioned - f.paid, held: f.held, settlement: f.settlement };
}

export async function settleTax(db: D1Database, year: number, now: Date) {
  validYear(year);
  if (year >= Number(monthKey(now).slice(0, 4))) throw new DomainError("year_not_over", "Chỉ quyết toán năm đã kết thúc.", 409);
  const f = await taxFigures(db, year);
  if (f.settlement) throw new DomainError("already_settled", `Năm ${year} đã quyết toán.`, 409);
  // Chỉ lấy phần thừa thật sự còn nằm ở các tài khoản Thuế; người dùng tự chuyển phần đó sang Tích luỹ.
  const surplus = Math.max(0, Math.min(f.provisioned - f.paid, f.held));
  const at = now.toISOString();
  const statements = [
    db.prepare("INSERT INTO tax_settlements (year, provisioned, paid, surplus_tx_id, settled_at) VALUES (?, ?, ?, NULL, ?)").bind(year, f.provisioned, f.paid, at),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(String(err))) throw new DomainError("already_settled", `Năm ${year} đã quyết toán.`, 409);
    throw err;
  }
  return { ...(await getTax(db, year)), surplus, move: { amount: surplus, toPocket: "savings" as const } };
}

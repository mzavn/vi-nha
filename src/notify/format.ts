// Định dạng tin: tiền tệ theo docs/DESIGN.md §5, câu chữ theo §6
// (không xưng hô, không viết hoa đầu câu quá mức, không chấm than).
// Mỗi tin có hai bản (ADR-79): `full` cho Telegram (HTML, đầy đủ, < 4096 ký tự) và `push` cho thông báo đẩy
// (chữ thường, tiêu đề ≤ 25 ký tự, nội dung ≤ 150 ký tự, việc cần làm trước, thông tin sau).
// Mọi hàm ở đây THUẦN: nhận số liệu đã tính sẵn, không đọc DB, không biết giờ hiện tại.

import { limitFigures, NEAR_LIMIT_PCT, weeklyRhythm, type LimitNudge } from "../domain/look-back";
import type { MonthClose } from "../domain/month-tasks";
import { blessingFor, type PeaceMonths, type PocketGoal, type PocketsView, type ShortDebtItem } from "../domain/pockets";
import type { NearSpend, TopUp } from "../domain/snapshot";
import type { PushText } from "../services/push";
import { escapeHtml } from "./telegram";

/** Hai bản của một tin: Telegram nhận `full`, máy đã bật thông báo nhận `push`. */
export interface NotifyMessage {
  full: string;
  push: PushText;
}

/** Tiêu đề thông báo đẩy: iOS hiện chừng 25–50 ký tự, lấy mức thấp. */
export const PUSH_TITLE_MAX = 25;
/** Nội dung thông báo đẩy: màn khoá iOS hiện chừng 150–178 ký tự, lấy mức thấp. */
export const PUSH_BODY_MAX = 150;
const SEP = " · ";

/** Độ dài tính theo ký tự (code point), không theo đơn vị UTF-16. */
const len = (s: string) => Array.from(s).length;

/** Cắt còn `max` ký tự, kết thúc bằng "…". */
function clip(s: string, max: number): string {
  return len(s) <= max ? s : `${Array.from(s).slice(0, max - 1).join("").trimEnd()}…`;
}

/** Phương án đầu tiên vừa `max`; không phương án nào vừa thì cắt phương án cuối. */
function firstFit(options: string[], max: number): string {
  return options.find((o) => len(o) <= max) ?? clip(options[options.length - 1]!, max);
}

/**
 * Nối các mục bằng " · " trong `max` ký tự. Không vừa thì bỏ mục từ cuối lên, thay bằng `rest(số mục bị bỏ)`
 * (mặc định "…"): mục đứng trước — việc cần làm — giữ lâu nhất.
 */
function fitJoin(items: string[], max: number, rest: (hidden: number) => string = () => "…"): string {
  const all = items.join(SEP);
  if (len(all) <= max) return all;
  for (let k = items.length - 1; k > 0; k--) {
    const s = `${items.slice(0, k).join(SEP)} ${rest(items.length - k)}`;
    if (len(s) <= max) return s;
  }
  return clip(items[0]!, max);
}

const MINUS = "−"; // U+2212, không phải dấu gạch nối thường

/** `1.250.000 ₫` / `−50.000 ₫` — nhóm nghìn bằng dấu chấm, không làm tròn hiển thị (số đầu vào coi như đã nguyên). */
export function formatMoney(amount: number): string {
  const rounded = Math.round(amount);
  const grouped = Math.abs(rounded).toLocaleString("vi-VN");
  return `${rounded < 0 ? MINUS : ""}${grouped} ₫`;
}

/** `3,2` — một chữ số thập phân, dấu phẩy kiểu vi-VN. */
const formatDecimal1 = (n: number) => n.toFixed(1).replace(".", ",");

/** `2.000.000` — số tiền không kèm "₫", cho các mục bản ngắn kiểu "Mua sắm 1.200.000/1.000.000 ₫". */
const plainMoney = (amount: number) => formatMoney(amount).replace(" ₫", "");

/** `10/11` từ ngày `YYYY-MM-DD`. */
const dayMonth = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

/** `T38 (14–20/9)` theo docs/DESIGN.md §5 — số tuần một mình vô nghĩa, luôn kèm khoảng ngày. */
export function formatWeekLabel(weekKey: string, startDay: string, endDay: string): string {
  const num = weekKey.split("-W")[1] ?? weekKey;
  const [, startMonth, startDate] = startDay.split("-");
  const [, endMonth, endDate] = endDay.split("-");
  const range = startMonth === endMonth ? `${Number(startDate)}–${Number(endDate)}/${Number(endMonth)}` : `${Number(startDate)}/${Number(startMonth)}–${Number(endDate)}/${Number(endMonth)}`;
  return `T${num} (${range})`;
}

// ── Tin 07:00 hằng ngày ──────────────────────────────────────────────

/**
 * Câu tiền vận hành (ADR-122) cho tin sáng và tóm tắt `get_snapshot`: mở bằng cả hai số — tổng và chi khoảng X/ngày tới
 * ngày lương; hết tiền thì nói đã hết, còn ít không đủ 1.000/ngày thì nói số còn lại.
 */
export function nearSpendLine(ns: Pick<NearSpend, "amount" | "payday" | "daysLeft" | "perDay">): string {
  const [, m, d] = ns.payday.split("-").map(Number);
  if (ns.amount <= 0) return `Tiền vận hành đã hết (${formatMoney(ns.amount)}), còn ${ns.daysLeft} ngày`;
  if (ns.perDay === null) return `Vận hành còn ${formatMoney(ns.amount)} tới ngày lương ${d}/${m} (còn ${ns.daysLeft} ngày)`;
  return `Vận hành ${formatMoney(ns.amount)} · chi khoảng ${formatMoney(ns.perDay)}/ngày tới ngày lương ${d}/${m} (còn ${ns.daysLeft} ngày)`;
}

/** Tiêu đề bản ngắn của tin sáng (≤ 25 ký tự): cùng số tiền vận hành, phương án dài trước, ngắn dần. */
function nearSpendTitle(ns: Pick<NearSpend, "amount" | "payday" | "perDay">): string {
  if (ns.amount <= 0) return "Tiền vận hành đã hết";
  if (ns.perDay === null) return firstFit([`Vận hành còn ${formatMoney(ns.amount)}`, `Còn ${formatMoney(ns.amount)}`], PUSH_TITLE_MAX);
  const [, m, d] = ns.payday.split("-").map(Number);
  const day = `~${formatMoney(ns.perDay).replace(" ₫", "")}/ngày`;
  return firstFit([`Vận hành: ${day} tới ${d}/${m}`, `Vận hành ${day}`, `${day} tới ${d}/${m}`, day], PUSH_TITLE_MAX);
}

export interface DailyMessageInput {
  /** Tiền vận hành — dòng đầu bản đầy đủ và tiêu đề bản ngắn; `perDay` đã trừ phần còn phải trả (ledger UC-103 bước 7b). */
  nearSpend: Pick<NearSpend, "amount" | "payday" | "daysLeft" | "perDay">;
  /** Nhắc chuyển thêm (`snapshot.topUp`, ADR-141): có → dòng Vận hành thêm câu "cần chuyển thêm …" kèm nguồn đầu; null / thiếu = không. */
  topUp?: Pick<TopUp, "amount" | "sources"> | null;
  /** Nhóm có hạn mức cần nhìn lại ở tháng hiện tại (`limitNudges`, notify UC-402 bước 4): đã lọc & sắp — vượt trước, rồi % giảm dần. */
  limitNudges: LimitNudge[];
  /** Số giao dịch (bank_logs) còn `pending`, chưa gán. */
  unassignedCount: number;
  /**
   * Mục tiêu Dự phòng theo thứ tự `reserve.goals` của server (thứ tự ưu tiên); `held` = đã có sau khi chia số dư tài khoản,
   * `spent` = đã chi cho mục tiêu trong tháng. Mục tiêu theo % (`target` null) và mục tiêu chưa gắn tài khoản (`held` null)
   * không vào dòng Mục tiêu.
   */
  reserveGoals: Pick<PocketGoal, "name" | "held" | "target" | "spent">[];
  /** Phần an tâm (`reserve.peace`), âm = thiếu. */
  peace: number;
  peaceMonths: Pick<PeaceMonths, "covered" | "target">;
  /** Nợ ngắn hạn cần trả (`pockets.shortDebt`) — dòng nợ ngắn hạn luôn có: còn nợ thì nhắc, hết thì lời chúc. */
  shortDebt: Pick<PocketsView["shortDebt"], "total" | "count"> & { items: Pick<ShortDebtItem, "heldFor">[] };
  /** Ngày VN hôm nay (`YYYY-MM-DD`) — chọn lời chúc. */
  day: string;
  /** Tài khoản đang lệch đối soát (bookDrift ≠ 0 — sổ khác giao dịch ngân hàng đã gán); rỗng = khớp. */
  driftAccounts: { name: string; amount: number }[];
  /**
   * Nhắc ① trích Tích luỹ đang mở (`snapshot.month.tasks`, pocket UC-1206): `missing` = Σ phần còn thiếu của các nhắc có
   * khoản lương công khai; `privateCount` = số nhắc của lương về tài khoản riêng tư (ADR-133: chỉ đếm, không số). null / 0 = không nhắc.
   */
  savingsDue?: { missing: number; privateCount: number } | null;
  /** Dư tháng vừa hết (`snapshot.monthClose`, pocket UC-1207): `ask` (chưa chia, chưa bỏ qua) và dư > 0 → dòng mời chia dư. */
  monthClose?: Pick<MonthClose, "month" | "surplus" | "status"> | null;
  /** Cặp `transfer` tự ghép (log_id_2 IS NOT NULL) có `at` thuộc ngày VN hôm qua. */
  pairedTransfersYesterday: number;
  /** Số giao dịch cron 02:00 đêm qua đã vá thêm. */
  backfillAddedLastNight: number;
  /** Khoảng của lượt rà đêm qua (`backfillWindow`): thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước. */
  backfillScope?: "day" | "week" | "month";
  /** Giao dịch ngân hàng cần xem tay trong 24 giờ qua: không đọc được, hoặc đã ghi nhưng xử lý tiếp bị lỗi. */
  unreadableBankTransactions?: number;
  /** Tên tài khoản cần đếm tiền mặt / nhập số dư tay; chỉ có giá trị vào Chủ nhật. Rỗng = không cần nhắc. */
  cashCountReminder: string[];
  /** Ngày 1: tháng trước (`YYYY-MM`) và người thuê đang ở chưa gửi bản tính tháng đó, kèm số dư hiện tại (dương = còn nợ). */
  rentalBillReminder?: { month: string; tenants: { name: string; balance: number }[] };
  /** Sổ nợ: tổng còn nợ và số khoản còn nợ của mọi khoản (đang theo dõi, còn nợ > 0) — vế "tất cả khoản nợ còn / còn nợ khác". */
  debts?: { balance: number; count: number } | null;
  /** Sổ phải thu: tổng người khác còn nợ và số khoản (đang theo dõi, còn phải thu > 0). Không có hoặc tổng 0 thì không hiện dòng. */
  receivables?: { balance: number; count: number } | null;
  /**
   * Lãi tiền gửi máy tự ghi hôm qua (change 261018-lai-tien-gui): tổng, số khoản, tên tài khoản nhận — chỉ tài khoản công
   * khai; `privateCount` = số khoản lãi vào tài khoản riêng tư có chủ còn hoạt động (notify UC-402 AC-40, không số, không tên).
   * Không có khoản nào thì không hiện dòng.
   */
  interestYesterday?: { total: number; count: number; accounts: string[]; privateCount?: number } | null;
}

/**
 * Tin sáng. Bản đầy đủ: dòng Vận hành, rồi các dòng việc cần làm (chưa gán, cần xem tay, Chi tiêu tháng này, Chưa trích Tích luỹ, chia dư, đếm tiền mặt, lập bản tính), rồi các dòng thông tin
 * (Mục tiêu, nợ ngắn hạn, người khác nợ mình, đối soát, chuyển nội bộ, lãi tiền gửi, vá webhook). Bản ngắn: tiêu đề là tiền vận hành mỗi ngày, nội dung là việc cần làm theo cùng thứ tự, rồi chỗ lệch đối soát.
 */
export function dailyMessage(input: DailyMessageInput): NotifyMessage {
  const topUp = input.topUp ? ` · cần chuyển thêm ${formatMoney(input.topUp.amount)} vào Tiền vận hành${input.topUp.sources[0] ? ` (từ ${escapeHtml(input.topUp.sources[0].name)})` : ""}` : "";
  const lines: string[] = [`${nearSpendLine(input.nearSpend)}${topUp}`];
  /** Việc cần làm, bản ngắn cho thông báo đẩy — cùng thứ tự với các dòng việc của bản đầy đủ. */
  const todo: string[] = [];

  // ── Việc cần làm ──
  if (input.unassignedCount > 0) {
    lines.push(`${input.unassignedCount} giao dịch chưa gán`);
    todo.push(`${input.unassignedCount} chưa gán`);
  }

  const unreadable = input.unreadableBankTransactions ?? 0;
  if (unreadable > 0) {
    lines.push(`${unreadable} giao dịch ngân hàng cần xem tay`);
    todo.push(`${unreadable} cần xem tay`);
  }

  if (input.limitNudges.length > 0) {
    const nudge = (n: LimitNudge, name: string) => (n.over > 0 ? `${name} vượt ${formatMoney(n.over)}` : `${name} ${n.pct}%`);
    lines.push(`Chi tiêu tháng này: ${input.limitNudges.map((n) => nudge(n, escapeHtml(n.name))).join(SEP)}`);
    todo.push(...input.limitNudges.map((n) => nudge(n, n.name)));
  }

  const due = input.savingsDue;
  if (due && (due.missing > 0 || due.privateCount > 0)) {
    const privateText = due.privateCount > 0 ? `${SEP}${due.privateCount} khoản của tài khoản riêng tư` : "";
    lines.push(`Chưa trích Tích luỹ${due.missing > 0 ? ` ${formatMoney(due.missing)}` : ""}${privateText}`);
    todo.push(`chưa trích Tích luỹ${due.missing > 0 ? ` ${plainMoney(due.missing)}` : ""}`);
  }

  const close = input.monthClose;
  if (close && close.status === "ask" && close.surplus > 0) {
    const month = Number(close.month.slice(5, 7));
    lines.push(`Tháng ${month} dư ${formatMoney(close.surplus)} — mở app để chia`);
    todo.push(`chia dư tháng ${month}`);
  }

  if (input.cashCountReminder.length > 0) {
    lines.push(`Chủ nhật: đếm tiền mặt, nhập số dư — ${input.cashCountReminder.map(escapeHtml).join(", ")}`);
    todo.push("đếm tiền mặt");
  }

  const bill = input.rentalBillReminder;
  const tenants = bill?.tenants ?? [];
  for (const t of tenants) {
    lines.push(`Lập bản tính tháng ${Number(bill!.month.slice(5, 7))} cho ${escapeHtml(t.name)} (số dư ${formatMoney(t.balance)})`);
  }
  if (tenants.length > 0) todo.push(`lập bản tính ${tenants.map((t) => t.name).join(", ")}`);

  // ── Thông tin ──
  // % = phần của mục tiêu (đã có + đã chi trong tháng) ÷ B, kẹp 0…100 — cùng luật "đủ" của thẻ Dự phòng (pocket UC-1209 bước 9).
  const goalChips = input.reserveGoals.flatMap((g) =>
    g.held === null || g.target === null || g.target <= 0 ? [] : [`${escapeHtml(g.name)} ${Math.max(0, Math.min(100, Math.floor(((g.held + g.spent) * 100) / g.target)))}%`],
  );
  if (input.peace < 0) goalChips.push(`Phần an tâm thiếu ${formatMoney(-input.peace)}`);
  else if (input.peace > 0 && input.peaceMonths.covered !== null) goalChips.push(`Phần an tâm đủ ${formatDecimal1(input.peaceMonths.covered)}/${input.peaceMonths.target} tháng`);
  if (goalChips.length > 0) lines.push(`Mục tiêu: ${goalChips.join(" · ")}`);

  const short = input.shortDebt;
  const allDebts = input.debts ?? { balance: 0, count: 0 };
  if (short.count > 0) {
    const heldFor = short.items.reduce((s, d) => s + d.heldFor, 0);
    const parts = [`Nợ ngắn hạn còn ${formatMoney(short.total)} (${short.count} khoản)`];
    if (heldFor > 0) parts.push(`đã có ${formatMoney(heldFor)} trong tài khoản Trả nợ`);
    if (allDebts.count > short.count) parts.push(`tất cả khoản nợ còn ${formatMoney(allDebts.balance)} (${allDebts.count} khoản)`);
    lines.push(parts.join(SEP));
  } else {
    lines.push(`${blessingFor(input.day)}${allDebts.count > 0 ? `${SEP}còn nợ khác ${formatMoney(allDebts.balance)} (${allDebts.count} khoản)` : ""}`);
  }
  if (input.receivables && input.receivables.balance > 0) {
    lines.push(`Người khác nợ mình ${formatMoney(input.receivables.balance)} (${input.receivables.count} khoản)`);
  }

  const drift = input.driftAccounts.map((d) => `lệch ${formatMoney(Math.abs(d.amount))} ở ${d.name}`);
  if (drift.length === 0) {
    lines.push("Đối soát: khớp");
  } else {
    lines.push(`Đối soát: ${input.driftAccounts.map((d) => `lệch ${formatMoney(Math.abs(d.amount))} ở ${escapeHtml(d.name)}`).join(" · ")}`);
  }

  if (input.pairedTransfersYesterday > 0) {
    lines.push(`Hôm qua tự ghép ${input.pairedTransfersYesterday} cặp chuyển nội bộ`);
  }

  const lai = input.interestYesterday;
  const laiPrivate = lai?.privateCount ?? 0;
  const laiPrivateText = `${laiPrivate} khoản của tài khoản riêng tư`;
  if (lai && lai.count > 0) {
    lines.push(`Lãi tiền gửi: +${formatMoney(lai.total)} (${lai.count} khoản) — vào ${lai.accounts.map(escapeHtml).join(", ")}${laiPrivate > 0 ? `${SEP}${laiPrivateText}` : ""}`);
  } else if (laiPrivate > 0) {
    lines.push(`Lãi tiền gửi: ${laiPrivateText}`);
  }

  if (input.backfillAddedLastNight > 0) {
    const scope = input.backfillScope === "week" ? " (soát cả tuần trước)" : input.backfillScope === "month" ? " (soát cả tháng trước)" : "";
    lines.push(`Đêm qua vá ${input.backfillAddedLastNight} giao dịch webhook bỏ sót${scope}`);
  }

  const items = [...todo, ...drift];
  const body = items.length > 0 ? fitJoin(items, PUSH_BODY_MAX) : `Không có việc cần làm${SEP}đối soát khớp`;
  return {
    full: lines.join("\n"),
    push: {
      title: nearSpendTitle(input.nearSpend),
      body: body.charAt(0).toUpperCase() + body.slice(1),
    },
  };
}

// ── Tin 08:00 thứ Hai (tổng kết tuần) ──────────────────────────────────

export interface WeeklyMessageInput {
  /** `T38 (14–20/9)`. */
  weekLabel: string;
  /** Tiền vận hành lúc gửi (snapshot) — dòng Vận hành giống hệt tin sáng, mục đầu bản ngắn. null: không dòng / không mục. */
  nearSpend: Pick<NearSpend, "amount" | "payday" | "daysLeft" | "perDay"> | null;
  /** Tổng chi cả tuần (spend − refund, mọi tài khoản, mọi danh mục) — tiêu đề của bản ngắn. */
  totalSpent: number;
  /** Chi từ ngăn Vận hành trong tuần (spend − refund vào ngăn Vận hành). */
  operatingSpent: number;
  /** Tối đa 5 danh mục tiêu nhiều nhất, đã sắp giảm dần. */
  topCategories: { name: string; spent: number }[];
  /** Nhóm có hạn mức của tháng hiện tại, theo `sort`. */
  limits: { name: string; spent: number; limit: number; over: number }[];
  /** Tháng hiện tại (`YYYY-MM`, giờ VN) cho "Từ 1/m". */
  month: string;
}

const NO_WEEK_DATA = "Không có dữ liệu chi tiêu tuần này.";

/**
 * Tổng kết tuần theo nhịp Vận hành (notify UC-406). Bản đầy đủ: Vận hành như tin sáng, chi tuần · từ Vận hành ≈ X/ngày, mọi
 * nhóm có hạn mức của tháng (từ ngày 1), top 5 danh mục. Bản ngắn: tiêu đề "Tuần T38: chi X"; nội dung là Vận hành còn bao
 * nhiêu, nhóm ≥ 80% (vượt trước, % giảm dần), danh mục tiêu nhiều nhất, rồi các nhóm còn lại.
 */
export function weeklyMessage(input: WeeklyMessageInput): NotifyMessage {
  const lines: string[] = [`Tổng kết tuần ${input.weekLabel}`];
  if (input.nearSpend) lines.push(nearSpendLine(input.nearSpend));

  const empty = input.totalSpent === 0 && input.topCategories.length === 0;
  if (!empty) {
    lines.push(`Tuần qua chi ${formatMoney(input.totalSpent)} · từ Vận hành ${formatMoney(input.operatingSpent)} ≈ ${formatMoney(weeklyRhythm(input.operatingSpent))}/ngày`);
  }

  if (input.limits.length > 0) {
    const groups = input.limits.map((g) => `${escapeHtml(g.name)} ${formatMoney(g.spent)} / ${formatMoney(g.limit)}${g.over > 0 ? ` (vượt ${formatMoney(g.over)})` : ""}`);
    lines.push(`Từ ${dayMonth(`${input.month}-01`)}: ${groups.join(SEP)}`);
  }

  if (input.topCategories.length > 0) {
    lines.push("Top 5 danh mục tiêu nhiều nhất:");
    input.topCategories.forEach((c, i) => lines.push(`${i + 1}. ${escapeHtml(c.name)} — ${formatMoney(c.spent)}`));
  }
  if (empty) lines.push(NO_WEEK_DATA);

  const ns = input.nearSpend;
  const operating = !ns ? [] : ns.amount <= 0 ? ["Vận hành đã hết"] : [`Vận hành còn ${formatMoney(ns.amount)}${ns.perDay === null ? "" : ` ≈ ${formatMoney(ns.perDay)}/ngày`}`];
  const byPct = input.limits
    .map((g, i) => ({ ...g, pct: limitFigures(g.limit, g.spent).pct ?? 0, i }))
    .sort((a, b) => b.over - a.over || b.pct - a.pct || a.i - b.i);
  const chip = (g: { name: string; spent: number; limit: number }) => `${g.name} ${plainMoney(g.spent)}/${formatMoney(g.limit)}`;
  const top = input.topCategories[0];
  const items = [
    ...operating,
    ...byPct.filter((g) => g.pct >= NEAR_LIMIT_PCT).map(chip),
    ...(top ? [`tiêu nhiều nhất ${top.name} ${formatMoney(top.spent)}`] : []),
    ...byPct.filter((g) => g.pct < NEAR_LIMIT_PCT).map(chip),
  ];
  const body = items.length > 0 ? fitJoin(items, PUSH_BODY_MAX) : NO_WEEK_DATA;
  const week = input.weekLabel.split(" ")[0]!;
  const spent = formatMoney(input.totalSpent);
  return {
    full: lines.join("\n"),
    push: {
      title: firstFit([`Tuần ${week}: chi ${spent}`, `${week}: chi ${spent}`, `Tổng kết ${week}`], PUSH_TITLE_MAX),
      body: body.charAt(0).toUpperCase() + body.slice(1),
    },
  };
}

// ── Báo lương về (notify UC-412) ──────────────────────────────────────

export interface SalaryMessageInput {
  /** Khoản lương. */
  income: number;
  /** Nhắc ① của khoản lương: số trích và %. */
  amount: number;
  pct: number;
  /** Gợi ý không bắt buộc (`snapshot.month.goalHint`, pocket UC-1206 AC-18): mục tiêu tài khoản đầu tiên còn thiếu. */
  goalHint: { name: string; short: number } | null;
}

/**
 * Tin "Lương về" (notify UC-412): một dòng khoản lương · trích Tích luỹ {pct}% = số trích, cộng tối đa một dòng gợi ý mục
 * tiêu còn thiếu (cùng chữ thẻ Trích Tích luỹ). Bản ngắn: "Lương về · trích {số}". `hideAmounts` (lương về tài khoản riêng tư,
 * ADR-133): không số tiền nào, giữ `{pct}%` và tên mục tiêu.
 */
export function salaryMessage(input: SalaryMessageInput, opts: { hideAmounts?: boolean } = {}): NotifyMessage {
  const hide = opts.hideAmounts === true;
  const what = `trích Tích luỹ ${input.pct}%`;
  const hint = input.goalHint;
  const short = hint && !hide ? ` ${formatMoney(hint.short)}` : "";
  const lines = [hide ? `Lương về · ${what}` : `Lương về ${formatMoney(input.income)} · ${what} = ${formatMoney(input.amount)}`];
  if (hint) lines.push(`Mục tiêu còn thiếu: ${escapeHtml(hint.name)}${short} ›`);

  const items = [hide ? `Trích Tích luỹ ${input.pct}%` : `Trích Tích luỹ ${input.pct}% = ${formatMoney(input.amount)} từ lương ${formatMoney(input.income)}`];
  if (hint) items.push(`mục tiêu còn thiếu: ${hint.name}${short}`);
  return {
    full: lines.join("\n"),
    push: {
      title: hide ? `Lương về · trích ${input.pct}%` : `Lương về · trích ${plainMoney(input.amount)}`,
      body: fitJoin(items, PUSH_BODY_MAX),
    },
  };
}

// ── Báo giao dịch chưa gán (mỗi lượt cron) ─────────────────────────────

/** Giữ bản đầy đủ dưới giới hạn 4096 ký tự của Telegram. */
const PENDING_MAX_LINES = 20;

export interface PendingLog {
  amount: number;
  direction: "in" | "out";
  /** Tên tài khoản; null = log không khớp tài khoản nào ("TK lạ"). */
  accountName: string | null;
}

/**
 * Gộp các log chưa gán thành một tin. Bản ngắn: "N giao dịch chưa gán", nội dung từng khoản tới khi hết chỗ, rồi "… và K khoản".
 * `privateCount` log của tài khoản riêng tư (đã tách khỏi `logs`) chỉ thành một mục "K khoản của tài khoản riêng tư", không số,
 * không tên (notify UC-407 bước 3): bản đầy đủ sau các dòng log thường, bản ngắn đứng đầu phần bị cắt, luôn giữ.
 */
export function pendingMessage(logs: PendingLog[], privateCount = 0): NotifyMessage {
  const total = logs.length + privateCount;
  const item = (r: PendingLog, name: string) => `${r.direction === "in" ? "+" : MINUS}${r.amount.toLocaleString("vi-VN")} ₫ ${name}`;
  const priv = `${privateCount} khoản của tài khoản riêng tư`;
  const shown = logs.slice(0, PENDING_MAX_LINES);
  const lines = shown.map((r) => item(r, `· ${escapeHtml(r.accountName ?? "TK lạ")}`));
  if (privateCount > 0) lines.push(priv);
  if (logs.length > shown.length) lines.push(`… và ${logs.length - shown.length} khoản khác`);
  const items = logs.map((r) => item(r, r.accountName ?? "TK lạ"));
  let body = privateCount > 0 ? "" : fitJoin(items, PUSH_BODY_MAX, (hidden) => `… và ${hidden} khoản`);
  // Mục riêng tư luôn giữ: bỏ log thường từ cuối lên cho tới khi vừa, mục riêng tư đứng ngay trước "… và K khoản".
  for (let k = items.length; privateCount > 0 && k >= 0; k--) {
    body = `${[...items.slice(0, k), priv].join(SEP)}${k < items.length ? ` … và ${items.length - k} khoản` : ""}`;
    if (len(body) <= PUSH_BODY_MAX) break;
  }
  return {
    full: `${total} khoản chưa gán:\n${lines.join("\n")}`,
    push: {
      title: firstFit([`${total} khoản chưa gán`, `${total} chưa gán`], PUSH_TITLE_MAX),
      body,
    },
  };
}

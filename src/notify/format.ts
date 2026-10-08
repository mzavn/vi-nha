// Định dạng tin: tiền tệ theo docs/DESIGN.md §5, câu chữ theo §6
// (không xưng hô, không viết hoa đầu câu quá mức, không chấm than).
// Mỗi tin có hai bản (ADR-79): `full` cho Telegram (HTML, đầy đủ, < 4096 ký tự) và `push` cho thông báo đẩy
// (chữ thường, tiêu đề ≤ 25 ký tự, nội dung ≤ 150 ký tự, việc cần làm trước, thông tin sau).
// Mọi hàm ở đây THUẦN: nhận số liệu đã tính sẵn, không đọc DB, không biết giờ hiện tại.

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

/** `92%` — phần trăm làm tròn số nguyên, chỉ dùng để hiển thị (ngưỡng ≥80% được lọc từ trước). */
const formatPct = (n: number) => `${Math.round(n)}%`;

/** `T38 (14–20/9)` theo docs/DESIGN.md §5 — số tuần một mình vô nghĩa, luôn kèm khoảng ngày. */
export function formatWeekLabel(weekKey: string, startDay: string, endDay: string): string {
  const num = weekKey.split("-W")[1] ?? weekKey;
  const [, startMonth, startDate] = startDay.split("-");
  const [, endMonth, endDate] = endDay.split("-");
  const range = startMonth === endMonth ? `${Number(startDate)}–${Number(endDate)}/${Number(endMonth)}` : `${Number(startDate)}/${Number(startMonth)}–${Number(endDate)}/${Number(endMonth)}`;
  return `T${num} (${range})`;
}

// ── Tin 07:00 hằng ngày ──────────────────────────────────────────────

export interface DailyMessageInput {
  /** Còn để chi tuần này, và số ngày còn lại của tuần (tính cả hôm nay). */
  spendableThisWeek: number;
  daysLeftInWeek: number;
  /** Ví must/have/nice đã ≥80% dự kiến tuần hoặc tháng, đã lọc & sắp theo % giảm dần. */
  atRisk: { name: string; pct: number }[];
  /** Số giao dịch (bank_logs) còn `pending`, chưa gán ví. */
  unassignedCount: number;
  /** Tiến độ các ví mục tiêu (mode='goal'), ví dụ Du lịch. */
  goals: { name: string; pct: number }[];
  /** Quỹ an tâm: null = chưa đủ dữ liệu để tính, không hiện dòng. */
  safetyFundMonthsCovered: number | null;
  safetyFundMonthsTarget: number;
  /** Tài khoản đang lệch đối soát (bookDrift ≠ 0 — sổ khác giao dịch ngân hàng đã gán); rỗng = khớp. */
  driftAccounts: { name: string; amount: number }[];
  /** Lệnh chuyển tiền còn `pending` quá 3 ngày. */
  transferOrdersOverdue: number;
  /** Cặp `transfer` tự ghép (log_id_2 IS NOT NULL) có `at` thuộc ngày VN hôm qua. */
  pairedTransfersYesterday: number;
  /** Số giao dịch cron 02:00 đêm qua đã vá thêm. */
  backfillAddedLastNight: number;
  /** Khoảng của lượt rà đêm qua (`backfillWindow`): thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước. */
  backfillScope?: "day" | "week" | "month";
  /** Giao dịch ngân hàng cần xem tay trong 24 giờ qua: không đọc được, hoặc đã ghi nhưng xử lý tiếp bị lỗi (ví dụ chưa chia). */
  unreadableBankTransactions?: number;
  /** Chỉ có giá trị vào ngày 1 hằng tháng, sau khi chốt tháng trước xong. */
  monthClose: {
    month: string; // "2026-09"
    amount: number;
    transfers: { fromName: string; toName: string; amount: number }[];
  } | null;
  /** Chỉ có giá trị vào ngày 10 & 25, khi còn income chưa chia. */
  incomeReminder: { day: number; unallocatedCount: number } | null;
  /** Tên tài khoản cần đếm ví / nhập số dư tay; chỉ có giá trị vào Chủ nhật. Rỗng = không cần nhắc. */
  cashCountReminder: string[];
  /** Ngày 1: người thuê đang ở chưa chốt tháng trước, kèm số dư hiện tại (dương = còn nợ). */
  rentalSettleReminder?: { name: string; balance: number }[];
  /** Sổ nợ: tổng còn nợ và số khoản còn nợ (đang theo dõi, còn nợ > 0). Không có hoặc tổng 0 thì không hiện dòng. */
  debts?: { balance: number; count: number } | null;
  /** Sổ phải thu: tổng người khác còn nợ và số khoản (đang theo dõi, còn phải thu > 0). Không có hoặc tổng 0 thì không hiện dòng. */
  receivables?: { balance: number; count: number } | null;
}

/**
 * Tin sáng. Bản đầy đủ: dòng 💰, rồi các dòng việc cần làm (📥 ❗ 🔁 ⚠️ 📅 🧮 🏠 🧹), rồi các dòng thông tin
 * (🎯 💳 🤝 🏦 🔗 🩹). Bản ngắn: tiêu đề "Còn X tuần này", nội dung là việc cần làm theo cùng thứ tự, rồi chỗ lệch đối soát.
 */
export function dailyMessage(input: DailyMessageInput): NotifyMessage {
  const lines: string[] = [
    input.spendableThisWeek < 0
      ? `💰 Tuần này đã chi vượt ${formatMoney(-input.spendableThisWeek)} (còn ${input.daysLeftInWeek} ngày)`
      : `💰 Còn để chi tuần này: ${formatMoney(input.spendableThisWeek)} (${input.daysLeftInWeek} ngày)`,
  ];
  /** Việc cần làm, bản ngắn cho thông báo đẩy — cùng thứ tự với các dòng việc của bản đầy đủ. */
  const todo: string[] = [];

  // ── Việc cần làm ──
  if (input.unassignedCount > 0) {
    lines.push(`📥 ${input.unassignedCount} giao dịch chưa gán`);
    todo.push(`${input.unassignedCount} chưa gán`);
  }

  const unreadable = input.unreadableBankTransactions ?? 0;
  if (unreadable > 0) {
    lines.push(`❗ ${unreadable} giao dịch ngân hàng cần xem tay`);
    todo.push(`${unreadable} cần xem tay`);
  }

  if (input.transferOrdersOverdue > 0) {
    lines.push(`🔁 ${input.transferOrdersOverdue} chuyển tiền cần làm (quá 3 ngày)`);
    todo.push(`${input.transferOrdersOverdue} chuyển tiền quá hạn`);
  }

  if (input.atRisk.length > 0) {
    lines.push(`⚠️ Sắp vỡ: ${input.atRisk.map((w) => `${escapeHtml(w.name)} ${formatPct(w.pct)}`).join(" · ")}`);
    todo.push(...input.atRisk.map((w) => `${w.name} ${formatPct(w.pct)}`));
  }

  if (input.incomeReminder && input.incomeReminder.unallocatedCount > 0) {
    lines.push(`📅 Hôm nay ngày ${input.incomeReminder.day}: còn ${input.incomeReminder.unallocatedCount} khoản thu chưa chia`);
    todo.push(`còn ${input.incomeReminder.unallocatedCount} khoản thu chưa chia`);
  }

  if (input.cashCountReminder.length > 0) {
    lines.push(`🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — ${input.cashCountReminder.map(escapeHtml).join(", ")}`);
    todo.push("đếm ví tiền mặt");
  }

  const tenants = input.rentalSettleReminder ?? [];
  for (const t of tenants) {
    lines.push(`🏠 Chốt tháng với ${escapeHtml(t.name)} (số dư ${formatMoney(t.balance)})`);
  }
  if (tenants.length > 0) todo.push(`chốt tháng ${tenants.map((t) => t.name).join(", ")}`);

  if (input.monthClose && input.monthClose.amount > 0) {
    const monthNumber = Number(input.monthClose.month.split("-")[1]);
    lines.push(`🧹 Đã quét ${formatMoney(input.monthClose.amount)} dư tháng ${monthNumber} sang Tích sản`);
    for (const t of input.monthClose.transfers) {
      lines.push(`🔁 Chuyển ${formatMoney(t.amount)} từ ${escapeHtml(t.fromName)} sang ${escapeHtml(t.toName)}`);
    }
    const orders = input.monthClose.transfers.length;
    todo.push(`quét ${formatMoney(input.monthClose.amount)} dư tháng ${monthNumber}${orders > 0 ? ` (${orders} lệnh chuyển)` : ""}`);
  }

  // ── Thông tin ──
  const goalChips = input.goals.map((g) => `${escapeHtml(g.name)} ${formatPct(g.pct)}`);
  if (input.safetyFundMonthsCovered !== null) {
    goalChips.push(`Quỹ an tâm ${formatDecimal1(input.safetyFundMonthsCovered)}/${input.safetyFundMonthsTarget} tháng`);
  }
  if (goalChips.length > 0) lines.push(`🎯 ${goalChips.join(" · ")}`);

  if (input.debts && input.debts.balance > 0) {
    lines.push(`💳 Còn nợ ${formatMoney(input.debts.balance)} (${input.debts.count} khoản)`);
  }
  if (input.receivables && input.receivables.balance > 0) {
    lines.push(`🤝 Người khác nợ mình ${formatMoney(input.receivables.balance)} (${input.receivables.count} khoản)`);
  }

  const drift = input.driftAccounts.map((d) => `lệch ${formatMoney(Math.abs(d.amount))} ở ${d.name}`);
  if (drift.length === 0) {
    lines.push("🏦 Đối soát: khớp");
  } else {
    lines.push(`🏦 Đối soát: ❌ ${input.driftAccounts.map((d) => `lệch ${formatMoney(Math.abs(d.amount))} ở ${escapeHtml(d.name)}`).join(" · ")}`);
  }

  if (input.pairedTransfersYesterday > 0) {
    lines.push(`🔗 Hôm qua tự ghép ${input.pairedTransfersYesterday} cặp chuyển nội bộ`);
  }

  if (input.backfillAddedLastNight > 0) {
    const scope = input.backfillScope === "week" ? " (soát lại cả tuần trước)" : input.backfillScope === "month" ? " (soát lại cả tháng trước)" : "";
    lines.push(`🩹 Đêm qua vá ${input.backfillAddedLastNight} giao dịch webhook bỏ sót${scope}`);
  }

  // Âm thì không viết "Còn −X": dễ đọc nhầm là còn tiền. Nói thẳng "đã chi vượt X" (số dương).
  const over = input.spendableThisWeek < 0;
  const money = formatMoney(Math.abs(input.spendableThisWeek));
  const items = [...todo, ...drift];
  const body = items.length > 0 ? fitJoin(items, PUSH_BODY_MAX) : `Không có việc cần làm${SEP}đối soát khớp`;
  return {
    full: lines.join("\n"),
    push: {
      title: firstFit(over ? [`Tuần này vượt ${money}`, `Vượt ${money}`] : [`Còn ${money} tuần này`, `Còn ${money}`], PUSH_TITLE_MAX),
      body: body.charAt(0).toUpperCase() + body.slice(1),
    },
  };
}

// ── Tin 08:00 thứ Hai (tổng kết tuần) ──────────────────────────────────

export interface WeeklyMessageInput {
  /** `T38 (14–20/9)`. */
  weekLabel: string;
  /** Đã tiêu / dự kiến từng ví phong bì tuần. */
  envelopes: { name: string; spent: number; target: number }[];
  /** Tối đa 5 danh mục tiêu nhiều nhất, đã sắp giảm dần. */
  topCategories: { name: string; spent: number }[];
  /** Tổng chi cả tuần (spend − refund, mọi danh mục) — tiêu đề của bản ngắn. */
  totalSpent: number;
}

/** Ví đã tiêu từ 80% dự kiến trở lên — cùng ngưỡng "sắp vỡ" của tin sáng — đứng đầu bản ngắn. */
const NEAR_TARGET = 0.8;

/**
 * Tổng kết tuần. Bản đầy đủ: từng ví đã tiêu / dự kiến, top 5 danh mục. Bản ngắn: tiêu đề "Tuần T38: chi X";
 * nội dung là các ví ≥ 80% dự kiến (sắp % giảm dần), danh mục tiêu nhiều nhất, rồi các ví còn lại.
 */
export function weeklyMessage(input: WeeklyMessageInput): NotifyMessage {
  const lines: string[] = [`📊 Tổng kết tuần ${input.weekLabel}`];

  for (const e of input.envelopes) {
    lines.push(`${escapeHtml(e.name)}: ${formatMoney(e.spent)} / ${formatMoney(e.target)}`);
  }

  if (input.topCategories.length > 0) {
    lines.push("🏆 Top 5 danh mục tiêu nhiều nhất:");
    input.topCategories.forEach((c, i) => lines.push(`${i + 1}. ${escapeHtml(c.name)} — ${formatMoney(c.spent)}`));
  }

  const empty = input.envelopes.length === 0 && input.topCategories.length === 0;
  if (empty) lines.push("Không có dữ liệu chi tiêu tuần này.");

  const ratio = (e: { spent: number; target: number }) => (e.target > 0 ? e.spent / e.target : e.spent > 0 ? Infinity : 0);
  const byRatio = [...input.envelopes].sort((a, b) => ratio(b) - ratio(a));
  const chip = (e: { name: string; spent: number; target: number }) => `${e.name} ${formatMoney(e.spent).replace(" ₫", "")}/${formatMoney(e.target)}`;
  const top = input.topCategories[0];
  const items = [
    ...byRatio.filter((e) => ratio(e) >= NEAR_TARGET).map(chip),
    ...(top ? [`tiêu nhiều nhất ${top.name} ${formatMoney(top.spent)}`] : []),
    ...byRatio.filter((e) => ratio(e) < NEAR_TARGET).map(chip),
  ];
  const body = fitJoin(items, PUSH_BODY_MAX);
  const week = input.weekLabel.split(" ")[0]!;
  const spent = formatMoney(input.totalSpent);
  return {
    full: lines.join("\n"),
    push: {
      title: firstFit([`Tuần ${week}: chi ${spent}`, `${week}: chi ${spent}`, `Tổng kết ${week}`], PUSH_TITLE_MAX),
      body: empty ? "Không có dữ liệu chi tiêu tuần này." : body.charAt(0).toUpperCase() + body.slice(1),
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

/** Gộp các log chưa gán thành một tin. Bản ngắn: "N giao dịch chưa gán", nội dung từng khoản tới khi hết chỗ, rồi "… và K khoản". */
export function pendingMessage(logs: PendingLog[]): NotifyMessage {
  const item = (r: PendingLog, name: string) => `${r.direction === "in" ? "+" : MINUS}${r.amount.toLocaleString("vi-VN")} ₫ ${name}`;
  const shown = logs.slice(0, PENDING_MAX_LINES);
  const lines = shown.map((r) => item(r, `— ${escapeHtml(r.accountName ?? "TK lạ")}`));
  if (logs.length > shown.length) lines.push(`… và ${logs.length - shown.length} khoản khác`);
  return {
    full: `⚠️ ${logs.length} giao dịch chưa gán:\n${lines.join("\n")}`,
    push: {
      title: firstFit([`${logs.length} giao dịch chưa gán`, `${logs.length} chưa gán`], PUSH_TITLE_MAX),
      body: fitJoin(
        logs.map((r) => item(r, r.accountName ?? "TK lạ")),
        PUSH_BODY_MAX,
        (hidden) => `… và ${hidden} khoản`,
      ),
    },
  };
}

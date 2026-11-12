import { describe, expect, it } from "vitest";
import type { PayCycleTask } from "../src/domain/pay-cycle";
import {
  dailyMessage,
  formatMoney,
  formatWeekLabel,
  payCycleMessage,
  pendingMessage,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  weeklyMessage,
  type DailyMessageInput,
  type WeeklyMessageInput,
} from "../src/notify/format";

describe("formatMoney: vi-VN, dấu trừ U+2212, không làm tròn", () => {
  it.each([
    [1_250_000, "1.250.000 ₫"],
    [0, "0 ₫"],
    [820_000, "820.000 ₫"],
    [-50_000, "−50.000 ₫"],
  ])("%d → %s", (amount, expected) => expect(formatMoney(amount)).toBe(expected));

  it("dấu trừ là U+2212, không phải gạch nối thường", () => {
    expect(formatMoney(-1)).toMatch(/^−/);
    expect(formatMoney(-1)).not.toMatch(/^-/);
  });
});

describe("formatWeekLabel", () => {
  it("cùng tháng: T38 (14–20/9)", () => {
    expect(formatWeekLabel("2026-W38", "2026-09-14", "2026-09-20")).toBe("T38 (14–20/9)");
  });

  it("lệch tháng: ghi rõ tháng ở cả hai đầu", () => {
    expect(formatWeekLabel("2026-W44", "2026-10-26", "2026-11-01")).toBe("T44 (26/10–1/11)");
  });
});

describe("dailyMessage", () => {
  /** Hôm nay 13/11 (lời chúc thứ ba), không mục tiêu Dự phòng, Dự phòng trống, không nợ. */
  const base: DailyMessageInput = {
    nearSpend: { amount: 4_100_000, payday: "2026-12-10", daysLeft: 29, perDay: 141_000 },
    limitNudges: [],
    unassignedCount: 0,
    reserveGoals: [],
    peace: 0,
    peaceMonths: { covered: null, target: 6 },
    shortDebt: { total: 0, count: 0, items: [] },
    day: "2026-11-13",
    driftAccounts: [],
    payTasksOpen: 0,
    pairedTransfersYesterday: 0,
    backfillAddedLastNight: 0,
    cashCountReminder: [],
  };
  const FIRST = "💰 Vận hành 4.100.000 ₫ · chi khoảng 141.000 ₫/ngày tới kỳ lương 10/12 (còn 29 ngày)";
  const BLESS = "💳 Không nợ ngắn hạn nào. Giữ nhịp này nhé 👏";
  /**
   * Hộ mẫu B: mục tiêu Dự phòng theo thứ tự server (A = số dư tài khoản của mục tiêu), phần an tâm 31.500.000 đủ 3,1 / 6
   * tháng, nợ ngắn hạn 8.000.000 (tài khoản Trả nợ có 1.000.000).
   */
  const sampleB: Pick<DailyMessageInput, "reserveGoals" | "peace" | "peaceMonths" | "shortDebt" | "debts"> = {
    reserveGoals: [
      { name: "Trả nợ Vay người thân", held: 1_000_000, target: 1_000_000, spent: 0 },
      { name: "Học phí", held: 4_000_000, target: 6_000_000, spent: 0 },
      { name: "Bảo dưỡng xe", held: 1_000_000, target: 4_800_000, spent: 0 },
      { name: "Thuế", held: 500_000, target: null, spent: 0 },
      { name: "Sửa nhà", held: null, target: 20_000_000, spent: 0 },
    ],
    peace: 31_500_000,
    peaceMonths: { covered: 3.1, target: 6 },
    shortDebt: { total: 8_000_000, count: 2, items: [{ heldFor: 1_000_000 }, { heldFor: 0 }] },
    debts: { balance: 58_000_000, count: 3 },
  };

  it("UC-402 AC-32: dòng đầu mở bằng cả hai số — Vận hành X · chi khoảng Y/ngày tới kỳ lương d/m (còn N ngày); hết tiền → báo đã hết kèm số ngày; còn ít không đủ 1.000/ngày → số còn lại; tiêu đề bản ngắn /ngày", () => {
    expect(dailyMessage(base).full.split("\n")[0]).toBe(FIRST);
    const out = dailyMessage({ ...base, nearSpend: { amount: -250_000, payday: "2026-12-10", daysLeft: 29, perDay: null } });
    expect(out.full.split("\n")[0]).toBe("💰 Tiền vận hành đã hết (−250.000 ₫) — còn 29 ngày");
    const little = dailyMessage({ ...base, nearSpend: { amount: 20_000, payday: "2027-01-10", daysLeft: 31, perDay: null } });
    expect(little.full.split("\n")[0]).toBe("💰 Vận hành còn 20.000 ₫ tới kỳ lương 10/1 (còn 31 ngày)");
    // Tiêu đề bản ngắn cùng số (≤ 25 ký tự; che số không áp dụng cho thông báo đẩy).
    expect([dailyMessage(base).push.title, out.push.title, little.push.title]).toEqual(["Vận hành ~141.000/ngày", "Tiền vận hành đã hết", "Vận hành còn 20.000 ₫"]);
  });

  it("UC-402 AC-5: không cảnh báo, không mục tiêu Dự phòng, Dự phòng trống, không nợ → đúng 3 dòng: 💰, 💳 lời chúc, đối soát", () => {
    expect(dailyMessage(base).full.split("\n")).toEqual([FIRST, BLESS, "🏦 Đối soát: khớp"]);
  });

  it("UC-402 AC-34: 🎯 mỗi mục tiêu Dự phòng có tài khoản và B theo thứ tự truyền vào (held / B), rồi phần an tâm; không có Thuế (theo %), không có mục tiêu chưa gắn tài khoản, không có Quỹ an tâm; phần an tâm âm → thiếu; covered null → không có mục; không mục nào → không dòng 🎯", () => {
    const line = (o: Partial<DailyMessageInput>) => dailyMessage({ ...base, ...sampleB, ...o }).full.split("\n").find((l) => l.startsWith("🎯"));
    expect(line({})).toBe("🎯 Trả nợ Vay người thân 100% · Học phí 66% · Bảo dưỡng xe 20% · Phần an tâm đủ 3,1/6 tháng");
    expect(line({ peace: -1_000_000, peaceMonths: { covered: 0, target: 6 } })).toBe("🎯 Trả nợ Vay người thân 100% · Học phí 66% · Bảo dưỡng xe 20% · Phần an tâm thiếu 1.000.000 ₫");
    expect(line({ peaceMonths: { covered: null, target: 6 } })).toBe("🎯 Trả nợ Vay người thân 100% · Học phí 66% · Bảo dưỡng xe 20%");
    expect(line({ reserveGoals: [{ name: "Quá <đích>", held: 9_000_000, target: 6_000_000, spent: 0 }], peace: 0 })).toBe("🎯 Quá &lt;đích&gt; 100%");
    expect(line({ reserveGoals: [], peace: 0 })).toBeUndefined();
    expect(dailyMessage({ ...base, ...sampleB }).full).not.toContain("Quỹ an tâm");
    expect(dailyMessage({ ...base, ...sampleB }).full).not.toContain("Sửa nhà");
  });

  it("UC-402 AC-41: 🎯 theo thứ tự ưu tiên, p = ⌊(held + spent) × 100 ÷ B⌋ kẹp 0…100 — nhóm tài khoản chung; Thuế không vào; đã chi 7.500.000 gắn Nhà ở → 100%; Học tập held −6.000.000, spent 6.000.000 → 0%", () => {
    const goals = [
      { name: "Hoá đơn", held: 2_000_000, target: 2_000_000, spent: 0 },
      { name: "Nhà ở", held: 7_500_000, target: 7_500_000, spent: 0 },
      { name: "Học tập", held: 4_500_000, target: 6_000_000, spent: 0 },
      { name: "Bảo dưỡng xe", held: 4_800_000, target: 4_800_000, spent: 0 },
      { name: "Hiếu hỉ", held: 2_200_000, target: 3_000_000, spent: 0 },
      { name: "Thuế", held: 1_500_000, target: null, spent: 0 },
    ];
    const line = (reserveGoals: typeof goals) =>
      dailyMessage({ ...base, ...sampleB, reserveGoals, peace: 5_000_000, peaceMonths: { covered: null, target: 6 } }).full.split("\n").find((l) => l.startsWith("🎯"));
    expect(line(goals)).toBe("🎯 Hoá đơn 100% · Nhà ở 100% · Học tập 75% · Bảo dưỡng xe 100% · Hiếu hỉ 73%");
    const paid = goals.map((g) => (g.name === "Nhà ở" ? { ...g, held: 0, spent: 7_500_000 } : g));
    expect(line(paid)).toContain("Nhà ở 100%");
    const over = goals.map((g) => (g.name === "Học tập" ? { ...g, held: -6_000_000, spent: 6_000_000 } : g));
    expect(line(over)).toContain("Học tập 0%");
    const single = [{ name: "Hoá đơn", held: 1_000_000, target: 2_000_000, spent: 500_000 }];
    expect(line(single)).toBe("🎯 Hoá đơn 75%");
  });

  it("UC-402 AC-35: 💳 nợ ngắn hạn kèm số đã có trong tài khoản Trả nợ và tất cả khoản nợ; chỉ nợ ngắn hạn → không vế cuối; hết nợ ngắn hạn → lời chúc của ngày kèm nợ khác; bản ngắn không đổi", () => {
    const debtLine = (o: Partial<DailyMessageInput>) => dailyMessage({ ...base, ...o }).full.split("\n").find((l) => l.startsWith("💳"));
    expect(debtLine(sampleB)).toBe("💳 Nợ ngắn hạn còn 8.000.000 ₫ (2 khoản) · đã có 1.000.000 ₫ trong tài khoản Trả nợ · tất cả khoản nợ còn 58.000.000 ₫ (3 khoản)");
    expect(dailyMessage({ ...base, ...sampleB }).full).not.toMatch(/để riêng|giữ riêng/);
    expect(debtLine({ shortDebt: { total: 8_000_000, count: 2, items: [{ heldFor: 0 }, { heldFor: 0 }] }, debts: { balance: 8_000_000, count: 2 } })).toBe("💳 Nợ ngắn hạn còn 8.000.000 ₫ (2 khoản)");
    expect(debtLine({ day: "2026-11-11", debts: { balance: 50_000_000, count: 1 } })).toBe("💳 Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn · còn nợ khác 50.000.000 ₫ (1 khoản)");
    expect(debtLine({ day: "2026-11-12" })).toBe("💳 Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình");
    expect(dailyMessage({ ...base, ...sampleB }).push).toEqual(dailyMessage(base).push);
  });

  it("UC-402 AC-30: lãi tiền gửi tự ghi hôm qua → một dòng thông tin sau dòng đối soát, vào tên tài khoản nhận (escape HTML); bản đẩy không đổi; không có lãi → không có dòng", () => {
    const msg = dailyMessage({ ...base, interestYesterday: { total: 155, count: 3, accounts: ["Tài khoản chính", "VCB <vợ>", "Tài khoản tiết kiệm"] } });
    expect(msg.full.split("\n")).toEqual([FIRST, BLESS, "🏦 Đối soát: khớp", "💰 Lãi tiền gửi: +155 ₫ (3 khoản) — vào Tài khoản chính, VCB &lt;vợ&gt;, Tài khoản tiết kiệm"]);
    expect(msg.push).toEqual(dailyMessage(base).push);
    expect(dailyMessage({ ...base, interestYesterday: { total: 0, count: 0, accounts: [] } }).full).toBe(dailyMessage(base).full);
  });

  it("UC-402 AC-40: lãi vào tài khoản riêng tư chỉ nối số khoản, không số tiền, không tên; chỉ có lãi riêng tư → một dòng chỉ số khoản; bản ngắn không đổi", () => {
    const mixed = dailyMessage({ ...base, interestYesterday: { total: 105, count: 2, accounts: ["VCB (chính)", "MB (Thuế)"], privateCount: 1 } });
    expect(mixed.full.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +105 ₫ (2 khoản) — vào VCB (chính), MB (Thuế) · 1 khoản của tài khoản riêng tư"]);
    const only = dailyMessage({ ...base, interestYesterday: { total: 0, count: 0, accounts: [], privateCount: 1 } });
    expect(only.full.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: 1 khoản của tài khoản riêng tư"]);
    expect(only.push).toEqual(dailyMessage(base).push);
    expect(mixed.push).toEqual(dailyMessage(base).push);
  });

  it("UC-402 AC-36: việc ngày lương còn mở → dòng ☑️ ở chỗ cũ của 📅 (sau 🔎, trước 🧮); bản ngắn có \"việc ngày lương N\"; 0 việc → không có dòng; không còn 🔁 / 📅 / 📌", () => {
    const msg = dailyMessage({ ...base, payTasksOpen: 5, limitNudges: [{ name: "Ăn uống", pct: 90, over: 0 }], cashCountReminder: ["Tiền mặt"] });
    expect(msg.full.split("\n").slice(1, 4)).toEqual(["🔎 Nhìn lại kỳ này: Ăn uống 90%", "☑️ Việc ngày lương còn 5 việc", "🧮 Chủ nhật: đếm tiền mặt, nhập số dư — Tiền mặt"]);
    expect(msg.push.body).toBe("Ăn uống 90% · việc ngày lương 5 · đếm tiền mặt");
    expect(msg.full).not.toMatch(/🔁|📅|📌/);
    expect(dailyMessage({ ...base, payTasksOpen: 0 }).full).not.toContain("☑️");
  });

  it("UC-402 AC-4: đủ mọi mục → đúng 9 dòng 💰 📥 🔎 ☑️ 🎯 💳 🏦 🔗 🩹: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ", () => {
    const input: DailyMessageInput = {
      ...base,
      limitNudges: [
        { name: "Đi lại", pct: 105, over: 40_000 },
        { name: "Ăn uống", pct: 92, over: 0 },
      ],
      unassignedCount: 5,
      reserveGoals: [{ name: "Du lịch", held: 4_500_000, target: 10_000_000, spent: 0 }],
      peace: 32_000_000,
      peaceMonths: { covered: 3.2, target: 6 },
      driftAccounts: [{ name: "VCB", amount: -120_000 }],
      payTasksOpen: 3,
      pairedTransfersYesterday: 1,
      backfillAddedLastNight: 2,
    };
    expect(dailyMessage(input).full).toBe(
      [
        FIRST,
        "📥 5 giao dịch chưa gán",
        "🔎 Nhìn lại kỳ này: Đi lại vượt 40.000 ₫ · Ăn uống 92%",
        "☑️ Việc ngày lương còn 3 việc",
        "🎯 Du lịch 45% · Phần an tâm đủ 3,2/6 tháng",
        BLESS,
        "🏦 Đối soát: ❌ lệch 120.000 ₫ ở VCB",
        "🔗 Hôm qua tự ghép 1 cặp chuyển nội bộ",
        "🩹 Đêm qua vá 2 giao dịch webhook bỏ sót",
      ].join("\n"),
    );
  });

  it("UC-402 AC-6: dòng 🔎 giữ thứ tự limitNudges truyền vào (vượt trước rồi % giảm dần — cron dùng limitNudges); nhóm vượt ghi số vượt, nhóm gần chạm ghi %", () => {
    const text = dailyMessage({ ...base, limitNudges: [{ name: "Mua sắm", pct: 120, over: 200_000 }, { name: "Ăn uống", pct: 83, over: 0 }] }).full;
    expect(text).toContain("🔎 Nhìn lại kỳ này: Mua sắm vượt 200.000 ₫ · Ăn uống 83%");
    expect(text).not.toContain("Sắp vỡ");
  });

  it("UC-402 AC-38: không nhóm nào cần nhắc → không dòng 🔎, không mục nhóm ở bản ngắn; không dòng nào chứa \"Sắp vỡ\" hay \"bù\"", () => {
    const msg = dailyMessage({ ...base, limitNudges: [], payTasksOpen: 1 });
    expect(msg.full).not.toMatch(/🔎|Sắp vỡ|bù/);
    expect(msg.push.body).toBe("Việc ngày lương 1");
  });

  it("UC-404 AC-5: Chủ nhật: nhắc đếm tiền mặt / nhập số dư kèm tên tài khoản", () => {
    const text = dailyMessage({ ...base, cashCountReminder: ["Tiền mặt (chồng)", "Tiền mặt (vợ)"] }).full;
    expect(text).toContain("🧮 Chủ nhật: đếm tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)");
    expect(text).not.toContain("ví tiền mặt");
  });

  it("UC-402 AC-17: ngày 1: mỗi người thuê chưa gửi bản tính tháng trước một dòng nhắc lập bản tính kèm tháng và số dư", () => {
    const text = dailyMessage({ ...base, rentalBillReminder: { month: "2026-10", tenants: [{ name: "An", balance: -80_000 }, { name: "Bình", balance: 5_111_667 }] } }).full;
    expect(text.split("\n")).toEqual([FIRST, "🏠 Lập bản tính tháng 10 cho An (số dư −80.000 ₫)", "🏠 Lập bản tính tháng 10 cho Bình (số dư 5.111.667 ₫)", BLESS, "🏦 Đối soát: khớp"]);
    expect(dailyMessage({ ...base, rentalBillReminder: { month: "2026-10", tenants: [] } }).full).not.toContain("🏠");
  });

  it("tin sáng báo người khác nợ mình X (N khoản) ngay sau dòng còn nợ, không còn ai nợ thì không có dòng", () => {
    const debts = { debts: { balance: 15_379_000, count: 2 }, shortDebt: { total: 15_379_000, count: 2, items: [{ heldFor: 0 }, { heldFor: 0 }] } };
    expect(dailyMessage({ ...base, ...debts, receivables: { balance: 3_000_000, count: 1 } }).full.split("\n")).toEqual([
      FIRST,
      "💳 Nợ ngắn hạn còn 15.379.000 ₫ (2 khoản)",
      "🤝 Người khác nợ mình 3.000.000 ₫ (1 khoản)",
      "🏦 Đối soát: khớp",
    ]);
    expect(dailyMessage({ ...base, ...debts, receivables: { balance: 0, count: 0 } }).full).not.toContain("🤝");
  });

  it("UC-402 AC-13: tên nhóm được escape HTML ở bản đầy đủ (parse_mode=HTML), giữ chữ thật ở bản ngắn", () => {
    const { full, push } = dailyMessage({ ...base, limitNudges: [{ name: "Ăn <uống> & chơi", pct: 90, over: 0 }] });
    expect(full).toContain("Ăn &lt;uống&gt; &amp; chơi 90%");
    expect(full).not.toContain("<uống>");
    expect(push.body).toBe("Ăn <uống> & chơi 90%");
  });

  it("UC-402 AC-42: có topUp (UC-103 AC-25) → dòng 💰 thêm \"· cần chuyển thêm 2.500.000 ₫ vào tiền chi tiêu (từ BIDV)\"; có số mỗi ngày thì câu nối sau số đó; topUp null hay không nguồn → không / không \"(từ …)\"", () => {
    const topUp = {
      amount: 2_500_000,
      sources: [
        { accountId: "tk-bidv", name: "BIDV", amount: 2_000_000 },
        { accountId: "phao", name: "Phao", amount: 500_000 },
      ],
    };
    const ac25 = dailyMessage({ ...base, nearSpend: { amount: 1_000_000, payday: "2026-12-10", daysLeft: 20, perDay: null }, topUp });
    expect(ac25.full.split("\n")[0]).toBe("💰 Vận hành còn 1.000.000 ₫ tới kỳ lương 10/12 (còn 20 ngày) · cần chuyển thêm 2.500.000 ₫ vào tiền chi tiêu (từ BIDV)");
    expect(dailyMessage({ ...base, topUp }).full.split("\n")[0]).toBe(`${FIRST} · cần chuyển thêm 2.500.000 ₫ vào tiền chi tiêu (từ BIDV)`);
    expect(dailyMessage({ ...base, topUp: { amount: 300_000, sources: [] } }).full.split("\n")[0]).toBe(`${FIRST} · cần chuyển thêm 300.000 ₫ vào tiền chi tiêu`);
    expect(dailyMessage({ ...base, topUp: null }).full.split("\n")[0]).toBe(FIRST);
  });
});

describe("dailyMessage — bản ngắn cho thông báo đẩy", () => {
  const base: DailyMessageInput = {
    nearSpend: { amount: 4_100_000, payday: "2026-12-10", daysLeft: 29, perDay: 141_000 },
    limitNudges: [],
    unassignedCount: 0,
    reserveGoals: [{ name: "Du lịch", held: 4_500_000, target: 10_000_000, spent: 0 }],
    peace: 32_000_000,
    peaceMonths: { covered: 3.2, target: 6 },
    shortDebt: { total: 15_379_000, count: 2, items: [{ heldFor: 0 }, { heldFor: 0 }] },
    day: "2026-11-13",
    driftAccounts: [],
    payTasksOpen: 0,
    pairedTransfersYesterday: 1,
    backfillAddedLastNight: 2,
    cashCountReminder: [],
    debts: { balance: 15_379_000, count: 2 },
  };

  it("không có việc: tiêu đề là tiền vận hành mỗi ngày, nội dung báo không có việc và đối soát khớp; thông tin không lên", () => {
    expect(dailyMessage(base).push).toEqual({ title: "Vận hành ~141.000/ngày", body: "Không có việc cần làm · đối soát khớp" });
  });

  it("chỉ lệch đối soát: nội dung là chỗ lệch", () => {
    expect(dailyMessage({ ...base, driftAccounts: [{ name: "MB", amount: -120_000 }] }).push.body).toBe("Lệch 120.000 ₫ ở MB");
  });

  it("UC-402 AC-26: việc cần làm theo thứ tự chưa gán → xem tay → nhóm 🔎 → việc ngày lương → đếm tiền mặt → lập bản tính người thuê, rồi chỗ lệch; không còn \"chốt tháng <m>\"", () => {
    const push = dailyMessage({
      ...base,
      unassignedCount: 3,
      unreadableBankTransactions: 1,
      limitNudges: [{ name: "Ăn uống", pct: 88, over: 0 }],
      payTasksOpen: 2,
      driftAccounts: [{ name: "MB", amount: 5_000 }],
    }).push;
    expect(push.body).toBe("3 chưa gán · 1 cần xem tay · Ăn uống 88% · việc ngày lương 2 · lệch 5.000 ₫ ở MB");

    const dayOne = dailyMessage({
      ...base,
      cashCountReminder: ["Tiền mặt"],
      rentalBillReminder: { month: "2026-10", tenants: [{ name: "Anh Bình", balance: 7_075_000 }] },
    }).push;
    expect(dayOne.body).toBe("Đếm tiền mặt · lập bản tính Anh Bình");
  });

  it("UC-402 AC-27: tin dài nhất (ba nhóm tên dài): tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …", () => {
    const { full, push } = dailyMessage({
      ...base,
      nearSpend: { amount: 3_580_224_000, payday: "2026-12-10", daysLeft: 29, perDay: 123_456_000 },
      unassignedCount: 12,
      unreadableBankTransactions: 2,
      payTasksOpen: 5,
      limitNudges: [
        { name: "Ăn uống gia đình mở rộng", pct: 135, over: 1_050_000 },
        { name: "Đi lại & xăng xe hằng ngày", pct: 105, over: 40_000 },
        { name: "Chơi (chồng)", pct: 92, over: 0 },
      ],
      cashCountReminder: ["Tiền mặt (chồng)", "Tiền mặt (vợ)"],
      rentalBillReminder: { month: "2026-11", tenants: [{ name: "Anh Bình", balance: 7_075_000 }, { name: "An", balance: -80_000 }] },
      receivables: { balance: 3_000_000, count: 1 },
      driftAccounts: [{ name: "VCB (vợ)", amount: 1_000_000 }],
      interestYesterday: { total: 155, count: 3, accounts: ["Tài khoản chính"] },
    });
    expect(push.title).toBe("~123.456.000/ngày"); // "Vận hành ~123.456.000/ngày" dài 26, kèm "tới 10/12" dài 27
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(push.body).toBe("12 chưa gán · 2 cần xem tay · Ăn uống gia đình mở rộng vượt 1.050.000 ₫ · Đi lại & xăng xe hằng ngày vượt 40.000 ₫ · Chơi (chồng) 92% …");
    expect(push.body).not.toContain("<");
    // Bản đầy đủ giữ mọi dòng: việc cần làm trước, thông tin sau, dưới giới hạn 4096 ký tự của Telegram.
    expect(full.split("\n").map((l) => Array.from(l)[0])).toEqual(["💰", "📥", "❗", "🔎", "☑", "🧮", "🏠", "🏠", "🎯", "💳", "🤝", "🏦", "🔗", "💰", "🩹"]);
    expect(full).not.toMatch(/🧹|📌|Sắp vỡ/);
    expect(full.length).toBeLessThan(4096);
  });

  it("một việc dài hơn cả nội dung thì cắt giữa chừng, vẫn kết thúc bằng …", () => {
    const body = dailyMessage({ ...base, limitNudges: [{ name: "x".repeat(400), pct: 99, over: 0 }] }).push.body;
    expect(Array.from(body)).toHaveLength(PUSH_BODY_MAX);
    expect(body.endsWith("…")).toBe(true);
  });

  it("tiêu đề không bao giờ quá 25 ký tự", () => {
    for (const amount of [0, -50_000, 20_000, 13_250_000, 113_250_000, 999_999_999_999]) {
      const perDay = amount >= 29_000 ? Math.floor(amount / 29 / 1000) * 1000 : null;
      const title = dailyMessage({ ...base, nearSpend: { amount, payday: "2026-12-31", daysLeft: 29, perDay } }).push.title;
      expect(Array.from(title).length, title).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    }
  });
});

describe("weeklyMessage", () => {
  const nearSpend = { amount: 9_000_000, payday: "2026-12-10", daysLeft: 17, perDay: 529_000 };
  const limits = [
    { name: "Ăn uống", spent: 2_300_000, limit: 3_000_000, over: 0 },
    { name: "Đi lại", spent: 450_000, limit: 800_000, over: 0 },
    { name: "Mua sắm", spent: 1_200_000, limit: 1_000_000, over: 200_000 },
  ];

  it("UC-406 AC-4: định dạng theo đầu vào mới: 💰 như tin sáng, 🧾 tuần qua, 🔎 mọi nhóm có hạn mức theo thứ tự (vượt ghi rõ), 🏆 top 5; không dòng phong bì", () => {
    const input: WeeklyMessageInput = {
      weekLabel: "T47 (16–22/11)",
      nearSpend,
      totalSpent: 2_100_000,
      operatingSpent: 1_600_000,
      limits,
      cycleStart: "2026-11-10",
      topCategories: [
        { name: "Mua sắm", spent: 700_000 },
        { name: "Đi chợ / nấu ăn", spent: 600_000 },
      ],
    };
    expect(weeklyMessage(input).full).toBe(
      [
        "📊 Tổng kết tuần T47 (16–22/11)",
        "💰 Vận hành 9.000.000 ₫ · chi khoảng 529.000 ₫/ngày tới kỳ lương 10/12 (còn 17 ngày)",
        "🧾 Tuần qua chi 2.100.000 ₫ · từ Vận hành 1.600.000 ₫ ≈ 228.000 ₫/ngày",
        "🔎 Kỳ từ 10/11: Ăn uống 2.300.000 ₫ / 3.000.000 ₫ · Đi lại 450.000 ₫ / 800.000 ₫ · Mua sắm 1.200.000 ₫ / 1.000.000 ₫ (vượt 200.000 ₫)",
        "🏆 Top 5 danh mục tiêu nhiều nhất:",
        "1. Mua sắm — 700.000 ₫",
        "2. Đi chợ / nấu ăn — 600.000 ₫",
      ].join("\n"),
    );
    // Dòng 💰 giống hệt tin sáng cùng số.
    const daily = dailyMessage({
      nearSpend,
      limitNudges: [],
      unassignedCount: 0,
      reserveGoals: [],
      peace: 0,
      peaceMonths: { covered: null, target: 6 },
      shortDebt: { total: 0, count: 0, items: [] },
      day: "2026-11-23",
      driftAccounts: [],
      payTasksOpen: 0,
      pairedTransfersYesterday: 0,
      backfillAddedLastNight: 0,
      cashCountReminder: [],
    });
    expect(weeklyMessage(input).full.split("\n")[1]).toBe(daily.full.split("\n")[0]);
  });

  it("UC-406 AC-4: tuần rỗng hoàn toàn (không nearSpend, không nhóm, không danh mục) → tiêu đề + câu trạng thái rỗng", () => {
    const { full, push } = weeklyMessage({ weekLabel: "T1 (29/12–4/1)", nearSpend: null, totalSpent: 0, operatingSpent: 0, limits: [], cycleStart: null, topCategories: [] });
    expect(full).toBe(["📊 Tổng kết tuần T1 (29/12–4/1)", "Không có dữ liệu chi tiêu tuần này."].join("\n"));
    expect(push).toEqual({ title: "Tuần T1: chi 0 ₫", body: "Không có dữ liệu chi tiêu tuần này." });
  });

  it("UC-406 AC-3: tuần không chi nhưng có nhóm hạn mức → 💰, 🔎 0 ₫ / hạn mức, câu rỗng; không 🧾, không 🏆", () => {
    const { full } = weeklyMessage({
      weekLabel: "T46 (9–15/11)",
      nearSpend,
      totalSpent: 0,
      operatingSpent: 0,
      limits: [{ name: "Ăn uống", spent: 0, limit: 3_000_000, over: 0 }],
      cycleStart: "2026-11-10",
      topCategories: [],
    });
    expect(full.split("\n")).toEqual([
      "📊 Tổng kết tuần T46 (9–15/11)",
      "💰 Vận hành 9.000.000 ₫ · chi khoảng 529.000 ₫/ngày tới kỳ lương 10/12 (còn 17 ngày)",
      "🔎 Kỳ từ 10/11: Ăn uống 0 ₫ / 3.000.000 ₫",
      "Không có dữ liệu chi tiêu tuần này.",
    ]);
  });

  it("UC-406 AC-9: bản ngắn: tiêu đề tổng chi; mở bằng Vận hành còn X ≈ Y/ngày, rồi nhóm ≥ 80% (vượt trước), rồi danh mục tiêu nhiều nhất, rồi nhóm còn lại; hết tiền → Vận hành đã hết", () => {
    const input: WeeklyMessageInput = { weekLabel: "T47 (16–22/11)", nearSpend, totalSpent: 2_100_000, operatingSpent: 1_600_000, limits, cycleStart: "2026-11-10", topCategories: [{ name: "Mua sắm", spent: 700_000 }] };
    const { push } = weeklyMessage(input);
    expect(push.title).toBe("Tuần T47: chi 2.100.000 ₫");
    expect(push.body.startsWith("Vận hành còn 9.000.000 ₫ ≈ 529.000 ₫/ngày · Mua sắm 1.200.000/1.000.000 ₫ · tiêu nhiều nhất Mua sắm 700.000 ₫")).toBe(true);
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(weeklyMessage({ ...input, nearSpend: { ...nearSpend, amount: -50_000, perDay: null } }).push.body.startsWith("Vận hành đã hết · Mua sắm")).toBe(true);
    expect(weeklyMessage({ ...input, nearSpend: null }).push.body.startsWith("Mua sắm 1.200.000/1.000.000 ₫")).toBe(true);
  });

  it("UC-406 AC-10: tổng chi dài thì tiêu đề bỏ chữ Tuần, vẫn ≤ 25; tám nhóm có hạn mức → nội dung ≤ 150, mở bằng Vận hành rồi hai nhóm % cao nhất, kết thúc bằng …", () => {
    const { push } = weeklyMessage({
      weekLabel: "T40 (28/9–4/10)",
      nearSpend,
      totalSpent: 12_345_000,
      operatingSpent: 12_345_000,
      limits: Array.from({ length: 8 }, (_, i) => ({ name: `Nhóm số ${i + 1}`, spent: 900_000 - i * 100_000, limit: 1_000_000, over: 0 })),
      cycleStart: "2026-09-10",
      topCategories: [{ name: "Nhà", spent: 12_345_000 }],
    });
    expect(push.title).toBe("T40: chi 12.345.000 ₫");
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(push.body).toMatch(/^Vận hành còn 9\.000\.000 ₫ ≈ 529\.000 ₫\/ngày · Nhóm số 1 900\.000\/1\.000\.000 ₫ · Nhóm số 2 800\.000\/1\.000\.000 ₫ · .* …$/);
  });
});

describe("pendingMessage", () => {
  it("bản đầy đủ mỗi khoản một dòng; bản ngắn gộp một dòng, tài khoản không rõ là TK lạ", () => {
    const { full, push } = pendingMessage([
      { amount: 24_400, direction: "out", accountName: "MB chính (chồng)" },
      { amount: 50_000, direction: "in", accountName: null },
    ]);
    expect(full).toBe(["⚠️ 2 giao dịch chưa gán:", "−24.400 ₫ — MB chính (chồng)", "+50.000 ₫ — TK lạ"].join("\n"));
    expect(push).toEqual({ title: "2 giao dịch chưa gán", body: "−24.400 ₫ MB chính (chồng) · +50.000 ₫ TK lạ" });
  });

  it("nhiều khoản: bản đầy đủ dừng ở 20 dòng; bản ngắn ≤ 150, đuôi … và N khoản", () => {
    const logs = Array.from({ length: 25 }, (_, i) => ({ amount: 100_000 + i, direction: "out" as const, accountName: "MB chính (chồng)" }));
    const { full, push } = pendingMessage(logs);
    const lines = full.split("\n");
    expect(lines).toHaveLength(22);
    expect(lines[21]).toBe("… và 5 khoản khác");
    expect(push.title).toBe("25 giao dịch chưa gán");
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    const shown = push.body.split(" · ").length;
    expect(push.body.endsWith(` … và ${25 - shown} khoản`)).toBe(true);
  });

  it("escape HTML ở bản đầy đủ, bản ngắn giữ chữ thật", () => {
    const { full, push } = pendingMessage([{ amount: 1_000, direction: "in", accountName: "A&B <x>" }]);
    expect(full).toContain("A&amp;B &lt;x&gt;");
    expect(push.body).toBe("+1.000 ₫ A&B <x>");
  });

  it("UC-407 AC-14: log của tài khoản riêng tư gộp thành một dòng không số, không tên — sau các dòng log thường, trước \"… và N khoản khác\"; bản ngắn giữ mục riêng tư ở đầu phần bị cắt", () => {
    const { full, push } = pendingMessage([{ amount: 50_000, direction: "in", accountName: "VCB (chính)" }], 2);
    expect(full).toBe("⚠️ 3 giao dịch chưa gán:\n+50.000 ₫ — VCB (chính)\n2 khoản của tài khoản riêng tư");
    expect(push).toEqual({ title: "3 giao dịch chưa gán", body: "+50.000 ₫ VCB (chính) · 2 khoản của tài khoản riêng tư" });
    for (const s of [full, push.title, push.body]) {
      expect(s).not.toContain("3.000.000");
      expect(s).not.toContain("120.000");
      expect(s).not.toContain("VCB (vợ)");
    }

    const many = pendingMessage(Array.from({ length: 25 }, (_, i) => ({ amount: 100_000 + i, direction: "out" as const, accountName: "MB chính (chồng)" })), 3);
    const lines = many.full.split("\n");
    expect(lines[0]).toBe("⚠️ 28 giao dịch chưa gán:");
    expect(lines.slice(-2)).toEqual(["3 khoản của tài khoản riêng tư", "… và 5 khoản khác"]);
    expect(many.push.title).toBe("28 giao dịch chưa gán");
    expect(Array.from(many.push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    const shown = many.push.body.split(" · ").length - 1;
    expect(many.push.body.endsWith(` · 3 khoản của tài khoản riêng tư … và ${25 - shown} khoản`)).toBe(true);

    expect(pendingMessage([], 1)).toEqual({ full: "⚠️ 1 giao dịch chưa gán:\n1 khoản của tài khoản riêng tư", push: { title: "1 giao dịch chưa gán", body: "1 khoản của tài khoản riêng tư" } });
  });
});

describe("dòng giao dịch ngân hàng không đọc được", () => {
  it("hiện khi có, và không hiện khi không có", async () => {
    const { dailyMessage } = await import("../src/notify/format");
    const base: DailyMessageInput = {
      nearSpend: { amount: 4_100_000, payday: "2026-12-10", daysLeft: 29, perDay: 141_000 }, limitNudges: [], unassignedCount: 0, reserveGoals: [], peace: 0,
      peaceMonths: { covered: null, target: 6 }, shortDebt: { total: 0, count: 0, items: [] }, day: "2026-11-13", driftAccounts: [], payTasksOpen: 0,
      pairedTransfersYesterday: 0, backfillAddedLastNight: 0, cashCountReminder: [],
    };
    expect(dailyMessage({ ...base, unreadableBankTransactions: 2 }).full.split("\n")).toContain("❗ 2 giao dịch ngân hàng cần xem tay");
    expect(dailyMessage({ ...base, unreadableBankTransactions: 0 }).full).not.toContain("cần xem tay");
  });
});

describe("payCycleMessage — lương về tài khoản riêng tư (notify UC-412)", () => {
  const QR = [{ accountId: "x", name: "X", bank: "MB", accountNo: "1", subAccount: null }];
  const task = (o: Partial<PayCycleTask>): PayCycleTask => ({
    id: 1, kind: "savings", status: "open", auto: false, suggested: 0, amount: 0, linked: 0, missing: 0, pct: null, reason: null, toPocket: null,
    goal: null, toAccountId: null, source: null, doneAt: null, lastTxAt: null, targets: [], targetName: null, ...o,
  });
  const goal = (id: string, name: string) => ({ id, name, held: 0, target: null, accountId: id });
  const START = "2026-11-10T01:00:00.000Z";
  const NO_SAVINGS = "chưa có tài khoản Tích luỹ — mở tài khoản thật ›";

  it("UC-412 AC-4: chế độ không số — 💵 không số lương, dòng việc không \"· số\", dư kỳ trước không số; pct và tên mục tiêu giữ; bản ngắn không số tiền", () => {
    const tasks = [
      task({ kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", targets: QR, targetName: "X", source: { hidden: true } }),
      task({ kind: "goal", amount: 2_000_000, goal: goal("school", "Học phí"), targets: QR, targetName: "X" }),
      task({ kind: "goal", amount: 760_000, goal: goal("car", "Bảo dưỡng xe"), targets: QR, targetName: "X" }),
      task({ kind: "surplus", amount: 600_000, toPocket: "savings", targets: QR, targetName: "X" }),
      task({ kind: "surplus", amount: 600_000, toAccountId: "bonus", targets: QR, targetName: "Ví Thưởng" }),
    ];
    const msg = payCycleMessage({ income: 20_000_000, startedAt: START, prevOperating: 1_200_000, tasks }, { hideAmounts: true });
    expect(msg.full.split("\n")).toEqual([
      "💵 Lương về — kỳ lương mới từ 10/11",
      "Việc ngày lương (5):",
      "☑️ Trích Tích luỹ 10%",
      "☑️ Nạp Học phí",
      "☑️ Nạp Bảo dưỡng xe",
      "☑️ Dư kỳ trước vào Tích luỹ",
      "☑️ Dư kỳ trước vào Ví Thưởng",
      "Mở app › Hôm nay để làm — có mã QR chuyển khoản",
    ]);
    expect(msg.push).toEqual({ title: "Lương về · 5 việc", body: "Trích Tích luỹ 10% · Nạp Học phí · Nạp Bảo dưỡng xe · Dư kỳ trước vào Tích luỹ · Dư kỳ trước vào Ví Thưởng" });
    for (const n of ["20.000.000", "2.000.000", "760.000", "600.000", "1.200.000"]) {
      expect(msg.full).not.toContain(n);
      expect(msg.push.body).not.toContain(n);
    }
    // Dư kỳ trước âm: dòng "tiêu quá" giữ (không suy ra lương).
    const over = payCycleMessage({ income: 20_000_000, startedAt: START, prevOperating: -300_000, tasks: tasks.slice(0, 1) }, { hideAmounts: true });
    expect(over.full.split("\n")).toContain("Kỳ trước tiêu quá 300.000 ₫ — không có gì để chia");
  });

  it("UC-412 AC-4: trùng ca chưa có tài khoản Tích luỹ (pocket UC-1206 AC-10) → ① và ④ có câu nhắc mở tài khoản, không số; có số thì như thẻ việc", () => {
    const tasks = [
      task({ kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings" }),
      task({ kind: "surplus", amount: 6_000_000, toPocket: "savings" }),
    ];
    const hidden = payCycleMessage({ income: 20_000_000, startedAt: START, prevOperating: 12_000_000, tasks }, { hideAmounts: true });
    expect(hidden.full.split("\n")).toEqual([
      "💵 Lương về — kỳ lương mới từ 10/11",
      "Việc ngày lương (2):",
      `☑️ Trích Tích luỹ 10% · ${NO_SAVINGS}`,
      `☑️ Dư kỳ trước vào Tích luỹ · ${NO_SAVINGS}`,
      "Mở app › Hôm nay để làm",
    ]);
    expect(hidden.push).toEqual({ title: "Lương về · 2 việc", body: "Trích Tích luỹ 10% · Dư kỳ trước vào Tích luỹ" });
    const shown = payCycleMessage({ income: 20_000_000, startedAt: START, prevOperating: 12_000_000, tasks });
    expect(shown.full.split("\n").slice(2, 4)).toEqual([`☑️ Trích Tích luỹ 10% · ${NO_SAVINGS}`, `☑️ Dư kỳ trước 12.000.000 ₫: 6.000.000 ₫ vào Tích luỹ · ${NO_SAVINGS}`]);
  });
});

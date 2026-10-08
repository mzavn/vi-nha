import { describe, expect, it } from "vitest";
import {
  dailyMessage,
  formatMoney,
  formatWeekLabel,
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
  const base: DailyMessageInput = {
    spendableThisWeek: 3_250_000,
    daysLeftInWeek: 4,
    atRisk: [],
    unassignedCount: 0,
    goals: [],
    safetyFundMonthsCovered: null,
    safetyFundMonthsTarget: 6,
    driftAccounts: [],
    transferOrdersOverdue: 0,
    pairedTransfersYesterday: 0,
    backfillAddedLastNight: 0,
    monthClose: null,
    incomeReminder: null,
    cashCountReminder: [],
  };

  it("không có gì cảnh báo → tin ngắn đúng 2 dòng", () => {
    const text = dailyMessage(base).full;
    expect(text.split("\n")).toEqual(["💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)", "🏦 Đối soát: khớp"]);
  });

  it("đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ", () => {
    const input: DailyMessageInput = {
      ...base,
      atRisk: [
        { name: "Đi lại", pct: 105 },
        { name: "Ăn uống", pct: 92 },
      ],
      unassignedCount: 5,
      goals: [{ name: "Du lịch", pct: 45 }],
      safetyFundMonthsCovered: 3.2,
      driftAccounts: [{ name: "VCB", amount: -120_000 }],
      transferOrdersOverdue: 2,
      pairedTransfersYesterday: 1,
      backfillAddedLastNight: 2,
      incomeReminder: { day: 10, unallocatedCount: 1 },
    };
    expect(dailyMessage(input).full).toBe(
      [
        "💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)",
        "📥 5 giao dịch chưa gán",
        "🔁 2 chuyển tiền cần làm (quá 3 ngày)",
        "⚠️ Sắp vỡ: Đi lại 105% · Ăn uống 92%",
        "📅 Hôm nay ngày 10: còn 1 khoản thu chưa chia",
        "🎯 Du lịch 45% · Quỹ an tâm 3,2/6 tháng",
        "🏦 Đối soát: ❌ lệch 120.000 ₫ ở VCB",
        "🔗 Hôm qua tự ghép 1 cặp chuyển nội bộ",
        "🩹 Đêm qua vá 2 giao dịch webhook bỏ sót",
      ].join("\n"),
    );
  });

  it("atRisk đã sắp theo % giảm dần được giữ nguyên thứ tự truyền vào (cron chịu trách nhiệm sắp)", () => {
    const text = dailyMessage({ ...base, atRisk: [{ name: "A", pct: 99 }, { name: "B", pct: 80 }] }).full;
    expect(text).toContain("⚠️ Sắp vỡ: A 99% · B 80%");
  });

  it("ngày 1: dòng chốt tháng kèm lệnh chuyển tiền, chỉ hiện khi số quét > 0", () => {
    const text = dailyMessage({
      ...base,
      monthClose: {
        month: "2026-09",
        amount: 4_640_000,
        transfers: [{ fromName: "VCB (chính)", toName: "TCB (Tích sản)", amount: 4_640_000 }],
      },
    }).full;
    expect(text.split("\n")).toEqual([
      "💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)",
      "🧹 Đã quét 4.640.000 ₫ dư tháng 9 sang Tích sản",
      "🔁 Chuyển 4.640.000 ₫ từ VCB (chính) sang TCB (Tích sản)",
      "🏦 Đối soát: khớp",
    ]);
  });

  it("chốt tháng quét được 0 đồng thì không thêm dòng nào", () => {
    const text = dailyMessage({ ...base, monthClose: { month: "2026-09", amount: 0, transfers: [] } }).full;
    expect(text).not.toContain("🧹");
  });

  it("Chủ nhật: nhắc đếm ví/nhập số dư kèm tên tài khoản", () => {
    const text = dailyMessage({ ...base, cashCountReminder: ["Tiền mặt (chồng)", "Tiền mặt (vợ)"] }).full;
    expect(text).toContain("🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)");
  });

  it("ngày 1: mỗi người thuê chưa chốt tháng trước một dòng nhắc kèm số dư", () => {
    const text = dailyMessage({ ...base, rentalSettleReminder: [{ name: "Anh Bình", balance: -80_000 }, { name: "An", balance: 5_111_667 }] }).full;
    expect(text.split("\n")).toEqual([
      "💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)",
      "🏠 Chốt tháng với Anh Bình (số dư −80.000 ₫)",
      "🏠 Chốt tháng với An (số dư 5.111.667 ₫)",
      "🏦 Đối soát: khớp",
    ]);
  });

  it("tin sáng báo còn nợ X (N khoản), hết nợ thì không có dòng", () => {
    expect(dailyMessage({ ...base, debts: { balance: 15_379_000, count: 2 } }).full.split("\n")).toEqual([
      "💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)",
      "💳 Còn nợ 15.379.000 ₫ (2 khoản)",
      "🏦 Đối soát: khớp",
    ]);
    expect(dailyMessage({ ...base, debts: { balance: 0, count: 0 } }).full).not.toContain("💳");
  });

  it("tin sáng báo người khác nợ mình X (N khoản) ngay sau dòng còn nợ, không còn ai nợ thì không có dòng", () => {
    expect(dailyMessage({ ...base, debts: { balance: 15_379_000, count: 2 }, receivables: { balance: 3_000_000, count: 1 } }).full.split("\n")).toEqual([
      "💰 Còn để chi tuần này: 3.250.000 ₫ (4 ngày)",
      "💳 Còn nợ 15.379.000 ₫ (2 khoản)",
      "🤝 Người khác nợ mình 3.000.000 ₫ (1 khoản)",
      "🏦 Đối soát: khớp",
    ]);
    expect(dailyMessage({ ...base, receivables: { balance: 0, count: 0 } }).full).not.toContain("🤝");
  });

  it("escape HTML trong tên ví/tài khoản vì tin gửi bằng parse_mode=HTML", () => {
    const { full, push } = dailyMessage({ ...base, atRisk: [{ name: "Ăn <uống> & chơi", pct: 90 }] });
    expect(full).toContain("Ăn &lt;uống&gt; &amp; chơi 90%");
    expect(full).not.toContain("<uống>");
    expect(push.body).toBe("Ăn <uống> & chơi 90%");
  });
});

describe("dailyMessage — bản ngắn cho thông báo đẩy", () => {
  const base: DailyMessageInput = {
    spendableThisWeek: 3_250_000,
    daysLeftInWeek: 4,
    atRisk: [],
    unassignedCount: 0,
    goals: [{ name: "Du lịch", pct: 45 }],
    safetyFundMonthsCovered: 3.2,
    safetyFundMonthsTarget: 6,
    driftAccounts: [],
    transferOrdersOverdue: 0,
    pairedTransfersYesterday: 1,
    backfillAddedLastNight: 2,
    monthClose: null,
    incomeReminder: null,
    cashCountReminder: [],
    debts: { balance: 15_379_000, count: 2 },
  };

  it("không có việc: tiêu đề còn để chi tuần này, nội dung báo không có việc và đối soát khớp; thông tin không lên", () => {
    expect(dailyMessage(base).push).toEqual({ title: "Còn 3.250.000 ₫ tuần này", body: "Không có việc cần làm · đối soát khớp" });
  });

  it("còn để chi âm: không viết 'Còn −X' mà nói thẳng đã chi vượt, cả bản ngắn lẫn bản đầy đủ", () => {
    const m = dailyMessage({ ...base, spendableThisWeek: -415_300, daysLeftInWeek: 1 });
    expect(m.push.title).toBe("Tuần này vượt 415.300 ₫");
    expect(m.full.split("\n")[0]).toBe("💰 Tuần này đã chi vượt 415.300 ₫ (còn 1 ngày)");
  });

  it("chỉ lệch đối soát: nội dung là chỗ lệch", () => {
    expect(dailyMessage({ ...base, driftAccounts: [{ name: "MB", amount: -120_000 }] }).push.body).toBe("Lệch 120.000 ₫ ở MB");
  });

  it("việc cần làm theo thứ tự chưa gán → xem tay → chuyển tiền → sắp vỡ → chưa chia → đếm ví → chốt người thuê → quét tháng, rồi chỗ lệch", () => {
    const push = dailyMessage({
      ...base,
      unassignedCount: 3,
      unreadableBankTransactions: 1,
      transferOrdersOverdue: 2,
      atRisk: [{ name: "Ăn uống", pct: 88 }],
      incomeReminder: { day: 10, unallocatedCount: 1 },
      driftAccounts: [{ name: "MB", amount: 5_000 }],
    }).push;
    expect(push.body).toBe("3 chưa gán · 1 cần xem tay · 2 chuyển tiền quá hạn · Ăn uống 88% · còn 1 khoản thu chưa chia · lệch 5.000 ₫ ở MB");

    const dayOne = dailyMessage({
      ...base,
      cashCountReminder: ["Tiền mặt"],
      rentalSettleReminder: [{ name: "Anh Bình", balance: 7_075_000 }],
      monthClose: { month: "2026-09", amount: 4_640_000, transfers: [{ fromName: "VCB", toName: "TCB", amount: 4_640_000 }] },
    }).push;
    expect(dayOne.body).toBe("Đếm ví tiền mặt · chốt tháng Anh Bình · quét 4.640.000 ₫ dư tháng 9 (1 lệnh chuyển)");
  });

  it("tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …", () => {
    const { full, push } = dailyMessage({
      ...base,
      spendableThisWeek: 123_456_789,
      unassignedCount: 12,
      unreadableBankTransactions: 2,
      transferOrdersOverdue: 3,
      atRisk: [
        { name: "Ăn uống gia đình mở rộng", pct: 135 },
        { name: "Đi lại & xăng xe hằng ngày", pct: 105 },
        { name: "Chơi (chồng)", pct: 92 },
      ],
      incomeReminder: { day: 25, unallocatedCount: 2 },
      cashCountReminder: ["Tiền mặt (chồng)", "Tiền mặt (vợ)"],
      rentalSettleReminder: [{ name: "Anh Bình", balance: 7_075_000 }, { name: "An", balance: -80_000 }],
      monthClose: { month: "2026-09", amount: 4_640_000, transfers: [{ fromName: "VCB (chính)", toName: "TCB (Tích sản)", amount: 4_640_000 }] },
      receivables: { balance: 3_000_000, count: 1 },
      driftAccounts: [{ name: "VCB (vợ)", amount: 1_000_000 }],
    });
    expect(push.title).toBe("Còn 123.456.789 ₫"); // "Còn 123.456.789 ₫ tuần này" dài 26
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(push.body).toBe("12 chưa gán · 2 cần xem tay · 3 chuyển tiền quá hạn · Ăn uống gia đình mở rộng 135% · Đi lại & xăng xe hằng ngày 105% · Chơi (chồng) 92% …");
    expect(push.body).not.toContain("<");
    // Bản đầy đủ giữ mọi dòng: việc cần làm trước, thông tin sau, dưới giới hạn 4096 ký tự của Telegram.
    expect(full.split("\n").map((l) => Array.from(l)[0])).toEqual(["💰", "📥", "❗", "🔁", "⚠", "📅", "🧮", "🏠", "🏠", "🧹", "🔁", "🎯", "💳", "🤝", "🏦", "🔗", "🩹"]);
    expect(full.length).toBeLessThan(4096);
  });

  it("một việc dài hơn cả nội dung thì cắt giữa chừng, vẫn kết thúc bằng …", () => {
    const body = dailyMessage({ ...base, atRisk: [{ name: "x".repeat(400), pct: 99 }] }).push.body;
    expect(Array.from(body)).toHaveLength(PUSH_BODY_MAX);
    expect(body.endsWith("…")).toBe(true);
  });

  it("tiêu đề không bao giờ quá 25 ký tự", () => {
    for (const amount of [0, -50_000, 13_250_000, 113_250_000, 999_999_999_999]) {
      expect(Array.from(dailyMessage({ ...base, spendableThisWeek: amount }).push.title).length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    }
  });
});

describe("weeklyMessage", () => {
  it("tổng kết tuần: đã tiêu/dự kiến từng ví + top 5 danh mục", () => {
    const input: WeeklyMessageInput = {
      weekLabel: "T38 (14–20/9)",
      envelopes: [
        { name: "Ăn uống", spent: 580_000, target: 625_000 },
        { name: "Đi lại", spent: 310_000, target: 300_000 },
      ],
      topCategories: [
        { name: "Đi chợ / nấu ăn", spent: 450_000 },
        { name: "Xăng xe / gửi xe", spent: 300_000 },
      ],
      totalSpent: 1_050_000,
    };
    expect(weeklyMessage(input).full).toBe(
      [
        "📊 Tổng kết tuần T38 (14–20/9)",
        "Ăn uống: 580.000 ₫ / 625.000 ₫",
        "Đi lại: 310.000 ₫ / 300.000 ₫",
        "🏆 Top 5 danh mục tiêu nhiều nhất:",
        "1. Đi chợ / nấu ăn — 450.000 ₫",
        "2. Xăng xe / gửi xe — 300.000 ₫",
      ].join("\n"),
    );
  });

  it("tuần không có dữ liệu chi tiêu: vẫn có tiêu đề, kèm câu trạng thái rỗng", () => {
    const { full, push } = weeklyMessage({ weekLabel: "T1 (29/12–4/1)", envelopes: [], topCategories: [], totalSpent: 0 });
    expect(full).toBe(["📊 Tổng kết tuần T1 (29/12–4/1)", "Không có dữ liệu chi tiêu tuần này."].join("\n"));
    expect(push).toEqual({ title: "Tuần T1: chi 0 ₫", body: "Không có dữ liệu chi tiêu tuần này." });
  });

  it("bản ngắn: tiêu đề tổng chi tuần; ví ≥ 80% dự kiến lên đầu (sắp % giảm dần), rồi danh mục tiêu nhiều nhất, rồi ví còn lại", () => {
    const push = weeklyMessage({
      weekLabel: "T40 (28/9–4/10)",
      envelopes: [
        { name: "Chơi (chồng)", spent: 50_000, target: 820_000 },
        { name: "Ăn uống", spent: 540_000, target: 625_000 },
        { name: "Đi lại", spent: 310_000, target: 300_000 },
      ],
      topCategories: [{ name: "Đi chợ / nấu ăn", spent: 450_000 }],
      totalSpent: 2_345_000,
    }).push;
    expect(push).toEqual({
      title: "Tuần T40: chi 2.345.000 ₫",
      body: "Đi lại 310.000/300.000 ₫ · Ăn uống 540.000/625.000 ₫ · tiêu nhiều nhất Đi chợ / nấu ăn 450.000 ₫ · Chơi (chồng) 50.000/820.000 ₫",
    });
  });

  it("bản ngắn: tổng chi dài thì tiêu đề bỏ chữ Tuần, vẫn ≤ 25; nhiều ví thì nội dung ≤ 150, kết thúc bằng …", () => {
    const { push } = weeklyMessage({
      weekLabel: "T40 (28/9–4/10)",
      envelopes: Array.from({ length: 8 }, (_, i) => ({ name: `Phong bì số ${i + 1}`, spent: 900_000 - i * 100_000, target: 1_000_000 })),
      topCategories: [{ name: "Nhà", spent: 12_345_000 }],
      totalSpent: 12_345_000,
    });
    expect(push.title).toBe("T40: chi 12.345.000 ₫");
    expect(Array.from(push.body).length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(push.body).toMatch(/^Phong bì số 1 900\.000\/1\.000\.000 ₫ · Phong bì số 2 800\.000\/1\.000\.000 ₫ · .* …$/);
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
});

describe("dòng giao dịch ngân hàng không đọc được", () => {
  it("hiện khi có, và không hiện khi không có", async () => {
    const { dailyMessage } = await import("../src/notify/format");
    const base = {
      spendableThisWeek: 1_000_000, daysLeftInWeek: 3, atRisk: [], unassignedCount: 0, goals: [], safetyFundMonthsCovered: null,
      safetyFundMonthsTarget: 6, driftAccounts: [], transferOrdersOverdue: 0, pairedTransfersYesterday: 0, backfillAddedLastNight: 0,
      monthClose: null, incomeReminder: null, cashCountReminder: [],
    };
    expect(dailyMessage({ ...base, unreadableBankTransactions: 2 }).full.split("\n")).toContain("❗ 2 giao dịch ngân hàng cần xem tay");
    expect(dailyMessage({ ...base, unreadableBankTransactions: 0 }).full).not.toContain("cần xem tay");
  });
});

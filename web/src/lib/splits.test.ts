import { describe, expect, it } from "vitest";
import { formatVnd } from "./money";
import { ASSIGN_CHOICES, assignBody, assignToast, counterpartAccounts, hiddenLogsLine, interestToast, linkToast, logChip, manualMatchLabel, validateSplits, type AssignChoice, type AssignRow, type SplitMeaning } from "./splits";
import type { AccountRef } from "./types";

describe("tách log: tổng phải khớp số tiền log", () => {
  it("khớp đúng thì cho gán", () => {
    const r = validateSplits(250_000, [
      { meaning: "spend", amount: 180_000, category_id: "groceries" },
      { meaning: "spend", amount: 70_000, category_id: "hangouts" },
    ]);
    expect(r).toEqual({ ok: true, sum: 250_000, diff: 0, message: null });
  });

  it("thiếu thì chặn và nói thiếu bao nhiêu", () => {
    const r = validateSplits(250_000, [{ meaning: "spend", amount: 200_000, category_id: "food" }]);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(50_000);
    expect(r.message).toBe("Còn thiếu 50.000 ₫ so với log.");
  });

  it("thừa thì chặn", () => {
    const r = validateSplits(100_000, [
      { meaning: "spend", amount: 80_000, category_id: "food" },
      { meaning: "spend", amount: 30_000, category_id: "food" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(-10_000);
    expect(r.message).toContain("Thừa 10.000");
  });

  it("mỗi dòng phải đủ thông tin theo loại", () => {
    expect(validateSplits(10, []).message).toBe("Cần ít nhất một dòng.");
    expect(validateSplits(10, [{ meaning: "spend", amount: 0, category_id: "a" }]).message).toBe("Dòng 1 chưa có số tiền.");
    expect(validateSplits(10, [{ meaning: "spend", amount: 10 }]).message).toContain("cần danh mục");
    expect(validateSplits(10, [{ meaning: "transfer", amount: 10 }]).message).toContain("tài khoản đầu kia");
    expect(validateSplits(10, [{ meaning: "buy_asset", amount: 10 }]).message).toContain("loại tài sản");
    expect(validateSplits(10, [{ meaning: "spend", amount: 2.5, category_id: "a" }]).ok).toBe(false);
  });

  it("rút tiền mặt: một dòng chuyển nội bộ đủ số", () => {
    expect(validateSplits(2_000_000, [{ meaning: "transfer", amount: 2_000_000, other_account_id: "cash-husband" }]).ok).toBe(true);
  });
});

describe("toast sau khi gán: kết quả kèm hệ quả", () => {
  const none = { label: "", nearSpend: null };

  it("UC-706 AC-17: một dòng chi → số tiền, danh mục, Vận hành còn bao nhiêu; chưa tải lại được số → chỉ kết quả", () => {
    expect(assignToast([{ meaning: "spend", amount: 45_000, category_id: "eating-out" }], { label: "Ăn ngoài", nearSpend: { amount: 4_055_000, perDay: 139_000 } })).toBe(
      `Đã gán ${formatVnd(45_000)} Ăn ngoài · Vận hành còn ${formatVnd(4_055_000)} ≈ 139.000/ngày`,
    );
    expect(assignToast([{ meaning: "spend", amount: 45_000, category_id: "eating-out" }], { ...none, label: "Ăn ngoài" })).toBe(`Đã gán ${formatVnd(45_000)} Ăn ngoài.`);
  });

  it("chuyển nội bộ và tách nhiều dòng", () => {
    expect(assignToast([{ meaning: "transfer", amount: 2_000_000, other_account_id: "cash" }], none)).toBe(`Đã gán chuyển nội bộ ${formatVnd(2_000_000)}.`);
    const two = [
      { meaning: "spend" as const, amount: 180_000, category_id: "cho" },
      { meaning: "spend" as const, amount: 70_000, category_id: "tap" },
    ];
    expect(assignToast(two, none)).toBe("Đã gán 2 dòng.");
  });

  it("UC-706 AC-33: gán lương mở kỳ → toast có 'Kỳ lương mới từ 10/11 · 5 việc'; không chữ 'chia', 'lệnh chuyển'", () => {
    const income = [{ meaning: "income" as const, amount: 20_000_000 }];
    const t = assignToast(income, { ...none, effects: { cycle: { opened: true, startedAt: "2026-11-10T01:00:00Z", payday: "2026-11-10", tasks: 5 }, tasksDone: [] } });
    expect(t).toBe(`Đã gán ${formatVnd(20_000_000)} · Kỳ lương mới từ 10/11 · 5 việc`);
    expect(assignToast(income, { ...none, effects: { cycle: null, tasksDone: [] } })).toBe(`Đã gán thu nhập ${formatVnd(20_000_000)}.`);
    expect(t).not.toMatch(/chia|lệnh chuyển/);
  });

  it("UC-706 AC-34: gán chuyển nội bộ sang tài khoản tích luỹ làm xong ① → 'Đã ghi · Trích Tích luỹ ✓'", () => {
    expect(assignToast([{ meaning: "transfer", amount: 2_000_000, other_account_id: "wealth" }], { ...none, effects: { cycle: null, tasksDone: [{ id: 11, kind: "savings" }] } })).toBe("Đã ghi · Trích Tích luỹ ✓");
  });
});

describe("thân yêu cầu Gán (UC-706)", () => {
  const row = (r: Omit<AssignRow, "key">): AssignRow => ({ key: 1, ...r });

  it("UC-706 AC-33: thu nhập nguồn Lương, công tắc bật → split có opens_cycle true, nguồn; không trường ví, không transfer_order_id", () => {
    const body = assignBody([row({ meaning: "income", amount: 20_000_000, income_stream_id: "salary-husband", opens_cycle: true, taxable: false, category_id: null })], false);
    expect(body).toEqual({ splits: [{ meaning: "income", amount: 20_000_000, taxable: false, income_stream_id: "salary-husband", opens_cycle: true }], create_rule: false });
    expect(JSON.stringify(body)).not.toMatch(/wallet|transfer_order_id|allocate|wealth_move/);
    // tiền người thuê: không gửi opens_cycle
    expect(assignBody([row({ meaning: "income", amount: 4_000_000, tenantMode: true, tenant_id: "t1", opens_cycle: false })], false).splits[0]).toEqual({ meaning: "income", amount: 4_000_000, taxable: false, tenant_id: "t1" });
  });

  it("UC-706 AC-31: lãi tiền gửi → một dòng income interest, không ví", () => {
    expect(assignBody([row({ meaning: "income", amount: 37, interestMode: true })], false)).toEqual({ splits: [{ meaning: "income", amount: 37, interest: true }], create_rule: false });
    expect(interestToast(37)).toBe(`Đã ghi lãi ${formatVnd(37)}`);
  });

  it("UC-706 AC-36: log chờ của tài khoản riêng tư bị giấu → '1 khoản của tài khoản riêng tư'; 0 / thiếu → không dòng", () => {
    expect(hiddenLogsLine(1)).toBe("1 khoản của tài khoản riêng tư");
    expect(hiddenLogsLine(0)).toBeNull();
    expect(hiddenLogsLine(undefined)).toBeNull();
  });
});

describe("Gán lãi tiền gửi (261018-lai-tien-gui)", () => {
  const label = () => "chưa có luật";
  it("UC-706: log có gợi ý lãi → chip xanh 'gợi ý: Lãi tiền gửi', sau 'có thể trùng', thay 'tiền vào — phải hỏi'", () => {
    const lai = { meaning: "income", interest: true, label: "Lãi tiền gửi" };
    expect(logChip({ direction: "in", suggestion: lai }, label)).toEqual({ cls: "chip ok", text: "gợi ý: Lãi tiền gửi" });
    expect(logChip({ direction: "in", suggestion: null }, label)).toEqual({ cls: "chip warn", text: "tiền vào — phải hỏi" });
    expect(logChip({ direction: "in", suggestion: { possible_duplicate_of: "x", label: "Có thể trùng" } }, label)).toEqual({ cls: "chip warn", text: "có thể trùng — xem trước khi gán" });
  });

  it("UC-706 AC-33: loại Lãi tiền gửi có ở tiền vào, không có ở tiền ra; mọi dòng giải thích không có chữ 'ví', 'chia'", () => {
    expect(ASSIGN_CHOICES.in.find((c) => c.value === "interest")?.label).toBe("Lãi tiền gửi");
    expect(ASSIGN_CHOICES.out.some((c) => c.value === "interest")).toBe(false);
    for (const c of [...ASSIGN_CHOICES.in, ...ASSIGN_CHOICES.out]) expect(c.hint).not.toMatch(/(^|\s)ví[\s.,]|chia|lệnh chuyển/i);
  });
});

describe("chữ nhắc dưới hàng chip 'Gán thành'", () => {
  it("mỗi loại của mỗi chiều có đúng một dòng giải thích riêng; tiền vào có Thu từ người thuê", () => {
    const meanings: Record<"in" | "out", AssignChoice[]> = {
      in: ["income", "interest", "tenant", "refund", "collect", "transfer"],
      out: ["spend", "transfer", "lend", "buy_asset"],
    };
    for (const dir of ["in", "out"] as const) {
      const choices = ASSIGN_CHOICES[dir];
      expect(choices.map((c) => c.value)).toEqual(meanings[dir]);
      for (const c of choices) expect(c.hint.trim()).not.toBe("");
      expect(new Set(choices.map((c) => c.hint)).size).toBe(choices.length);
    }
  });

  it("mua hộ người khác (nhà mình không có phần) là Cho vay, chia bill có phần mình là Chi tiêu + Hoàn tiền; trả dư tách Thu nhập (ADR-84)", () => {
    const hint = (dir: "in" | "out", v: SplitMeaning) => ASSIGN_CHOICES[dir].find((c) => c.value === v)!.hint;
    expect(hint("out", "lend")).toMatch(/mua hộ \/ trả hộ người khác \(nhà mình không có phần\)/);
    expect(hint("in", "collect")).toMatch(/mua hộ/);
    expect(hint("in", "collect")).toMatch(/Trả dư thì Tách thêm dòng Thu nhập/);
    for (const [dir, v] of [["out", "spend"], ["in", "refund"]] as const) {
      expect(hint(dir, v)).toMatch(/bill/);
      expect(hint(dir, v)).not.toMatch(/mua hộ/i);
    }
  });
});

describe("Gán: nối vào khoản đã nhập tay", () => {
  it("UC-305 AC-27: dòng 'Đã nhập tay?' nói giờ VN, danh mục (hoặc loại) và ghi chú; toast nói không ghi thêm", () => {
    const m = { id: 7, at: "2026-10-15T15:20:00.000Z", amount: 500_000, meaning: "spend", category_id: "groceries", note: "đi chợ" };
    expect(manualMatchLabel(m, "Đi chợ")).toBe("15/10 22:20 · Đi chợ · đi chợ");
    expect(manualMatchLabel({ ...m, meaning: "income", category_id: null, note: null }, null)).toBe("15/10 22:20 · Thu nhập");
    expect(linkToast(500_000)).toBe(`Đã nối ${formatVnd(500_000)} vào khoản đã nhập tay — không ghi thêm.`);
  });
});

describe("Gán chuyển khoản: tài khoản đầu kia", () => {
  const acct = (id: string, ownerMemberId: string, hiddenFromMe = false): AccountRef => ({
    id,
    name: id,
    pocket: "operating",
    kind: id.startsWith("cash") ? "cash" : "bank",
    ownerMemberId,
    sepayEnabled: id.startsWith("vcb"),
    sepayOut: false,
    openedAt: null,
    feedFrom: null,
    sepayOutFrom: null,
    private: ownerMemberId === "wife",
    hiddenFromMe,
  });

  it("UC-706 AC-37: bootstrap của chồng (hộ mẫu P), gán L2 (VCB (chính)) thành Chuyển khoản → ô tài khoản đầu kia không có VCB (vợ), Tiền mặt (vợ); bootstrap của vợ → có", () => {
    const view = (hidden: boolean) => [acct("vcb-husband", "husband"), acct("cash-husband", "husband"), acct("mb-husband", "husband"), acct("vcb-wife", "wife", hidden), acct("cash-wife", "wife", hidden)];
    expect(counterpartAccounts(view(true), "vcb-husband").map((a) => a.id)).toEqual(["cash-husband", "mb-husband"]);
    expect(counterpartAccounts(view(false), "vcb-husband").map((a) => a.id)).toEqual(["cash-husband", "mb-husband", "vcb-wife", "cash-wife"]);
  });
});



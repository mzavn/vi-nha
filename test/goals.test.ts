// `GET /v1/goals` đọc ngăn (ledger UC-107, MODIFIED Đợt D): cùng số `snapshot.pockets`, không còn trường theo ví.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AT, client, householdC } from "./helpers/household-c";
import { householdParent, PARENT_NOW, parentTx } from "./helpers/household-parent";

let call: ReturnType<typeof client>;
const at = (vn: string) => vi.setSystemTime(new Date(AT(vn)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T07:00:00");
  call = client(householdC());
});
afterEach(() => vi.useRealTimers());

describe("Tích luỹ và Dự phòng: GET /v1/goals", () => {
  it("UC-107 AC-13: sau lương và chuyển Tích luỹ (UC-1206 AC-3) → savings.pct 10, đã trích 2.000.000 / 20.000.000; mục tiêu Học phí, Bảo dưỡng xe, Thuế bằng snapshot; không trường ví", async () => {
    await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "main", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") });
    at("2026-11-10T10:00:00");
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 2_600_000, account_id: "main", to_account_id: "savings", at: AT("2026-11-10T10:00:00") });
    const g = (await call("GET", "/v1/goals")).json.data;
    const s = (await call("GET", "/v1/snapshot")).json.data;
    expect(g.savings).toEqual({ total: s.pockets.savings.total, change: s.pockets.savings.change, pct: 10, savingsDone: { amount: 2_000_000, base: 20_000_000, pct: 10, level: "10to30" } });
    expect(g.reserve.goals.map((x: { name: string }) => x.name)).toEqual(["Học phí", "Bảo dưỡng xe", "Thuế"]);
    expect(g.reserve.goals.map((x: { held: number }) => x.held)).toEqual(s.pockets.reserve.goals.map((x: { held: number }) => x.held));
    expect(g.reserve.goals[0]).toMatchObject({ target: 6_000_000, targetPct: null, monthlyAmount: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15" });
    expect(g.reserve.goals[2]).toMatchObject({ target: null, targetPct: 10 });
    expect([g.reserve.total, g.reserve.peace, g.reserve.peaceMonths, g.shortDebt]).toEqual([s.pockets.reserve.total, s.pockets.reserve.peace, s.pockets.reserve.peaceMonths, s.pockets.shortDebt]);
    expect(JSON.stringify(g)).not.toMatch(/wealthBuilding|safetyFund|walletId/);
  });
});

describe("GET /v1/goals có tiền lãi của nhóm và mục tiêu trả từ tiền chi tiêu (ledger UC-107, ADR-140, ADR-141)", () => {
  it("UC-107 AC-15: sau đáo hạn (lãi 3.000.000) và các khoản chi của UC-1209 AC-18 → Nhà ở / Học tập / Tập luyện với nhóm interest 3.000.000; bốn mục tiêu trả từ tiền chi tiêu với remaining như AC-18", async () => {
    vi.setSystemTime(PARENT_NOW);
    const raw = householdParent({ operatingGoals: true });
    parentTx(raw, { at: "2026-11-19 09:00", meaning: "income", amount: 3_000_000, to: "gui-6-thang", interest: true });
    parentTx(raw, { at: "2026-11-19 09:10", meaning: "transfer", amount: 103_000_000, from: "gui-6-thang", to: "tk-tiet-kiem" });
    raw.exec("UPDATE accounts SET active = 0, deactivated_at = '2026-11-19' WHERE id = 'gui-6-thang'");
    parentTx(raw, { at: "2026-11-19 10:00", meaning: "spend", amount: 1_000_000, from: "tk-chi-tieu-vo", goal: "dien-nuoc" });
    parentTx(raw, { at: "2026-11-19 10:05", meaning: "spend", amount: 300_000, from: "cash-husband", goal: "thuoc" });
    parentTx(raw, { at: "2026-11-19 10:10", meaning: "spend", amount: 200_000, from: "tk-chi-tieu-chong" });
    const g = (await client(raw)("GET", "/v1/goals")).json.data;
    expect(g.reserve.goals.map((x: { id: string; held: number }) => [x.id, x.held])).toEqual([
      ["nha-o", 60_000_000],
      ["hoc-tap", 30_000_000],
      ["tap-luyen", 15_000_000],
    ]);
    expect(g.reserve.groups).toEqual([expect.objectContaining({ accountId: "tk-tiet-kiem", balance: 108_000_000, interest: 3_000_000, goalIds: ["nha-o", "hoc-tap", "tap-luyen"] })]);
    expect(g.operating).toEqual({
      goals: [
        { id: "dien-nuoc", name: "Điện nước", monthly: 2_000_000, monthAmount: null, note: null, categoryIds: [], spent: 1_000_000, remaining: 1_000_000 },
        { id: "thuoc", name: "Thuốc", monthly: 500_000, monthAmount: null, note: null, categoryIds: [], spent: 300_000, remaining: 200_000 },
        { id: "thien-phuoc", name: "Thiện phước", monthly: 1_000_000, monthAmount: null, note: null, categoryIds: [], spent: 0, remaining: 1_000_000 },
        { id: "ve-que", name: "Về quê", monthly: 1_000_000, monthAmount: null, note: null, categoryIds: [], spent: 0, remaining: 1_000_000 },
      ],
      remaining: 3_200_000,
    });
  });
});

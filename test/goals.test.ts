// `GET /v1/goals` đọc ngăn (ledger UC-107, MODIFIED Đợt D): cùng số `snapshot.pockets`, không còn trường theo ví.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AT, client, householdC } from "./helpers/household-c";

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
    expect(g.savings).toEqual({ total: s.pockets.savings.total, change: s.pockets.savings.change, pct: 10, savingsDone: { amount: 2_000_000, base: 20_000_000, pct: 10 } });
    expect(g.reserve.goals.map((x: { name: string }) => x.name)).toEqual(["Học phí", "Bảo dưỡng xe", "Thuế"]);
    expect(g.reserve.goals.map((x: { held: number }) => x.held)).toEqual(s.pockets.reserve.goals.map((x: { held: number }) => x.held));
    expect(g.reserve.goals[0]).toMatchObject({ target: 6_000_000, targetPct: null, monthlyAmount: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15" });
    expect(g.reserve.goals[2]).toMatchObject({ target: null, targetPct: 10 });
    expect([g.reserve.total, g.reserve.peace, g.reserve.peaceMonths, g.shortDebt]).toEqual([s.pockets.reserve.total, s.pockets.reserve.peace, s.pockets.reserve.peaceMonths, s.pockets.shortDebt]);
    expect(JSON.stringify(g)).not.toMatch(/wealthBuilding|safetyFund|walletId/);
  });
});

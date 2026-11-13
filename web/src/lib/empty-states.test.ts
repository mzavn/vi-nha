import { describe, expect, it } from "vitest";
import { EMPTY_STATES, type EmptyStateKey } from "./empty-states";

describe("trạng thái rỗng có hướng dẫn (UC-711 AC-37)", () => {
  const REQUIRED_KEYS: EmptyStateKey[] = [
    "ledgerMonth",
    "ledgerFilter",
    "assign",
    "recent",
    "pocketOperating",
    "pocketSavings",
    "pocketReserve",
    "pocketOther",
    "holdingAssets",
    "reserveGoals",
    "spending",
    "debtsIowe",
    "debtsOwedMe",
    "tenants",
    "reportSheet",
    "reportCashFlow",
    "reportIncome",
    "reportFreedom",
    "pendingQueue",
  ];

  it("UC-711 AC-37: đủ mọi danh sách rỗng", () => {
    for (const key of REQUIRED_KEYS) {
      expect(EMPTY_STATES[key], `Thiếu key ${key}`).toBeDefined();
    }
  });

  it("UC-711 AC-37: câu ≤ 140 ký tự, không chữ số, không xuống dòng, có dấu chấm câu", () => {
    for (const [key, state] of Object.entries(EMPTY_STATES)) {
      expect(state.title.length, `${key} title dài quá 140`).toBeLessThanOrEqual(140);
      expect(state.title, `${key} title chứa chữ số`).not.toMatch(/\d|\n/);
      expect(state.title.endsWith("."), `${key} title không kết thúc bằng dấu chấm`).toBe(true);

      if (state.hint) {
        expect(state.hint.length, `${key} hint dài quá 140`).toBeLessThanOrEqual(140);
        expect(state.hint, `${key} hint chứa chữ số`).not.toMatch(/\d|\n/);
        expect(state.hint.endsWith("."), `${key} hint không kết thúc bằng dấu chấm`).toBe(true);
      }

      if (state.action) {
        expect(state.action.label.length, `${key} action.label dài quá 140`).toBeLessThanOrEqual(140);
        expect(state.action.label, `${key} action.label chứa chữ số`).not.toMatch(/\d|\n/);
      }
    }
  });
});

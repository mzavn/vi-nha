import { describe, expect, it } from "vitest";
import { type FiConfig, fiConfigPayload, fiConfigSummary, fiConfigToForm } from "./settings";

// Mặc định của migration 0031.
const defaults: FiConfig = {
  fi_swr_bps: 350,
  fi_inflation_bps: 350,
  fi_fat_bps: 11000,
  fi_legacy_rate_bps: 300,
  fi_high_interest_bps: 1500,
  fi_safety_months: "6,12,24",
  fi_expense_monthly: null,
  fi_expense_must_monthly: null,
  fi_birth_year: null,
  fi_target_age_f1: null,
  fi_target_age_f2: null,
  fi_target_age_f3: null,
};

describe("Cài đặt › Tham số › Tài sản & tự do", () => {
  it("UC-507 AC-16: form đọc mặc định theo %, lưu lại đúng phần vạn; SWR 3% → 300", () => {
    const f = fiConfigToForm(defaults);
    expect(f).toMatchObject({ swr: "3,5", inflation: "3,5", fat: "110", legacy: "3", highInterest: "15", safetyMonths: "6, 12, 24", birthYear: "" });
    expect(fiConfigPayload(f, 2026)).toEqual({ ok: true, value: defaults });
    expect(fiConfigPayload({ ...f, swr: "3" }, 2026)).toMatchObject({ ok: true, value: { fi_swr_bps: 300 } });
    expect(fiConfigSummary(defaults)).toBe("SWR 3,5% · lạm phát 3,5% · lãi cao từ 15% · Mốc an tâm 6/12/24 tháng");
  });

  it("UC-507 AC-16: SWR 12% hay tuổi mục tiêu bằng tuổi hiện tại → lỗi tại ô, không gửi", () => {
    const f = fiConfigToForm(defaults);
    expect(fiConfigPayload({ ...f, swr: "12" }, 2026)).toMatchObject({ ok: false, errors: { swr: expect.any(String) } });
    expect(fiConfigPayload({ ...f, birthYear: "1990", f1: "36" }, 2026)).toMatchObject({ ok: false, errors: { f1: expect.any(String) } });
    expect(fiConfigPayload({ ...f, birthYear: "1990", f1: "45", f2: "50" }, 2026)).toMatchObject({ ok: true, value: { fi_birth_year: 1990, fi_target_age_f1: 45, fi_target_age_f2: 50, fi_target_age_f3: null } });
    expect(fiConfigPayload({ ...f, safetyMonths: "12, 6, 24" }, 2026)).toMatchObject({ ok: false, errors: { safetyMonths: expect.any(String) } });
    expect(fiConfigPayload({ ...f, fat: "90" }, 2026).ok).toBe(false);
    expect(fiConfigPayload({ ...f, birthYear: "2030" }, 2026).ok).toBe(false);
    expect(fiConfigPayload({ ...f, expense: 20_000_000, expenseMust: 15_000_000 }, 2026)).toMatchObject({ ok: true, value: { fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000 } });
  });
});

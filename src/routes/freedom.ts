import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { recordChange } from "../services/audit";
import { getFreedom } from "../services/freedom";
import * as plans from "../services/income-plans";

// Mốc tự do (UC-1103) và kế hoạch thu nhập năm (UC-1104), mount ở /v1 sau requireAuth:
//   GET /freedom · GET /income-plans · GET / PUT /income-plans/:year (mỗi lần lưu một bản mới, nhật ký income_plan.version).
export const freedomRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T) => c.json({ ok: true, data }, 200);

freedomRoutes.get("/freedom", async (c) => ok(c, await getFreedom(c.env.DB, new Date())));
freedomRoutes.get("/income-plans", async (c) => ok(c, await plans.listYears(c.env.DB, new Date())));
freedomRoutes.get("/income-plans/:year", async (c) => ok(c, await plans.getYear(c.env.DB, c.req.param("year"), new Date())));
freedomRoutes.put("/income-plans/:year", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  const year = await plans.saveYear(c.env.DB, c.req.param("year"), b as Record<string, unknown>, c.get("memberId"), new Date());
  await recordChange(c, "income_plan.version", `income_plan:${year.year}`, { id: year.current!.id, lines: year.current!.lines.length });
  return ok(c, year);
});

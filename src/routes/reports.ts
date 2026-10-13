import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { recordChange } from "../services/audit";
import * as reports from "../services/reports";

// Lưu chuyển tiền, Kết quả thu chi (BR-15, UC-1105, UC-1106), mount ở /v1 sau requireAuth:
//   GET /reports/cash-flow?period= · GET /reports/income-statement?period= · GET /reports/transactions?period=&line=
//   PUT / DELETE /transactions/:id/report-class — phân loại lại chỉ đổi báo cáo (nhật ký report_class.set | clear).
export const reportRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T) => c.json({ ok: true, data }, 200);
const txId = (c: Context<AppEnv>) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
  return id;
};

reportRoutes.get("/reports/cash-flow", async (c) => ok(c, await reports.getCashFlow(c.env.DB, c.req.query("period"), new Date())));
reportRoutes.get("/reports/income-statement", async (c) => ok(c, await reports.getIncomeStatement(c.env.DB, c.req.query("period"), new Date())));
reportRoutes.get("/reports/transactions", async (c) =>
  ok(c, await reports.reportTransactions(c.env.DB, c.req.query("period"), c.req.query("line"), new Date())),
);

reportRoutes.put("/transactions/:id/report-class", async (c) => {
  const id = txId(c);
  const b = (await c.req.json().catch(() => null)) as { class?: unknown } | null;
  const result = await reports.setReportClass(c.env.DB, id, b?.class, c.get("memberId"));
  await recordChange(c, "report_class.set", `tx:${id}`, { class: result.reportClass });
  return ok(c, result);
});
reportRoutes.delete("/transactions/:id/report-class", async (c) => {
  const id = txId(c);
  const result = await reports.clearReportClass(c.env.DB, id);
  await recordChange(c, "report_class.clear", `tx:${id}`, null);
  return ok(c, result);
});

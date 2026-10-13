import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { recordChange } from "../services/audit";
import * as balance from "../services/balance";

// Bảng cân đối (BR-15, UC-1101, UC-1102), mount ở /v1 sau requireAuth:
//   GET /balance-sheet?date= · GET /balance-sheet/history?months= · /balance-items, /balance-values, /balance-lots.
// Mỗi thao tác ghi một dòng nhật ký (ADR-90); không thao tác nào ghi giao dịch.
export const balanceRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}
const numId = (c: Context<AppEnv>) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
  return id;
};

balanceRoutes.get("/balance-sheet", async (c) => ok(c, await balance.getBalanceSheet(c.env.DB, c.req.query("date"), new Date())));
balanceRoutes.get("/balance-sheet/history", async (c) => ok(c, await balance.getBalanceHistory(c.env.DB, Number(c.req.query("months") ?? 12), new Date())));

balanceRoutes.post("/balance-items", async (c) => {
  const item = await balance.createItem(c.env.DB, await body(c), c.get("memberId"), new Date());
  await recordChange(c, "balance.item.create", `balance_item:${item.id}`, null);
  return ok(c, item, 201);
});
balanceRoutes.patch("/balance-items/:id", async (c) => {
  const b = await body(c);
  const item = await balance.updateItem(c.env.DB, c.req.param("id"), b, new Date());
  await recordChange(c, "balance.item.update", `balance_item:${item.id}`, { fields: Object.keys(b).sort().slice(0, 20) });
  return ok(c, item);
});
balanceRoutes.delete("/balance-items/:id", async (c) => {
  const res = await balance.deleteItem(c.env.DB, c.req.param("id"));
  await recordChange(c, "balance.item.delete", `balance_item:${res.id}`, null);
  return ok(c, res);
});
balanceRoutes.post("/balance-items/:id/values", async (c) => {
  const item = await balance.addValue(c.env.DB, c.req.param("id"), await body(c), c.get("memberId"), new Date());
  await recordChange(c, "balance.value.add", `balance_item:${item.id}`, null);
  return ok(c, item, 201);
});
balanceRoutes.post("/balance-values/:id/void", async (c) => {
  const id = numId(c);
  const item = await balance.voidValue(c.env.DB, id, new Date());
  await recordChange(c, "balance.value.void", `balance_value:${id}`, null);
  return ok(c, item);
});
balanceRoutes.post("/balance-items/:id/lots", async (c) => {
  const item = await balance.addLot(c.env.DB, c.req.param("id"), await body(c), c.get("memberId"), new Date());
  await recordChange(c, "balance.lot.add", `balance_item:${item.id}`, null);
  return ok(c, item, 201);
});
balanceRoutes.patch("/balance-lots/:id", async (c) => {
  const id = numId(c);
  const item = await balance.updateLotTargets(c.env.DB, id, await body(c), new Date());
  await recordChange(c, "balance.lot.targets", `balance_lot:${id}`, null);
  return ok(c, item);
});
balanceRoutes.post("/balance-lots/:id/sell", async (c) => {
  const id = numId(c);
  const item = await balance.sellLot(c.env.DB, id, await body(c), new Date());
  await recordChange(c, "balance.lot.sell", `balance_lot:${id}`, null);
  return ok(c, item);
});
balanceRoutes.post("/balance-lots/:id/void", async (c) => {
  const id = numId(c);
  const item = await balance.voidLot(c.env.DB, id, new Date());
  await recordChange(c, "balance.lot.void", `balance_lot:${id}`, null);
  return ok(c, item);
});

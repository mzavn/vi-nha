import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { actorOf } from "../services/audit";
import * as rental from "../services/rental";

// /v1/rental — sổ người thuê và bản tính tháng (rental UC-801, UC-806, UC-807). Mount sau requireAuth.
export const rentalRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

function intParam(c: Context<AppEnv>): number {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
  return id;
}

rentalRoutes.get("/", async (c) => ok(c, await rental.getRental(c.env.DB, new Date())));
rentalRoutes.patch("/config", async (c) => ok(c, await rental.updateRentalConfig(c.env.DB, await body(c))));

rentalRoutes.post("/tenants", async (c) => ok(c, await rental.createTenant(c.env.DB, await body(c), new Date()), 201));
rentalRoutes.patch("/tenants/:id", async (c) => ok(c, await rental.updateTenant(c.env.DB, c.req.param("id"), await body(c), new Date())));

rentalRoutes.post("/tenants/:id/bills", async (c) => {
  const { view, created } = await rental.createBill(c.env.DB, c.req.param("id"), await body(c), actorOf(c), new Date());
  return ok(c, view, created ? 201 : 200);
});
rentalRoutes.get("/tenants/:id/bills/:month", async (c) =>
  ok(c, await rental.getBill(c.env.DB, c.req.param("id"), c.req.param("month"), c.get("memberId"), new Date())),
);
rentalRoutes.put("/bills/:id", async (c) => ok(c, await rental.saveBill(c.env.DB, intParam(c), await body(c), actorOf(c), new Date())));
rentalRoutes.post("/bills/:id/issue", async (c) => ok(c, await rental.issueBill(c.env.DB, intParam(c), await body(c), actorOf(c), new Date())));
rentalRoutes.delete("/bills/:id", async (c) => ok(c, await rental.deleteBill(c.env.DB, intParam(c), actorOf(c))));

// Mô hình phí cố định / dòng tay / chốt tháng đã bỏ ở v2.2 (QĐ12): trả lỗi rõ, không ghi gì.
const gone = (c: Context<AppEnv>) =>
  c.json({ ok: false, error: { code: "model_changed", message: "Ví nhà v2.2 bỏ phí cố định, dòng tay và chốt tháng: dùng bản tính `…/bills`." } }, 410);
for (const path of ["/tenants/:id/fees", "/fees/*", "/tenants/:id/lines", "/lines/*", "/tenants/:id/settle", "/tenants/:id/month"]) rentalRoutes.all(path, gone);

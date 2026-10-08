import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import * as rental from "../services/rental";

// /v1/rental — sổ người thuê (UC-801…805). Mount sau requireAuth.
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

rentalRoutes.get("/", async (c) => ok(c, await rental.getRental(c.env.DB)));
rentalRoutes.patch("/config", async (c) => ok(c, await rental.updateRentalConfig(c.env.DB, await body(c))));

rentalRoutes.post("/tenants", async (c) => ok(c, await rental.createTenant(c.env.DB, await body(c), new Date()), 201));
rentalRoutes.patch("/tenants/:id", async (c) => ok(c, await rental.updateTenant(c.env.DB, c.req.param("id"), await body(c))));

rentalRoutes.post("/tenants/:id/fees", async (c) => ok(c, await rental.addFee(c.env.DB, c.req.param("id"), await body(c)), 201));
rentalRoutes.patch("/fees/:id", async (c) => ok(c, await rental.updateFee(c.env.DB, intParam(c), await body(c))));

rentalRoutes.post("/tenants/:id/lines", async (c) => {
  const { line, duplicate } = await rental.addLine(c.env.DB, c.req.param("id"), await body(c), new Date());
  return ok(c, line, duplicate ? 200 : 201);
});
rentalRoutes.post("/lines/:id/void", async (c) => ok(c, await rental.voidLine(c.env.DB, intParam(c))));

rentalRoutes.get("/tenants/:id/month", async (c) => ok(c, await rental.tenantMonth(c.env.DB, c.req.param("id"), c.req.query("month"), new Date())));
rentalRoutes.post("/tenants/:id/settle", async (c) => ok(c, await rental.settleMonth(c.env.DB, c.req.param("id"), await body(c), new Date()), 201));

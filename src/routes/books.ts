import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import * as debts from "../services/debts";
import * as receivables from "../services/receivables";

// Sổ đối ứng ngoài sổ cái, mount ở /v1 sau requireAuth:
//   /v1/debts, /v1/debt-lines — sổ nợ (UC-901…904)
//   /v1/receivables, /v1/receivable-lines — sổ phải thu (UC-1001…1004)
export const bookRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

type Input = Record<string, unknown>;
interface BookService {
  list(db: D1Database): Promise<unknown>;
  create(db: D1Database, b: Input, now: Date): Promise<unknown>;
  update(db: D1Database, id: string, b: Input): Promise<unknown>;
  addLine(db: D1Database, id: string, b: Input, now: Date): Promise<unknown>;
  voidLine(db: D1Database, id: number): Promise<unknown>;
}

/** Cùng một bộ đường dẫn cho mọi sổ đối ứng: GET/POST /<path>, PATCH /<path>/:id, POST /<path>/:id/lines, POST /<linePath>/:id/void. */
function mount(path: string, linePath: string, svc: BookService) {
  bookRoutes.get(`/${path}`, async (c) => ok(c, await svc.list(c.env.DB)));
  bookRoutes.post(`/${path}`, async (c) => ok(c, await svc.create(c.env.DB, await body(c), new Date()), 201));
  bookRoutes.patch(`/${path}/:id`, async (c) => ok(c, await svc.update(c.env.DB, c.req.param("id"), await body(c))));
  bookRoutes.post(`/${path}/:id/lines`, async (c) => ok(c, await svc.addLine(c.env.DB, c.req.param("id"), await body(c), new Date()), 201));
  bookRoutes.post(`/${linePath}/:id/void`, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
    return ok(c, await svc.voidLine(c.env.DB, id));
  });
}

mount("debts", "debt-lines", {
  list: debts.getDebts,
  create: debts.createDebt,
  update: debts.updateDebt,
  addLine: debts.addDebtLine,
  voidLine: debts.voidDebtLine,
});
mount("receivables", "receivable-lines", {
  list: receivables.getReceivables,
  create: receivables.createReceivable,
  update: receivables.updateReceivable,
  addLine: receivables.addReceivableLine,
  voidLine: receivables.voidReceivableLine,
});

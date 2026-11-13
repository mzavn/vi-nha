// Màn chuyển đổi một lần sang ba ngăn (pocket UC-1208, ADR-130): trạng thái ở server — `config.conversion_state` và mỗi bước
// đã xong một dòng `conversion_claims` (khoá chính `step`). Mỗi bước đổi dữ liệu bằng API sẵn có; ở đây chỉ kiểm điều kiện
// rồi ghi "bước này xong" trong MỘT batch có câu đầu là INSERT claim — yêu cầu thứ hai cùng bước làm cả batch huỷ.

import type { ConversionProgress } from "../domain/snapshot";
import { DomainError } from "../domain/types";

export const CONVERSION_STEPS = ["pockets", "goals", "savings_gap", "salary", "savings_pct"] as const;
export type ConversionStep = (typeof CONVERSION_STEPS)[number];

/** Bước kế tiếp = bước đầu tiên chưa có claim; null khi đủ 5. */
export const nextStep = (steps: readonly string[]): ConversionStep | null => CONVERSION_STEPS.find((s) => !steps.includes(s)) ?? null;

/** Các bước đã xong theo đúng thứ tự màn. */
const ordered = (steps: readonly string[]): ConversionStep[] => CONVERSION_STEPS.filter((s) => steps.includes(s));

/** `snapshot.conversion` / MCP `get_snapshot`: chỉ khi trạng thái `pending`; không có khoá / đã xong → null. */
export function conversionProgress(state: string | null, steps: readonly string[]): ConversionProgress | null {
  const next = nextStep(steps);
  return state === "pending" && next !== null ? { done: ordered(steps).length, total: 5, next } : null;
}

export interface SavingsGap {
  /** Số ví Tích sản cũ đóng băng ở 0040 (tiền, không gồm tài sản đã mua). */
  legacyCash: number;
  legacyAssets: number;
  /** = `pockets.savings.total`. */
  realSavings: number;
  /** realSavings − legacyCash. */
  diff: number;
  hasSavingsAccount: boolean;
}

export interface ConversionView {
  state: "pending" | "done" | null;
  steps: ConversionStep[];
  next: ConversionStep | null;
  /** null khi không có khoá `legacy_savings_cash` (D1 trống, nhà thiết lập bằng v2). */
  savingsGap: SavingsGap | null;
}

/** `GET /v1/conversion`. Tích luỹ thật = Σ sổ các tài khoản đang dùng ngăn Tích luỹ — đúng luật `pockets.savings.total`. */
export async function getConversion(db: D1Database): Promise<ConversionView> {
  const [config, claims, savings] = await db.batch([
    db.prepare("SELECT k, v FROM config WHERE k IN ('conversion_state', 'legacy_savings_cash', 'legacy_savings_assets')"),
    db.prepare("SELECT step FROM conversion_claims"),
    db.prepare(
      `SELECT COALESCE(SUM(b.book_balance), 0) AS total, COUNT(*) AS n
       FROM v_account_book b JOIN accounts a ON a.id = b.account_id WHERE a.pocket = 'savings'`,
    ),
  ]);
  const cfg = new Map(((config!.results ?? []) as { k: string; v: string }[]).map((r) => [r.k, r.v]));
  const steps = ordered(((claims!.results ?? []) as { step: string }[]).map((r) => r.step));
  const state = cfg.get("conversion_state");
  const real = ((savings!.results ?? [])[0] ?? { total: 0, n: 0 }) as { total: number; n: number };
  const legacyCash = cfg.get("legacy_savings_cash");
  const realSavings = Number(real.total);
  return {
    state: state === "pending" || state === "done" ? state : null,
    steps,
    next: nextStep(steps),
    savingsGap:
      legacyCash === undefined
        ? null
        : {
            legacyCash: Number(legacyCash),
            legacyAssets: Number(cfg.get("legacy_savings_assets") ?? 0),
            realSavings,
            diff: realSavings - Number(legacyCash),
            hasSavingsAccount: Number(real.n) > 0,
          },
  };
}

export interface StepResult {
  view: ConversionView;
  /** Chi tiết cho nhật ký `conversion.step`. */
  detail: { step: ConversionStep; no_salary?: true };
  /** Bước cuối vừa xong → nhật ký `conversion.done`. */
  done: boolean;
}

const conflict = (code: string, message: string): never => {
  throw new DomainError(code, message, 409);
};

/**
 * `POST /v1/conversion/steps/:step`. Kiểm thân (400), trạng thái và thứ tự (409), điều kiện của bước (409
 * `step_incomplete`), rồi một batch: claim trước, việc kèm theo sau (bước 5: `savings_pct`, `conversion_state` = done,
 * `conversion_done_at`). Batch lỗi → đọc lại claim: bước đã có claim (máy khác vừa làm) → 409 `step_order`; không có → lỗi
 * ném tiếp, không đoán theo chữ của lỗi (UC-1208 AC-10). Mọi lỗi: không ghi gì.
 */
export async function claimStep(db: D1Database, step: string, body: Record<string, unknown>, memberId: string | null, now: Date): Promise<StepResult> {
  if (!(CONVERSION_STEPS as readonly string[]).includes(step)) throw new DomainError("not_found", "Không có bước này.", 404);
  const s = step as ConversionStep;
  const noSalary = s === "salary" && body.no_salary === true;
  if (s === "salary" && body.no_salary !== undefined && typeof body.no_salary !== "boolean") {
    throw new DomainError("invalid_input", "no_salary phải là true / false.", 400, "no_salary");
  }
  const pct = s === "savings_pct" ? body.savings_pct : undefined;
  if (pct !== undefined && (typeof pct !== "number" || !Number.isInteger(pct) || pct < 1 || pct > 100)) {
    throw new DomainError("invalid_input", "% Tích luỹ trích từ lương là số nguyên từ 1 đến 100.", 400, "savings_pct");
  }

  const current = await getConversion(db);
  if (current.state !== "pending") conflict("conversion_not_pending", "Nhà mình không có việc chuyển sang ba ngăn nào đang dở.");
  if (current.next !== s) conflict("step_order", current.next ? "Bước này đã xong hoặc chưa tới lượt." : "Các bước đã xong.");

  if (s === "pockets") {
    const n = Number((await db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE active = 1 AND pocket_confirmed = 0").first<{ n: number }>())?.n ?? 0);
    if (n > 0) conflict("step_incomplete", `Còn ${n} tài khoản chưa xác nhận ngăn`);
  }
  if (s === "salary" && !noSalary) {
    const on = await db.prepare("SELECT 1 FROM income_streams WHERE active = 1 AND is_salary = 1 LIMIT 1").first();
    if (!on) conflict("step_incomplete", "Chưa có nguồn thu nào là \"Nguồn lương\": bật một nguồn hoặc chọn \"Nhà mình không có lương cố định\".");
  }

  const at = now.toISOString();
  const upsert = (k: string, v: string) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, v);
  const last = s === "savings_pct";
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO conversion_claims (step, at, by_member_id) VALUES (?, ?, ?)").bind(s, at, memberId),
    ...(last ? [...(pct !== undefined ? [upsert("savings_pct", String(pct))] : []), upsert("conversion_state", "done"), upsert("conversion_done_at", at)] : []),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    const claimed = await db.prepare("SELECT 1 FROM conversion_claims WHERE step = ?").bind(s).first();
    if (claimed) conflict("step_order", "Bước này vừa được làm xong ở máy khác.");
    throw err;
  }
  return { view: await getConversion(db), detail: noSalary ? { step: s, no_salary: true } : { step: s }, done: last };
}

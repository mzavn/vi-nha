// Dữ liệu cũ dưới mô hình mới (ADR-123, ADR-131): DB 1.42 dựng từ docs/schema.sql không còn ví, không chèn được dòng có
// loại chi cũ / fund / lần chia. Dựng DB như bản công khai ở v1.37 (baseline 0030 + 0031…0037), nạp hộ mẫu cũ có ví
// (test/helpers/legacy-household.sql), áp 0038, nạp dữ liệu cũ của test (ví, dòng có ví, fund, lần chia, lệnh chuyển, chốt
// tháng), rồi áp 0039…0044 — đúng đường một nhà đang dùng v1.x lên v2. Không tắt trigger. Chạy được ở cả repo gốc
// (baseline ở publish/migrations/) lẫn bản công khai (baseline ở migrations/).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { applyMigration, applyMigrations, asD1, readSql } from "./d1-sqlite";

const UPGRADE = ["0039_pay_cycles_no_wallets.sql", "0040_drop_wallet_model.sql", "0041_reward_goal_guard.sql", "0042_shared_goal_accounts.sql", "0043_tenant_bills.sql", "0044_parent_accounts_operating_goals.sql"] as const;

/** Baseline của bản công khai: repo gốc giữ ở publish/migrations/, bản công khai ở migrations/ (như test/baseline.test.ts). */
export const BASELINE_SQL = existsSync(join(dirname(fileURLToPath(import.meta.url)), "../../publish/migrations/0030_baseline.sql"))
  ? "publish/migrations/0030_baseline.sql"
  : "migrations/0030_baseline.sql";

/** DB trống như máy cài bản công khai, đã áp migration sau baseline tới trước `until`. */
function publicDb(until: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  db.exec(readSql(BASELINE_SQL));
  db.exec("COMMIT");
  applyMigrations(db, until, "0031");
  return db;
}

/** Hộ mẫu cũ có ví ở v1.38: DB trống tới 0037 + hộ mẫu (test/helpers/legacy-household.sql) + 0038. */
export function legacyHouseholdDb(): DatabaseSync {
  const db = publicDb("0038");
  db.exec("BEGIN");
  db.exec(readSql("test/helpers/legacy-household.sql"));
  db.exec("COMMIT");
  applyMigration(db, "0038_pockets.sql");
  return db;
}

/** Hộ mẫu cũ + dữ liệu cũ do `seed` nạp trước 0039, đã lên 1.42. */
export function openLegacyDb(seed: (db: DatabaseSync) => void): DatabaseSync {
  const db = legacyHouseholdDb();
  seed(db);
  for (const file of UPGRADE) applyMigration(db, file);
  return db;
}

/** Như `openLegacyDb` nhưng dừng ở 1.39 (đã áp 0039, chưa áp 0040) — test của chính 0040 tự áp. */
export function openPre0040Db(seed: (db: DatabaseSync) => void): DatabaseSync {
  const db = legacyHouseholdDb();
  seed(db);
  applyMigration(db, UPGRADE[0]);
  return db;
}

/**
 * DB trống ở v1.38 như máy cài bản công khai (baseline 0030 + 0031…0038, không hộ mẫu) — để nạp lịch sử có ví trước khi lên
 * v2. Đi cùng `upgradingD1`: lần đầu app chạm DB thì áp 0039…0044, đúng như một nhà cập nhật v2 với sổ cũ.
 */
export function legacyEmptyDb(): DatabaseSync {
  return publicDb("0039");
}

/** D1 của `db` áp migration 0039…0044 ngay trước câu đầu tiên app chạy (dữ liệu cũ test nạp trước đó vẫn mang ví). */
export function upgradingD1(db: DatabaseSync): D1Database {
  const d1 = asD1(db);
  let done = false;
  const upgrade = () => {
    if (!done) for (const file of UPGRADE) applyMigration(db, file);
    done = true;
  };
  return {
    ...d1,
    prepare: (sql: string) => (upgrade(), d1.prepare(sql)),
    batch: (stmts: D1PreparedStatement[]) => (upgrade(), d1.batch(stmts)),
  } as D1Database;
}

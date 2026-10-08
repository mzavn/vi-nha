import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const readSql = (path: string) => readFileSync(join(root, path), "utf8");

/** Chạy MỘT file migration bọc trong một transaction — như D1 remote (nên `PRAGMA defer_foreign_keys` có tác dụng tới COMMIT). */
export function applyMigration(db: DatabaseSync, file: string): void {
  db.exec("BEGIN");
  try {
    db.exec(readSql(`migrations/${file}`));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Chạy lần lượt các migration có tên trong [`from`, `until`) (mặc định: hết), mỗi file một transaction. Chỉ test/migrations/ và test schema dùng. */
export function applyMigrations(db: DatabaseSync, until = "9999", from = ""): void {
  const files = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => f >= from && f < until)) applyMigration(db, file);
}

/** DB trong bộ nhớ dựng từ chuỗi migration (bật khoá ngoại). `until`: dừng trước migration này. */
export function migratedDb(until = "9999"): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applyMigrations(db, until);
  return db;
}

/** Hình dạng schema: cột từng bảng, tên index, tên view — không phụ thuộc thứ tự ALTER. */
export function schemaShape(db: DatabaseSync) {
  const objects = db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as {
    type: string;
    name: string;
  }[];
  return objects.map((o) =>
    o.type === "table"
      ? { ...o, cols: (db.prepare(`PRAGMA table_info(${o.name})`).all() as { name: string; type: string; notnull: number }[])
          .map((c) => `${c.name}:${c.type}:${c.notnull}`).sort() }
      : o,
  );
}

/**
 * DB trong bộ nhớ của hộ mẫu: `docs/schema.sql` + `docs/seed.sql`. Seed đặt `opened_at = date('now')` theo đồng hồ thật,
 * còn test ghim `now` vào ngày cố định — nên bỏ mốc mở sổ (ADR-76) của tài khoản mẫu; test nào cần mốc tự đặt.
 */
export function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readSql("docs/schema.sql"));
  db.exec(readSql("docs/seed.sql"));
  db.exec("UPDATE accounts SET opened_at = NULL");
  return db;
}

type Stmt = { sql: string; args: SQLInputValue[] };

/** Bọc node:sqlite theo giao diện D1: prepare/bind/first/all/run và batch nguyên tử. */
export function asD1(db: DatabaseSync): D1Database {
  const exec = ({ sql, args }: Stmt) => {
    const st = db.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { results: st.all(...args), meta: {} };
    const r = st.run(...args);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const statement = (sql: string, args: SQLInputValue[] = []) => {
    const self = {
      sql,
      args,
      bind: (...next: unknown[]) => statement(sql, next.map((v) => (v === undefined ? null : v)) as SQLInputValue[]),
      first: async <T>(col?: string) => {
        const row = (db.prepare(sql).get(...args) ?? null) as Record<string, unknown> | null;
        return (col && row ? row[col] : row) as T;
      },
      all: async () => ({ ...exec(self), success: true }),
      run: async () => ({ ...exec(self), success: true }),
      raw: async () => db.prepare(sql).all(...args).map((r) => Object.values(r as object)),
    };
    return self;
  };
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: Stmt[]) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ ...exec(s), success: true }));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec: async (sql: string) => db.exec(sql),
  } as unknown as D1Database;
}

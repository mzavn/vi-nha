// Bản public: một migration baseline đóng băng (sinh một lần ở v1.0.0 từ docs/schema.sql) + mọi migration sau 0030.
// Repo gốc giữ baseline ở publish/migrations/, repo public ở migrations/ — test chạy được ở cả hai.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { applyMigrations, asD1, readSql, schemaShape } from "./helpers/d1-sqlite";

/** Migration cuối của repo gốc mà baseline thay thế; khớp BASELINE_AFTER của scripts/publish-public.mjs. */
const BASELINE_AFTER = "0030";
const BASELINE = existsSync(join(dirname(fileURLToPath(import.meta.url)), `../publish/migrations/${BASELINE_AFTER}_baseline.sql`))
  ? `publish/migrations/${BASELINE_AFTER}_baseline.sql`
  : `migrations/${BASELINE_AFTER}_baseline.sql`;

/** DB như máy mới cài bản public: baseline rồi các migration sau nó, mỗi file một transaction như D1 remote. */
function publicDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  db.exec(readSql(BASELINE));
  db.exec("COMMIT");
  applyMigrations(db, "9999", String(Number(BASELINE_AFTER) + 1).padStart(4, "0"));
  return db;
}

function docsDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readSql("docs/schema.sql"));
  return db;
}

/** Mọi dòng của mọi bảng — dữ liệu hệ thống của DB mới. */
const dump = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all() }));

describe("migration baseline của bản public", () => {
  it("baseline + migration sau nó dựng đúng schema và dữ liệu hệ thống của docs/schema.sql, không có hộ mẫu", () => {
    const db = publicDb();
    const docs = docsDb();
    expect(schemaShape(db)).toEqual(schemaShape(docs));
    expect(dump(db)).toEqual(dump(docs));
    expect(db.prepare("SELECT COUNT(*) AS n FROM members").get()).toEqual({ n: 0 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("DB mới từ baseline: GET /v1/setup → needed true", async () => {
    const env = { DB: asD1(publicDb()), API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
    const res = await app.request("https://app.example.com/v1/setup", { headers: { "CF-Connecting-IP": "203.0.113.7" } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { needed: true } });
  });
});

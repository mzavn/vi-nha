import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { listMemberGrants, MCP_PATH, oauthApi, revokeMemberGrants, type GrantMetadata } from "../oauth/server";
import { actorOf, fieldNames, listAudit, recordChange, type Alert } from "../services/audit";
import { householdPasswordOk, memberPasswordOk } from "../services/passwords";
import { SECRET_NAMES, type SecretName } from "../services/secrets";
import * as settings from "../services/settings";
import { createZaloLinkCode, setZaloWebhook, testZalo } from "../services/zalo";
import { clearSession, issueSession, loginBlocked, passwordAccepted, wrongPassword } from "./auth";

// /v1/settings — màn Cài đặt. Mount sau requireAuth: cookie phiên hoặc API token như mọi /v1 khác.
export const settingsRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

settingsRoutes.get("/", async (c) => ok(c, await settings.getSettings(c.env, new URL(c.req.url).origin)));
settingsRoutes.get("/audit", async (c) => ok(c, await listAudit(c.env.DB)));

/**
 * Cài đặt › Claude và ứng dụng AI (UC-508): địa chỉ MCP và mọi kết nối của cả nhà — tên ứng dụng / tên miền lấy từ
 * `metadata` lưu lúc uỷ quyền; không trả token, mã hay khoá nào.
 */
settingsRoutes.get("/mcp", async (c) => {
  const origin = new URL(c.req.url).origin;
  const api = oauthApi(c.env, origin);
  const members = await c.env.DB.prepare("SELECT id, name FROM members ORDER BY role = 'owner' DESC, name").all<{ id: string; name: string }>();
  const connections = [];
  for (const m of members.results) {
    for (const g of await listMemberGrants(api, m.id)) {
      const meta = (g.metadata ?? {}) as Partial<GrantMetadata>;
      connections.push({
        grantId: g.id,
        memberId: m.id,
        memberName: m.name,
        clientName: meta.clientName ?? g.clientId,
        clientDomain: meta.clientDomain ?? null,
        redirectHost: meta.redirectHost ?? null,
        scopes: g.scope,
        createdAt: new Date(g.createdAt * 1000).toISOString(),
      });
    }
  }
  connections.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok(c, { endpoint: `${origin}${MCP_PATH}`, connections });
});

/** Gỡ một kết nối: grant + token của nó (hết hiệu lực trong vòng 60 giây — KV). Ai đăng nhập cũng gỡ được (ADR-96); báo cả nhà. */
settingsRoutes.delete("/mcp/:memberId/:grantId", async (c) => {
  const memberId = c.req.param("memberId");
  const grantId = c.req.param("grantId");
  const api = oauthApi(c.env, new URL(c.req.url).origin);
  // Đọc thẳng khoá của grant (dạng `grant:<userId>:<grantId>` của thư viện) thay vì liệt kê: KV list trễ cả phút,
  // vừa nối xong mà bấm Gỡ thì liệt kê chưa thấy.
  const grant = await c.env.OAUTH_KV.get<{ metadata?: Partial<GrantMetadata>; clientId?: string }>(`grant:${memberId}:${grantId}`, "json");
  if (!grant) throw new DomainError("not_found", "Không có kết nối này.", 404);
  await api.revokeGrant(grantId, memberId);
  const meta = (grant.metadata ?? {}) as Partial<GrantMetadata>;
  const label = meta.clientDomain ?? meta.clientName ?? grant.clientId;
  const owner = await c.env.DB.prepare("SELECT name FROM members WHERE id = ?").bind(memberId).first<{ name: string }>();
  await recordChange(c, "mcp.revoke", `client:${label}`, { member_id: memberId, grant_id: grantId }, { what: `gỡ kết nối ${label} của ${owner?.name ?? memberId}` });
  return ok(c, { revoked: true });
});

settingsRoutes.post("/accounts", async (c) => {
  const b = await body(c);
  const account = await settings.createAccount(c.env.DB, b);
  await recordChange(c, "account.create", `account:${account.id}`, { fields: fieldNames(b) });
  return ok(c, account, 201);
});
settingsRoutes.patch("/accounts/:id", async (c) => {
  const b = await body(c);
  const account = await settings.updateAccount(c.env.DB, c.req.param("id"), b);
  await recordChange(c, "account.update", `account:${account.id}`, { fields: fieldNames(b) });
  return ok(c, account);
});

settingsRoutes.post("/wallets", async (c) => ok(c, await settings.createWallet(c.env.DB, await body(c)), 201));
settingsRoutes.patch("/wallets/:id", async (c) => ok(c, await settings.updateWallet(c.env.DB, c.req.param("id"), await body(c))));

settingsRoutes.post("/income-streams", async (c) => ok(c, await settings.createIncomeStream(c.env.DB, await body(c)), 201));
settingsRoutes.patch("/income-streams/:id", async (c) => ok(c, await settings.updateIncomeStream(c.env.DB, c.req.param("id"), await body(c))));

/** Thêm người (UC-507): nhật ký + báo cả nhà — người lạ được thêm vào nhà là việc cả nhà phải biết (ADR-90). */
settingsRoutes.post("/members", async (c) => {
  const b = await body(c);
  const member = await settings.createMember(c.env.DB, b);
  await recordChange(c, "member.create", `member:${member.id}`, { fields: fieldNames(b) }, { what: `thêm ${member.name} vào nhà` });
  return ok(c, member, 201);
});

/**
 * Đổi chat Telegram hay bỏ nối Zalo là đổi nơi nhận tin tiền của cả nhà (ADR-90): ghi nhật ký và cảnh báo mọi kênh,
 * kể cả chat cũ vừa bị thay/gỡ. Tắt / bật lại người (UC-507): nhật ký riêng, báo cả nhà; tự tắt mình thì xoá cookie; tắt thì
 * gỡ mọi kết nối Claude của người đó (UC-601 AC-10).
 */
settingsRoutes.patch("/members/:id", async (c) => {
  const id = c.req.param("id");
  const b = await body(c);
  const before = await settings.readMember(c.env.DB, id);
  const after = await settings.updateMember(c.env.DB, id, b);
  if (before && before.active !== after.active) {
    if (!after.active) await revokeMemberGrants(c.env, new URL(c.req.url).origin, id);
    await recordChange(c, after.active ? "member.activate" : "member.deactivate", `member:${id}`, null, {
      what: after.active ? `bật lại ${after.name}` : `tắt ${after.name} (mọi máy và kết nối Claude của người này bị gỡ)`,
    });
    if (!after.active && c.get("via") === "session" && c.get("memberId") === id) clearSession(c);
  }
  // Chỉ bật / tắt thì không ghi thêm member.update.
  const fields = fieldNames(b).filter((f) => f !== "active");
  if (fields.length === 0 && "active" in b) return ok(c, after);
  const what: string[] = [];
  const also: NonNullable<Alert["also"]> = {};
  if ((before?.tg_chat_id ?? null) !== after.tg_chat_id) {
    what.push(after.tg_chat_id ? `đổi chat Telegram nhận tin của ${after.name}` : `bỏ chat Telegram nhận tin của ${after.name}`);
    also.telegram = before?.tg_chat_id;
  }
  if (before?.zalo_chat_id && !after.zalo_chat_id) {
    what.push(`bỏ nối Zalo của ${after.name}`);
    also.zalo = before.zalo_chat_id;
  }
  await recordChange(c, "member.update", `member:${id}`, { fields }, what.length ? { what: what.join(" và "), also } : undefined);
  return ok(c, after);
});

/**
 * Đặt / đổi / gỡ mật khẩu riêng (UC-507). Quyền: `household_password` (mật khẩu chung) đúng → đổi được cho bất kỳ ai, xét
 * trước; `current` chỉ khi đổi của chính mình qua cookie — là mật khẩu đang dùng để vào. Token REST luôn cần mật khẩu chung.
 * Sai → 401, tính vào bộ chặn dò (scope `login`); đang bị chặn → 429 trước khi so. Đổi xong: mọi phiên của người đó hết
 * hiệu lực, mọi kết nối Claude của người đó bị gỡ (UC-601 AC-10); tự đổi của mình thì nhận cookie mới đúng cách vào mới.
 * Nhật ký không ghi mật khẩu; đổi cho người khác thì báo cả nhà.
 */
settingsRoutes.put("/members/:id/password", async (c) => {
  const now = new Date();
  const blocked = await loginBlocked(c, now);
  if (blocked) return blocked;
  const id = c.req.param("id");
  const b = await body(c);
  const password = b.password === null ? null : settings.memberPassword(b.password, "password");
  if (b.password !== null && password === null) throw new DomainError("invalid_input", "Nhập mật khẩu riêng mới, hoặc null để gỡ.", 400, "password");
  const target = await c.env.DB.prepare("SELECT password_hash FROM members WHERE id = ?").bind(id).first<{ password_hash: string | null }>();
  if (!target) throw new DomainError("not_found", "Không có thành viên này.", 404);
  const household = typeof b.household_password === "string" && b.household_password ? b.household_password : null;
  const current = typeof b.current === "string" && b.current ? b.current : null;
  const self = c.get("via") === "session" && c.get("memberId") === id;
  let accepted: boolean;
  if (household !== null) accepted = householdPasswordOk(c.env.APP_PASSWORD, household);
  else if (current !== null && self) accepted = await memberPasswordOk(c.env.APP_PASSWORD, current, target.password_hash);
  else if (self) throw new DomainError("invalid_input", "Nhập mật khẩu hiện tại.", 400, "current");
  else throw new DomainError("invalid_input", "Nhập mật khẩu chung của nhà.", 400, "household_password");
  if (!accepted) return wrongPassword(c, now, household !== null ? "household_password" : "current");
  await passwordAccepted(c);
  const { member, changed, gen } = await settings.setMemberPassword(c.env.DB, id, password);
  if (changed) {
    await revokeMemberGrants(c.env, new URL(c.req.url).origin, id);
    if (self) await issueSession(c, id, password === null ? "h" : "p", gen);
    const forOther = c.get("memberId") !== id;
    await recordChange(c, "member.password", `member:${id}`, { set: password !== null }, forOther ? { what: `${password === null ? "gỡ" : "đặt"} mật khẩu riêng của ${member.name}` } : undefined);
  }
  return ok(c, member);
});
settingsRoutes.post("/members/:id/zalo-code", async (c) => {
  const id = c.req.param("id");
  const code = await createZaloLinkCode(c.env, id, new Date(), actorOf(c));
  await recordChange(c, "member.zalo_code", `member:${id}`, null);
  return ok(c, code, 201);
});

settingsRoutes.patch("/rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
  return ok(c, await settings.updateRule(c.env.DB, id, await body(c)));
});

settingsRoutes.put("/config", async (c) => ok(c, await settings.updateConfig(c.env.DB, await body(c))));
settingsRoutes.patch("/notify-schedule", async (c) => ok(c, await settings.updateNotifySchedule(c.env.DB, await body(c))));

const SECRET_LABEL: Record<SecretName, string> = {
  telegram_bot_token: "bot token Telegram",
  zalo_bot_token: "bot token Zalo",
  zalo_webhook_secret: "khoá webhook Zalo",
};
const isSet = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Đổi/xoá khoá Telegram, Zalo: ghi tên khoá (không ghi giá trị) và cảnh báo cả nhà. */
settingsRoutes.put("/integrations", async (c) => {
  const b = await body(c);
  const result = await settings.updateIntegrations(c.env, b);
  const changed = SECRET_NAMES.filter((n) => Object.prototype.hasOwnProperty.call(b, n));
  if (changed.length) {
    const set = changed.filter((n) => isSet(b[n]));
    const cleared = changed.filter((n) => !isSet(b[n]));
    await recordChange(c, "integrations.update", null, { set, cleared }, { what: `đổi ${changed.map((n) => SECRET_LABEL[n]).join(", ")}` });
  }
  return ok(c, result);
});

settingsRoutes.post("/test/telegram", async (c) => {
  const b = await body(c);
  if (typeof b.member_id !== "string") throw new DomainError("invalid_input", "Thiếu member_id.");
  return ok(c, await settings.testTelegram(c.env, b.member_id));
});

settingsRoutes.post("/test/zalo", async (c) => {
  const b = await body(c);
  if (typeof b.member_id !== "string") throw new DomainError("invalid_input", "Thiếu member_id.");
  return ok(c, await testZalo(c.env, b.member_id));
});
settingsRoutes.post("/zalo/webhook", async (c) => ok(c, await setZaloWebhook(c.env, new URL(c.req.url).origin)));

/**
 * Khoá webhook SePay là chìa vào sổ (ai có nó gửi được giao dịch giả), tắt kết nối thì giao dịch thật rơi mất (ADR-90):
 * đặt/đổi/xoá khoá hay token, hoặc tắt kết nối → nhật ký + cảnh báo cả nhà. Nhật ký chỉ ghi tên trường.
 */
function sepayAlert(name: string, b: Record<string, unknown>): Alert | undefined {
  const what: string[] = [];
  if (Object.prototype.hasOwnProperty.call(b, "webhook_key")) what.push(isSet(b.webhook_key) ? "đặt khoá webhook" : "xoá khoá webhook");
  if (Object.prototype.hasOwnProperty.call(b, "api_token")) what.push(isSet(b.api_token) ? "đặt token API" : "xoá token API");
  if (b.active === false) what.push("tắt");
  return what.length ? { what: `${what.join(", ")} kết nối SePay “${name}”` } : undefined;
}

settingsRoutes.post("/sepay/connections", async (c) => {
  const b = await body(c);
  const conn = await settings.createSepayConnection(c.env, b);
  const alert = isSet(b.webhook_key) || isSet(b.api_token) ? sepayAlert(conn.name, b) : undefined;
  await recordChange(c, "sepay.create", `sepay:${conn.id}`, { fields: fieldNames(b) }, alert);
  return ok(c, conn, 201);
});
settingsRoutes.patch("/sepay/connections/:id", async (c) => {
  const b = await body(c);
  const conn = await settings.updateSepayConnection(c.env, c.req.param("id"), b);
  await recordChange(c, "sepay.update", `sepay:${conn.id}`, { fields: fieldNames(b), active: conn.active }, sepayAlert(conn.name, b));
  return ok(c, conn);
});
settingsRoutes.post("/sepay/connections/:id/test", async (c) => ok(c, await settings.testSepay(c.env, c.req.param("id"), new Date())));
settingsRoutes.post("/sepay/sync", async (c) => ok(c, await settings.syncSepayRange(c.env, await body(c), new Date())));

import { insufficientScope, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "../env";
import { registerTools, WRITE_TOOLS } from "../mcp/tools";
import { SCOPE_READ, SCOPE_WRITE, type GrantProps } from "../oauth/server";

/** Body JSON-RPC (một thông điệp hay một mảng) có gọi tool ghi nào không. Body hỏng để transport MCP tự trả lỗi. */
async function callsWriteTool(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  return (Array.isArray(body) ? body : [body]).some((m: unknown) => {
    if (!m || typeof m !== "object" || !("method" in m) || m.method !== "tools/call" || !("params" in m)) return false;
    const params = m.params;
    return Boolean(params && typeof params === "object" && "name" in params && typeof params.name === "string" && WRITE_TOOLS.includes(params.name));
  });
}

/**
 * `/mcp` (UC-601): resource server đã kiểm token (thư viện + lớp phòng hậu ở `src/oauth/server.ts`) trước khi gọi vào đây.
 * Quyền kiểm ở tầng HTTP, trước transport MCP — lỗi trong tool luôn bị gói thành 200: thiếu `mcp:read` → 403; gọi tool ghi
 * khi thiếu `mcp:write` → 403 `insufficient_scope` ghi đủ hai quyền để Claude xin thêm (AC-11), không ghi gì.
 * Stateless, tool-only: dựng McpServer + đăng ký tool mới cho từng request, không dùng Durable Object.
 */
export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: OAuthResourceContext<GrantProps>): Promise<Response> {
    const scope = ctx.auth.scope;
    if (!scope.includes(SCOPE_READ)) return insufficientScope(ctx.auth, [SCOPE_READ]);
    if (!scope.includes(SCOPE_WRITE) && (await callsWriteTool(request))) return insufficientScope(ctx.auth, [SCOPE_READ, SCOPE_WRITE]);
    const server = new McpServer({ name: "vi-nha", version: "1.0.0" });
    await registerTools(server, env.DB, ctx.props.memberId, () => new Date());
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

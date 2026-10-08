// Cài đặt › Claude và ứng dụng AI: dựng dòng hiển thị cho từng kết nối MCP (grant OAuth) từ GET /v1/settings/mcp.

import { dayKey, shortDate } from "./period";
import type { McpConnection } from "./types";

/** "Xem" (chỉ mcp:read) · "Xem + Ghi" (thêm mcp:write). Quyền lạ bỏ qua. */
export function scopeLabel(scopes: string[]): string {
  const read = scopes.includes("mcp:read");
  const write = scopes.includes("mcp:write");
  if (read && write) return "Xem + Ghi";
  if (write) return "Ghi";
  if (read) return "Xem";
  return "Không có quyền nào";
}

/** "nối ngày 8/10" theo giờ VN; khác năm với `now` thì kèm năm: "nối ngày 31/12/2025". */
export function connectedDate(iso: string, now: Date): string {
  const day = dayKey(iso);
  const year = day.slice(0, 4);
  return `nối ngày ${shortDate(day)}${year === dayKey(now).slice(0, 4) ? "" : `/${year}`}`;
}

/** DELETE /v1/settings/mcp/:memberId/:grantId — grant thuộc về từng người. */
export function revokePath(c: McpConnection): string {
  return `/v1/settings/mcp/${encodeURIComponent(c.memberId)}/${encodeURIComponent(c.grantId)}`;
}

export interface ConnectionRow {
  key: string;
  /** Tên ứng dụng, vd "Claude". */
  title: string;
  /** Tên miền đã xác minh ("claude.ai"); không có thì nơi chuyển về; trùng tên ứng dụng thì bỏ. */
  domain: string | null;
  /** "của Chồng · Xem + Ghi". */
  sub: string;
  /** "nối ngày 8/10". */
  sub2: string;
  revokePath: string;
}

/** Dòng hiển thị, mới nối đứng trước. */
export function connectionRows(list: McpConnection[], now: Date): ConnectionRow[] {
  return [...list]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((c) => {
      const domain = c.clientDomain ?? (c.redirectHost ? `chuyển về ${c.redirectHost}` : null);
      return {
        key: `${c.memberId}/${c.grantId}`,
        title: c.clientName,
        domain: domain === c.clientName ? null : domain,
        sub: `của ${c.memberName} · ${scopeLabel(c.scopes)}`,
        sub2: connectedDate(c.createdAt, now),
        revokePath: revokePath(c),
      };
    });
}

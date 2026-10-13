/**
 * Cài đặt › Nâng cao › Cập nhật Ví nhà (UC-709 AC-30): hỏi GitHub bản phát hành mới nhất khi người dùng bấm,
 * rồi chỉ đúng cách cập nhật theo cách đã cài (`__INSTALL__`, xem install-info.ts).
 */
import type { InstallInfo } from "./install-info";
import { GUIDE_URL, SOURCE_URL } from "./splits";

export const LATEST_RELEASE_API = "https://api.github.com/repos/mzavn/vi-nha/releases/latest";
export const UPDATE_GUIDE_URL = `${GUIDE_URL}/bat-dau/cap-nhat-vi-nha`;
/** Bản cài bằng `npm run setup` / nhờ AI: setup ghi `account_id` vào wrangler.jsonc nên `git pull` trần bị chặn. */
export const UPDATE_COMMAND = "git pull --autostash && npm ci && npm run deploy";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** So hai phiên bản `X.Y.Z` (có hay không có `v`) theo số: > 0 nếu a mới hơn; không phải `X.Y.Z` → null. */
export function compareVersions(a: string, b: string): number | null {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/** Phiên bản `X.Y.Z` từ JSON `releases/latest` của GitHub; tag lạ (không phải `X.Y.Z`) → null. */
export function releaseTag(json: unknown): string | null {
  const tag = (json as { tag_name?: unknown } | null)?.tag_name;
  if (typeof tag !== "string") return null;
  const m = SEMVER.exec(tag);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

export type UpdateAction = { kind: "workflow"; url: string } | { kind: "actions-hint" } | { kind: "command"; command: string };
export type UpdateView = { state: "latest"; text: string } | { state: "newer"; text: string; notesUrl: string; action: UpdateAction };

/** Kết quả kiểm tra: bản đang chạy so với bản mới nhất, và cách cập nhật theo cách đã cài. So không được → null. */
export function updateView(current: string, latest: string, install: InstallInfo): UpdateView | null {
  const diff = compareVersions(latest, current);
  if (diff === null) return null;
  if (diff <= 0) return { state: "latest", text: `Đang dùng bản mới nhất (${current}).` };
  const action: UpdateAction =
    install.builtBy === "local"
      ? { kind: "command", command: UPDATE_COMMAND }
      : install.repo
        ? { kind: "workflow", url: `https://github.com/${install.repo}/actions/workflows/update.yml` }
        : { kind: "actions-hint" };
  return { state: "newer", text: `Có bản mới ${latest}.`, notesUrl: `${SOURCE_URL}/releases/tag/v${latest}`, action };
}

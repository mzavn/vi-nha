/**
 * Cách app được build (UC-709 AC-31) — chạy lúc build trong web/vite.config.ts, nên không import gì: trên Cloudflare
 * (Workers Builds — cài bằng nút Deploy) kèm repo GitHub `chủ/tên` nếu đọc được, hay trên máy.
 */
export interface InstallInfo {
  builtBy: "cloudflare" | "local";
  repo: string;
}

const REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * `chủ/tên` từ địa chỉ remote GitHub (https, ssh, git@github.com:…); khác GitHub hay có chữ lạ → "".
 * Chỉ trả hai phần đã lọc: địa chỉ gốc trên Workers Builds có thể mang token, không bao giờ được vào bundle.
 */
export function githubRepo(remote: string): string {
  const path =
    /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/(.+)$/.exec(remote)?.[1] ??
    /^[^@/\s:]+@github\.com:(.+)$/.exec(remote)?.[1];
  const m = path ? REPO.exec(path) : null;
  if (!m || m[2] === "." || m[2] === "..") return "";
  return `${m[1]}/${m[2]}`;
}

/** `WORKERS_CI=1` (Workers Builds) mới đọc remote; build trên máy không đọc gì. */
export function installInfo(ci: string | undefined, readRemote: () => string | null): InstallInfo {
  if (ci !== "1") return { builtBy: "local", repo: "" };
  return { builtBy: "cloudflare", repo: githubRepo(readRemote() ?? "") };
}

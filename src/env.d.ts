export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Kho của OAuth cho Claude (UC-601): client, grant, token — thư viện chỉ lưu băm của token / mã, `props` mã hoá. */
  OAUTH_KV: KVNamespace;
  API_TOKEN: string;
  SEPAY_API_KEY: string;
  SEPAY_API_TOKEN: string;
  TG_BOT_TOKEN: string;
  ZALO_BOT_TOKEN: string;
  ZALO_WEBHOOK_SECRET: string;
  APP_PASSWORD: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Người đang dùng: từ cookie đăng nhập, hoặc header X-Member-Id khi gọi bằng API token. */
    memberId: string | null;
    via: "session" | "token";
    /** Trang uỷ quyền OAuth: origin của `redirect_uri` đã được thư viện xác thực, thêm vào CSP `form-action`. */
    formActionOrigin: string | undefined;
  };
};

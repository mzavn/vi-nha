/// <reference types="vite/client" />

/** `version` trong package.json lúc build (web/vite.config.ts › define); repo phát triển không có thì là chuỗi rỗng. */
declare const __APP_VERSION__: string;

/** Cách app được build (web/vite.config.ts › `installInfo`, UC-709 AC-31): trên Cloudflare kèm repo GitHub `chủ/tên`, hay trên máy. */
declare const __INSTALL__: import("./lib/install-info").InstallInfo;

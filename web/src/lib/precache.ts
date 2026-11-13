/** Font tự host trong app shell (pwa UC-710 AC-14): tên file trong `web/public/fonts/` → đường dẫn precache `/fonts/*.woff2`. */
export function fontPrecache(files: string[]): string[] {
  return files.filter((f) => f.endsWith(".woff2")).sort().map((f) => `/fonts/${f}`);
}

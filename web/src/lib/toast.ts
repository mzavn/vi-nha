/**
 * Thời gian toast ở lại (pwa UC-711 AC-7, AC-34): câu ngắn 2,2 giây, câu dài 60 ms mỗi ký tự, tối đa 8 giây. Toast kèm nút
 * (vd Hoàn tác) ở lại ít nhất 5 giây để kịp bấm.
 */
export function toastDuration(text: string, hasAction: boolean): number {
  return Math.min(8000, Math.max(hasAction ? 5000 : 2200, text.length * 60));
}

// Money là component, không phải hàm format (DESIGN.md §2.2): gánh tabular-nums, dấu −, màu âm, không làm tròn.
// Đang che số tiền (pwa UC-718): `•••••`, giữ dấu và màu; trình đọc màn hình nghe "đã che số tiền".
// Mọi con số đều dùng font Inter có `font-variant-numeric: tabular-nums` (bỏ prop `mono`).

import { amountsHidden, formatSigned, moneyDigits } from "../lib/money";

interface Props {
  value: number | null;
  /** Hiện ₫ sau số (.unit: 0,45em, --fg-3). Trong bảng dày đặc bỏ đi, ghi một lần ở header. */
  unit?: boolean;
  /** Có dấu + cho số dương (chênh lệch). */
  signed?: boolean;
  /** Âm thì tô đỏ. Tắt cho số không mang nghĩa "vượt" (ví dụ tiền ra của một log). */
  tone?: boolean;
  class?: string;
}

export function Money({ value, unit = true, signed = false, tone = true, class: cls = "" }: Props) {
  if (value === null) return <span class={cls} />;
  const text = signed ? formatSigned(value) : moneyDigits(value);
  const classes = ["num", tone && value < 0 ? "neg" : "", cls].filter(Boolean).join(" ");
  return (
    <span class={classes} aria-label={amountsHidden() ? "đã che số tiền" : undefined}>
      {text}
      {unit && <span class="unit">{"\u00a0₫"}</span>}
    </span>
  );
}

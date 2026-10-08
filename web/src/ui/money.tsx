// Money là component, không phải hàm format (DESIGN.md §9): gánh tabular-nums, dấu −, màu âm, không làm tròn.

import { formatSigned, groupDigits } from "../lib/money";

interface Props {
  value: number | null;
  /** Hiện ₫ sau số. Trong bảng dày đặc bỏ đi, ghi một lần ở header. */
  unit?: boolean;
  /** Font mono cho cột số trong bảng. */
  mono?: boolean;
  /** Có dấu + cho số dương (chênh lệch). */
  signed?: boolean;
  /** Âm thì tô đỏ. Tắt cho số không mang nghĩa "vượt" (ví dụ tiền ra của một log). */
  tone?: boolean;
  class?: string;
}

export function Money({ value, unit = true, mono = false, signed = false, tone = true, class: cls = "" }: Props) {
  if (value === null) return <span class={cls} />;
  const text = signed ? formatSigned(value) : groupDigits(value);
  const classes = [mono ? "num" : "tnum", tone && value < 0 ? "neg" : "", cls].filter(Boolean).join(" ");
  return (
    <span class={classes}>
      {text}
      {unit && <span class="cur">{" ₫"}</span>}
    </span>
  );
}

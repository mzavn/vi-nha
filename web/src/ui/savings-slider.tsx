// Thanh % Tích luỹ 1–100 với vạch 1 · 10 · 30 (ADR-142) — dùng chung sheet "Trích Tích luỹ", Tham số, Thiết lập, bước 5 màn
// chuyển đổi. Vạch trên thanh chỉ để nhìn; chạm chọn vạch bằng hàng nút ≥ 44px ngay dưới (vạch 1 và 10 quá gần nhau để chạm
// thẳng trên thanh ở 390px).

import { SAVINGS_MARKS } from "../lib/savings-scale";

const MIN = 1;
const MAX = 100;

/** Vị trí của một % trên thanh (0…100%). */
const at = (pct: number) => `${((pct - MIN) / (MAX - MIN)) * 100}%`;

/** `pct` 0 (sheet Trích Tích luỹ khi số 0): con trượt nằm ở đầu thanh, không vạch nào sáng. */
export function SavingsSlider(props: { pct: number; onPct: (pct: number) => void; disabled?: boolean; id?: string }) {
  const shown = Math.min(MAX, Math.max(0, Math.round(props.pct) || 0));
  const pct = Math.max(MIN, shown);
  return (
    <div class="sv-slider">
      <div class="sv-track">
        <input
          id={props.id}
          type="range"
          class="sv-range"
          min={MIN}
          max={MAX}
          step={1}
          value={pct}
          disabled={props.disabled}
          aria-label="% Tích luỹ"
          aria-valuetext={`${shown}%`}
          onInput={(ev) => props.onPct(Number(ev.currentTarget.value))}
        />
        <span class="sv-ticks" aria-hidden="true">
          {SAVINGS_MARKS.map((m) => (
            <span key={m.pct} class="sv-tick" style={{ left: at(m.pct) }} />
          ))}
        </span>
      </div>
      <div class="sv-marks" role="group" aria-label="tối thiểu · thường · hướng tới">
        {SAVINGS_MARKS.map((m) => (
          <button key={m.pct} type="button" class={`sv-mark${shown === m.pct ? " on" : ""}`} aria-pressed={shown === m.pct} disabled={props.disabled} onClick={() => props.onPct(m.pct)}>
            <b>{m.pct}%</b>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

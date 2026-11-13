// Thẻ "Tháng dư" ở Hôm nay (pwa UC-702 AC-39, pocket UC-1207): khi `monthClose.status` = `ask` trong suốt tháng sau. Dư dương →
// "Tháng 11 dư 4.800.000 ₫", dòng chi tiết, chip "50 / 50" (chạm để đổi %), [Chia] [Để lại Vận hành]; tiêu quá → một dòng, không
// nút. Bấm cần mạng; xong thì tải lại (việc chia dư hiện ở thẻ Trích Tích luỹ). Chữ và phép chia ở lib/month-tasks.ts.

import { useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { monthCloseCard, monthNo, monthReopenPath, monthSkipPath, monthSplitRequest, NEEDS_NETWORK, SURPLUS_PCT_CHOICES } from "../lib/month-tasks";
import { TOAST_UNDO_DONE } from "../lib/undo";
import type { Snapshot } from "../lib/types";
import { monthCloseAction, toast, useApp } from "../state/store";
import { InfoTip, Sheet } from "../ui/parts";

export function MonthCloseCard({ snap }: { snap: Snapshot }) {
  const { online } = useApp();
  const [pct, setPct] = useState<number | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const mc = snap.monthClose;
  const v = monthCloseCard(mc, { pct, paydayDay: snap.nearSpend.paydayDay, hasReward: snap.pockets.reserve.reward !== null });
  if (!mc || !v) return null;

  async function run(kind: "split" | "skip", path: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      await monthCloseAction(path, body);
      const m = monthNo(mc!.month);
      const toastText = kind === "split" ? `Đã chia dư tháng ${m}.` : `Đã để dư tháng ${m} lại Vận hành.`;
      toast(toastText, {
        label: "Hoàn tác",
        run: async () => {
          try {
            await monthCloseAction(monthReopenPath(mc!));
            toast(TOAST_UNDO_DONE);
          } catch (err) {
            toast(errorText(err));
          }
        },
      });
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const locked = !online || busy;
  const split = monthSplitRequest(mc, v.pct);

  return (
    <section class="card pocket" aria-label="Tháng dư">
      <div class="pocket-h">
        <h2>{v.title}</h2>
      </div>
      {v.detail && <p class="sub-line pad mc-detail">{v.detail}</p>}
      {v.canSplit && (
        <>
          <div class="srow mc-split">
            <div>
              <button type="button" class="chip" disabled={locked} aria-label="Đổi % chia" onClick={() => setPicking(true)}>
                {v.chip}
              </button>{" "}
              <span>{v.split}</span>
            </div>
            {snap.pockets.reserve.reward !== null && <InfoTip term="reward" />}
          </div>
          <div class="mc-act pad">
            <button type="button" class="btn btn-primary" disabled={locked} onClick={() => void run("split", split.path, split.body)}>
              Chia
            </button>
            <button type="button" class="btn btn-ghost" disabled={locked} onClick={() => void run("skip", monthSkipPath(mc))}>
              Để lại Vận hành
            </button>
          </div>
          {!online && <p class="note">{NEEDS_NETWORK}</p>}
        </>
      )}
      {picking && (
        <Sheet open title="Phần vào Tích luỹ" onClose={() => setPicking(false)}>
          <div class="mc-act pad">
            {SURPLUS_PCT_CHOICES.map((p) => (
              <button
                type="button"
                key={p}
                class="btn"
                aria-pressed={p === v.pct}
                onClick={() => {
                  setPct(p);
                  setPicking(false);
                }}
              >
                {p} / {100 - p}
              </button>
            ))}
          </div>
          <p class="fhint pad">Số trước vào Tích luỹ, số sau vào Ví Thưởng.</p>
        </Sheet>
      )}
    </section>
  );
}

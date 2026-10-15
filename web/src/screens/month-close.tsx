// Chốt tháng (allocation UC-207, ADR-111): thẻ ở Hôm nay (điện thoại + máy tính) khi tháng liền trước chưa chốt và còn
// phong bì dư; sheet xem trước bù chi lố, phần dư, thanh Tích sản / Ví Thưởng (bước 5), lệnh chuyển, cảnh báo; nút Chốt.
// Mọi số từ GET /v1/month-close — PWA không tự tính. Chốt cần mạng, không vào hàng đợi.

import { useEffect, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../lib/api";
import { formatVnd } from "../lib/money";
import { closePctLock, closePctStep, monthCloseCard, monthCloseLines, monthClosePath, monthCloseToast, monthCloseWarning, type MonthCloseLine } from "../lib/month-close";
import type { MonthCloseOpen, MonthCloseResult, MonthCloseView } from "../lib/types";
import { useResource } from "../state/resource";
import { refresh, toast, useApp } from "../state/store";
import { Money } from "../ui/money";
import { Banner, Card, NeedsNetwork, Sheet } from "../ui/parts";

export function MonthCloseCard() {
  const res = useResource<MonthCloseView>(monthClosePath());
  const [open, setOpen] = useState(false);
  const view = res.data;
  const card = view ? monthCloseCard(view) : null;
  if (!view || view.closed || !card) return null;
  return (
    <>
      <Card
        class="month-close-card"
        title={card.title}
        right={
          <button type="button" class="btn btn-primary" onClick={() => setOpen(true)}>
            Xem và chốt
          </button>
        }
      >
        <p style={{ margin: 0 }}>{card.line}</p>
        <p class="sub-line" style={{ margin: "4px 0 0" }}>
          Bù ví chi lố trước, phần dư chia Tích sản / Ví Thưởng. Chưa chốt thì phần dư vẫn nằm trong còn để chi.
        </p>
      </Card>
      {open && <MonthCloseSheet initial={view} onClose={() => setOpen(false)} onClosed={res.reload} />}
    </>
  );
}

function Lines({ lines, signed = false }: { lines: MonthCloseLine[]; signed?: boolean }) {
  return (
    <div class="wf">
      {lines.map((l) => (
        <div class="r" key={l.key}>
          <span>{l.label}</span>
          <Money value={l.value} mono unit={false} tone={signed} />
        </div>
      ))}
    </div>
  );
}

function MonthCloseSheet({ initial, onClose, onClosed }: { initial: MonthCloseOpen; onClose: () => void; onClosed: () => void }) {
  const { online, boot } = useApp();
  const [view, setView] = useState(initial);
  const [pct, setPct] = useState(initial.wealthPct);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const month = Number(view.month.slice(5, 7));
  const lock = closePctLock(view);
  const lines = monthCloseLines(view, boot?.wallets ?? []);
  const account = (id: string) => boot?.accounts.find((a) => a.id === id)?.name ?? id;

  // Kéo thanh: xem trước lại qua server (debounce như Chia thử); bảng cũ giữ nguyên trong lúc chờ.
  useEffect(() => {
    if (pct === view.wealthPct || !online) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<MonthCloseView>(monthClosePath(pct), true)
        .then((v) => {
          if (!live) return;
          setLoading(false);
          if (v.closed) return closedElsewhere();
          setView(v);
          setError(null);
        })
        .catch((err) => {
          if (!live) return;
          setLoading(false);
          setError(errorText(err));
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pct, online]);

  function closedElsewhere() {
    toast("Tháng này vừa được chốt ở máy khác.");
    void refresh();
    onClosed();
    onClose();
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      const done = await api.post<MonthCloseResult>("/v1/month-close", { month: view.month, wealth_pct: view.wealthPct });
      await refresh();
      toast(monthCloseToast(done));
      onClosed();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_closed") return closedElsewhere();
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`Chốt tháng ${month}`} onClose={onClose}>
      <p class="note" style={{ paddingBottom: 0 }}>
        Bù ví chi lố trước bằng ví còn dư; phần còn lại là Lợi nhuận thêm, chia Tích sản / Ví Thưởng. Bút toán ghi vào cuối tháng {month}.
      </p>
      {lines.covers.length > 0 && (
        <>
          <div class="card-h" style={{ paddingBottom: "2px" }}>
            <h2>Bù chi lố</h2>
          </div>
          <Lines lines={lines.covers} />
        </>
      )}
      {lines.left.length > 0 && (
        <>
          <div class="card-h" style={{ paddingBottom: "2px" }}>
            <h2>Còn chi lố, chờ lần chia sau</h2>
          </div>
          <Lines lines={lines.left} signed />
        </>
      )}
      {view.profit > 0 && (
        <div class="close-pct">
          <label for="close-pct">
            Tích sản <strong>{pct}%</strong>
            {view.rewardWalletId && (
              <>
                {" "}
                · Ví Thưởng <strong>{100 - pct}%</strong>
              </>
            )}
          </label>
          <input
            id="close-pct"
            class="wealth-range"
            type="range"
            min={0}
            max={100}
            step={closePctStep(view)}
            value={pct}
            disabled={lock !== null || busy}
            onInput={(e) => setPct(Number(e.currentTarget.value))}
          />
          {lock && <p class="fhint" style={{ padding: 0 }}>{lock}</p>}
        </div>
      )}
      <div class="card-h" style={{ paddingBottom: "2px" }}>
        <h2>Tổng</h2>
      </div>
      <Lines lines={lines.total} />
      {lines.sweeps.length > 0 && (
        <details class="close-detail">
          <summary>Từng ví góp vào phần dư</summary>
          <Lines lines={lines.sweeps} />
        </details>
      )}
      {view.warnings.map((w) => (
        <div key={w.walletId} style={{ padding: "10px 16px 0" }}>
          <Banner tone="warn" mark="!">
            {monthCloseWarning(view, w)}
          </Banner>
        </div>
      ))}
      <div class="note">
        {view.transferOrders.length === 0
          ? "Không sinh lệnh chuyển tiền: các ví nằm cùng tài khoản."
          : `Sau khi chốt sẽ sinh ${view.transferOrders.length} lệnh chuyển tiền: ` +
            view.transferOrders.map((o) => `${account(o.fromAccountId)} → ${account(o.toAccountId)} ${formatVnd(o.amount)}`).join("; ") +
            "."}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || loading || pct !== view.wealthPct} onClick={() => void close()}>
          {busy ? "Đang chốt…" : `Chốt tháng ${month}`}
        </button>
        {!online && <NeedsNetwork what="Chốt tháng" />}
      </div>
    </Sheet>
  );
}

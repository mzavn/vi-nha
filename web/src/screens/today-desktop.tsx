// Hôm nay trên máy tính (≥1024px): cùng ba thẻ ngăn (Vận hành, Tích luỹ, Dự phòng — ADR-122), thêm mọi thứ cần để quyết định
// mà không phải bấm sang màn khác — việc cần làm dạng danh sách, giao dịch gần đây.
// Không có card phong bì: chi theo nhóm xem ở Ví & quỹ › Nhìn lại (pwa UC-702 alt 6a, UC-707). Chỉ dùng số /v1 đã trả: snapshot (việc
// tháng, tháng dư), logs chưa gán, giao dịch.

import { useEffect, useState } from "preact/hooks";
import { conversionBanner } from "../lib/convert";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { formatVnd, maskAmounts, moneyDigits } from "../lib/money";
import { dayHeading, dayKey, shortDate, timeHM, weekLabel } from "../lib/period";
import { txLabel, txSign } from "../lib/transactions";
import { loadPageSize, PAGE_SIZES, savePageSize, splitPage, txPagePath } from "../lib/tx-paging";
import type { BankLog, Bootstrap, Snapshot, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Banner, Empty, FirstLoadFailed, PageHeader, Skeleton } from "../ui/parts";
import { LogRow } from "./assign";
import { MonthCloseCard } from "./month-close-card";
import { SavingsTaskCard } from "./savings-card";
import { OtherEntrySheet } from "./other-entry-sheet";
import { FreshnessRow, NearSpendCard, NearStatusCard } from "./today";

export function TodayDesk() {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [income, setIncome] = useState(false);
  const sub = snap ? `${dayHeading(snap.day)} · ${weekLabel(snap.week.key, snap.week.start, snap.week.end)}` : "";
  const rejected = app.queue.filter((q) => q.memberId === app.member?.id && q.status === "rejected").length;
  const a = snap?.attention;
  const convert = snap ? conversionBanner(snap.conversion) : null;
  const hasTodo = !!a && (!!convert || rejected > 0 || a.drift.some((d) => driftOf(d) !== null) || a.pendingLogs > 0);

  return (
    <>
      <PageHeader
        title="Hôm nay"
        sub={sub}
        action={
          <button type="button" class="btn btn-primary" onClick={() => setIncome(true)}>
            Ghi tiền vào
          </button>
        }
      />
      {!snap ? (
        <Card>
          {app.loadFailed ? <FirstLoadFailed online={app.online} onRetry={() => void refresh(true)} /> : <Skeleton rows={6} />}
        </Card>
      ) : app.compact ? (
        // Chế độ gọn (UC-711 AC-36): chỉ Vận hành (gọn), Gần đây, dòng trạng thái và khoản bị từ chối.
        <div class="dash dash-one">
          <div class="dash-main">
            <FreshnessRow />
            {rejected > 0 && (
              <Banner tone="bad" mark={String(rejected)} action="Xem" onAction={() => go("entry")}>
                <strong>{rejected} khoản nhập bị máy chủ từ chối.</strong> Nằm trong hàng đợi, chờ sửa hoặc bỏ.
              </Banner>
            )}
            <NearSpendCard snap={snap} compact />
            <RecentTransactions title="Gần đây" class="dash-recent" />
          </div>
        </div>
      ) : (
        // Lưới 8–4: cột chính (Vận hành, việc tháng này, Gần đây) và cột phụ (các hàng trạng thái Vận hành, tiết kiệm, Cần xem).
        <div class="dash">
          <div class="dash-main">
            <NearSpendCard snap={snap} rowsApart />
            <MonthCloseCard snap={snap} />
            <SavingsTaskCard snap={snap} doneApart />
            <RecentTransactions title="Gần đây" class="dash-recent" />
          </div>
          <div class="dash-side">
            <NearStatusCard snap={snap} />
            {hasTodo && <Todo snap={snap} rejected={rejected} convert={convert} />}
          </div>
        </div>
      )}
      {income && <OtherEntrySheet kind="income" amount={0} title="Ghi tiền vào" onClose={() => setIncome(false)} />}
    </>
  );
}

/** Việc tháng này: mỗi việc là một hàng bấm được dẫn thẳng tới chỗ làm, không chỉ một banner đếm số. */
function Todo({ snap, rejected, convert }: { snap: Snapshot; rejected: number; convert: string | null }) {
  const { boot } = useApp();
  const a = snap.attention;
  const logs = useResource<BankLog[]>(a.pendingLogs > 0 ? "/v1/logs?status=pending" : null);
  const drift = a.drift.flatMap((d) => {
    const amount = driftOf(d);
    return amount === null ? [] : [{ accountId: d.accountId, name: d.name, amount }];
  });
  const total = (convert ? 1 : 0) + rejected + drift.length + a.pendingLogs;
  const SHOW = 5;

  return (
    <Card class="dash-todo-card" title="Cần xem" right={<span class="hint">{total} việc</span>} flush>
      <div class="dash-todo">
        {convert && (
          <button type="button" class="srow" onClick={() => (location.hash = "#convert")}>
            <span class="srow-main">
              <span class="srow-t">{convert}</span>
            </span>
            <span class="srow-r">
              <Icon name="chevron-right" size={16} />
            </span>
          </button>
        )}
        {rejected > 0 && (
          <>
            <div class="set-sub">Khoản ghi bị từ chối</div>
            <button type="button" class="srow" onClick={() => go("entry")}>
              <span class="srow-main">
                <span class="srow-t">{rejected} khoản nhập bị máy chủ từ chối</span>
                <span class="srow-s">Nằm trong hàng đợi, chờ sửa hoặc bỏ.</span>
              </span>
              <span class="srow-r">
                <span class="chip bad">từ chối</span>
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
          </>
        )}

        {drift.length > 0 && (
          <>
            <div class="set-sub">Lệch đối soát</div>
            {drift.map((d) => (
              <button type="button" key={d.accountId} class="srow" onClick={() => go("wallets", { walletsTab: "accounts" })}>
                <span class="srow-main">
                  <span class="srow-t">{d.name}</span>
                  <span class="srow-s">
                    {DRIFT_LABEL}: <Money value={d.amount} signed tone={false} />
                  </span>
                </span>
                <span class="srow-r">
                  <span class="chip bad">lệch</span>
                  <Icon name="chevron-right" size={16} />
                </span>
              </button>
            ))}
          </>
        )}

        {a.pendingLogs > 0 && (
          <>
            <div class="set-sub">
              Chưa gán ({a.pendingLogs}) · vào trừ ra <Money value={a.pendingNet} tone={false} />
            </div>
            {logs.data ? (
              <>
                {logs.data.slice(0, SHOW).map((l) => (
                  <LogRow key={l.id} log={l} boot={boot} onOpen={() => go("assign", { assignFocus: l.id })} />
                ))}
                {logs.data.length > SHOW && (
                  <button type="button" class="srow" onClick={() => go("assign")}>
                    <span class="srow-t">Xem cả {logs.data.length} giao dịch chưa gán</span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                )}
              </>
            ) : logs.loading ? (
              <Skeleton rows={2} />
            ) : (
              <button type="button" class="srow" onClick={() => go("assign")}>
                <span class="srow-t">{a.pendingLogs} giao dịch chưa gán</span>
                <span class="srow-r">
                  Gán
                  <Icon name="chevron-right" size={16} />
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Giao dịch mới nhất trong sổ (GET /v1/transactions). Dùng ở Hôm nay và màn Nhập (điện thoại: dưới form).
 * Chạm một dòng mở chi tiết để sửa / xoá (UC-715). Chia trang: cỡ trang chọn được (nhớ theo máy), nút ‹ › theo con trỏ
 * `before`; giữ ngăn xếp con trỏ để lùi lại.
 */
export function RecentTransactions({ title, class: cls }: { title: string; class?: string }) {
  const { boot, online, version } = useApp();
  // Khoản đã xoá ẩn mặc định (vẫn nằm trong sổ); bật lên để xem lại khi cần đối chiếu.
  const [showVoid, setShowVoid] = useState(false);
  const [size, setSize] = useState(loadPageSize);
  // Con trỏ `before` của trang 2, 3, …; rỗng là trang 1.
  const [cursors, setCursors] = useState<number[]>([]);
  // Sổ vừa đọc lại (có ghi / sửa / xoá): về trang 1, con trỏ cũ có thể đã lệch.
  useEffect(() => setCursors((c) => (c.length ? [] : c)), [version]);
  const res = useResource<TxRow[]>(txPagePath(size, cursors[cursors.length - 1], showVoid));
  // Trang sau tải hỏng thì báo lỗi, không để dòng của trang cũ nằm dưới nhãn "Trang N".
  const page = res.data && !(res.error && cursors.length > 0) ? splitPage(res.data, size) : null;
  const busy = res.loading || !online;

  function pick(n: number) {
    setSize(n);
    savePageSize(n);
    setCursors([]);
  }
  const pager = (
    <div class="pager">
      <span class="pager-size">
        <label for="tx-page-size">Mỗi trang</label>
        <select id="tx-page-size" class="ctl" value={String(size)} disabled={!online} onChange={(e) => pick(Number(e.currentTarget.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} dòng
            </option>
          ))}
        </select>
      </span>
      <span class="pager-nav">
        <span class="pager-at" aria-live="polite">
          {res.loading ? "Đang tải…" : `Trang ${cursors.length + 1}`}
        </span>
        <button
          type="button"
          class="pager-btn"
          aria-label="Trang trước"
          disabled={busy || cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <button
          type="button"
          class="pager-btn"
          aria-label="Trang sau"
          disabled={busy || !page?.hasNext}
          onClick={() => page && setCursors((c) => [...c, page.rows[page.rows.length - 1]!.id])}
        >
          <Icon name="chevron-right" size={20} />
        </button>
      </span>
      {!online && <span class="hint pager-off">Đổi trang cần mạng.</span>}
    </div>
  );

  return (
    <Card
      class={cls}
      title={title}
      right={
        <span class="flex items-center gap-3 recent-links">
          {res.cachedAt && <span class="hint">số lúc {timeHM(res.cachedAt)}</span>}
          <button
            type="button"
            class="link"
            aria-pressed={showVoid}
            onClick={() => {
              setShowVoid((v) => !v);
              setCursors([]);
            }}
          >
            {showVoid ? "Ẩn khoản đã xoá" : "Hiện khoản đã xoá"}
          </button>
          <button type="button" class="link link-more" onClick={() => go("ledger", { book: null })}>
            Xem tất cả
            <Icon name="chevron-right" size={14} />
          </button>
        </span>
      }
      flush
    >
      {page ? (
        page.rows.length === 0 && cursors.length === 0 ? (
          <Empty title="Sổ chưa có giao dịch nào." />
        ) : (
          <>
            <table class="data dk-table dk-tx">
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  <th scope="col" class="l">
                    Khoản
                  </th>
                  <th scope="col" class="num">Số tiền ₫</th>
                </tr>
              </thead>
              <tbody>{page.rows.map((r) => <TxLine key={r.id} r={r} boot={boot} />)}</tbody>
            </table>
            {pager}
          </>
        )
      ) : res.loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <Empty title={res.error?.offline ? "Không có mạng." : "Chưa tải được giao dịch."} action="Tải lại" onAction={res.reload} />
          {cursors.length > 0 && pager}
        </>
      )}
    </Card>
  );
}

function TxLine({ r, boot }: { r: TxRow; boot: Bootstrap | null }) {
  const voided = r.status !== "active";
  const sign = txSign(r);
  const who = boot && boot.members.length > 1 ? boot.members.find((m) => m.id === r.by_member_id)?.name : undefined;
  const acct = boot?.accounts.find((x) => x.id === r.account_id)?.name;
  const today = dayKey(r.at) === dayKey(new Date());
  const context = [acct, who].filter(Boolean).join(" · ");
  // Cả hàng bấm được; nút trong ô "Khoản" cho bàn phím và trình đọc màn hình (bấm nó nổi lên hàng).
  return (
    <tr class="tx-row" onClick={() => openTx(r.id, r)}>
      <td class="dk-when">
        {today ? timeHM(r.at) : shortDate(r.at)}
        {today && <div class="sub-line">hôm nay</div>}
      </td>
      <td class="l">
        <button type="button" class="tx-open" aria-label={`Xem ${txLabel(r)} ${formatVnd(r.amount)}`}>
          {txLabel(r)}
        </button>
        {voided && (
          <>
            {" "}
            <span class="chip">đã xoá</span>
          </>
        )}
        {r.rule_id != null && (
          <>
            {" "}
            <span class="chip">tự gán</span>
          </>
        )}
        {(r.note || context) && <div class="sub-line">{[r.note && maskAmounts(r.note), context].filter(Boolean).join(" · ")}</div>}
      </td>
      <td class={`num${sign === "+" ? " dk-in" : ""}${voided ? " dk-void" : ""}`}>
        {sign}
        {moneyDigits(r.amount)}
      </td>
    </tr>
  );
}

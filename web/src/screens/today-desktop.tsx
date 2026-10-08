// Hôm nay trên máy tính (≥1024px): cùng câu trả lời "còn bao nhiêu để chi", thêm mọi thứ cần để quyết định
// mà không phải bấm sang màn khác — từng phong bì chi tiêu, việc cần làm dạng danh sách, giao dịch gần đây.
// Chỉ dùng số /v1 đã trả: snapshot, logs chưa gán, lệnh chuyển tiền, giao dịch.

import { useEffect, useState } from "preact/hooks";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { formatVnd, groupDigits } from "../lib/money";
import { dayHeading, dayKey, heroLabel, shortDate, timeHM, weekLabel, weekMetaText } from "../lib/period";
import { txLabel, txSign } from "../lib/transactions";
import { loadPageSize, PAGE_SIZES, savePageSize, splitPage, txPagePath } from "../lib/tx-paging";
import type { BankLog, Bootstrap, Snapshot, TransferOrder, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, FirstLoadFailed, PageHeader, Skeleton } from "../ui/parts";
import { LogRow } from "./assign";
import { OtherEntrySheet } from "./other-entry-sheet";
import { GoalsCard, SpendableCashCard, WaterfallCard } from "./today";

export function TodayDesk() {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [income, setIncome] = useState(false);
  const sub = snap ? `${dayHeading(snap.day)} · ${weekLabel(snap.week.key, snap.week.start, snap.week.end)}` : "";
  const rejected = app.queue.filter((q) => q.memberId === app.member?.id && q.status === "rejected").length;
  const a = snap?.attention;
  // Snapshot cũ trong cache máy (trước khi server có `unallocatedIncome`) thì không có — coi như 0.
  const unallocated = a?.unallocatedIncome?.count ?? 0;
  const hasTodo = !!a && (rejected > 0 || a.drift.some((d) => driftOf(d) !== null) || a.pendingLogs > 0 || unallocated > 0 || a.transferOrdersPending > 0);

  return (
    <>
      <PageHeader
        title="Hôm nay"
        sub={sub}
        action={
          <button type="button" class="btn btn-primary" onClick={() => setIncome(true)}>
            Chia tiền
          </button>
        }
      />
      {!snap ? (
        <Card>
          {app.loadFailed ? <FirstLoadFailed online={app.online} onRetry={() => void refresh(true)} /> : <Skeleton rows={6} />}
        </Card>
      ) : (
        // Hai chồng: chính (số hero, phong bì, giao dịch) và phụ (việc cần làm, dòng thác, quỹ).
        // ≥1280px hai chồng đứng cạnh nhau; 1024–1279px các card xếp thành lưới hai cột (xem .dash trong CSS).
        <div class={hasTodo ? "dash" : "dash no-todo"}>
          <div class="dash-main">
            <Hero snap={snap} />
            <SpendWallets snap={snap} />
            <RecentTransactions title="Giao dịch gần đây" class="dash-recent" />
          </div>
          <div class="dash-side">
            {hasTodo && <Todo snap={snap} rejected={rejected} />}
            <div class="dash-cash">
              <SpendableCashCard snap={snap} />
            </div>
            <div class="dash-tiers">
              <WaterfallCard snap={snap} />
            </div>
            <div class="dash-goals">
              <GoalsCard snap={snap} />
            </div>
          </div>
        </div>
      )}
      {income && <OtherEntrySheet kind="income" amount={0} title="Ghi thu nhập và chia" onClose={() => setIncome(false)} />}
    </>
  );
}

/** Số hero như điện thoại, cộng phần "vì sao ra số này": từng phong bì góp bao nhiêu vào tổng. */
function Hero({ snap }: { snap: Snapshot }) {
  const t = snap.tiers;
  const hero = heroLabel(snap.spendableThisWeek);
  const line = (id: string) => snap.wallets.find((w) => w.id === id);
  return (
    <section class="hero dk-hero" aria-labelledby="hero-lab">
      <div class="dk-hero-in">
        <div class="dk-hero-main">
          <div class="lab" id="hero-lab">
            {hero.label}
          </div>
          <div class="big">
            <Money value={hero.amount} class={hero.over ? "neg" : ""} />
          </div>
          <div class="meta">{weekMetaText(snap.day, snap.week.end, snap.week.weeksLeftInMonth)}</div>
          <div class="split">
            <div>
              <div class="k">Đã khóa</div>
              <div class="v">
                <Money value={t.wealth_building.balance + t.tax.balance} />
              </div>
            </div>
            <div>
              <div class="k">Tài sản</div>
              <div class="v">
                <Money value={t.wealth_building.assets} />
              </div>
            </div>
            <div>
              <div class="k">Chờ đầu tư</div>
              <div class="v">
                <Money value={t.wealth_building.cash} />
              </div>
            </div>
          </div>
        </div>
        <div class="dk-hero-side">
          <div class="k">Cộng từ các phong bì</div>
          {snap.spendableByWallet.length === 0 ? (
            <p class="sub-line">Chưa có phong bì chi tiêu.</p>
          ) : (
            <ul class="dk-parts">
              {snap.spendableByWallet.map((p) => {
                const w = line(p.walletId);
                return (
                  <li key={p.walletId}>
                    <span class="min-w-0">
                      {p.name}
                      <span class="sub-line">
                        {w?.weekTarget != null ? (
                          <>
                            tuần đã chi {groupDigits(w.spentWeek ?? 0)} / {formatVnd(w.weekTarget)}
                          </>
                        ) : w?.balance != null ? (
                          w.balance > 0 ? (
                            <>
                              trong ví {formatVnd(w.balance)}, chia đều cho {snap.week.weeksLeftInMonth} tuần còn lại
                            </>
                          ) : (
                            <>ví đang âm, chưa bù thì không còn để chi</>
                          )
                        ) : null}
                      </span>
                    </span>
                    <Money value={p.amount} mono />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Việc cần làm: mỗi việc là một hàng bấm được dẫn thẳng tới chỗ làm, không chỉ một banner đếm số. */
function Todo({ snap, rejected }: { snap: Snapshot; rejected: number }) {
  const { boot } = useApp();
  const a = snap.attention;
  const unalloc = a.unallocatedIncome;
  const logs = useResource<BankLog[]>(a.pendingLogs > 0 ? "/v1/logs?status=pending" : null);
  const orders = useResource<TransferOrder[]>(a.transferOrdersPending > 0 ? "/v1/transfer-orders?status=pending" : null);
  const drift = a.drift.flatMap((d) => {
    const amount = driftOf(d);
    return amount === null ? [] : [{ accountId: d.accountId, name: d.name, amount }];
  });
  const total = rejected + drift.length + a.pendingLogs + (unalloc?.count ?? 0) + a.transferOrdersPending;
  const SHOW = 5;

  return (
    <Card class="dash-todo-card" title="Việc cần làm" right={<span class="hint">{total} việc</span>} flush>
      <div class="dash-todo">
        {rejected > 0 && (
          <>
            <div class="set-sub">Khoản nhập bị từ chối</div>
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

        {unalloc && unalloc.count > 0 && unalloc.oldestTxId !== null && (
          <>
            <div class="set-sub">Thu chưa chia</div>
            <button type="button" class="srow" onClick={() => openTx(unalloc.oldestTxId!)}>
              <span class="srow-main">
                <span class="srow-t">
                  {unalloc.count} khoản thu chưa chia (<Money value={unalloc.amount} tone={false} />)
                </span>
                <span class="srow-s">Tiền đang nằm ở ví Thu nhập.</span>
              </span>
              <span class="srow-r">
                Chia
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
          </>
        )}

        {a.transferOrdersPending > 0 && (
          <>
            <div class="set-sub">
              Chuyển tiền cần làm ({a.transferOrdersPending}
              {a.transferOrdersOverdue > 0 ? `, ${a.transferOrdersOverdue} quá 3 ngày` : ""})
            </div>
            {(orders.data ?? []).slice(0, SHOW).map((o) => (
              <button type="button" key={o.id} class="srow" onClick={() => go("wallets", { walletsTab: "transfers" })}>
                <span class="srow-main">
                  <span class="srow-t">
                    {o.from_name} → {o.to_name}
                  </span>
                  {o.wallet_names && <span class="srow-s">cho {o.wallet_names}</span>}
                  <span class="srow-s2 num">{o.memo}</span>
                </span>
                <span class="srow-r">
                  <Money value={o.amount} class="srow-amt" />
                  <Icon name="chevron-right" size={16} />
                </span>
              </button>
            ))}
            {(!orders.data || orders.data.length > SHOW) && (
              <button type="button" class="srow" onClick={() => go("wallets", { walletsTab: "transfers" })}>
                <span class="srow-t">{orders.data ? `Xem cả ${orders.data.length} lệnh` : `${a.transferOrdersPending} lệnh chuyển tiền`}</span>
                <Icon name="chevron-right" size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Mọi phong bì chi tiêu: tuần và tháng — dự kiến, đã chi, còn — cạnh nhau, và số thật còn trong ví. */
function SpendWallets({ snap }: { snap: Snapshot }) {
  const lines = snap.wallets.filter((w) => (w.tier === "must" || w.tier === "nice") && w.kind === "envelope");
  const cell = (v: number | null, tone = true) => (v === null ? "" : <Money value={v} unit={false} mono tone={tone} />);
  return (
    <Card
      class="dash-wallets"
      title="Phong bì chi tiêu"
      right={<span class="hint">{weekLabel(snap.week.key, snap.week.start, snap.week.end)} · ₫</span>}
      flush
      note="Còn tuần = dự kiến tuần trừ đã chi tuần. Trong ví là số thật, gồm cả phần dồn từ tuần trước và phần vượt chưa bù."
    >
      {lines.length === 0 ? (
        <Empty title="Chưa có phong bì chi tiêu." />
      ) : (
        <div class="table-wrap">
          <table class="data dk-table dk-env">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Ví
                </th>
                <th scope="colgroup" colSpan={3} class="dk-group">
                  Tuần này
                </th>
                <th scope="col" rowSpan={2}>
                  Đã chi tháng
                </th>
                <th scope="col" rowSpan={2}>
                  Trong ví
                </th>
              </tr>
              <tr>
                <th scope="col">Dự kiến</th>
                <th scope="col">Đã chi</th>
                <th scope="col">Còn</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((w) => {
                const weekLeft = w.weekTarget !== null ? w.weekTarget - (w.spentWeek ?? 0) : null;
                const monthUsed = w.monthTarget && w.spentMonth !== null ? Math.round((100 * w.spentMonth) / w.monthTarget) : null;
                return (
                  <tr key={w.id}>
                    <td>
                      {w.name}
                      <div class="sub-line">{w.tier === "nice" ? "Hưởng thụ" : w.mustGroup === "have" ? "Có thì tốt" : "Must"}</div>
                    </td>
                    <td class="num">{cell(w.weekTarget)}</td>
                    <td class="num">{cell(w.spentWeek, false)}</td>
                    <td class="num">{cell(weekLeft)}</td>
                    {/* Dự kiến tháng đã có ở Ví & quỹ › Ngân sách; ở đây bỏ cột đó để tên ví không bị ép xuống 4–5 dòng (audit 261001 F16). */}
                    <td class="num">
                      {cell(w.spentMonth, false)}
                      {monthUsed !== null && monthUsed > 100 && (
                        <div>
                          <span class="chip bad">{monthUsed}%</span>
                        </div>
                      )}
                    </td>
                    <td class="num">
                      <strong>{cell(w.balance)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Giao dịch mới nhất trong sổ (GET /v1/transactions). Dùng ở Hôm nay và màn Nhập (điện thoại: dưới form).
 * Chạm một dòng mở chi tiết để sửa / xoá (UC-715). Chia trang: cỡ trang chọn được (nhớ theo máy), Trang trước /
 * Trang sau theo con trỏ `before`; giữ ngăn xếp con trỏ để lùi lại.
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
      <button type="button" class="btn pager-prev" disabled={busy || cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
        Trang trước
      </button>
      <span class="pager-at" aria-live="polite">
        {res.loading ? "Đang tải…" : `Trang ${cursors.length + 1}`}
      </span>
      <button
        type="button"
        class="btn pager-next"
        disabled={busy || !page?.hasNext}
        onClick={() => page && setCursors((c) => [...c, page.rows[page.rows.length - 1]!.id])}
      >
        Trang sau
      </button>
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
                  <th scope="col">Số tiền ₫</th>
                </tr>
              </thead>
              <tbody>{page.rows.map((r) => <TxLine key={r.id} r={r} boot={boot} />)}</tbody>
            </table>
            {pager}
            <div class="pad" style={{ paddingTop: 0, paddingBottom: "12px" }}>
              <button type="button" class="btn" style={{ width: "100%" }} onClick={() => go("ledger", { book: null })}>
                Mở Sổ giao dịch — xem theo tháng, lọc, tìm
              </button>
            </div>
          </>
        )
      ) : res.loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <Empty title={res.error?.offline ? "Không có mạng." : "Chưa tải được giao dịch."}>
            <div style={{ marginTop: "10px" }}>
              <button type="button" class="btn" onClick={res.reload}>
                Tải lại
              </button>
            </div>
          </Empty>
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
  const context = [r.wallet_name, acct, who].filter(Boolean).join(" · ");
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
        {(r.note || context) && <div class="sub-line">{[r.note, context].filter(Boolean).join(" · ")}</div>}
      </td>
      <td class={`num${sign === "+" ? " dk-in" : ""}${voided ? " dk-void" : ""}`}>
        {sign}
        {groupDigits(r.amount)}
      </td>
    </tr>
  );
}

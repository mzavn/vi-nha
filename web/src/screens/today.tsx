// Hôm nay — mở app là thấy câu trả lời: thẻ Vận hành (chi khoảng bao nhiêu mỗi ngày tới ngày lương, gợi ý hôm nay, các hàng trạng
// thái: khoản phải trả, nợ ngắn hạn, tuổi tiền; nhắc chuyển thêm), thẻ Tháng dư, thẻ Trích Tích luỹ, rồi thẻ Tích luỹ và thẻ Dự phòng — ba ngăn đọc
// `snapshot.pockets` (ADR-122).
// Banner chỉ hiện khi có việc phải làm.

import { type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { OperatingGoal } from "../../../src/domain/pockets";
import { api, errorText } from "../lib/api";
import { conversionBanner } from "../lib/convert";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { EMPTY_STATES } from "../lib/empty-states";
import { monthAmountBody, nearSpendCard } from "../lib/near-spend";
import { savingsTaskCard, topUpQr } from "../lib/month-tasks";
import { formatVnd, maskAmounts, moneyDigits } from "../lib/money";
import { dayHeading, dayKey, shortDate, timeHM, weekLabel } from "../lib/period";
import { txLabel, txSign } from "../lib/transactions";
import type { Snapshot, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, syncNow, toast, useApp, viewSnapshot } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Banner, Card, CardHead, Empty, FirstLoadFailed, InfoTip, PageHeader, Sheet, Skeleton, TxRow as TxRowView } from "../ui/parts";
import { MonthCloseCard } from "./month-close-card";
import { QrSheet, SavingsDoneRow, SavingsTaskCard } from "./savings-card";
import { OtherEntrySheet } from "./other-entry-sheet";

const toPockets = () => go("settings", { settingsFocus: "pockets" });

export function Today() {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [income, setIncome] = useState(false);

  const sub = snap ? `${dayHeading(snap.day)} · ${weekLabel(snap.week.key, snap.week.start, snap.week.end)}` : "";
  return (
    <>
      <PageHeader
        title="Hôm nay"
        sub={sub}
        action={
          <div class="flex items-center gap-1">
            {/* Cài đặt là điều hướng phụ: nút bánh răng không viền cạnh hành động chính, không thành tab thứ năm. */}
            <button type="button" class="btn btn-ghost icon-btn" aria-label="Cài đặt" onClick={() => go("settings")}>
              <Icon name="settings" size={20} />
            </button>
            <button type="button" class="btn btn-primary" onClick={() => setIncome(true)}>
              Ghi tiền vào
            </button>
          </div>
        }
      />
      <FreshnessRow />
      {!snap ? (
        <Card>
          {app.loadFailed ? <FirstLoadFailed online={app.online} onRetry={() => void refresh(true)} /> : <Skeleton rows={4} />}
        </Card>
      ) : (
        <TodayBody snap={snap} />
      )}
      {income && <OtherEntrySheet kind="income" amount={0} title="Ghi tiền vào" onClose={() => setIncome(false)} />}
    </>
  );
}

/** "số lúc HH:mm" khi đang hiện số cũ, kèm số khoản chờ đồng bộ (UC-711 AC-38). */
export function FreshnessRow() {
  const { stale, snap, queue, member, online, syncing } = useApp();
  const pending = queue.filter((q) => q.memberId === member?.id && q.status === "pending").length;
  if (!stale && !pending && online) return null;
  return (
    <div class="status-row" role="status">
      {!online && (
        <span class="chip">
          <Icon name="cloud-off" size={12} /> {pending > 0 ? `Chưa có mạng · ${pending} khoản sẽ tự gửi khi có mạng` : "Chưa có mạng"}
        </span>
      )}
      {online && pending > 0 && <span class="chip warn">{pending} khoản đang chờ gửi</span>}
      {stale && snap && <span>số lúc {timeHM(snap.at)}{shortDate(snap.at) !== shortDate(new Date().toISOString()) ? ` ngày ${shortDate(snap.at)}` : ""}</span>}
      <button type="button" class="btn" onClick={() => void syncNow()} disabled={syncing}>
        <Icon name="sync" size={14} />
        {syncing ? "Đang đồng bộ…" : "Đồng bộ"}
      </button>
    </div>
  );
}

function TodayBody({ snap }: { snap: Snapshot }) {
  const { queue, member, compact } = useApp();
  const rejected = queue.filter((q) => q.memberId === member?.id && q.status === "rejected").length;
  const convert = conversionBanner(snap.conversion);

  if (compact) {
    return (
      <>
        {rejected > 0 && (
          <Banner tone="bad" mark={String(rejected)} action="Xem" onAction={() => go("entry")}>
            <strong>{rejected} khoản nhập bị máy chủ từ chối.</strong> Nằm trong hàng đợi, chờ sửa hoặc bỏ.
          </Banner>
        )}
        <NearSpendCard snap={snap} compact />
        <RecentCard />
      </>
    );
  }

  return (
    <>
      {/* Màn chuyển đổi còn dở (UC-702 AC-27): banner đứng đầu. */}
      {convert && (
        <Banner tone="info" mark="›" action="Mở" onAction={() => (location.hash = "#convert")}>
          <strong>{convert}</strong>
        </Banner>
      )}
      <NearSpendCard snap={snap} />
      <MonthCloseCard snap={snap} />
      <SavingsTaskCard snap={snap} />
      <NeedReviewBlock snap={snap} rejected={rejected} />
      <RecentCard />
    </>
  );
}

function NeedReviewBlock({ snap, rejected }: { snap: Snapshot; rejected: number }) {
  const a = snap.attention;
  const drift = a.drift.flatMap((d) => {
    const amount = driftOf(d);
    return amount === null ? [] : [{ name: d.name, amount }];
  });

  const hasItems = rejected > 0 || drift.length > 0 || a.pendingLogs > 0;
  if (!hasItems) return null;

  return (
    <Card title="Cần xem" flush>
      <div class="dash-todo">
        {rejected > 0 && (
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
        )}
        {drift.map((d) => (
          <button type="button" key={d.name} class="srow" onClick={() => go("wallets", { walletsTab: "accounts" })}>
            <span class="srow-main">
              <span class="srow-t">Lệch đối soát ở {d.name}</span>
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
        {a.pendingLogs > 0 && (
          <button type="button" class="srow" onClick={() => go("assign")}>
            <span class="srow-main">
              <span class="srow-t">{a.pendingLogs} giao dịch ngân hàng chưa gán</span>
              <span class="srow-s">
                vào trừ ra <Money value={a.pendingNet} tone={false} />
              </span>
            </span>
            <span class="srow-r">
              <span class="chip warn">chưa gán</span>
              <Icon name="chevron-right" size={16} />
            </span>
          </button>
        )}
      </div>
    </Card>
  );
}

function RecentCard() {
  const { boot } = useApp();
  const res = useResource<TxRow[]>("/v1/transactions?limit=5");
  const rows = (res.data ?? []).slice(0, 5);

  return (
    <Card
      title="Gần đây"
      flush
      right={
        <button type="button" class="link link-more" onClick={() => go("ledger", { book: null })}>
          Mở Sổ ›
        </button>
      }
    >
      {res.loading && !res.data ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <Empty state={EMPTY_STATES.recent} onAction={() => go("entry")} />
      ) : (
        <div class="pad recent-list">
          {rows.map((r) => {
            const sign = txSign(r);
            const acct = boot?.accounts.find((x) => x.id === r.account_id)?.name;
            return (
              <TxRowView
                key={r.id}
                title={txLabel(r)}
                chip={
                  <>
                    {r.status !== "active" && <span class="chip">đã xoá</span>}
                    {r.rule_id != null && <span class="chip">tự gán</span>}
                  </>
                }
                sub={[timeHM(r.at), r.note && maskAmounts(r.note), acct].filter(Boolean).join(" · ")}
                amount={<span class={sign === "+" ? "pos" : undefined}>{sign}{moneyDigits(r.amount)}</span>}
                deleted={r.status !== "active"}
                onClick={() => openTx(r.id, r)}
                ariaLabel={`Xem ${txLabel(r)} ${formatVnd(r.amount)}`}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * Hàng trạng thái của thẻ Vận hành (DESIGN §4.5): nhãn một dòng (+ dòng phụ) trái, giá trị phải, một "›" khi bấm được. Cả hàng
 * bấm được nhờ nút trên nhãn phủ kín hàng (::after); nút ⓘ nằm ngoài nút hàng, giải thích mở thành khối riêng dưới nhãn.
 */
function NearRow({
  label,
  tip,
  note,
  value,
  onClick,
  aria,
}: {
  label: ComponentChildren;
  tip?: ComponentChildren;
  note?: string | null;
  value: string;
  onClick?: () => void;
  aria?: string;
}) {
  const isDone = /[✓✔☑]/.test(value);
  const valEl = isDone ? (
    <span class="inline-flex items-center gap-1">
      {value.replace(/[✓✔☑]/g, "").trim()}
      <Icon name="check" size={16} />
    </span>
  ) : (
    value
  );
  return (
    <div class={onClick ? "near-row is-btn" : "near-row"}>
      <span class="near-row-l">
        <span class="near-row-t">
          {onClick ? (
            <button type="button" class="near-row-btn" onClick={onClick} aria-label={aria}>
              {label}
            </button>
          ) : (
            <span class="near-row-lab">{label}</span>
          )}
          {tip}
        </span>
        {note && <span class="near-row-n">{note}</span>}
      </span>
      <span class="near-row-r">
        <span class="near-row-v">{valEl}</span>
        {onClick && <Icon name="chevron-right" size={16} />}
      </span>
    </div>
  );
}

/**
 * Thẻ Vận hành (ADR-122, ADR-141): số chính "Chi khoảng X/ngày" kèm dòng phụ "còn {tổng} · {n} ngày tới lương {d/m}"; khối vàng
 * nhắc chuyển thêm (Mở QR từng nguồn); hai ô gợi ý hôm nay (bữa ăn, đi chợ); các hàng trạng thái (`NearStatusRows`); chân nhỏ
 * nhạt: tài khoản thuộc Vận hành + Đổi ngăn. Máy tính (`rowsApart`) đưa các hàng trạng thái sang cột phụ (`NearStatusCard`).
 * Snapshot cũ trong cache chưa có `nearSpend` thì không hiện.
 */
export function NearSpendCard({ snap, compact, rowsApart }: { snap: Snapshot; compact?: boolean; rowsApart?: boolean }) {
  const [qrFrom, setQrFrom] = useState<string | null>(null);
  if (!snap.nearSpend) return null;
  const today = dayKey(new Date());
  const topUp = snap.topUp ?? null;
  const v = nearSpendCard(snap.nearSpend, today, snap.pockets, topUp, snap.moneyAge ?? null);
  const perDayNum = v.perDay ? v.perDay.replace(/\/ngày$/, "") : null;

  return (
    <section class="card near" aria-labelledby="near-lab">
      <CardHead
        pocket="operating"
        title={
          <span class="card-head-title-wrap">
            Vận hành
            <InfoTip term="operating" />
          </span>
        }
        action={compact ? undefined : "Đổi ngăn ›"}
        onAction={compact ? undefined : toPockets}
        id="near-lab"
      />
      {perDayNum ? (
        <>
          <div class="near-lead">Chi khoảng</div>
          <div class="near-big">
            <span class="near-num">{perDayNum}</span>
            <span class="unit">/ngày</span>
          </div>
        </>
      ) : (
        v.big && <div class="near-say">{v.big}</div>
      )}
      <div class="near-ctx">
        {v.amount && (
          <>
            còn <b class={v.out ? "neg" : undefined}>{v.amount}</b> ·{" "}
          </>
        )}
        {v.days}
      </div>
      {v.sub && <div class="near-sub">{v.sub}</div>}
      {!compact && v.topUp && (
        <div class="near-topup" role="status">
          <strong>{v.topUp.title}</strong>
          {v.topUp.sources.map((s) => (
            <div class="near-topup-row" key={s.accountId}>
              <span class="min-w-0">{s.text}</span>
              {s.qr && (
                <button type="button" class="btn" onClick={() => setQrFrom(s.accountId)}>
                  Mở QR
                </button>
              )}
            </div>
          ))}
          {v.topUp.missing && <p>{v.topUp.missing}</p>}
          {v.topUp.hint && <p>{v.topUp.hint}</p>}
        </div>
      )}
      {v.meals.length > 0 && (
        <div class="near-tiles">
          {v.meals.map((m) => (
            <div class="near-tile" key={m.label}>
              <span class="near-tile-l">{m.label}</span>
              <span class="near-tile-v">{m.value}</span>
            </div>
          ))}
        </div>
      )}
      {!compact && !rowsApart && <NearStatusRows snap={snap} />}
      {!compact && (
        <div class="near-foot">
          <span class="min-w-0">{v.source}</span>
        </div>
      )}
      {!compact && v.unconfirmed && (
        <button type="button" class="chip warn near-chip" onClick={toPockets}>
          {v.unconfirmed}
        </button>
      )}
      {qrFrom && topUp && <QrSheet qrOf={() => topUpQr(topUp, qrFrom, today)} onClose={() => setQrFrom(null)} />}
    </section>
  );
}

/** Máy tính: các hàng trạng thái của Vận hành và hàng Tiết kiệm tháng này thành một thẻ ở cột phụ (lưới 8–4). */
export function NearStatusCard({ snap }: { snap: Snapshot }) {
  const { online } = useApp();
  if (!snap.nearSpend) return null;
  const v = nearSpendCard(snap.nearSpend, dayKey(new Date()), snap.pockets, snap.topUp ?? null, snap.moneyAge ?? null);
  const savings = savingsTaskCard(snap.month, online)?.collapsed ?? null;
  const hasRows = !v.noAccounts && !!(v.reserved || v.debt || v.age || v.blessing || v.payday || v.pending);
  if (!hasRows && !savings) return null;
  return (
    <section class="card near near-status" aria-label="Vận hành tháng này">
      {hasRows && <NearStatusRows snap={snap} />}
      <SavingsDoneRow snap={snap} />
    </section>
  );
}

/** Các hàng trạng thái: khoản phải trả tháng này (chạm → danh sách), nợ ngắn hạn (chạm → trả nợ) hay lời chúc, tuổi tiền (UC-702 AC-41). */
function NearStatusRows({ snap }: { snap: Snapshot }) {
  const { boot } = useApp();
  const [list, setList] = useState(false);
  const [edit, setEdit] = useState<OperatingGoal | null>(null);
  const today = dayKey(new Date());
  const v = nearSpendCard(snap.nearSpend, today, snap.pockets, snap.topUp ?? null, snap.moneyAge ?? null);
  if (v.noAccounts) return null;

  const shortDebtItems = snap.pockets?.shortDebt?.items ?? [];
  const dayNum = Number(today.slice(8, 10));
  const dated = shortDebtItems.filter((x) => x.dueDay !== null);
  const soon = dated.find((x) => x.dueDay! >= dayNum) ?? dated[0];
  const targetDebt = soon ?? [...shortDebtItems].sort((a, b) => b.balance - a.balance)[0];

  return (
    <div class="near-side">
      {v.reserved && (
        <NearRow
          label="Khoản phải trả tháng này"
          tip={<InfoTip term="payables" />}
          note={v.reserved.note}
          value={v.reserved.value}
          onClick={() => setList(true)}
        />
      )}
      {v.debt && (
        <NearRow
          label="Nợ ngắn hạn"
          note={v.debt.next ? `${v.debt.sub} · ${v.debt.next}` : v.debt.sub}
          value={v.debt.value}
          aria={`Trả nợ ngắn hạn, còn ${v.debt.value}`}
          onClick={() => go("wallets", targetDebt ? { walletsTab: "debts", debtPayId: targetDebt.id } : { walletsTab: "debts" })}
        />
      )}
      {v.age && <NearRow label="Tuổi tiền" tip={<InfoTip term="moneyAge" />} note={v.age.note} value={v.age.value} />}
      {v.blessing && <p class="near-note">{v.blessing}</p>}
      {v.payday && <p class="near-note">{v.payday}</p>}
      {v.pending && <p class="near-note">{v.pending}</p>}
      {list && v.reserved && !edit && (
        <Sheet open title="Khoản phải trả tháng này" onClose={() => setList(false)}>
          {v.reserved.items.map((g) => {
            const goalObj = snap.pockets.operating.goals?.find((o) => o.id === g.id);
            const remaining = goalObj?.remaining ?? 0;
            const catIds = goalObj?.categoryIds ?? [];
            const firstCatId = boot?.categories
              ?.filter((c) => catIds.includes(c.id))
              ?.sort((a, b) => a.name.localeCompare(b.name, "vi"))[0]?.id ?? null;
            return (
              <div class="srow" key={g.id}>
                <button
                  type="button"
                  class="srow-btn"
                  onClick={() => setEdit(goalObj ?? null)}
                >
                  <div>{g.title} ›</div>
                  {g.month && <div class="sub-line">{g.month}</div>}
                  <div class="sub-line">{g.spent}</div>
                </button>
                {remaining > 0 && (
                  <button
                    type="button"
                    class="link link-pay"
                    onClick={() => {
                      setList(false);
                      go("entry", {
                        entryPreset: {
                          back: "today",
                          goal_id: g.id,
                          category_id: firstCatId,
                          amount: remaining,
                        },
                      });
                    }}
                  >
                    Trả ›
                  </button>
                )}
              </div>
            );
          })}
          <p class="fhint pad">Chạm một khoản để đặt số cho riêng tháng này; tháng sau về số mỗi tháng.</p>
        </Sheet>
      )}
      {edit && <MonthAmountSheet goal={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/**
 * Số tháng này của một khoản phải trả (UC-702 AC-37, ADR-143 sửa theo ADR-144): điền sẵn số tháng này, lý do ≤ 80 ký tự, 0 được;
 * "Về số mỗi tháng" khi đang có số riêng. Lưu `PUT /v1/goal-month-amounts/:goalId` xong tải lại snapshot.
 */
function MonthAmountSheet({ goal, onClose }: { goal: OperatingGoal; onClose: () => void }) {
  const custom = goal.monthAmount !== null;
  const [amount, setAmount] = useState<number | null>(goal.monthAmount ?? goal.monthly);
  const [note, setNote] = useState(goal.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save(value: number | null) {
    setBusy(true);
    try {
      await api.put(`/v1/goal-month-amounts/${encodeURIComponent(goal.id)}`, monthAmountBody(value, note));
      await refresh(true);
      onClose();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open title={`${goal.name} · tháng này`} onClose={onClose}>
      <div class="field">
        <label for="month-amount">Số tháng này</label>
        <AmountInput id="month-amount" value={amount ?? 0} onChange={(n, valid) => setAmount(valid || n === 0 ? n : null)} />
      </div>
      <div class="field">
        <label for="month-note">Lý do</label>
        <input id="month-note" class="ctl" maxLength={80} value={note} placeholder="Không bắt buộc" onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <p class="fhint">
        Mỗi tháng <Money value={goal.monthly} />. Chỉ đổi tháng này, 0 = tháng này không trả.
      </p>
      <div class="sheet-foot">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || amount === null} onClick={() => void save(amount)}>
          Lưu
        </button>
        {custom && (
          <button type="button" class="btn btn-wide month-amount-reset" disabled={busy} onClick={() => void save(null)}>
            Về số mỗi tháng
          </button>
        )}
      </div>
    </Sheet>
  );
}



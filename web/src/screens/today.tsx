// Hôm nay — mở app là thấy câu trả lời: thẻ Vận hành (tổng và chi khoảng bao nhiêu mỗi ngày tới kỳ lương), thẻ Việc ngày lương,
// rồi thẻ Tích luỹ và thẻ Dự phòng — ba ngăn đọc `snapshot.pockets` (ADR-122). Banner chỉ hiện khi có việc phải làm.

import { useState } from "preact/hooks";
import { conversionBanner } from "../lib/convert";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { nearSpendCard } from "../lib/near-spend";
import { dayHeading, dayKey, shortDate, timeHM, weekLabel } from "../lib/period";
import { NO_SAVINGS_ACCOUNT, reserveCard, savingsCard } from "../lib/pocket-cards";
import type { Snapshot } from "../lib/types";
import { go, refresh, syncNow, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Banner, Bar, Card, FirstLoadFailed, PageHeader, Skeleton, TierRow } from "../ui/parts";
import { PayCycleCard } from "./pay-cycle-card";
import { OtherEntrySheet } from "./other-entry-sheet";

const toPockets = () => go("settings", { settingsFocus: "pockets" });
const toPocketGoals = () => go("settings", { settingsFocus: "pocket-goals" });

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
              Tiền vào
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
      {income && <OtherEntrySheet kind="income" amount={0} title="Ghi thu nhập" onClose={() => setIncome(false)} />}
    </>
  );
}

/** "số lúc HH:mm" khi đang hiện số cũ, kèm số khoản chờ đồng bộ. */
function FreshnessRow() {
  const { stale, snap, queue, member, online, syncing } = useApp();
  const pending = queue.filter((q) => q.memberId === member?.id && q.status === "pending").length;
  if (!stale && !pending && online) return null;
  return (
    <div class="status-row" role="status">
      {!online && (
        <span class="chip">
          <Icon name="cloud-off" size={12} /> không có mạng
        </span>
      )}
      {stale && snap && <span>số lúc {timeHM(snap.at)}{shortDate(snap.at) !== shortDate(new Date().toISOString()) ? ` ngày ${shortDate(snap.at)}` : ""}</span>}
      {pending > 0 && <span class="chip warn">{pending} chờ đồng bộ, đã trừ tạm</span>}
      <button type="button" class="btn" onClick={() => void syncNow()} disabled={syncing}>
        <Icon name="sync" size={14} />
        {syncing ? "Đang đồng bộ…" : "Đồng bộ"}
      </button>
    </div>
  );
}

function TodayBody({ snap }: { snap: Snapshot }) {
  const { queue, member } = useApp();
  const rejected = queue.filter((q) => q.memberId === member?.id && q.status === "rejected").length;
  const a = snap.attention;
  const convert = conversionBanner(snap.conversion);
  const drift = a.drift.flatMap((d) => {
    const amount = driftOf(d);
    return amount === null ? [] : [{ name: d.name, amount }];
  });

  return (
    <>
      {/* Màn chuyển đổi còn dở (UC-702 AC-27): banner đứng đầu. */}
      {convert && (
        <Banner tone="info" mark="›" action="Mở" onAction={() => (location.hash = "#convert")}>
          <strong>{convert}</strong>
        </Banner>
      )}
      <NearSpendCard snap={snap} />
      <PayCycleCard snap={snap} />

      {rejected > 0 && (
        <Banner tone="bad" mark={String(rejected)} action="Xem" onAction={() => go("entry")}>
          <strong>{rejected} khoản nhập bị máy chủ từ chối.</strong> Nằm trong hàng đợi, chờ sửa hoặc bỏ.
        </Banner>
      )}
      {drift.map((d) => (
        <Banner key={d.name} tone="bad" mark="!" action="Đối soát" onAction={() => go("wallets", { walletsTab: "accounts" })}>
          <strong>Lệch đối soát ở {d.name}.</strong> {DRIFT_LABEL}: <Money value={d.amount} signed tone={false} />.
        </Banner>
      ))}
      {a.pendingLogs > 0 && (
        <Banner tone="warn" mark={String(a.pendingLogs)} action="Gán" onAction={() => go("assign")}>
          <strong>{a.pendingLogs} giao dịch ngân hàng chưa gán</strong>, vào trừ ra <Money value={a.pendingNet} tone={false} />.
        </Banner>
      )}

      {/* Lối vào Sổ giao dịch trên điện thoại (UC-716) — chủ nhà: "không xem được trên mobile cái chi tiết các bản ghi à? tôi tìm không thấy". */}
      <Card flush class="card-invert">
        <TierRow
          name={
            <>
              <Icon name="book" size={16} /> Sổ giao dịch
            </>
          }
          dot={null}
          amount={<span class="link-more">Mở <Icon name="chevron-right" size={14} /></span>}
          left="Xem lại theo tháng, lọc, tìm, sửa các khoản đã ghi"
          onClick={() => go("ledger", { book: null })}
          label="Mở Sổ giao dịch"
        />
      </Card>

      <SavingsCard snap={snap} />
      <ReserveCard snap={snap} />
    </>
  );
}

/**
 * Thẻ Vận hành (ADR-122): tổng ngăn Vận hành và chi khoảng bao nhiêu mỗi ngày tới kỳ lương — hai số to cùng cỡ — rồi bữa ăn /
 * lần đi chợ, nợ ngắn hạn cần trả (chỉ nhắc) hay lời chúc. Snapshot cũ trong cache chưa có `nearSpend` thì không hiện.
 */
export function NearSpendCard({ snap }: { snap: Snapshot }) {
  if (!snap.nearSpend) return null;
  const v = nearSpendCard(snap.nearSpend, dayKey(new Date()), snap.pockets);
  return (
    <section class="hero near" aria-labelledby="near-lab">
      <div class="lab" id="near-lab">
        {v.head}
      </div>
      {!v.noAccounts && (
        <>
          <div class={v.out ? "near-total out" : "near-total"}>Còn {v.amount}</div>
          {v.perDay ? (
            <div class="near-big">
              Chi khoảng <span class="nowrap">{v.perDay}</span>
            </div>
          ) : (
            <div class="near-say">{v.big}</div>
          )}
          {v.sub && <div class="meta">{v.sub}</div>}
          {v.meals.map((line) => (
            <p key={line} class="near-meals">
              {line}
            </p>
          ))}
          {v.payday && <p class="near-note">{v.payday}</p>}
          {v.debt && (
            <div class="near-debt">
              <div class="near-foot">
                <span class="min-w-0">{v.debt.line}</span>
                <button type="button" class="link" onClick={() => go("wallets", { walletsTab: "debts" })}>
                  Trả ›
                </button>
              </div>
              {v.debt.next && <div class="sub-line">{v.debt.next}</div>}
            </div>
          )}
          {v.blessing && <p class="near-debt">{v.blessing}</p>}
        </>
      )}
      <div class="near-foot">
        <span class="min-w-0">{v.source}</span>
        <button type="button" class="link" onClick={toPockets}>
          Đổi ngăn ›
        </button>
      </div>
      {v.unconfirmed && (
        <button type="button" class="chip warn near-chip" onClick={toPockets}>
          {v.unconfirmed}
        </button>
      )}
      {v.late && <p class="near-note">{v.late}</p>}
      {v.pending && <p class="near-note">{v.pending}</p>}
    </section>
  );
}

/** Thẻ Tích luỹ (ADR-122): tiền thật ở ngăn, thay đổi kỳ này / kỳ trước, % trích. Bản lưu chưa có `pockets` thì không hiện. */
export function SavingsCard({ snap }: { snap: Snapshot }) {
  const v = savingsCard(snap.pockets, snap.payCycle);
  if (!v) return null;
  const open = () => go("wallets", { walletsTab: "wealth-building" });
  return (
    <section class="card pocket pocket-savings" onClick={v.empty ? undefined : open}>
      <button type="button" class="pocket-h" onClick={v.empty ? toPockets : undefined}>
        <h2>Tích luỹ</h2>
        <span class="link-more">
          {v.empty ? "Ba ngăn" : "Xem"} <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {v.empty ? (
        <button type="button" class="link pocket-empty" style={{ textAlign: "left" }} onClick={toPockets}>
          {NO_SAVINGS_ACCOUNT}
        </button>
      ) : (
        <>
          <div class="pocket-total">{v.total}</div>
          <ul class="hero-parts">
            {v.lines.map((l) => (
              <li key={l.label}>
                <span>{l.label}</span>
                <span>{l.value}</span>
              </li>
            ))}
          </ul>
          <div class="pocket-meta">
            <p>{v.change}</p>
            <p>{v.prev}</p>
            <p>{v.pct}</p>
            {v.done && <p>{v.done}</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** Thẻ Dự phòng (ADR-122, ADR-132): mỗi mục tiêu là một tài khoản thật, rồi phần an tâm đo bằng tháng vận hành, Ví Thưởng. */
export function ReserveCard({ snap }: { snap: Snapshot }) {
  const v = reserveCard(snap.pockets);
  if (!v) return null;
  return (
    <section class="card pocket pocket-reserve">
      <button type="button" class="pocket-h" onClick={v.empty ? toPockets : toPocketGoals}>
        <h2>Dự phòng</h2>
        <span class="link-more">
          {v.empty ? "Xếp tài khoản vào ngăn" : "Mục tiêu"} <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {v.empty ? (
        <p class="pocket-empty">Chưa có tài khoản nào ở ngăn Dự phòng.</p>
      ) : (
        <>
          <div class="pocket-total">{v.total}</div>
          {v.goals.map((g) => (
            <div class="tier" key={g.id}>
              <div class="nm">
                {g.name}
                {g.full && <span class="chip ok">đủ</span>}
              </div>
              <div class="amt">{g.pct !== null ? `${g.pct}%` : ""}</div>
              <div class="tsub">
                <span>{g.amount}</span>
              </div>
              {g.pct !== null && <Bar pct={g.pct} tone="ok" />}
              {g.sub && (
                <div class="tsub">
                  <span>{g.sub}</span>
                </div>
              )}
              {g.needsAccount && (
                <button type="button" class="link" onClick={toPocketGoals}>
                  Mở tài khoản thật ›
                </button>
              )}
            </div>
          ))}
          <div class="tier">
            <div class={v.peace.bad ? "nm bad" : "nm"}>{v.peace.title}</div>
            <div class="amt">{v.peace.pct !== null ? `${v.peace.pct}%` : ""}</div>
            {v.peace.months && (
              <div class="tsub">
                <span>{v.peace.months}</span>
              </div>
            )}
            {v.peace.pct !== null && <Bar pct={v.peace.pct} tone="ok" />}
            {v.peace.note && (
              <div class="tsub">
                <span>{v.peace.note}</span>
              </div>
            )}
          </div>
          {v.reward && (
            <div class="tier">
              <div class="nm">{v.reward}</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

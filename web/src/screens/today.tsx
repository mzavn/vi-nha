// Hôm nay — mở app là thấy câu trả lời: còn bao nhiêu để chi tuần này (snapshot.spendableThisWeek).
// Banner chỉ hiện khi có việc phải làm. Không có banner "mọi thứ ổn".

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { orderSpendable } from "../lib/budget";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { formatVnd } from "../lib/money";
import { dayHeading, heroLabel, monthLabel, shortDate, timeHM, weekLabel, weekMetaText } from "../lib/period";
import { spendableCashView } from "../lib/spendable-cash";
import { safetyFundCashText, safetyFundMonthsText } from "../lib/wealth-building";
import type { Snapshot } from "../lib/types";
import { go, openTx, refresh, syncNow, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Banner, Card, FirstLoadFailed, PageHeader, Skeleton, TierRow } from "../ui/parts";
import { OtherEntrySheet } from "./other-entry-sheet";

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : 0);
export const pctText = (n: number) => `${String(n).replace(".", ",")}%`;

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
              Chia tiền
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
      {income && <OtherEntrySheet kind="income" amount={0} title="Ghi thu nhập và chia" onClose={() => setIncome(false)} />}
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
  const t = snap.tiers;
  const rejected = queue.filter((q) => q.memberId === member?.id && q.status === "rejected").length;
  const parts = orderSpendable(snap.spendableByWallet);
  const hero = heroLabel(snap.spendableThisWeek);
  const a = snap.attention;
  // Snapshot cũ trong cache máy (trước khi server có trường này) thì không có — coi như không có khoản nào.
  const unalloc = a.unallocatedIncome;
  const drift = a.drift.flatMap((d) => {
    const amount = driftOf(d);
    return amount === null ? [] : [{ name: d.name, amount }];
  });

  return (
    <>
      <section class="hero" aria-labelledby="hero-lab">
        <div class="lab" id="hero-lab">
          {hero.label}
        </div>
        <div class="big">
          <Money value={hero.amount} class={hero.over ? "neg" : ""} />
        </div>
        <div class="meta">{weekMetaText(snap.day, snap.week.end, snap.week.weeksLeftInMonth)}</div>
        {hero.over && (
          <div class="meta" style={{ marginTop: "6px" }}>
            Các phong bì cộng lại đã chi quá dự kiến tuần này — xem từng ví ngay dưới.
          </div>
        )}
        {/* Số hero là tổng nhiều phong bì: ví âm phải lộ ra ngay dưới, không để ví còn dư che mất (DESIGN.md §1.3). */}
        {parts.length === 0 ? (
          <div class="meta">Chưa có phong bì chi tiêu</div>
        ) : (
          <ul class="hero-parts" aria-label="Cộng từ các phong bì">
            {parts.map((p) => (
              <li key={p.walletId}>
                <span class="min-w-0">{p.name}</span>
                <Money value={p.amount} />
              </li>
            ))}
          </ul>
        )}
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
      </section>

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
      {unalloc && unalloc.count > 0 && unalloc.oldestTxId !== null && (
        <Banner tone="warn" mark={String(unalloc.count)} action="Chia" onAction={() => openTx(unalloc.oldestTxId!)}>
          <strong>{unalloc.count} khoản thu chưa chia</strong> (<Money value={unalloc.amount} tone={false} />) — tiền đang nằm ở ví Thu nhập.
        </Banner>
      )}
      {a.transferOrdersPending > 0 && (
        <Banner tone="warn" mark={String(a.transferOrdersPending)} action="Làm" onAction={() => go("wallets", { walletsTab: "transfers" })}>
          <strong>{a.transferOrdersPending} lệnh chuyển tiền chưa làm</strong>
          {a.transferOrdersOverdue > 0 ? `, ${a.transferOrdersOverdue} quá 3 ngày.` : "."}
        </Banner>
      )}

      <SpendableCashCard snap={snap} />

      {/* Lối vào Sổ giao dịch trên điện thoại (UC-716) — chủ nhà: "không xem được trên mobile cái chi tiết các bản ghi à? tôi tìm không thấy". */}
      <Card flush>
        <TierRow
          name="Sổ giao dịch"
          dot={null}
          amount={<span class="link-more">Mở <Icon name="chevron-right" size={14} /></span>}
          left="Xem lại theo tháng, lọc, tìm, sửa các khoản đã ghi"
          onClick={() => go("ledger", { book: null })}
          label="Mở Sổ giao dịch"
        />
      </Card>

      <WaterfallCard snap={snap} />
      <GoalsCard snap={snap} />
    </>
  );
}

/**
 * Tiền chi được (ADR-85): tiền thật ở các tài khoản đang tính, trừ Tích sản và Thuế còn giữ — kê đủ dòng để không bí ẩn.
 * Section báo cáo riêng, không thay hero "Còn để chi tuần này". Snapshot cũ trong cache chưa có trường này thì không hiện.
 */
export function SpendableCashCard({ snap }: { snap: Snapshot }) {
  if (!snap.spendableCash) return null;
  const v = spendableCashView(snap.spendableCash, snap.attention.drift);
  return (
    <Card class="cash-card" title="Tiền chi được" right={<span class="hint">theo sổ</span>}>
      <div class={v.short ? "cash-big neg" : "cash-big"}>
        {v.short && "thiếu "}
        <Money value={v.amount} tone={false} />
      </div>
      <p class="cash-meta">{v.meta}</p>
      {v.lines.length > 0 && (
        <ul class="hero-parts" aria-label="Cộng từ các tài khoản">
          {v.lines.map((l) => (
            <li key={l.key}>
              <span class="min-w-0">
                {l.label}
                {l.note && <span class="cash-warn">{l.note}</span>}
              </span>
              <Money value={l.value} />
            </li>
          ))}
        </ul>
      )}
      <div class="cash-foot">
        <span class="min-w-0">{v.excluded ?? "Đang tính mọi tài khoản."}</span>
        <button type="button" class="link" onClick={() => go("settings", { settingsFocus: "accounts" })}>
          Đổi tài khoản
        </button>
      </div>
    </Card>
  );
}

/** Năm phe của dòng thác tháng này. Dùng chung cho Hôm nay ở điện thoại và bảng điều khiển máy tính. */
export function WaterfallCard({ snap }: { snap: Snapshot }) {
  const t = snap.tiers;
  const fund = snap.safetyFund;
  const covered = safetyFundMonthsText(fund);
  return (
    <Card title={`Dòng thác ${monthLabel(snap.month)}`} right={<span class="hint">rót từ trên xuống</span>} flush>
      <TierRow
        name="Tích sản"
        dot="lock"
        chip={<span class="chip lock">khóa</span>}
        amount={<Money value={t.wealth_building.balance} />}
        left={
          <>
            tiền {formatVnd(t.wealth_building.cash)} → tài sản {formatVnd(t.wealth_building.assets)}
          </>
        }
        right={covered !== null ? `quỹ an tâm ${covered} tháng` : undefined}
        bar={fund.pct !== null ? { pct: fund.pct, tone: "ok" } : null}
        onClick={() => go("wallets", { walletsTab: "wealth-building" })}
        label="Tích sản — xem chi tiết"
      />
      <TierRow name="Thuế" dot="lock" chip={<span class="chip lock">khóa</span>} amount={<Money value={t.tax.balance} />} left="Để riêng từ thu nhập chưa khấu trừ" />
      <GroupRow name="Hưởng thụ" dot="nice" tier="nice" g={t.nice} />
      <GroupRow name="Must" dot="must" tier="must" g={t.must} />
      <GroupRow name="Có thì tốt" dot="have" tier="have" g={t.have} chip={<span class="chip">phần còn lại</span>} />
      <div class="legend">
        <span>
          <i class="dot d-lock" /> khóa, không chạm
        </span>
        <span>
          <i class="dot d-nice" /> bóp trước khi thiếu
        </span>
        <span>
          <i class="dot d-have" /> nhận phần dư
        </span>
      </div>
    </Card>
  );
}

/** Quỹ an tâm và các quỹ có đích. */
export function GoalsCard({ snap }: { snap: Snapshot }) {
  const fund = snap.safetyFund;
  const covered = safetyFundMonthsText(fund);
  return (
    <Card
      title="Quỹ mục tiêu"
      flush
      note={fund.estimated ? "Mức Quỹ an tâm đang là ước tính từ ngân sách Must, vì chưa đủ 3 tháng chi thật. Đủ dữ liệu thì app tự đổi sang số thật." : undefined}
    >
      <TierRow
        name="Quỹ an tâm"
        dot={null}
        chip={fund.estimated ? <span class="chip">ước tính</span> : undefined}
        amount={covered !== null ? `${covered} tháng` : "—"}
        left={safetyFundCashText(fund, fund.estimated)}
        right={fund.pct !== null ? pctText(fund.pct) : undefined}
        bar={fund.pct !== null ? { pct: fund.pct, tone: "ok" } : null}
      />
      {snap.goals.map((g) => (
        <TierRow
          key={g.walletId}
          name={g.name}
          dot={null}
          amount={
            <>
              <Money value={g.balance} unit={false} /> / <Money value={g.target} />
            </>
          }
          left={`Hạn ${shortDate(g.targetDate)}`}
          right={g.pct !== null ? pctText(g.pct) : undefined}
          bar={g.pct !== null ? { pct: g.pct, tone: "ok" } : null}
        />
      ))}
    </Card>
  );
}

function GroupRow(props: {
  name: string;
  dot: "nice" | "must" | "have";
  tier: string;
  g: { balance: number; monthTarget: number };
  chip?: ComponentChildren;
}) {
  const { balance, monthTarget } = props.g;
  const over = balance < 0;
  const p = pct(balance, monthTarget);
  return (
    <TierRow
      name={props.name}
      dot={props.dot}
      chip={props.chip}
      amount={
        monthTarget > 0 ? (
          <>
            <Money value={balance} unit={false} /> / <Money value={monthTarget} />
          </>
        ) : (
          <Money value={balance} />
        )
      }
      left={over ? `Vượt ${formatVnd(-balance)} — chưa Bù thì lần chia tiền tới lấp trước` : monthTarget > 0 ? "còn lại / dự kiến tháng" : "còn lại"}
      right={over ? <span class="chip bad">âm</span> : monthTarget > 0 ? pctText(p) : undefined}
      bar={monthTarget > 0 || over ? { pct: over ? 100 : p, tone: over ? "bad" : undefined } : null}
      onClick={() => go("wallets", { walletsTab: "budget", tierFilter: props.tier })}
      label={`${props.name} — xem từng ví`}
    />
  );
}

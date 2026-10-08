// Ví & Quỹ: ngân sách theo phe (tuần / tháng) kèm chuyển ngân sách và ví giữ riêng, Tích sản, Tài khoản, Người thuê, Nợ, Phân tích, Chuyển tiền cần làm.
// Ba trục tách bạch: ví kèm "còn lại", tài khoản kèm "lệch", danh mục kèm "kỳ trước".

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { budgetTotals, coverPrefill, type MoveDraft } from "../lib/budget";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { formatVnd, groupDigits } from "../lib/money";
import { applyQueueToBudget } from "../lib/pending";
import { monthKey, monthLabel, previousMonth, shortDate, weekLabel, weekRange } from "../lib/period";
import { safetyFundCashText, safetyFundMonthsText, wealthBuildingKinds, wealthBuildingPlaces, wealthBuildingSources, type AssetLabels, type WealthBuildingLine } from "../lib/wealth-building";
import { defaultFilter } from "../lib/tx-filter";
import type { AccountRow, Budget, BudgetLine, Reserve, SpendByCategory, WealthBuildingBreakdown, TransferOrder, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, setState, setWalletsTab, toast, useApp, viewSnapshot, type WalletsTab } from "../state/store";
import { copyText } from "../ui/clipboard";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Bar, Card, Empty, Loadable, NeedsNetwork, PageHeader, Seg, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";
import { DebtSheet, MoveBudgetSheet } from "./budget-sheets";
import { CountSheet } from "./count-sheet";
import { DebtsTab } from "./debts";
import { ASSET_KINDS, OtherEntrySheet } from "./other-entry-sheet";
import { TenantsTab } from "./tenants";

const TABS: { value: WalletsTab; label: string }[] = [
  { value: "budget", label: "Ngân sách" },
  { value: "wealth-building", label: "Tích sản" },
  { value: "accounts", label: "Tài khoản" },
  { value: "tenants", label: "Người thuê" },
  { value: "debts", label: "Nợ" },
  { value: "analysis", label: "Phân tích" },
  { value: "transfers", label: "Chuyển tiền" },
];

export function Wallets() {
  const { walletsTab, snap } = useApp();
  const now = new Date();
  const orders = snap?.attention.transferOrdersPending ?? 0;
  return (
    <>
      <PageHeader title="Ví & quỹ" sub={monthLabel(snap?.month ?? monthKey(now))} />
      {/* Bảy mục phải thấy hết trên điện thoại: xuống dòng, không cuộn ngang (mục đang chọn không bao giờ khuất). */}
      <div class="tabs wrap" role="group" aria-label="Mục">
        {TABS.map((t) => (
          <button type="button" key={t.value} aria-pressed={walletsTab === t.value} onClick={() => setWalletsTab(t.value)}>
            {t.label}
            {t.value === "transfers" && orders > 0 ? ` (${orders})` : ""}
          </button>
        ))}
      </div>
      {walletsTab === "budget" && <BudgetTab />}
      {walletsTab === "wealth-building" && <WealthBuildingTab />}
      {walletsTab === "accounts" && <AccountsTab />}
      {walletsTab === "analysis" && <AnalysisTab />}
      {walletsTab === "transfers" && <TransfersTab />}
      {walletsTab === "tenants" && <TenantsTab />}
      {walletsTab === "debts" && <DebtsTab />}
    </>
  );
}

// ── Ngân sách ──────────────────────────────────────────────────────
const TIER_GROUPS: { key: string; label: string; match: (l: BudgetLine) => boolean }[] = [
  { key: "wealth_building", label: "Tích sản", match: (l) => l.tier === "wealth_building" },
  { key: "tax", label: "Thuế", match: (l) => l.tier === "tax" },
  { key: "nice", label: "Hưởng thụ", match: (l) => l.tier === "nice" },
  { key: "must", label: "Must", match: (l) => l.tier === "must" && l.mustGroup !== "have" },
  { key: "have", label: "Có thì tốt", match: (l) => l.tier === "must" && l.mustGroup === "have" },
];

type MoveOpen = { draft: MoveDraft; title: string };

function BudgetTab() {
  const app = useApp();
  const [kind, setKind] = useState<"week" | "month">("month");
  const [move, setMove] = useState<MoveOpen | null>(null);
  const [paying, setPaying] = useState<Reserve | null>(null);
  const now = new Date();
  const wk = weekRange(now);
  const period = kind === "week" ? wk.key : monthKey(now);
  const res = useResource<Budget>(`/v1/budget?period=${period}`);
  // Máy tính: thêm cột kỳ trước để thấy xu hướng — cùng endpoint, kỳ liền trước.
  const wide = useWide();
  const prev = useResource<Budget>(wide ? `/v1/budget?period=${kind === "week" ? weekRange(new Date(now.getTime() - 7 * 86_400_000)).key : previousMonth(monthKey(now))}` : null);
  const filter = app.tierFilter;
  const groups = TIER_GROUPS.filter((g) => !filter || g.key === filter);
  const view = viewSnapshot(app);
  const balances: Record<string, number | null> = Object.fromEntries((view?.wallets ?? []).map((w) => [w.id, w.balance]));
  const memberId = app.member?.id ?? null;
  const cover = (l: BudgetLine, balance: number) =>
    setMove({ draft: coverPrefill(l.walletId, balance, app.boot?.wallets ?? [], balances, memberId), title: `Bù ${l.name}` });
  const reserves = (view?.reserves ?? []).map((r) => ({ ...r, balance: balances[r.walletId] ?? r.balance }));
  // Chạm tên ví: Sổ giao dịch lọc sẵn ví đó, tháng này (UC-716) — xem các khoản làm nên số "đã chi".
  const openBook = (walletId: string) => go("ledger", { book: { ...defaultFilter(now), walletId } });
  const wealthBuilding = app.boot?.wallets.find((w) => w.tier === "wealth_building");

  return (
    <>
      <Card
        title={kind === "week" ? weekLabel(wk.key, wk.start, wk.end) : monthLabel(monthKey(now))}
        right={
          <Seg
            label="Kỳ"
            value={kind}
            onChange={setKind}
            options={[
              { value: "week", label: "Tuần" },
              { value: "month", label: "Tháng" },
            ]}
          />
        }
        flush
        note="Có thì tốt là ví nhận phần còn lại — vượt ở đây nghĩa là tháng sau phải bóp, không phải rút Tích sản. Ví âm thì bấm Bù để chuyển ngân sách từ ví khác sang."
      >
        {filter && (
          <div class="status-row" style={{ padding: "0 14px", margin: "0 0 8px" }}>
            <span>Đang xem một phe.</span>
            <button type="button" class="link" onClick={() => setState({ tierFilter: null })}>
              Xem tất cả
            </button>
          </div>
        )}
        <Loadable res={res}>
          {(raw) => {
            const b = applyQueueToBudget(raw, app.queue);
            const shown = groups.map((g) => ({ g, lines: b.lines.filter(g.match) })).filter((x) => x.lines.length > 0);
            if (shown.length === 0) return <Empty title="Không có ví nào có số dự kiến trong kỳ này." />;
            const total = budgetTotals(shown.flatMap((x) => x.lines));
            // Điện thoại: mỗi ví một hàng, "còn lại" là số to bên phải — bảng bốn cột không vừa 390px (audit 261001 F01).
            if (!wide) {
              return (
                <div class="blist">
                  {shown.map(({ g, lines }) => (
                    <Fragment key={g.key}>
                      <div class="set-sub bgroup">
                        <span>{g.label}</span>
                        <span>còn lại</span>
                      </div>
                      {lines.map((l) => (
                        <BudgetItem key={l.walletId} l={l} onCover={cover} onOpen={openBook} />
                      ))}
                    </Fragment>
                  ))}
                  {total && (
                    <div class="tier btotal">
                      <div class="nm">Tổng chi tiêu</div>
                      <div class="amt">
                        <Money value={total.remaining} />
                      </div>
                      <div class="tsub">
                        <span>
                          đã chi {groupDigits(total.spent)} / {formatVnd(total.target)}
                        </span>
                        <span>còn lại</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div class="table-wrap">
                <table class="data dk-table">
                  <thead>
                    <tr>
                      <th scope="col">Ví</th>
                      <th scope="col">Dự kiến</th>
                      <th scope="col">Thực tế</th>
                      <th scope="col">Còn lại ₫</th>
                      <th scope="col">Đã dùng</th>
                      <th scope="col">{kind === "week" ? "Tuần trước" : "Tháng trước"}</th>
                      <th scope="col">So kỳ trước</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ g, lines }) => [
                      <tr class="group" key={g.key}>
                        <td colSpan={7}>{g.label}</td>
                      </tr>,
                      ...lines.map((l) => (
                        <BudgetRow key={l.walletId} l={l} onCover={cover} onOpen={openBook} prev={prev.data ? (prev.data.lines.find((x) => x.walletId === l.walletId)?.spent ?? 0) : null} />
                      )),
                    ])}
                    {total && (
                      <tr class="dk-total">
                        <td>Tổng chi tiêu</td>
                        <td class="num">
                          <Money value={total.target} unit={false} mono />
                        </td>
                        <td class="num">
                          <Money value={total.spent} unit={false} mono tone={false} />
                        </td>
                        <td class="num">
                          <Money value={total.remaining} unit={false} mono />
                        </td>
                        <td colSpan={3} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Loadable>
        <div class="pad">
          <button type="button" class="btn btn-wide" onClick={() => setMove({ draft: { fromWalletId: null, toWalletId: null, amount: 0 }, title: "Chuyển ngân sách" })}>
            <Icon name="swap" size={16} /> Chuyển ngân sách
          </button>
        </div>
      </Card>

      {!filter &&
        reserves.map((r) => (
          <Card key={r.walletId} title={r.name} right={<span class="chip">giữ riêng</span>} note="Không vào ví chi tiêu. Trả nợ hay chuyển sang Tích sản là việc cả nhà quyết từng lần.">
            <div class="flex justify-between items-baseline" style={{ margin: "2px 0 12px" }}>
              <span style={{ color: "var(--fg-2)" }}>Số dư</span>
              {r.balance === null ? <span>—</span> : <Money value={r.balance} class="font-semibold" />}
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn" onClick={() => setPaying(r)}>
                Trả nợ
              </button>
              <button
                type="button"
                class="btn"
                disabled={!wealthBuilding}
                onClick={() =>
                  setMove({ draft: { fromWalletId: r.walletId, toWalletId: wealthBuilding?.id ?? null, amount: Math.max(0, r.balance ?? 0) }, title: `Chuyển sang ${wealthBuilding?.name ?? "Tích sản"}` })
                }
              >
                Chuyển sang Tích sản
              </button>
            </div>
          </Card>
        ))}

      {move && <MoveBudgetSheet key={move.title} initial={move.draft} title={move.title} onClose={() => setMove(null)} />}
      {paying && <DebtSheet reserve={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Điện thoại: một ví một hàng theo kiểu hàng tầng — tên, còn lại, "đã chi / dự kiến", thanh; ví âm có dòng Bù riêng. */
function BudgetItem({ l, onCover, onOpen }: { l: BudgetLine; onCover: (l: BudgetLine, balance: number) => void; onOpen: (walletId: string) => void }) {
  const over = l.remaining !== null && l.remaining < 0;
  const used = l.target && l.spent !== null ? Math.round((100 * l.spent) / l.target) : null;
  const negative = typeof l.balance === "number" && l.balance < 0 ? l.balance : null;
  return (
    <div class="tier">
      <div class="nm">
        <WalletLink l={l} onOpen={onOpen} />
        {over && used !== null && <span class="chip bad">{used}%</span>}
      </div>
      <div class="amt">
        <Money value={l.remaining} />
      </div>
      <div class="tsub">
        <span>
          {l.spent === null ? "" : l.target !== null ? `đã chi ${groupDigits(l.spent)} / ${formatVnd(l.target)}` : `đã chi ${formatVnd(l.spent)}`}
        </span>
        <span>{!over && used !== null ? `${used}% đã dùng` : ""}</span>
      </div>
      {used !== null && <Bar pct={used} tone={over ? "bad" : undefined} />}
      {negative !== null && <NegativeLine amount={negative} onCover={() => onCover(l, negative)} />}
    </div>
  );
}

/**
 * Ví đang âm dù kỳ này vẫn còn trong dự kiến: nói rõ là số dư thật của ví (chi vượt chưa bù), kèm nút Bù đủ 44px —
 * để "còn lại 500.000" và "âm 150.000" trên cùng một hàng không còn mâu thuẫn (audit 261001 F15).
 */
function NegativeLine({ amount, onCover }: { amount: number; onCover: () => void }) {
  return (
    <div class="bneg">
      <span>
        Số dư thật <Money value={amount} /> — vượt từ trước, chưa bù
      </span>
      <button type="button" class="btn" onClick={onCover}>
        Bù
      </button>
    </div>
  );
}

/** Tên ví trong bảng Ngân sách: chạm mở Sổ giao dịch lọc ví đó, tháng này. */
function WalletLink({ l, onOpen }: { l: BudgetLine; onOpen: (walletId: string) => void }) {
  return (
    <button type="button" class="link wallet-link" aria-label={`${l.name}: xem các khoản tháng này`} onClick={() => onOpen(l.walletId)}>
      {l.name}
    </button>
  );
}

/** Máy tính: một hàng của bảng ngân sách đủ cột — dự kiến, thực tế, còn lại, % đã dùng, kỳ trước. */
function BudgetRow({ l, prev, onCover, onOpen }: { l: BudgetLine; prev: number | null; onCover: (l: BudgetLine, balance: number) => void; onOpen: (walletId: string) => void }) {
  const over = l.remaining !== null && l.remaining < 0;
  const used = l.target && l.spent !== null ? Math.round((100 * l.spent) / l.target) : null;
  const secret = l.spent === null;
  const negative = typeof l.balance === "number" && l.balance < 0 ? l.balance : null;
  return (
    <tr>
      <td>
        <WalletLink l={l} onOpen={onOpen} />
        {negative !== null && <NegativeLine amount={negative} onCover={() => onCover(l, negative)} />}
      </td>
      <td class="num">
        <Money value={l.target} unit={false} mono />
      </td>
      <td class="num">
        <Money value={l.spent} unit={false} mono tone={false} />
      </td>
      <td class="num">
        <Money value={l.remaining} unit={false} mono />
      </td>
      <td>
        {used !== null && (
          <div class="dk-pct">
            {over ? <span class="chip bad" style={{ justifySelf: "end" }}>{used}%</span> : <span class="tnum">{used}%</span>}
            <Bar pct={used} tone={over ? "bad" : undefined} />
          </div>
        )}
      </td>
      <td class="num">{secret || prev === null ? "" : <Money value={prev} unit={false} mono tone={false} />}</td>
      <td class="num dk-delta">{secret || prev === null ? "" : <Money value={(l.spent ?? 0) - prev} unit={false} mono signed tone={false} />}</td>
    </tr>
  );
}

// ── Tích sản ───────────────────────────────────────────────────────
function WealthBuildingTab() {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [buying, setBuying] = useState(false);
  const txs = useResource<TxRow[]>("/v1/transactions?limit=200");
  const breakdown = useResource<WealthBuildingBreakdown>("/v1/wealth-building");
  if (!snap) return <Skeleton rows={4} />;
  const t = snap.tiers.wealth_building;
  const fund = snap.safetyFund;
  const full = fund.pct !== null && fund.pct >= 100;
  const covered = safetyFundMonthsText(fund);
  const total = t.cash + t.assets;
  const assets = (txs.data ?? []).filter((r) => r.meaning === "buy_asset" && r.status === "active");
  const assetLabel = (k: string | null) => ASSET_KINDS.find((a) => a.value === k)?.label ?? k ?? "";
  const assetLabels: AssetLabels = Object.fromEntries(ASSET_KINDS.map((a) => [a.value, a.label]));
  const wide = useWide();

  const cards = (
    <>
      <Card title="Tích sản">
        <p class="hint" style={{ margin: "0 0 10px" }}>
          Tiền để dành lâu dài của nhà — gồm tiền (dùng được lúc khẩn cấp) và tài sản đã mua bằng tiền đó. Không chi trực tiếp từ đây.
        </p>
        <div class="flex justify-between items-baseline">
          <span style={{ color: "var(--fg-2)" }}>Tổng Tích sản</span>
          <Money value={total} class="font-semibold" />
        </div>
        {/* Thanh chỉ để thấy tỉ lệ; số đầy đủ nằm ở các dòng bên dưới (không rút gọn "55k" trên card này). */}
        <div
          style={{ display: "flex", gap: "2px", height: "10px", borderRadius: "5px", overflow: "hidden", margin: "6px 0 2px", background: "var(--surface-3)" }}
          role="img"
          aria-label={`Tiền ${formatVnd(t.cash)}, tài sản ${formatVnd(t.assets)}`}
        >
          {total > 0 && t.cash > 0 && <div style={{ flex: t.cash, background: "var(--lock-bg)" }} />}
          {total > 0 && t.assets > 0 && <div style={{ flex: t.assets, background: "var(--lock)" }} />}
        </div>
        <Loadable res={breakdown}>
          {(b) => {
            const places = wealthBuildingPlaces(b);
            return (
              <>
                <WealthBuildingList title="Loại" lines={wealthBuildingKinds(b, assetLabels)} />
                <WealthBuildingList title="Tiền đang ở đâu" lines={places.lines} empty="Chưa có tiền Tích sản." />
                {places.extra && (
                  <p class="hint" style={{ margin: "4px 0 0" }}>
                    {places.extra}
                  </p>
                )}
              </>
            );
          }}
        </Loadable>
        <div class="flex justify-between" style={{ fontSize: "13px", padding: "3px 0", marginTop: "12px" }}>
          <span style={{ color: "var(--fg-2)" }}>Quỹ an tâm {fund.estimated && <span class="chip">ước tính</span>}</span>
          <span>{covered !== null ? `${covered} tháng chi Must` : "—"}</span>
        </div>
        <Bar pct={fund.pct ?? 0} tone="ok" />
        <div class="sub-line" style={{ margin: "6px 0 12px" }}>
          {safetyFundCashText(fund)}
        </div>
        <button type="button" class="btn btn-primary btn-wide" onClick={() => setBuying(true)}>
          Mua tài sản
        </button>
        {!full && (
          <p class="hint" style={{ margin: "8px 0 0" }}>
            Quỹ an tâm chưa đủ. Quỹ an tâm chỉ tính tiền mặt — tài sản mua lúc nào cũng được.
          </p>
        )}
      </Card>
      <Card title="Tiền Tích sản đến từ đâu">
        <Loadable res={breakdown}>
          {(b) => {
            const src = wealthBuildingSources(b, assetLabels);
            return (
              <>
                <WealthBuildingList title="Vào" lines={src.ins} empty="Chưa có khoản nào vào Tích sản." />
                {src.outs.length > 0 && <WealthBuildingList title="Ra khỏi tiền" lines={src.outs} />}
                <ul class="hero-parts">
                  <li>
                    <span>Còn lại là tiền</span>
                    <Money value={src.cash} />
                  </li>
                </ul>
                <button
                  type="button"
                  class="btn btn-wide"
                  style={{ marginTop: "12px" }}
                  onClick={() => go("ledger", { book: { ...defaultFilter(new Date()), month: null, walletId: b.walletId } })}
                >
                  Xem các khoản Tích sản
                </button>
                {src.fundNote && (
                  <p class="hint" style={{ margin: "8px 0 0" }}>
                    {src.fundNote}
                  </p>
                )}
              </>
            );
          }}
        </Loadable>
      </Card>
      <Card title="Tài sản đang giữ" flush>
        <Loadable res={txs}>
          {() =>
            assets.length === 0 ? (
              <Empty title="Chưa mua tài sản nào.">Tiền Tích sản đang nằm ở dạng tiền mặt. Giá tốt thì mua vàng — Quỹ an tâm chỉ tính phần tiền mặt.</Empty>
            ) : (
              <table class="data">
                <thead>
                  <tr>
                    <th scope="col">Loại</th>
                    <th scope="col">Ngày</th>
                    <th scope="col">Số tiền ₫</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((r) => (
                    <tr key={r.id} class="tx-row" onClick={() => openTx(r.id, r)}>
                      <td>
                        <button type="button" class="tx-open">
                          {assetLabel(r.asset_kind)}
                        </button>
                        {r.note && <div class="sub-line">{r.note}</div>}
                      </td>
                      <td>{shortDate(r.at)}</td>
                      <td class="num">
                        <Money value={r.amount} unit={false} mono />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
      </Card>
    </>
  );

  return (
    <>
      {wide ? <div class="dk-cols">{cards}</div> : cards}
      {buying && <OtherEntrySheet kind="buy_asset" amount={0} title="Mua tài sản" onClose={() => setBuying(false)} />}
    </>
  );
}

/** Một nhóm dòng của tab Tích sản: nhãn + câu phụ bên trái, số đầy đủ (₫) bên phải; dòng chi tiết thụt vào. */
function WealthBuildingList({ title, lines, empty }: { title: string; lines: WealthBuildingLine[]; empty?: string }) {
  return (
    <section aria-label={title} style={{ marginTop: "12px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-2)" }}>{title}</div>
      <ul class="hero-parts" style={{ marginTop: "4px" }}>
        {lines.length === 0 && empty && (
          <li>
            <span>{empty}</span>
          </li>
        )}
        {lines.map((l) => (
          <li key={l.key} style={l.level === "part" ? { paddingLeft: "12px", fontSize: "12.5px" } : undefined}>
            <span>
              {l.label}
              {l.note && <div class="sub-line">{l.note}</div>}
            </span>
            <Money value={l.value} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Tài khoản ──────────────────────────────────────────────────────
function AccountsTab() {
  const { boot } = useApp();
  const res = useResource<AccountRow[]>("/v1/accounts");
  const [counting, setCounting] = useState<string | null>(null);
  const wide = useWide();
  return (
    <>
      <Card
        title="Tài khoản"
        flush
        note="Muốn chắc số trong sổ đúng: đếm tiền hoặc xem app ngân hàng rồi bấm Nhập số dư — chênh bao nhiêu app ghi một khoản điều chỉnh. Lệch = sổ khác các giao dịch ngân hàng đã gán; khoản chưa gán không tính là lệch."
      >
        <Loadable res={res}>
          {(rows) => wide ? <AccountsWide rows={rows} onCount={setCounting} /> : (
            // Điện thoại: mỗi tài khoản một hàng, số sổ to bên phải; dòng "lệch" chỉ có nghĩa với tài khoản SePay
            // nên chỉ hiện ở đó — không còn bảng bốn cột đầy "—" (audit 261001 F21).
            <div class="blist">
              {rows.map((r) => {
                const feed = boot?.accounts.find((a) => a.id === r.accountId)?.sepayEnabled ?? false;
                const drift = driftOf(r);
                return (
                  <div class="tier" key={r.accountId}>
                    <div class="nm">
                      {r.name}
                      {drift !== null && <span class="chip bad">lệch</span>}
                    </div>
                    <div class="amt">
                      <Money value={r.bookBalance} />
                    </div>
                    <div class="tsub">
                      <span>{feed ? "SePay tự cập nhật" : "nhập tay"}</span>
                      <span>số trong sổ</span>
                    </div>
                    {drift !== null && (
                      <div class="tsub">
                        <span>{DRIFT_LABEL}</span>
                        <span>
                          <Money value={drift} signed tone={false} class="neg" />
                        </span>
                      </div>
                    )}
                    {!!r.pendingCount && (
                      <div class="tsub">
                        <span>
                          {r.pendingCount} giao dịch chưa gán · vào trừ ra <Money value={r.pendingNet ?? 0} signed tone={false} />
                        </span>
                      </div>
                    )}
                    {/* Số dư thật chỉ đến từ người nhà nhập — kể cả tài khoản SePay (ADR-87). */}
                    <div class="bneg calm">
                      <span>{r.lastCountAt ? `lần nhập gần nhất ${shortDate(r.lastCountAt)}` : "chưa nhập số dư lần nào"}</span>
                      <button type="button" class="btn" onClick={() => setCounting(r.accountId)}>
                        Nhập số dư
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Loadable>
      </Card>
      {counting && <CountSheet accountId={counting} onClose={() => setCounting(null)} />}
    </>
  );
}

const ACCOUNT_KIND: Record<string, string> = { bank: "Ngân hàng", cash: "Tiền mặt", ewallet: "Ví điện tử", credit: "Thẻ tín dụng" };

/** Máy tính: mọi cột của /v1/accounts cùng lúc — sổ, feed, lệch, chưa gán, lần cuối. */
function AccountsWide({ rows, onCount }: { rows: AccountRow[]; onCount: (id: string) => void }) {
  const { boot } = useApp();
  const money = (v: number | null) => (v === null ? "—" : <Money value={v} unit={false} mono />);
  return (
    <div class="table-wrap">
      <table class="data dk-table">
        <thead>
          <tr>
            <th scope="col">Tài khoản</th>
            <th scope="col">Sổ</th>
            <th scope="col">Số SePay</th>
            <th scope="col">Lệch</th>
            <th scope="col">Chưa gán</th>
            <th scope="col">Gần nhất</th>
            <th scope="col">
              <span class="sr-only">Việc</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const feed = boot?.accounts.find((a) => a.id === r.accountId)?.sepayEnabled ?? false;
            const drift = driftOf(r);
            return (
              <tr key={r.accountId}>
                <td>
                  {r.name}
                  <div class="sub-line">
                    {ACCOUNT_KIND[r.kind] ?? r.kind} · {feed ? "SePay tự cập nhật" : "nhập tay"}
                  </div>
                </td>
                <td class="num">{money(r.bookBalance)}</td>
                <td class="num">{money(r.feedBalance)}</td>
                {/* Không `num` (nowrap): chữ lệch dài, phải xuống dòng; số vẫn mono qua Money. */}
                <td>
                  {drift !== null ? (
                    <>
                      <Money value={drift} signed unit={false} mono tone={false} class="neg" />
                      <div class="sub-line">{DRIFT_LABEL}</div>
                    </>
                  ) : r.bookDrift === null ? (
                    "—"
                  ) : (
                    "khớp"
                  )}
                </td>
                <td class="num">
                  {r.pendingCount ? (
                    <>
                      {r.pendingCount} khoản
                      <div class="sub-line">
                        <Money value={r.pendingNet ?? 0} signed unit={false} mono tone={false} />
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td class="dk-when">
                  {r.lastAt ? shortDate(r.lastAt) : "—"}
                  {r.lastCountAt && <div class="sub-line">đếm {shortDate(r.lastCountAt)}</div>}
                </td>
                <td>
                  <div class="dk-act">
                    <button type="button" class="btn" onClick={() => onCount(r.accountId)}>
                      Nhập số dư thật
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Phân tích ──────────────────────────────────────────────────────
function AnalysisTab() {
  const month = monthKey(new Date());
  const res = useResource<SpendByCategory>(`/v1/spend-by-category?period=${month}`);
  const m = (k: string) => `T${Number(k.slice(5))}`;
  const wide = useWide();
  return (
    <Card
      title="Chi theo danh mục"
      right={
        res.data &&
        (wide ? (
          <span class="dk-key">
            <span>
              <i class="now" aria-hidden="true" />
              {monthLabel(res.data.month)}
            </span>
            <span>
              <i class="prev" aria-hidden="true" />
              {monthLabel(res.data.previous)}
            </span>
          </span>
        ) : (
          <span class="hint">{`${monthLabel(res.data.month)} so với ${monthLabel(res.data.previous)}`}</span>
        ))
      }
      flush
    >
      <Loadable res={res}>
        {(d) =>
          d.categories.length === 0 ? (
            <Empty title="Chưa có khoản chi nào trong hai tháng này." />
          ) : wide ? (
            <AnalysisWide d={d} label={m} />
          ) : (
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">Danh mục</th>
                  <th scope="col">{m(d.month)}</th>
                  <th scope="col">{m(d.previous)} ₫</th>
                </tr>
              </thead>
              <tbody>
                {d.categories.map((c) => {
                  const delta = c.spent - c.previousSpent;
                  return (
                    <tr key={c.categoryId}>
                      <td>
                        {c.name}
                        {delta !== 0 && (
                          <div class="sub-line">
                            {delta > 0 ? "nhiều hơn" : "ít hơn"} {formatVnd(Math.abs(delta))}
                          </div>
                        )}
                      </td>
                      <td class="num">
                        <Money value={c.spent} unit={false} mono />
                      </td>
                      <td class="num">
                        <Money value={c.previousSpent} unit={false} mono />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </Loadable>
    </Card>
  );
}

/**
 * Máy tính: mỗi danh mục một cặp thanh cùng thước — đặc là tháng này, rỗng là tháng trước — cạnh cột số.
 * Không tô màu "tốt/xấu" cho chi ít hay nhiều: màu chỉ mang trạng thái (DESIGN.md §3).
 */
function AnalysisWide({ d, label }: { d: SpendByCategory; label: (k: string) => string }) {
  const max = Math.max(1, ...d.categories.flatMap((c) => [c.spent, c.previousSpent]));
  const w = (v: number) => `${(100 * v) / max}%`;
  const total = d.categories.reduce((a, c) => ({ now: a.now + c.spent, prev: a.prev + c.previousSpent }), { now: 0, prev: 0 });
  return (
    <div class="table-wrap">
      <table class="data dk-table">
        <thead>
          <tr>
            <th scope="col">Danh mục</th>
            <th scope="col" class="l" style={{ width: "38%" }}>
              So sánh
            </th>
            <th scope="col">{label(d.month)} ₫</th>
            <th scope="col">{label(d.previous)} ₫</th>
            <th scope="col">Chênh lệch</th>
          </tr>
        </thead>
        <tbody>
          {d.categories.map((c) => (
            <tr key={c.categoryId}>
              <td>{c.name}</td>
              <td class="l" style={{ verticalAlign: "middle" }}>
                <svg class="dk-cmp" role="img" aria-label={`${label(d.month)} ${formatVnd(c.spent)}, ${label(d.previous)} ${formatVnd(c.previousSpent)}`}>
                  <title>{`${monthLabel(d.month)}: ${formatVnd(c.spent)} · ${monthLabel(d.previous)}: ${formatVnd(c.previousSpent)}`}</title>
                  {c.spent > 0 && <rect class="now" x="0" y="2" width={w(c.spent)} height="8" rx="2" />}
                  {c.previousSpent > 0 && <rect class="prev" x="0.75" y="13.75" width={w(c.previousSpent)} height="6.5" rx="2" />}
                </svg>
              </td>
              <td class="num">
                <Money value={c.spent} unit={false} mono />
              </td>
              <td class="num">
                <Money value={c.previousSpent} unit={false} mono />
              </td>
              <td class="num dk-delta">
                <Money value={c.spent - c.previousSpent} unit={false} mono signed tone={false} />
              </td>
            </tr>
          ))}
          <tr class="dk-total">
            <td>Tổng</td>
            <td />
            <td class="num">
              <Money value={total.now} unit={false} mono />
            </td>
            <td class="num">
              <Money value={total.prev} unit={false} mono />
            </td>
            <td class="num dk-delta">
              <Money value={total.now - total.prev} unit={false} mono signed tone={false} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Chuyển tiền cần làm ────────────────────────────────────────────
function TransfersTab() {
  const { online } = useApp();
  const res = useResource<TransferOrder[]>("/v1/transfer-orders?status=pending");
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmSkip, setConfirmSkip] = useState<number | null>(null);
  const wide = useWide();

  async function mark(o: TransferOrder, status: "done" | "skip") {
    setBusy(o.id);
    try {
      await api.post(`/v1/transfer-orders/${o.id}/${status}`);
      toast(status === "done" ? `Đã đánh dấu đã chuyển ${formatVnd(o.amount)}.` : "Đã bỏ qua lệnh này.");
      res.reload();
      void refresh();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(null);
      setConfirmSkip(null);
    }
  }

  return (
    <Card title="Chuyển tiền cần làm" flush note="Phân bổ trong app chỉ là ảo cho tới khi tiền đi thật giữa các tài khoản. Chép số tiền và nội dung sang app ngân hàng.">
      <Loadable res={res}>
        {(list) =>
          list.length === 0 ? (
            <Empty title="Không có lệnh chuyển tiền nào đang chờ." />
          ) : wide ? (
            <div class="table-wrap">
              <table class="data dk-table">
                <thead>
                  <tr>
                    <th scope="col">Chuyển</th>
                    <th scope="col" class="l">
                      Nội dung CK
                    </th>
                    <th scope="col">Số tiền ₫</th>
                    <th scope="col">
                      <span class="sr-only">Việc</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o) => {
                    const created = `${o.created_at.replace(" ", "T")}Z`;
                    const overdue = Date.now() - Date.parse(created) > 3 * 86_400_000;
                    return (
                      <tr key={o.id}>
                        <td>
                          {o.from_name} → {o.to_name}
                          <div class="sub-line">
                            {o.wallet_names && <>cho {o.wallet_names} · </>}tạo {shortDate(created)} {overdue && <span class="chip bad">quá 3 ngày</span>}
                          </div>
                        </td>
                        <td class="l num">{o.memo}</td>
                        <td class="num">
                          <strong>
                            <Money value={o.amount} unit={false} mono />
                          </strong>
                        </td>
                        <td>
                          <div class="dk-act">
                            <button type="button" class="btn" onClick={() => void copyText(String(o.amount), "số tiền")}>
                              <Icon name="copy" size={14} /> Chép số tiền
                            </button>
                            <button type="button" class="btn" onClick={() => void copyText(o.memo, "nội dung")}>
                              <Icon name="copy" size={14} /> Chép nội dung
                            </button>
                            <button type="button" class="btn" disabled={!online || busy === o.id} onClick={() => void mark(o, "done")}>
                              <Icon name="check" size={14} /> Đã chuyển
                            </button>
                            <button
                              type="button"
                              class={confirmSkip === o.id ? "btn btn-bad" : "btn btn-ghost"}
                              disabled={!online || busy === o.id}
                              onClick={() => (confirmSkip === o.id ? void mark(o, "skip") : setConfirmSkip(o.id))}
                            >
                              {confirmSkip === o.id ? "Bỏ qua hẳn" : "Bỏ qua"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!online && (
                <div class="pad">
                  <NeedsNetwork what="Đánh dấu đã chuyển" />
                </div>
              )}
            </div>
          ) : (
            <div>
              {list.map((o) => {
                const overdue = Date.now() - Date.parse(`${o.created_at.replace(" ", "T")}Z`) > 3 * 86_400_000;
                return (
                  <div key={o.id} style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
                    <div class="flex justify-between items-baseline gap-2">
                      <span style={{ fontWeight: 500 }}>
                        {o.from_name} → {o.to_name}
                      </span>
                      <Money value={o.amount} class="font-semibold" />
                    </div>
                    {o.wallet_names && (
                      <div class="srow-s" style={{ marginTop: "2px" }}>
                        cho {o.wallet_names}
                      </div>
                    )}
                    <div class="sub-line flex gap-2 items-center" style={{ margin: "3px 0 10px" }}>
                      <span class="num">{o.memo}</span>· tạo {shortDate(`${o.created_at.replace(" ", "T")}Z`)}
                      {overdue && <span class="chip bad">quá 3 ngày</span>}
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <button type="button" class="btn" onClick={() => void copyText(String(o.amount), "số tiền")}>
                        <Icon name="copy" size={15} /> Chép số tiền
                      </button>
                      <button type="button" class="btn" onClick={() => void copyText(o.memo, "nội dung")}>
                        <Icon name="copy" size={15} /> Chép nội dung
                      </button>
                      <button type="button" class="btn" disabled={!online || busy === o.id} onClick={() => void mark(o, "done")}>
                        <Icon name="check" size={15} /> Đã chuyển
                      </button>
                      <button
                        type="button"
                        class={confirmSkip === o.id ? "btn btn-bad" : "btn btn-ghost"}
                        disabled={!online || busy === o.id}
                        onClick={() => (confirmSkip === o.id ? void mark(o, "skip") : setConfirmSkip(o.id))}
                      >
                        {confirmSkip === o.id ? "Bỏ qua hẳn" : "Bỏ qua"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!online && (
                <div class="pad">
                  <NeedsNetwork what="Đánh dấu đã chuyển" />
                </div>
              )}
            </div>
          )
        }
      </Loadable>
    </Card>
  );
}


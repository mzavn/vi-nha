// Tài khoản (pwa UC-707): Ba ngăn, Chi tiêu (chi theo nhóm danh mục trong tháng, so hạn mức mềm mỗi tháng và tháng trước), Nợ,
// Cho thuê — điều hướng mục con theo SectionNav (DESIGN §4.18). Ba trục tách bạch: nhóm kèm "còn / vượt" hạn mức mềm, tài khoản
// kèm "lệch", danh mục kèm "tháng trước".

import { DEBT_CATEGORY_ID } from "../../../src/domain/system-ids";
import { Fragment } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { LookBack, LookBackCategory, LookBackGroup } from "../../../src/domain/look-back";
import { ApiError } from "../lib/api";
import { loadAllAssetBuys } from "../lib/asset-buys";
import { driftOf } from "../lib/drift";
import { EMPTY_STATES } from "../lib/empty-states";
import { formatVnd, maskAmounts } from "../lib/money";
import { interestLineText } from "../lib/interest";
import { accountsTotal, nestAccounts, type NestedAccount } from "../lib/accounts-total";
import { barPct, compareText, excludedText, isEmptyLookBack, limitText, LOOK_BACK_NOTE, lookBackGroups, lookBackPath, monthHeading, principalText, queueNote, savingsLine, stepMonth } from "../lib/look-back";
import { monthKey, monthLabel, shortDate } from "../lib/period";
import { SCREEN_TITLES, WALLETS_TAB_LABELS } from "../lib/nav";
import { reserveCard, savingsCard } from "../lib/pocket-cards";
import { monthFilter } from "../lib/tx-filter";
import type { AccountRow, Bootstrap, TxRow } from "../lib/types";
import { type Resource, useResource } from "../state/resource";
import { go, openTx, setLookBackMonth, setWalletsTab, useApp, viewSnapshot, type WalletsTab } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Bar, Card, Chip, Empty, InfoTip, Loadable, PageHeader, Row, SectionNav } from "../ui/parts";
import { useWide } from "../ui/shell";
import { CountSheet } from "./count-sheet";
import { DebtsTab } from "./debts";
import { ASSET_KINDS, OtherEntrySheet } from "./other-entry-sheet";
import { TenantsTab } from "./tenants";

const TABS = (Object.entries(WALLETS_TAB_LABELS) as [WalletsTab, string][]).map(([value, label]) => ({ value, label }));

export function Wallets() {
  const { walletsTab, snap } = useApp();
  const wide = useWide();
  const now = new Date();
  const nav = <SectionNav wide={wide} label="Mục" items={TABS} value={walletsTab} onChange={setWalletsTab} />;
  const body = (
    <>
      {walletsTab === "accounts" && <AccountsTab />}
      {walletsTab === "analysis" && <LookBackTab />}
      {walletsTab === "debts" && <DebtsTab />}
      {walletsTab === "tenants" && <TenantsTab />}
    </>
  );
  return (
    <>
      <PageHeader title={SCREEN_TITLES.wallets} sub={monthLabel(snap?.month.key ?? monthKey(now))} />
      {wide ? (
        <div class="sec-layout">
          {nav}
          <div class="min-w-0">{body}</div>
        </div>
      ) : (
        <>
          {nav}
          {body}
        </>
      )}
    </>
  );
}

// ── Nhìn lại ───────────────────────────────────────────────────────
/**
 * Nhìn lại theo tháng (pwa UC-707 AC-40, ledger UC-108): tháng chọn nằm trên địa chỉ `#wallets/analysis/YYYY-MM` (tháng hiện tại
 * không ghi). Số của server — khoản chờ đồng bộ chưa tính.
 */
function LookBackTab() {
  const { lookBackMonth, queue } = useApp();
  const res = useResource<LookBack>(lookBackPath(lookBackMonth));
  const current = monthKey(new Date());
  useEffect(() => {
    // Tháng trên địa chỉ là tháng hiện tại (địa chỉ cũ theo ngày lương của kỳ đang chạy) hay server không nhận tháng đó → tháng hiện tại.
    if (lookBackMonth && (lookBackMonth === current || res.error?.code === "invalid_period")) setLookBackMonth(null);
  }, [lookBackMonth, res.error]);
  const d = res.data;
  const prev = d && stepMonth(d, -1, current);
  const next = d && stepMonth(d, 1, current);
  const queued = queueNote(queue.length);
  return (
    <Card
      title={d ? monthHeading(d) : WALLETS_TAB_LABELS.analysis}
      right={
        d && (
          <div class="book-month" role="group" aria-label="Tháng">
            <button type="button" class="btn book-step" aria-label="Tháng trước" disabled={!prev} onClick={() => prev && setLookBackMonth(prev.month)}>
              <Icon name="chevron-left" size={18} />
            </button>
            {next && (
              <button type="button" class="btn book-step" aria-label="Tháng sau" onClick={() => setLookBackMonth(next.month)}>
                <Icon name="chevron-right" size={18} />
              </button>
            )}
          </div>
        )
      }
      flush
      note={LOOK_BACK_NOTE}
    >
      <Loadable res={res}>{(raw) => <LookBackBody d={raw} queued={queued} />}</Loadable>
    </Card>
  );
}

function LookBackBody({ d, queued }: { d: LookBack; queued: string | null }) {
  const wide = useWide();
  const { boot } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  // Chạm danh mục → Sổ giao dịch lọc danh mục đó và đúng tháng (`#ledger?month=…&category=…`), nên Chi của Sổ bằng số ở đây.
  const drill = (c: LookBackCategory) => {
    if (c.categoryId) go("ledger", { book: monthFilter(d.month, c.categoryId, new Date()) });
  };
  // Nhóm chứa danh mục Trả nợ: trả gốc ghi ở hàng này bằng chữ mờ (UC-707 AC-44).
  const debtGroupId = boot?.categories.find((c) => c.id === DEBT_CATEGORY_ID)?.groupId ?? null;
  const groups = lookBackGroups(d, debtGroupId);
  const excluded = excludedText(d, debtGroupId);
  const rows: Rows = {
    open,
    toggle,
    drill,
    principal: (id) => principalText(d, id, debtGroupId),
    interest: d.interest.lines.length > 0 || d.interest.spent !== 0 || d.interest.previousSpent !== 0,
    ungrouped: d.ungrouped.categories.length > 0 || d.ungrouped.spent !== 0 || d.ungrouped.previousSpent !== 0,
  };
  return (
    <>
      <div class="tier btotal">
        <div class="nm">{d.next === null ? "Đã chi tháng này" : `Đã chi tháng ${Number(d.month.slice(5, 7))}`}</div>
        <div class="amt">
          <Money value={d.total} tone={false} />
        </div>
        <div class="tsub">
          <span>Tháng trước {formatVnd(d.previousTotal)}</span>
        </div>
      </div>
      {queued && (
        <p class="status-row" style={{ padding: "10px 14px 0" }}>
          {queued}
        </p>
      )}
      {savingsLine(d.month, d.savings) && (
        <p class="status-row" style={{ padding: "10px 14px 0" }}>
          {savingsLine(d.month, d.savings)}
        </p>
      )}
      {isEmptyLookBack(d) ? (
        <Empty state={EMPTY_STATES.spending} />
      ) : wide ? (
        <LookBackTable d={d} groups={groups} rows={rows} />
      ) : (
        <div class="blist">
          {groups.map((g) => (
            <GroupItem key={g.id} id={g.id} g={g} rows={rows} />
          ))}
          {rows.interest && (
            <div class="tier">
              <div class="nm">Lãi vay</div>
              <div class="amt">
                <Money value={d.interest.spent} tone={false} />
              </div>
              <div class="tsub">
                <span>{compareText(d.interest.spent, d.interest.previousSpent)}</span>
              </div>
              <InterestLines d={d} />
            </div>
          )}
          {rows.ungrouped && (
            <>
              <GroupItem id="ungrouped" g={{ name: "Chưa xếp nhóm", essential: false, pct: null, left: null, over: null, ...d.ungrouped }} rows={rows} />
              <div class="srow" style={{ justifyContent: "flex-end", minHeight: "44px", borderTop: 0 }}>
                <SortLink />
              </div>
            </>
          )}
        </div>
      )}
      {excluded && (
        <p class="status-row" style={{ padding: "10px 14px 0" }}>
          {excluded}
        </p>
      )}
    </>
  );
}

/** Trạng thái chung của các hàng: nhóm đang mở, chạm nhóm / danh mục, có hàng Lãi vay / Chưa xếp nhóm không. */
interface Rows {
  open: string | null;
  toggle: (id: string) => void;
  drill: (c: LookBackCategory) => void;
  /** Chữ mờ "Trả gốc … không tính vào chi" của hàng nhóm Trả nợ; nhóm khác null. */
  principal: (groupId: string) => string | null;
  interest: boolean;
  ungrouped: boolean;
}

/** "Xếp nhóm ›": Cài đặt › Nhóm danh mục & hạn mức mềm (pwa UC-709). */
const SortLink = () => (
  <button type="button" class="link" onClick={() => go("settings", { settingsFocus: "pockets" })}>
    Xếp nhóm ›
  </button>
);

type GroupLike = Pick<LookBackGroup, "name" | "essential" | "spent" | "previousSpent" | "pct" | "left" | "over" | "categories">;

/** Điện thoại: một nhóm một hàng — tên, chip Thiết yếu, đã chi; thanh (đầy tối đa 100%) và "còn / vượt"; so tháng trước. Chạm → danh mục. */
function GroupItem({ id, g, rows }: { id: string; g: GroupLike; rows: Rows }) {
  const bar = barPct(g);
  const limit = limitText(g);
  const open = rows.open === id;
  const principal = rows.principal(id);
  return (
    <>
      <button type="button" class="tier" aria-expanded={open} onClick={() => rows.toggle(id)}>
        <div class="nm">
          <span>{g.name}</span>
          {g.essential && <span class="chip">Thiết yếu</span>}
        </div>
        <div class="amt">{principal && g.spent === 0 ? null : <Money value={g.spent} tone={false} />}</div>
        <div class="tsub">
          <span>{principal ?? compareText(g.spent, g.previousSpent)}</span>
          <span>{limit && `${limit} · ${g.pct}%`}</span>
        </div>
        {bar !== null && <Bar pct={bar} tone={g.over ? "bad" : undefined} />}
      </button>
      {open &&
        g.categories.map((c) => (
          <button type="button" key={c.categoryId ?? "none"} class="srow" style={{ paddingLeft: "28px" }} disabled={!c.categoryId} onClick={() => rows.drill(c)}>
            <span class="srow-main">
              <span class="srow-t">{c.name}</span>
              <span class="srow-s">{compareText(c.spent, c.previousSpent)}</span>
            </span>
            <Money value={c.spent} tone={false} />
          </button>
        ))}
    </>
  );
}

/** Hàng Lãi vay: mỗi khoản nợ có lãi một dòng phụ — ngày trả, lãi dự kiến, đã trả (ledger UC-108 bước 4). */
function InterestLines({ d }: { d: LookBack }) {
  if (d.interest.lines.length === 0) return null;
  return (
    <ul class="interest-lines">
      {d.interest.lines.map((x) => (
        <li key={x.debtId}>{interestLineText(x)}</li>
      ))}
    </ul>
  );
}

/** Máy tính: bảng nhóm cột Tháng này / Tháng trước / Hạn mức /tháng; chạm nhóm mở danh mục ngay dưới. */
function LookBackTable({ d, groups, rows }: { d: LookBack; groups: LookBackGroup[]; rows: Rows }) {
  const cell = (v: number | null) => (v === null ? "" : <Money value={v} unit={false} tone={false} />);
  const categoryRows = (id: string, categories: LookBackCategory[]) =>
    rows.open === id &&
    categories.map((c) => (
      <tr key={`${id}:${c.categoryId ?? "none"}`}>
        <td style={{ paddingLeft: "28px" }}>
          {c.categoryId ? (
            <button type="button" class="tx-open" onClick={() => rows.drill(c)}>
              {c.name}
            </button>
          ) : (
            c.name
          )}
        </td>
        <td class="num">{cell(c.spent)}</td>
        <td class="num">{cell(c.previousSpent)}</td>
        <td />
      </tr>
    ));
  const groupCell = (id: string, name: string, sub: preact.ComponentChildren) => (
    <td>
      <button type="button" class="tx-open" aria-expanded={rows.open === id} onClick={() => rows.toggle(id)}>
        {name}
      </button>
      {sub && " "}
      {sub}
    </td>
  );
  return (
    <div class="table-wrap">
      <table class="data dk-table">
        <thead>
          <tr>
            <th scope="col">Nhóm</th>
            <th scope="col">{d.next === null ? "Tháng này ₫" : `Tháng ${Number(d.month.slice(5, 7))} ₫`}</th>
            <th scope="col">Tháng trước ₫</th>
            <th scope="col">Hạn mức/tháng ₫</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const bar = barPct(g);
            const limit = limitText(g);
            const principal = rows.principal(g.id);
            return [
              <tr key={g.id}>
                {groupCell(g.id, g.name, [g.essential && <span class="chip">Thiết yếu</span>, principal && <div class="sub-line">{principal}</div>])}
                <td class="num">{principal && g.spent === 0 ? "" : cell(g.spent)}</td>
                <td class="num">{principal && g.previousSpent === 0 ? "" : cell(g.previousSpent)}</td>
                <td class="num">
                  {cell(g.limit)}
                  {bar !== null && (
                    <div class="dk-pct">
                      {g.over ? <span class="chip bad" style={{ justifySelf: "end" }}>{g.pct}%</span> : <span class="tnum">{g.pct}%</span>}
                      <Bar pct={bar} tone={g.over ? "bad" : undefined} />
                    </div>
                  )}
                  {limit && <div class="sub-line">{limit}</div>}
                </td>
              </tr>,
              categoryRows(g.id, g.categories),
            ];
          })}
          {rows.interest && (
            <tr>
              <td>
                Lãi vay
                <InterestLines d={d} />
              </td>
              <td class="num">{cell(d.interest.spent)}</td>
              <td class="num">{cell(d.interest.previousSpent)}</td>
              <td />
            </tr>
          )}
          {rows.ungrouped && [
            <tr key="ungrouped">
              {groupCell(
                "ungrouped",
                "Chưa xếp nhóm",
                <div>
                  <SortLink />
                </div>,
              )}
              <td class="num">{cell(d.ungrouped.spent)}</td>
              <td class="num">{cell(d.ungrouped.previousSpent)}</td>
              <td />
            </tr>,
            categoryRows("ungrouped", d.ungrouped.categories),
          ]}
          <tr class="dk-total">
            <td>{d.next === null ? "Đã chi tháng này" : `Đã chi tháng ${Number(d.month.slice(5, 7))}`}</td>
            <td class="num">{cell(d.total)}</td>
            <td class="num">{cell(d.previousTotal)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Tích luỹ ───────────────────────────────────────────────────────
/** Mọi khoản mua tài sản (UC-707 AC-38), cùng trạng thái tải / lỗi / số cũ như `useResource`; ghi xong (version tăng) đọc lại. */
function useAssetBuys(): Resource<TxRow[]> {
  const { version } = useApp();
  const [tick, setTick] = useState(0);
  const fresh = useRef(false);
  const [st, setSt] = useState<Omit<Resource<TxRow[]>, "reload">>({ data: null, error: null, loading: true, cachedAt: null });
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    const noCache = fresh.current;
    fresh.current = false;
    loadAllAssetBuys(noCache)
      .then(({ data, cachedAt }) => alive && setSt({ data, error: null, loading: false, cachedAt }))
      .catch((err: unknown) => {
        const e = err instanceof ApiError ? err : new ApiError(0, "offline", "Không có mạng.");
        if (alive) setSt((s) => ({ ...s, error: e, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [tick, version]);
  const reload = useCallback(() => {
    fresh.current = true;
    setTick((t) => t + 1);
  }, []);
  return { ...st, reload };
}

// ── Ba ngăn ────────────────────────────────────────────────────────
/** Dòng phụ của hàng "Tiền thật đang có" (pwa UC-707 AC-31). */
function accountsTotalNote(hasCredit: boolean, hasExcluded: boolean): string | null {
  const parts = [hasCredit ? "đã trừ dư nợ thẻ" : null, hasExcluded ? "gồm cả Tích luỹ, Dự phòng, ngoài ngăn" : null];
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

/** Quá chừng này ngày chưa nhập số dư thì tài khoản nhập tay hiện chip "chưa đối soát". */
const COUNT_STALE_DAYS = 30;

/**
 * Hàng tài khoản (DESIGN §4.5, K-010): tên · số trong sổ; một dòng phụ ("SePay" / "nhập tay" · "N chưa gán"); chạm cả hàng mở
 * nhập số dư. Sổ lệch ngân hàng: chip "lệch" + số lệch dưới số dư; tài khoản nhập tay chưa nhập số dư lần nào hoặc quá 30 ngày:
 * chip "chưa đối soát". Khoản gửi kỳ hạn là hàng con thụt 16px.
 */
function AccountItem({ item: { row: r, child }, boot, onCount }: { item: NestedAccount<AccountRow>; boot: Bootstrap | null; onCount: (id: string) => void }) {
  const feed = boot?.accounts.find((a) => a.id === r.accountId)?.sepayEnabled ?? false;
  const drift = driftOf(r);
  const stale = !feed && (!r.lastCountAt || Date.now() - Date.parse(r.lastCountAt) > COUNT_STALE_DAYS * 86_400_000);
  return (
    <Row
      title={
        <>
          {r.name}
          {drift !== null ? <Chip tone="neg">lệch</Chip> : stale && <Chip tone="warn">chưa đối soát</Chip>}
        </>
      }
      sub={[feed ? "SePay" : "nhập tay", r.pendingCount ? `${r.pendingCount} chưa gán` : null].filter(Boolean).join(" · ")}
      value={<Money value={r.bookBalance} />}
      valueSub={drift !== null && <Money value={drift} signed tone={false} class="neg" />}
      indent={child}
      onClick={() => onCount(r.accountId)}
    />
  );
}

/** Tiêu đề thẻ ngăn: chấm 8px màu ngăn · tên · ⓘ sát tên (DESIGN §4.2). */
function PocketTitle({ pocket, label, term }: { pocket: "operating" | "savings" | "reserve" | "outside"; label: string; term?: "operating" | "savings" | "reserve" }) {
  return (
    <span class="card-t">
      <i class={`card-head-dot pocket-${pocket}`} aria-hidden="true" />
      {label}
      {term && <InfoTip term={term} />}
    </span>
  );
}

function AccountsTab() {
  const app = useApp();
  const { boot } = app;
  const snap = viewSnapshot(app);
  const hasExcluded = (snap?.nearSpend?.excluded.length ?? 0) > 0;
  const res = useResource<AccountRow[]>("/v1/accounts");
  const parentOf = new Map(
    snap?.pockets ? [snap.pockets.savings, snap.pockets.reserve, snap.pockets.operating, snap.pockets.outside].flatMap((p) => p.accounts.map((a) => [a.id, a.parentId ?? null] as const)) : [],
  );
  const nest = (rows: AccountRow[]) => nestAccounts(rows, (r) => ({ id: r.accountId, name: r.name, balance: r.bookBalance, parentId: parentOf.get(r.accountId) ?? null }));
  const [counting, setCounting] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const txs = useAssetBuys();
  const assets = (txs.data ?? []).filter((r) => r.status === "active");
  const assetLabel = (k: string | null) => ASSET_KINDS.find((a) => a.value === k)?.label ?? k ?? "";
  const savings = savingsCard(snap?.pockets, snap?.month);
  const reserve = reserveCard(snap?.pockets);

  const operatingIds = new Set(snap?.pockets?.operating.accounts.map((a) => a.id) ?? []);
  const savingsIds = new Set(snap?.pockets?.savings.accounts.map((a) => a.id) ?? []);
  const reserveIds = new Set(snap?.pockets?.reserve.accounts.map((a) => a.id) ?? []);
  const outsideIds = new Set(snap?.pockets?.outside.accounts.map((a) => a.id) ?? []);

  return (
    <>
      <Loadable res={res}>
        {(rows) => {
          const sum = accountsTotal(rows);
          const note = accountsTotalNote(sum.hasCredit, hasExcluded);
          const allNested = nest(rows);
          const opNested = allNested.filter(({ row }) => operatingIds.has(row.accountId));
          const svNested = allNested.filter(({ row }) => savingsIds.has(row.accountId));
          const rsNested = allNested.filter(({ row }) => reserveIds.has(row.accountId));
          const outNested = allNested.filter(({ row }) => outsideIds.has(row.accountId));

          return (
            <>
              {rows.length > 0 && (
                <Card flush>
                  <Row total title="Tiền thật đang có" sub={note} value={<Money value={sum.total} />} valueSub={<span class="row-act">Báo cáo ›</span>} onClick={() => go("net-worth")} />
                </Card>
              )}

              <Card title={<PocketTitle pocket="operating" label="Vận hành" term="operating" />} right={snap?.pockets ? <Money value={snap.pockets.operating.total} tone={false} /> : undefined} flush>
                {opNested.length === 0 ? (
                  <Empty state={EMPTY_STATES.pocketOperating} onAction={() => go("settings", { settingsFocus: "pockets" })} />
                ) : (
                  opNested.map((item) => <AccountItem key={item.row.accountId} item={item} boot={boot} onCount={setCounting} />)
                )}
              </Card>

              <Card title={<PocketTitle pocket="savings" label="Tích luỹ" term="savings" />} right={snap?.pockets ? <Money value={snap.pockets.savings.total} tone={false} /> : undefined} flush>
                {svNested.length === 0 ? (
                  <Empty state={EMPTY_STATES.pocketSavings} onAction={() => go("settings", { settingsFocus: "pockets" })} />
                ) : (
                  svNested.map((item) => <AccountItem key={item.row.accountId} item={item} boot={boot} onCount={setCounting} />)
                )}
                {savings && !savings.empty && (
                  <div class="pocket-meta list-sec">
                    <p>{savings.change}</p>
                    <p>{savings.prev}</p>
                    <div class="near-foot list-foot-row">
                      <span>{savings.pct}</span>
                      <button type="button" class="link" onClick={() => go("settings", { settingsFocus: "parameters" })}>
                        Đổi ›
                      </button>
                    </div>
                  </div>
                )}
                <div class="list-h">Tài sản đang giữ</div>
                <Loadable res={txs}>
                  {() =>
                    assets.length === 0 ? (
                      <Empty state={EMPTY_STATES.holdingAssets} onAction={() => setBuying(true)} />
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
                                {r.note && <div class="sub-line">{maskAmounts(r.note)}</div>}
                              </td>
                              <td>{shortDate(r.at)}</td>
                              <td class="num">
                                <Money value={r.amount} unit={false} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  }
                </Loadable>
                {assets.length > 0 && (
                  <div class="list-foot">
                    <button type="button" class="btn" onClick={() => setBuying(true)}>
                      Mua tài sản
                    </button>
                  </div>
                )}
              </Card>

              <Card title={<PocketTitle pocket="reserve" label="Dự phòng" term="reserve" />} right={snap?.pockets ? <Money value={snap.pockets.reserve.total} tone={false} /> : undefined} flush>
                {rsNested.length === 0 ? (
                  <Empty state={EMPTY_STATES.pocketReserve} onAction={() => go("settings", { settingsFocus: "pockets" })} />
                ) : (
                  rsNested.map((item) => <AccountItem key={item.row.accountId} item={item} boot={boot} onCount={setCounting} />)
                )}
                {reserve && !reserve.empty && (
                  <>
                    <div class="list-h">Mục tiêu</div>
                    {reserve.groups.length === 0 ? (
                      <Empty state={EMPTY_STATES.reserveGoals} onAction={() => go("settings", { settingsFocus: "pocket-goals" })} />
                    ) : (
                      reserve.groups.map((grp) => (
                        <Fragment key={grp.key}>
                          {grp.head && <Row title={grp.head.name} value={grp.head.balance} sub={grp.head.meta} subTone={grp.head.tone === "warn" ? "warn" : undefined} />}
                          {grp.goals.map((g) => (
                            <Row
                              key={g.id}
                              title={g.name}
                              sub={g.amount}
                              subTone={g.over ? "neg" : undefined}
                              value={
                                g.needsAccount ? (
                                  <button type="button" class="row-act" onClick={() => go("settings", { settingsFocus: "pocket-goals" })}>
                                    Mở tài khoản ›
                                  </button>
                                ) : g.pct !== null ? (
                                  `${g.pct}%`
                                ) : undefined
                              }
                              valueSub={g.full && <Chip tone="pos">đủ</Chip>}
                              track={g.pct !== null ? { pct: g.pct, pocket: "reserve", tone: g.full ? "pos" : undefined } : null}
                              indent={Boolean(grp.head)}
                            />
                          ))}
                          {grp.interest && <p class="row-note">{grp.interest}</p>}
                          {grp.note && <p class="row-note">{grp.note}</p>}
                        </Fragment>
                      ))
                    )}
                    <Row
                      title={
                        <>
                          {reserve.peace.title}
                          <InfoTip term="peace" />
                        </>
                      }
                      sub={[reserve.peace.months, reserve.peace.note].filter(Boolean).join(" · ") || undefined}
                      subTone={reserve.peace.bad ? "neg" : undefined}
                      value={reserve.peace.pct !== null ? `${reserve.peace.pct}%` : undefined}
                      track={reserve.peace.pct !== null ? { pct: reserve.peace.pct, pocket: "reserve" } : null}
                    />
                    {reserve.reward && (
                      <Row
                        title={
                          <>
                            {reserve.reward}
                            <InfoTip term="reward" />
                          </>
                        }
                      />
                    )}
                  </>
                )}
              </Card>

              {outNested.length > 0 && (
                <Card title={<PocketTitle pocket="outside" label="Ngoài ngăn" />} right={snap?.pockets ? <Money value={snap.pockets.outside.total} tone={false} /> : undefined} flush>
                  {outNested.map((item) => (
                    <AccountItem key={item.row.accountId} item={item} boot={boot} onCount={setCounting} />
                  ))}
                </Card>
              )}
            </>
          );
        }}
      </Loadable>
      {counting && <CountSheet accountId={counting} onClose={() => setCounting(null)} />}
      {buying && <OtherEntrySheet kind="buy_asset" amount={0} title="Mua tài sản" onClose={() => setBuying(false)} />}
    </>
  );
}

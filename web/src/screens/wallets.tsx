// Ví & quỹ (pwa UC-707): Nhìn lại (chi theo nhóm danh mục trong kỳ lương, so hạn mức mềm và kỳ trước), Tích luỹ, Tài khoản,
// Người thuê, Nợ. Ba trục tách bạch: nhóm kèm "còn / vượt" hạn mức mềm, tài khoản kèm "lệch", danh mục kèm "kỳ trước".

import { useEffect, useState } from "preact/hooks";
import type { LookBack, LookBackCategory, LookBackGroup } from "../../../src/domain/look-back";
import { DRIFT_LABEL, driftOf } from "../lib/drift";
import { formatVnd, maskAmounts } from "../lib/money";
import { interestLineText } from "../lib/interest";
import { accountsTotal } from "../lib/accounts-total";
import { barPct, compareText, cycleHeading, excludedText, isEmptyLookBack, limitText, LOOK_BACK_EMPTY, LOOK_BACK_NOTE, lookBackPath, queueNote, stepCycle } from "../lib/look-back";
import { monthKey, monthLabel, shortDate } from "../lib/period";
import { NO_SAVINGS_ACCOUNT, savingsCard } from "../lib/pocket-cards";
import { cycleFilter } from "../lib/tx-filter";
import type { AccountRow, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, setLookBackCycle, setWalletsTab, useApp, viewSnapshot, type WalletsTab } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Bar, Card, Empty, Loadable, PageHeader, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";
import { CountSheet } from "./count-sheet";
import { DebtsTab } from "./debts";
import { ASSET_KINDS, OtherEntrySheet } from "./other-entry-sheet";
import { TenantsTab } from "./tenants";

const TABS: { value: WalletsTab; label: string }[] = [
  { value: "analysis", label: "Nhìn lại" },
  { value: "wealth-building", label: "Tích luỹ" },
  { value: "accounts", label: "Tài khoản" },
  { value: "tenants", label: "Người thuê" },
  { value: "debts", label: "Nợ" },
];

export function Wallets() {
  const { walletsTab, snap } = useApp();
  const now = new Date();
  return (
    <>
      <PageHeader title="Ví & quỹ" sub={monthLabel(snap?.month ?? monthKey(now))} />
      {/* Năm mục phải thấy hết trên điện thoại: xuống dòng, không cuộn ngang (mục đang chọn không bao giờ khuất). */}
      <div class="tabs wrap" role="group" aria-label="Mục">
        {TABS.map((t) => (
          <button type="button" key={t.value} aria-pressed={walletsTab === t.value} onClick={() => setWalletsTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {walletsTab === "analysis" && <LookBackTab />}
      {walletsTab === "wealth-building" && <WealthBuildingTab />}
      {walletsTab === "accounts" && <AccountsTab />}
      {walletsTab === "tenants" && <TenantsTab />}
      {walletsTab === "debts" && <DebtsTab />}
    </>
  );
}

// ── Nhìn lại ───────────────────────────────────────────────────────
type CycleLookBack = Extract<LookBack, { kind: "cycle" }>;

/**
 * Nhìn lại theo kỳ lương (pwa UC-707, ledger UC-108): kỳ chọn nằm trên địa chỉ `#wallets/analysis/<ngày lương>`; ngày đó không
 * phải kỳ nào (server `invalid_cycle`, UC-711 AC-27) thì về kỳ hiện tại. Số của server — khoản chờ đồng bộ chưa tính.
 */
function LookBackTab() {
  const { lookBackCycle, queue } = useApp();
  const res = useResource<LookBack>(lookBackPath(lookBackCycle));
  useEffect(() => {
    if (lookBackCycle && res.error?.code === "invalid_cycle") setLookBackCycle(null);
  }, [lookBackCycle, res.error]);
  const d = res.data?.kind === "cycle" ? res.data : null;
  const prev = d && stepCycle(d, -1);
  const next = d && stepCycle(d, 1);
  const queued = queueNote(queue.length);
  return (
    <Card
      title={d ? cycleHeading(d.cycle) : "Nhìn lại"}
      right={
        d && (
          <div class="book-month" role="group" aria-label="Kỳ lương">
            <button type="button" class="btn book-step" aria-label="Kỳ trước" disabled={!prev} onClick={() => prev && setLookBackCycle(prev.cycle)}>
              <Icon name="chevron-left" size={18} />
            </button>
            {next && (
              <button type="button" class="btn book-step" aria-label="Kỳ sau" onClick={() => setLookBackCycle(next.cycle)}>
                <Icon name="chevron-right" size={18} />
              </button>
            )}
          </div>
        )
      }
      flush
      note={LOOK_BACK_NOTE}
    >
      <Loadable res={res}>{(raw) => (raw.kind === "cycle" ? <LookBackBody d={raw} queued={queued} /> : null)}</Loadable>
    </Card>
  );
}

function LookBackBody({ d, queued }: { d: CycleLookBack; queued: string | null }) {
  const wide = useWide();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  // Chạm danh mục → Sổ giao dịch lọc danh mục đó và đúng kỳ (mốc giờ của kỳ), nên Chi của Sổ bằng số ở đây.
  const drill = (c: LookBackCategory) => {
    if (c.categoryId) go("ledger", { book: cycleFilter(d.cycle, c.categoryId, new Date()) });
  };
  const excluded = excludedText(d.excluded.debtPrincipal);
  const rows: Rows = {
    open,
    toggle,
    drill,
    interest: d.interest.lines.length > 0 || d.interest.spent !== 0 || d.interest.previousSpent !== 0,
    ungrouped: d.ungrouped.categories.length > 0 || d.ungrouped.spent !== 0 || d.ungrouped.previousSpent !== 0,
  };
  return (
    <>
      <div class="tier btotal">
        <div class="nm">Đã chi kỳ này</div>
        <div class="amt">
          <Money value={d.total} tone={false} />
        </div>
        <div class="tsub">
          <span>Kỳ trước {formatVnd(d.previousTotal)}</span>
        </div>
      </div>
      {queued && (
        <p class="status-row" style={{ padding: "10px 14px 0" }}>
          {queued}
        </p>
      )}
      {isEmptyLookBack(d) ? (
        <Empty title={LOOK_BACK_EMPTY} />
      ) : wide ? (
        <LookBackTable d={d} rows={rows} />
      ) : (
        <div class="blist">
          {d.groups.map((g) => (
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

/** Điện thoại: một nhóm một hàng — tên, chip Thiết yếu, đã chi; thanh (đầy tối đa 100%) và "còn / vượt"; so kỳ trước. Chạm → danh mục. */
function GroupItem({ id, g, rows }: { id: string; g: GroupLike; rows: Rows }) {
  const bar = barPct(g);
  const limit = limitText(g);
  const open = rows.open === id;
  return (
    <>
      <button type="button" class="tier" aria-expanded={open} onClick={() => rows.toggle(id)}>
        <div class="nm">
          <span>{g.name}</span>
          {g.essential && <span class="chip">Thiết yếu</span>}
        </div>
        <div class="amt">
          <Money value={g.spent} tone={false} />
        </div>
        <div class="tsub">
          <span>{compareText(g.spent, g.previousSpent)}</span>
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
function InterestLines({ d }: { d: CycleLookBack }) {
  if (d.interest.lines.length === 0) return null;
  return (
    <ul class="interest-lines">
      {d.interest.lines.map((x) => (
        <li key={x.debtId}>{interestLineText(x)}</li>
      ))}
    </ul>
  );
}

/** Máy tính: bảng nhóm cột Kỳ này / Kỳ trước / Hạn mức; chạm nhóm mở danh mục ngay dưới. */
function LookBackTable({ d, rows }: { d: CycleLookBack; rows: Rows }) {
  const cell = (v: number | null) => (v === null ? "" : <Money value={v} unit={false} mono tone={false} />);
  const categoryRows = (id: string, categories: LookBackCategory[]) =>
    rows.open === id &&
    categories.map((c) => (
      <tr key={`${id}:${c.categoryId ?? "none"}`}>
        <td style={{ paddingLeft: "28px" }}>
          {c.categoryId ? (
            <button type="button" class="link" onClick={() => rows.drill(c)}>
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
      <button type="button" class="link" aria-expanded={rows.open === id} onClick={() => rows.toggle(id)}>
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
            <th scope="col">Kỳ này ₫</th>
            <th scope="col">Kỳ trước ₫</th>
            <th scope="col">Hạn mức ₫</th>
          </tr>
        </thead>
        <tbody>
          {d.groups.map((g) => {
            const bar = barPct(g);
            const limit = limitText(g);
            return [
              <tr key={g.id}>
                {groupCell(g.id, g.name, g.essential && <span class="chip">Thiết yếu</span>)}
                <td class="num">{cell(g.spent)}</td>
                <td class="num">{cell(g.previousSpent)}</td>
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
            <td>Đã chi kỳ này</td>
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
/**
 * Ví & quỹ › Tích luỹ (pwa UC-707, ADR-122): card đầu đọc `pockets.savings` — cùng số thẻ Tích luỹ ở Hôm nay; tài sản đang giữ
 * và nút Mua tài sản (UC-707 AC-37: không còn phần cách tính cũ, không gọi /v1/wealth-building).
 */
function WealthBuildingTab() {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [buying, setBuying] = useState(false);
  const txs = useResource<TxRow[]>("/v1/transactions?limit=200");
  const wide = useWide();
  if (!snap) return <Skeleton rows={4} />;
  const savings = savingsCard(snap.pockets, snap.payCycle);
  const assets = (txs.data ?? []).filter((r) => r.meaning === "buy_asset" && r.status === "active");
  const assetLabel = (k: string | null) => ASSET_KINDS.find((a) => a.value === k)?.label ?? k ?? "";

  const current = (
    <>
      {savings && (
        <section class="card pocket">
          <div class="pocket-h">
            <h2>Tích luỹ</h2>
          </div>
          {savings.empty ? (
            <div class="pocket-empty">
              <button type="button" class="link" style={{ textAlign: "left" }} onClick={() => go("settings", { settingsFocus: "pockets" })}>
                {NO_SAVINGS_ACCOUNT}
              </button>
            </div>
          ) : (
            <>
              <div class="pocket-total">{savings.total}</div>
              <ul class="hero-parts">
                {savings.lines.map((l) => (
                  <li key={l.label}>
                    <span>{l.label}</span>
                    <span>{l.value}</span>
                  </li>
                ))}
              </ul>
              <div class="pocket-meta">
                <p>{savings.change}</p>
                <p>{savings.prev}</p>
                <div class="near-foot" style={{ borderTop: 0, paddingTop: 0, marginTop: 2 }}>
                  <span>{savings.pct}</span>
                  <button type="button" class="link" onClick={() => go("settings", { settingsFocus: "parameters" })}>
                    Đổi ›
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
      <Card title="Tài sản đang giữ" flush>
        <Loadable res={txs}>
          {() =>
            assets.length === 0 ? (
              <Empty title="Chưa mua tài sản nào.">Tiền Tích luỹ đang nằm ở dạng tiền mặt. Giá tốt thì mua vàng.</Empty>
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
                        <Money value={r.amount} unit={false} mono />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Loadable>
        <div class="pad">
          <button type="button" class="btn btn-primary btn-wide" onClick={() => setBuying(true)}>
            Mua tài sản
          </button>
        </div>
      </Card>
    </>
  );

  return (
    <>
      {wide ? <div class="dk-cols">{current}</div> : current}
      {buying && <OtherEntrySheet kind="buy_asset" amount={0} title="Mua tài sản" onClose={() => setBuying(false)} />}
    </>
  );
}

// ── Tài khoản ──────────────────────────────────────────────────────
/** Dòng phụ của hàng "Tiền thật đang có" (pwa UC-707 AC-31). */
function accountsTotalNote(hasCredit: boolean, hasExcluded: boolean): string | null {
  const parts = [hasCredit ? "đã trừ dư nợ thẻ" : null, hasExcluded ? "gồm cả tiền Tích luỹ, Dự phòng và tài khoản ngoài ngăn — tiền vận hành xem ở Hôm nay" : null];
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

function AccountsTab() {
  const { boot, snap } = useApp();
  const hasExcluded = (snap?.nearSpend?.excluded.length ?? 0) > 0;
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
          {(rows) => {
            const sum = accountsTotal(rows);
            const note = accountsTotalNote(sum.hasCredit, hasExcluded);
            return wide ? <AccountsWide rows={rows} onCount={setCounting} total={rows.length > 0 ? { value: sum.total, note } : null} /> : (
            // Điện thoại: mỗi tài khoản một hàng, số sổ to bên phải; dòng "lệch" chỉ có nghĩa với tài khoản SePay
            // nên chỉ hiện ở đó — không còn bảng bốn cột đầy "—" (audit 261001 F21).
            <div class="blist">
              {rows.length > 0 && (
                <div class="tier accounts-total">
                  <div class="nm">Tiền thật đang có</div>
                  <div class="amt">
                    <Money value={sum.total} />
                  </div>
                  {note && (
                    <div class="tsub">
                      <span>{note}</span>
                    </div>
                  )}
                </div>
              )}
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
          );
          }}
        </Loadable>
      </Card>
      {counting && <CountSheet accountId={counting} onClose={() => setCounting(null)} />}
    </>
  );
}

const ACCOUNT_KIND: Record<string, string> = { bank: "Ngân hàng", cash: "Tiền mặt", ewallet: "Ví điện tử", credit: "Thẻ tín dụng" };

/** Máy tính: mọi cột của /v1/accounts cùng lúc — sổ, feed, lệch, chưa gán, lần cuối. */
function AccountsWide({ rows, onCount, total }: { rows: AccountRow[]; onCount: (id: string) => void; total: { value: number; note: string | null } | null }) {
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
          {total && (
            <tr class="dk-total">
              <td>
                Tiền thật đang có
                {total.note && <div class="sub-line">{total.note}</div>}
              </td>
              <td class="num">
                <Money value={total.value} unit={false} mono />
              </td>
              <td colSpan={5} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}



// Tài sản & tự do (`#net-worth`, pwa UC-717): màn phụ, không có tab ở thanh dưới, không FAB; mở từ tab Nợ và thanh bên.
// Lát này có hai phần: Cân đối (A/B/C/D, theo tháng) và Tháp. Tiền, nợ, phải thu luôn từ sổ — dòng từ sổ có chip "từ sổ",
// chạm thì mở màn nguồn. Mục tài sản nhập tay (vàng, đất, chứng khoán…) chạm mở sheet: lô, giá theo ngày, chốt lời / cắt lỗ.
// Ghi cần mạng (ghi thẳng lên server); mất mạng thì xem bản lưu. Mọi số đã tính ở server (GET /v1/balance-sheet).

import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import type { NetWorthSection } from "../lib/hash-route";
import { formatVnd } from "../lib/money";
import {
  ASSET_KIND_LABEL,
  assetRowSub,
  cashflowFooter,
  dateText,
  defaultFlags,
  growthText,
  historySub,
  INTEREST_GROUP_LABEL,
  ITEM_SECTIONS,
  itemPayload,
  itemTargetsPayload,
  itemToForm,
  ledgerTarget,
  liabilityName,
  liabilityRowSub,
  lotPayload,
  lotsSummary,
  lotsTotalText,
  lotSub,
  lotTitle,
  monthText,
  pctText,
  pnlText,
  positionText,
  PYRAMID,
  pyramidLabel,
  returnText,
  SECTION_LABEL,
  sectionGroupLabel,
  sellPayload,
  soldLotText,
  statusLabel,
  targetsPayload,
  TERM_LABEL,
  valuePayload,
  valueText,
  valueToast,
  valueToForm,
  type ItemForm,
  type LotForm,
  type ValueForm,
} from "../lib/net-worth";
import { dayKey } from "../lib/period";
import { periodFromHash, periodHash } from "../lib/reports";
import type { Result } from "../lib/settings";
import type { BalanceHistory, BalanceItem, BalanceLot, BalanceRow, BalanceSheet, LiabilityRow, PyramidTier } from "../lib/types";
import { type Resource, useResource } from "../state/resource";
import { go, setNetWorthSection, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, Loadable, NeedsNetwork, PageHeader, Seg, Sheet } from "../ui/parts";
import { useWide } from "../ui/shell";
import { MilestonesSection, ProjectionSection } from "./net-worth-freedom";
import { CashFlowSection, IncomeSection, PeriodBar } from "./net-worth-reports";
import { Check, Field, Hint } from "./settings-sheets";

/** Sáu phần (UC-717); hash lạ mở về Cân đối. */
const SECTIONS: { value: NetWorthSection; label: string }[] = [
  { value: "sheet", label: "Cân đối" },
  { value: "pyramid", label: "Tháp" },
  { value: "cash-flow", label: "Lưu chuyển tiền" },
  { value: "income", label: "Thu chi" },
  { value: "milestones", label: "Mốc tự do" },
  { value: "projection", label: "Thử số" },
];

type Open =
  | { kind: "add" }
  | { kind: "item"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "value"; id: string }
  | { kind: "lot"; id: string }
  | { kind: "sell"; id: string; lotId: number }
  | { kind: "lot-targets"; id: string; lotId: number }
  | { kind: "item-targets"; id: string }
  | null;

export function NetWorth() {
  const app = useApp();
  const wide = useWide();
  const section = SECTIONS.some((s) => s.value === app.netWorthSection) ? app.netWorthSection : "sheet";
  const sheet = useResource<BalanceSheet>("/v1/balance-sheet");
  const history = useResource<BalanceHistory>("/v1/balance-sheet/history?months=12");
  const [open, setOpen] = useState<Open>(null);
  const data = sheet.data;
  const item = open && open.kind !== "add" ? (data?.items.find((i) => i.id === open.id) ?? null) : null;
  const today = data?.today ?? dayKey(new Date());
  // Lưu chuyển tiền và Thu chi dùng chung một kỳ (UC-717 AC-3); kỳ nằm trên địa chỉ nên F5 giữ đúng kỳ, mặc định tháng hiện tại.
  const [period, setPeriod] = useState(() => periodFromHash(location.hash, dayKey(new Date())));
  const report = section === "cash-flow" || section === "income";
  // replaceState: ghi kỳ vào địa chỉ mà không thêm bước "quay lại", không gây hashchange.
  useEffect(() => {
    if (report) window.history.replaceState(null, "", periodHash(section, period));
  }, [report, section, period]);

  // Ghi xong: toast nói hệ quả, bảng / tháp / lịch sử đọc lại; sheet con đóng về sheet của mục.
  const changed = (text: string, back: Open = open && open.kind !== "add" ? { kind: "item", id: open.id } : null) => {
    toast(text);
    sheet.reload();
    history.reload();
    setOpen(back);
  };
  const toItem = () => setOpen(item ? { kind: "item", id: item.id } : null);

  const main = section === "milestones" ? (
    <MilestonesSection />
  ) : section === "projection" ? (
    <ProjectionSection today={today} />
  ) : report ? (
    <>
      <PeriodBar period={period} today={today} onChange={setPeriod} />
      {section === "cash-flow" ? <CashFlowSection period={period} /> : <IncomeSection period={period} />}
    </>
  ) : (
    <Loadable res={sheet}>
      {(d) =>
        section === "pyramid" ? (
          <Pyramid d={d} onOpen={(id) => setOpen({ kind: "item", id })} />
        ) : (
          <BalanceSheetView d={d} history={history} wide={wide} onOpen={(id) => setOpen({ kind: "item", id })} />
        )
      }
    </Loadable>
  );

  return (
    <>
      <PageHeader
        title="Tài sản & tự do"
        sub={`Tới ngày ${dateText(today)}`}
        action={
          <button type="button" class="btn btn-primary" disabled={!app.online} onClick={() => setOpen({ kind: "add" })}>
            <Icon name="plus" size={16} /> Thêm tài sản
          </button>
        }
      />
      {/* Hàng nút các phần: xuống dòng khi chật, không cuộn ngang (UC-717 AC-1). */}
      <div class="tabs wrap" role="group" aria-label="Phần">
        {SECTIONS.map((s) => (
          <button type="button" key={s.value} aria-pressed={section === s.value} onClick={() => setNetWorthSection(s.value)}>
            {s.label}
          </button>
        ))}
      </div>

      {wide ? (
        <div class="dk-cols nw-cols">
          <div>{main}</div>
          <div class="dk-panel">{data && <Summary d={data} />}</div>
        </div>
      ) : (
        main
      )}

      {open?.kind === "add" && <ItemFormSheet item={null} today={today} onClose={() => setOpen(null)} onSaved={(text, id) => changed(text, { kind: "item", id })} />}
      {item && open?.kind === "item" && <ItemSheet item={item} onClose={() => setOpen(null)} open={setOpen} onChanged={changed} />}
      {item && open?.kind === "edit" && <ItemFormSheet item={item} today={today} onClose={toItem} onSaved={(text) => changed(text)} />}
      {item && open?.kind === "value" && <ValueSheet item={item} today={today} onClose={toItem} onSaved={changed} />}
      {item && open?.kind === "lot" && <LotSheet item={item} today={today} onClose={toItem} onSaved={changed} />}
      {item && open?.kind === "item-targets" && <ItemTargetsSheet item={item} today={today} onClose={toItem} onSaved={changed} />}
      {item && open?.kind === "sell" && <LotOf item={item} lotId={open.lotId}>{(lot) => <SellSheet item={item} lot={lot} today={today} onClose={toItem} onSaved={changed} />}</LotOf>}
      {item && open?.kind === "lot-targets" && <LotOf item={item} lotId={open.lotId}>{(lot) => <LotTargetsSheet item={item} lot={lot} onClose={toItem} onSaved={changed} />}</LotOf>}
    </>
  );
}

function LotOf({ item, lotId, children }: { item: BalanceItem; lotId: number; children: (lot: BalanceLot) => ComponentChildren }) {
  const lot = item.lots.find((l) => l.id === lotId);
  return lot ? <>{children(lot)}</> : null;
}

// ── Cân đối ─────────────────────────────────────────────────────────

/** Card tóm tắt ba hàng: Tổng tài sản · Nợ phải trả (−) · Vốn chủ sở hữu (28px, không phải hero — DESIGN §4). */
function Summary({ d }: { d: BalanceSheet }) {
  return (
    <Card>
      <div class="srow" style={{ borderTop: 0 }}>
        <span class="srow-t">Tổng tài sản</span>
        <Money value={d.totalAssets} tone={false} />
      </div>
      <div class="srow">
        <span class="srow-t">Nợ phải trả</span>
        <Money value={-d.totalLiabilities} tone={false} />
      </div>
      <div class="srow nw-equity">
        <span class="srow-t">Vốn chủ sở hữu</span>
        <Money value={d.equity} />
      </div>
    </Card>
  );
}

function BalanceSheetView({ d, history, wide, onOpen }: { d: BalanceSheet; history: Resource<BalanceHistory>; wide: boolean; onOpen: (id: string) => void }) {
  const items = new Map(d.items.map((i) => [i.id, i]));
  const groups = (["A", "B"] as const).map((g) => ({ g, sections: d.assets.filter((s) => s.section.startsWith(g)) })).filter((x) => x.sections.length > 0);
  const empty = d.assets.length === 0 && d.liabilities.length === 0;
  return (
    <>
      {!wide && <Summary d={d} />}
      {empty && (
        <Card>
          <Empty title="Chưa có gì trong bảng cân đối.">Tiền, nợ, phải thu lấy từ sổ. Thêm vàng, đất, chứng khoán bằng nút Thêm tài sản.</Empty>
        </Card>
      )}
      {groups.map(({ g, sections }) => (
        <Card key={g} title={sectionGroupLabel(sections[0]!.section)} right={<Money value={sections.reduce((s, x) => s + x.total, 0)} tone={false} />} flush>
          <div class="blist">
            {sections.map((s) => (
              <Fragment key={s.section}>
                <div class="set-sub bgroup">
                  <span>{SECTION_LABEL[s.section]}</span>
                  <span class="tnum">{formatVnd(s.total)}</span>
                </div>
                {s.rows.map((r) => (
                  <AssetLine key={r.key} r={r} item={r.itemId ? (items.get(r.itemId) ?? null) : null} onOpen={onOpen} />
                ))}
              </Fragment>
            ))}
          </div>
        </Card>
      ))}
      {d.items.some((i) => !i.present) && (
        <Card title="Chưa có trong bảng" flush note="Mục chưa có định giá hay lô đang giữ thì chưa cộng vào bảng. Chạm để cập nhật giá hoặc thêm lô.">
          {d.items
            .filter((i) => !i.present)
            .map((i) => (
              <button type="button" key={i.id} class="srow" onClick={() => onOpen(i.id)}>
                <span class="srow-main">
                  <span class="srow-t">{i.name}</span>
                  <span class="srow-s">{[SECTION_LABEL[i.section], pyramidLabel(i.pyramid), i.measure === "units" ? `theo lô (${i.unit})` : "theo giá trị"].join(" · ")}</span>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
        </Card>
      )}
      {d.liabilities.length > 0 && <Liabilities d={d} />}
      <p class="hint" style={{ margin: "0 4px 12px" }}>
        Vốn chủ = tài sản − nợ. Tiền, nợ, phải thu lấy từ sổ. Số ở đây không đổi ví hay số còn để chi.
      </p>
      <Loadable res={history}>{(h) => <History h={h} />}</Loadable>
    </>
  );
}

/** Một dòng tài sản: tên trái, giá trị phải; dòng phụ % / dòng tiền / ngày giá; mục theo lô thêm số lượng, lãi / lỗ, chip chạm giá. */
function AssetLine({ r, item, onOpen }: { r: BalanceRow; item: BalanceItem | null; onOpen: (id: string) => void }) {
  const lots = item ? lotsSummary(item) : null;
  const ledger = r.source === "ledger";
  const click = () => {
    if (!ledger && r.itemId) return onOpen(r.itemId);
    const t = ledgerTarget(r.key);
    go(t.tab, { walletsTab: t.walletsTab });
  };
  return (
    <button type="button" class="tier" onClick={click} aria-label={`${r.name}: ${formatVnd(r.value)}${ledger ? ", từ sổ — mở sổ nguồn" : ", xem chi tiết"}`}>
      <div class="nm">
        {r.name}
        {ledger && <span class="chip">từ sổ</span>}
        {lots?.chips.map((c) => (
          <span key={c.label} class={`chip ${c.tone}`}>
            {c.label}
          </span>
        ))}
      </div>
      <div class="amt">
        <Money value={r.value} tone={false} />
      </div>
      <div class="tsub nw-sub">
        <span>{assetRowSub(r, item)}</span>
      </div>
      {lots?.text && (
        <div class="tsub nw-sub">
          <span>{lots.text}</span>
        </div>
      )}
    </button>
  );
}

/** C. Nợ phải trả: Ngắn hạn / Dài hạn, mỗi nhóm con Không lãi / Lãi thường / Lãi cao; hàng cuối Tiền lãi mỗi năm. */
function Liabilities({ d }: { d: BalanceSheet }) {
  return (
    <Card title="C. Nợ phải trả" right={<Money value={d.totalLiabilities} tone={false} />} flush>
      <div class="blist">
        {(["short", "long"] as const).map((term) => {
          const groups = d.liabilities.filter((g) => g.term === term);
          if (groups.length === 0) return null;
          return (
            <Fragment key={term}>
              <div class="set-sub bgroup">
                <span>{TERM_LABEL[term]}</span>
                <span class="tnum">{formatVnd(groups.reduce((s, g) => s + g.total, 0))}</span>
              </div>
              {groups.map((g) => (
                <Fragment key={g.group}>
                  <div class="nw-group">{INTEREST_GROUP_LABEL[g.group]}</div>
                  {g.rows.map((r) => (
                    <LiabilityLine key={r.key} r={r} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          );
        })}
        <div class="tier btotal">
          <div class="nm">Tiền lãi mỗi năm</div>
          <div class="amt">
            <Money value={d.interestPerYear} tone={false} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function LiabilityLine({ r }: { r: LiabilityRow }) {
  const t = ledgerTarget(r.key);
  return (
    <button type="button" class="tier" onClick={() => go(t.tab, { walletsTab: t.walletsTab })} aria-label={`${liabilityName(r)}: ${formatVnd(r.value)}, từ sổ — mở sổ nguồn`}>
      <div class="nm">
        {liabilityName(r)}
        <span class="chip">từ sổ</span>
      </div>
      <div class="amt">
        <Money value={r.value} tone={false} />
      </div>
      <div class="tsub nw-sub">
        <span>{liabilityRowSub(r)}</span>
      </div>
    </button>
  );
}

/** Card Theo tháng: mới nhất trên cùng, mỗi tháng một hàng — tháng trái, vốn chủ phải. */
function History({ h }: { h: BalanceHistory }) {
  if (h.points.length === 0) return null;
  return (
    <Card title="Theo tháng" flush note="Mỗi tháng tính tại cuối tháng; tháng đang chạy tính tới hôm nay.">
      <div class="blist">
        {[...h.points].reverse().map((p) => (
          <div class="tier" key={p.month}>
            <div class="nm">Tháng {monthText(p.month)}</div>
            <div class="amt">
              <Money value={p.equity} />
            </div>
            <div class="tsub nw-sub">
              <span>{historySub(p)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Tháp ────────────────────────────────────────────────────────────

/** Năm hàng từ trên xuống, thanh căn giữa rộng theo %; chạm tầng → danh sách dòng của tầng. */
function Pyramid({ d, onOpen }: { d: BalanceSheet; onOpen: (id: string) => void }) {
  const [tier, setTier] = useState<PyramidTier | null>(null);
  const rows = d.assets.flatMap((s) => s.rows);
  const items = new Map(d.items.map((i) => [i.id, i]));
  return (
    <>
      <Card title="Tháp tài sản" flush note={cashflowFooter(d.cashflowMonthly, d.netCashflowMonthly)}>
        <div class="blist">
          {PYRAMID.map(({ tier: t, label }) => {
            const p = d.pyramid.find((x) => x.tier === t);
            return (
              <button type="button" key={t} class="tier nw-tier" aria-expanded={tier === t} onClick={() => setTier(tier === t ? null : t)}>
                <div class="nm">{label}</div>
                <div class="amt">
                  <Money value={p?.total ?? 0} tone={false} /> <span class="nw-pct">{pctText(p?.pct ?? null)}</span>
                </div>
                <div class="nw-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, p?.pct ?? 0))}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>
      {tier && (
        <Card title={`Tầng ${pyramidLabel(tier)}`} flush>
          {rows.filter((r) => r.pyramid === tier).length === 0 ? (
            <Empty title="Tầng này chưa có gì." />
          ) : (
            <div class="blist">
              {rows
                .filter((r) => r.pyramid === tier)
                .map((r) => (
                  <AssetLine key={r.key} r={r} item={r.itemId ? (items.get(r.itemId) ?? null) : null} onOpen={onOpen} />
                ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ── Sheet một mục ───────────────────────────────────────────────────

function ItemSheet({ item, onClose, open, onChanged }: { item: BalanceItem; onClose: () => void; open: (o: Open) => void; onChanged: (text: string, back?: Open) => void }) {
  const { online } = useApp();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSold, setShowSold] = useState(false);
  const held = item.lots.filter((l) => l.held);
  const sold = item.lots.filter((l) => !l.held);
  const units = item.measure === "units";
  const ret = returnText(item);

  async function act(key: string, path: string, done: string, back?: Open) {
    if (confirm !== key) return setConfirm(key);
    setBusy(true);
    try {
      if (key === "delete") await api.del(path);
      else await api.post(path);
      onChanged(done, back);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const flags = [SECTION_LABEL[item.section].replace(/^\d+\. /, ""), `tầng ${pyramidLabel(item.pyramid).toLowerCase()}`, item.liquid ? "tiền lỏng" : null, item.investable ? "tài sản đầu tư" : null, item.assetKind ? `gắn ${ASSET_KIND_LABEL[item.assetKind].toLowerCase()} mua qua app` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet open title={item.name} onClose={onClose}>
      <div class="srow" style={{ borderTop: 0 }}>
        <span class="srow-main">
          <span class="srow-t">{units ? `${item.unitPrice !== null ? `Giá ${formatVnd(item.unitPrice)}/${item.unit}` : "Chưa có giá — mỗi lô tính theo giá mua"}` : "Giá trị"}</span>
          <span class="srow-s">{[item.priceOn ? `ngày ${dateText(item.priceOn)}` : null, ret].filter(Boolean).join(" · ") || flags}</span>
        </span>
        <Money value={item.value} tone={false} class="srow-amt" />
      </div>
      <p class="fhint">{flags}</p>

      {!units && item.position && (
        <div class="srow">
          <span class="srow-main">
            <span class="srow-t">
              {pnlText(item.position)} <StatusChip p={item.position} />
            </span>
            <span class="srow-s">{positionText(item.position)}</span>
          </span>
        </div>
      )}

      <div class="pad grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-primary" disabled={!online} onClick={() => open({ kind: "value", id: item.id })}>
          {units ? "Cập nhật giá" : "Cập nhật giá trị"}
        </button>
        {units ? (
          <button type="button" class="btn" disabled={!online} onClick={() => open({ kind: "lot", id: item.id })}>
            Thêm lô
          </button>
        ) : (
          <button type="button" class="btn" disabled={!online} onClick={() => open({ kind: "item-targets", id: item.id })}>
            Giá mua & mục tiêu
          </button>
        )}
      </div>

      {units && (
        <>
          <div class="set-sub">Các lô</div>
          {held.length === 0 && <p class="fhint">Chưa có lô nào đang giữ. Thêm lô: ngày mua, số lượng, giá mua một {item.unit}.</p>}
          {held.map((l) => (
            <div class="srow nw-lot" key={l.id}>
              <span class="srow-main">
                <span class="srow-t">{lotTitle(l, item.unit)}</span>
                <span class="srow-s">{lotSub(l)}</span>
                {l.position && (
                  <span class="srow-s">
                    <StatusChip p={l.position} /> {growthText(l.position)}
                  </span>
                )}
                {online && (
                  <span class="nw-act">
                    <button type="button" class="link" onClick={() => open({ kind: "sell", id: item.id, lotId: l.id })}>
                      Bán lô
                    </button>
                    <button type="button" class="link" onClick={() => open({ kind: "lot-targets", id: item.id, lotId: l.id })}>
                      Giá chốt lời / cắt lỗ
                    </button>
                    <button type="button" class={confirm === `lot${l.id}` ? "btn btn-bad" : "link"} disabled={busy} onClick={() => void act(`lot${l.id}`, `/v1/balance-lots/${l.id}/void`, `Đã huỷ lô ${lotTitle(l, item.unit)}.`)}>
                      {confirm === `lot${l.id}` ? "Huỷ hẳn lô này" : "Huỷ lô"}
                    </button>
                  </span>
                )}
              </span>
              <span class={l.position && l.position.pnl < 0 ? "srow-amt neg tnum" : "srow-amt tnum"}>{l.position ? pnlText(l.position) : ""}</span>
            </div>
          ))}
          {held.length > 0 && <p class="fhint nw-total">{lotsTotalText(item)}</p>}
          {sold.length > 0 && (
            <button type="button" class="srow" aria-expanded={showSold} onClick={() => setShowSold((v) => !v)}>
              <span class="srow-t">Đã bán ({sold.length})</span>
              <span class="srow-r">
                <Icon name={showSold ? "chevron-up" : "chevron-down"} size={16} />
              </span>
            </button>
          )}
          {showSold &&
            sold.map((l) => (
              <div class="srow" key={l.id}>
                <span class="srow-main">
                  <span class="srow-t">{lotTitle(l, item.unit)}</span>
                  <span class="srow-s">{soldLotText(l)}</span>
                </span>
              </div>
            ))}
        </>
      )}

      <div class="set-sub">{units ? "Lịch sử giá" : "Lịch sử định giá"}</div>
      {item.values.length === 0 && <p class="fhint">Chưa có lần định giá nào.</p>}
      {item.values.map((v) => (
        <div class="srow" key={v.id}>
          <span class="srow-main">
            <span class="srow-s">{valueText(v, item.unit)}</span>
          </span>
          {online && (
            <button type="button" class={confirm === `v${v.id}` ? "btn btn-bad" : "link"} disabled={busy} onClick={() => void act(`v${v.id}`, `/v1/balance-values/${v.id}/void`, `Đã huỷ định giá ngày ${dateText(v.asOf)}.`)}>
              {confirm === `v${v.id}` ? "Huỷ hẳn" : "Huỷ"}
            </button>
          )}
        </div>
      ))}

      <div class="pad grid grid-cols-2 gap-2">
        <button type="button" class="btn" disabled={!online} onClick={() => open({ kind: "edit", id: item.id })}>
          Sửa mục
        </button>
        {item.lots.length === 0 && item.values.length === 0 && (
          <button
            type="button"
            class={confirm === "delete" ? "btn btn-bad" : "btn"}
            disabled={!online || busy}
            onClick={() => void act("delete", `/v1/balance-items/${encodeURIComponent(item.id)}`, `Đã xoá mục ${item.name}.`, null)}
          >
            {confirm === "delete" ? "Xoá hẳn mục này" : "Xoá mục"}
          </button>
        )}
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Chỉ ghi thêm: ghi sai thì huỷ dòng rồi ghi lại. Không có giao dịch nào được ghi — tiền bán về tài khoản ghi ở sổ như mọi khoản khác.
      </div>
      {!online && (
        <div class="pad">
          <NeedsNetwork what="Cập nhật giá, thêm hay bán lô" />
        </div>
      )}
    </Sheet>
  );
}

function StatusChip({ p }: { p: NonNullable<BalanceLot["position"]> }) {
  const s = statusLabel(p);
  return <span class={s.tone ? `chip ${s.tone}` : "chip"}>{s.label}</span>;
}

// ── Sheet nhập ──────────────────────────────────────────────────────

/** Gửi một request ghi: chặn bấm hai lần, lỗi server hiện trên nút. */
function useSend() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function send<T, R>(r: Result<T>, call: (body: T) => Promise<R>, done: (res: R) => void) {
    if (!r.ok) {
      setErrors(r.errors);
      setError("Còn ô chưa đúng, xem dòng đỏ.");
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      done(await call(r.value));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return { busy, error, errors, send };
}

function Footer({ busy, error, label, onSubmit }: { busy: boolean; error: string | null; label: string; onSubmit: () => void }) {
  const { online } = useApp();
  return (
    <div class="pad">
      {error && (
        <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy} onClick={onSubmit}>
        {busy ? "Đang lưu…" : label}
      </button>
      {!online && <NeedsNetwork what={label} />}
    </div>
  );
}

/** Thêm / sửa mục: tên, mục, tầng, cách tính, đơn vị, cờ, loại mua qua app. Thêm theo giá trị thì ghi luôn giá trị đầu tiên. */
function ItemFormSheet({ item, today, onClose, onSaved }: { item: BalanceItem | null; today: string; onClose: () => void; onSaved: (text: string, id: string) => void }) {
  const [f, setF] = useState<ItemForm>(() => itemToForm(item));
  const [first, setFirst] = useState({ amount: 0, day: today });
  const { busy, error, errors, send } = useSend();
  const set = (patch: Partial<ItemForm>) => setF((x) => ({ ...x, ...patch }));
  // Đổi mục / tầng khi thêm: cờ theo mặc định mới (người dùng vẫn bật / tắt lại được).
  const place = (patch: Pick<ItemForm, "section"> | Pick<ItemForm, "pyramid">) => {
    const next = { ...f, ...patch };
    set(item ? patch : { ...patch, ...defaultFlags(next.section, next.pyramid) });
  };
  const locked = !!item && (item.lots.length > 0 || item.values.length > 0);

  function submit() {
    const r = itemPayload(f, item);
    const body: Result<Record<string, unknown>> =
      r.ok && !item && f.measure === "value" && first.amount > 0 ? { ok: true, value: { ...r.value, value: first.amount, as_of: first.day } } : r;
    void send(
      body,
      (b) => (item ? api.patch<BalanceItem>(`/v1/balance-items/${encodeURIComponent(item.id)}`, b) : api.post<BalanceItem>("/v1/balance-items", b)),
      (saved) => onSaved(item ? `Đã lưu ${saved.name}.` : `Đã thêm ${saved.name}${saved.value !== null ? ` ${formatVnd(saved.value)}` : ""}.`, saved.id),
    );
  }

  return (
    <Sheet open title={item ? `Sửa ${item.name}` : "Thêm tài sản"} onClose={onClose}>
      {!item && <Hint>Tiền ngân hàng, tiền mặt, khoản nợ, khoản người khác nợ mình lấy từ sổ — không thêm ở đây.</Hint>}
      <Field id="i-name" label="Tên" error={errors.name} first={!!item}>
        <input id="i-name" class="ctl" maxLength={80} placeholder="Vàng nhẫn, Đất nền…" value={f.name} onInput={(e) => set({ name: e.currentTarget.value })} />
      </Field>
      <Field id="i-section" label="Mục">
        <select id="i-section" class="ctl" value={f.section} onChange={(e) => place({ section: e.currentTarget.value as ItemForm["section"] })}>
          {ITEM_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {`${s[0]}${s.slice(1)} · ${SECTION_LABEL[s].replace(/^\d+\. /, "")}`}
            </option>
          ))}
        </select>
      </Field>
      <Field id="i-pyramid" label="Tầng tháp">
        <select id="i-pyramid" class="ctl" value={f.pyramid} onChange={(e) => place({ pyramid: e.currentTarget.value as PyramidTier })}>
          {PYRAMID.map((p) => (
            <option key={p.tier} value={p.tier}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <div class="field">
        <span class="k">Cách tính</span>
        {locked ? (
          <span>{f.measure === "units" ? "Theo lô" : "Theo giá trị"}</span>
        ) : (
          <Seg
            label="Cách tính"
            value={f.measure}
            onChange={(measure) => set({ measure })}
            options={[
              { value: "value", label: "Theo giá trị" },
              { value: "units", label: "Theo lô" },
            ]}
          />
        )}
      </div>
      {locked && <Hint>Đã có định giá hoặc lô nên không đổi được cách tính.</Hint>}
      {f.measure === "units" && (
        <Field id="i-unit" label="Đơn vị" error={errors.unit}>
          <input id="i-unit" class="ctl" maxLength={20} placeholder="chỉ, lượng, cổ phiếu" value={f.unit} onInput={(e) => set({ unit: e.currentTarget.value })} />
        </Field>
      )}
      {!item && f.measure === "value" && (
        <>
          <Field id="i-value" label="Giá trị">
            <AmountInput id="i-value" value={first.amount} onChange={(n) => setFirst((x) => ({ ...x, amount: n }))} />
          </Field>
          <Field id="i-day" label="Ngày định giá">
            <input id="i-day" class="ctl" type="date" max={today} value={first.day} onInput={(e) => setFirst((x) => ({ ...x, day: e.currentTarget.value || today }))} />
          </Field>
        </>
      )}
      <Check id="i-liquid" label="Tiền lỏng — đếm cho Mốc an tâm" checked={f.liquid} onChange={(v) => set({ liquid: v })} />
      <Check id="i-investable" label="Tài sản đầu tư — đếm cho mốc Tự do" checked={f.investable} onChange={(v) => set({ investable: v })} />
      <Field id="i-kind" label="Loại mua qua app">
        <select id="i-kind" class="ctl" value={f.assetKind} onChange={(e) => set({ assetKind: e.currentTarget.value as ItemForm["assetKind"] })}>
          <option value="">không gắn</option>
          {(Object.keys(ASSET_KIND_LABEL) as (keyof typeof ASSET_KIND_LABEL)[]).map((k) => (
            <option key={k} value={k}>
              {ASSET_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Hint>Gắn loại thì khoản mua cùng loại qua app (giá mua) thôi hiện ở bảng — mục này thay nó bằng giá mới nhất.</Hint>
      <Field id="i-note" label="Ghi chú">
        <input id="i-note" class="ctl" maxLength={500} value={f.note} onInput={(e) => set({ note: e.currentTarget.value })} />
      </Field>
      <Footer busy={busy} error={error} label={item ? "Lưu" : "Thêm tài sản"} onSubmit={submit} />
    </Sheet>
  );
}

/** Cập nhật giá: ô điền sẵn từ dòng mới nhất, ngày hôm nay — mở mục, chạm Cập nhật giá, gõ, Lưu (UC-717 AC-2). */
function ValueSheet({ item, today, onClose, onSaved }: { item: BalanceItem; today: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState<ValueForm>(() => valueToForm(item, today));
  const { busy, error, errors, send } = useSend();
  const units = item.measure === "units";
  const set = (patch: Partial<ValueForm>) => setF((x) => ({ ...x, ...patch }));
  const gold = item.assetKind === "gold" || /vàng/i.test(item.name);
  return (
    <Sheet open title={units ? `Cập nhật giá ${item.name}` : `Cập nhật giá trị ${item.name}`} onClose={onClose}>
      <Field id="v-amount" label={units ? `Giá một ${item.unit ?? "đơn vị"}` : "Giá trị"} error={errors.amount} first>
        <AmountInput id="v-amount" value={f.amount} onChange={(n) => set({ amount: n })} autoFocus />
      </Field>
      {units && gold && <Hint>Giá tiệm mua vào, một {item.unit ?? "chỉ"}.</Hint>}
      <Field id="v-day" label="Ngày" error={errors.day}>
        <input id="v-day" class="ctl" type="date" max={today} value={f.day} onInput={(e) => set({ day: e.currentTarget.value || today })} />
      </Field>
      <Field id="v-cash" label="Dòng tiền thật">
        <AmountInput id="v-cash" value={f.cashflow} onChange={(n) => set({ cashflow: n })} />
      </Field>
      <div class="field">
        <span class="k">Kỳ của dòng tiền</span>
        <Seg
          label="Kỳ của dòng tiền"
          value={f.period}
          onChange={(period) => set({ period })}
          options={[
            { value: "month", label: "Tháng" },
            { value: "year", label: "Năm" },
          ]}
        />
      </div>
      <Hint>Cổ tức, tiền thuê, lãi thật sự về — số sau thuế.</Hint>
      <Field id="v-exp" label="Lợi suất kỳ vọng %/năm" error={errors.expected}>
        <input id="v-exp" class="ctl" inputMode="decimal" placeholder="tuỳ chọn" value={f.expected} onInput={(e) => set({ expected: e.currentTarget.value })} />
      </Field>
      <Hint>Lợi suất kỳ vọng gồm cả tăng giá — không tính là thu nhập.</Hint>
      <Footer
        busy={busy}
        error={error}
        label={`Lưu ${formatVnd(f.amount)}${units && item.unit ? `/${item.unit}` : ""}`}
        onSubmit={() => void send(valuePayload(f, item.measure, today), (b) => api.post(`/v1/balance-items/${encodeURIComponent(item.id)}/values`, b), () => onSaved(valueToast(item, f.amount, f.day)))}
      />
    </Sheet>
  );
}

function LotSheet({ item, today, onClose, onSaved }: { item: BalanceItem; today: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState<LotForm>({ day: today, quantity: "", unitCost: item.unitPrice ?? 0, note: "" });
  const { busy, error, errors, send } = useSend();
  const set = (patch: Partial<LotForm>) => setF((x) => ({ ...x, ...patch }));
  return (
    <Sheet open title={`Thêm lô ${item.name}`} onClose={onClose}>
      <Field id="l-day" label="Ngày mua" error={errors.day} first>
        <input id="l-day" class="ctl" type="date" max={today} value={f.day} onInput={(e) => set({ day: e.currentTarget.value || today })} />
      </Field>
      <Field id="l-qty" label={`Số lượng (${item.unit ?? "đơn vị"})`} error={errors.quantity}>
        <input id="l-qty" class="ctl" inputMode="decimal" placeholder="20 hoặc 0,5" value={f.quantity} onInput={(e) => set({ quantity: e.currentTarget.value })} autoFocus />
      </Field>
      <Field id="l-cost" label={`Giá mua một ${item.unit ?? "đơn vị"}`} error={errors.unitCost}>
        <AmountInput id="l-cost" value={f.unitCost} onChange={(n) => set({ unitCost: n })} />
      </Field>
      <Field id="l-note" label="Ghi chú">
        <input id="l-note" class="ctl" maxLength={500} value={f.note} onInput={(e) => set({ note: e.currentTarget.value })} />
      </Field>
      <Hint>Số mua của lô không sửa được; ghi sai thì huỷ lô rồi ghi lại. Bán một phần: huỷ lô rồi ghi lại hai lô.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Thêm lô"
        onSubmit={() => void send(lotPayload(f, today), (b) => api.post(`/v1/balance-items/${encodeURIComponent(item.id)}/lots`, b), () => onSaved(`Đã thêm lô ${f.quantity} ${item.unit ?? ""} ${item.name}.`.replace(/\s+/g, " ")))}
      />
    </Sheet>
  );
}

function SellSheet({ item, lot, today, onClose, onSaved }: { item: BalanceItem; lot: BalanceLot; today: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState({ day: today, price: item.unitPrice ?? lot.unitCost });
  const { busy, error, errors, send } = useSend();
  return (
    <Sheet open title={`Bán lô ${item.name}`} onClose={onClose}>
      <p class="fhint" style={{ paddingTop: "10px" }}>
        {lotTitle(lot, item.unit)}
      </p>
      <Field id="s-day" label="Ngày bán" error={errors.day}>
        <input id="s-day" class="ctl" type="date" min={lot.boughtOn} max={today} value={f.day} onInput={(e) => setF((x) => ({ ...x, day: e.currentTarget.value || today }))} />
      </Field>
      <Field id="s-price" label={`Giá bán một ${item.unit ?? "đơn vị"}`} error={errors.price}>
        <AmountInput id="s-price" value={f.price} onChange={(n) => setF((x) => ({ ...x, price: n }))} autoFocus />
      </Field>
      <Hint>Bán cả lô, ghi một lần. Không có giao dịch nào được ghi — tiền bán về tài khoản ghi ở sổ như mọi khoản khác.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Ghi bán lô"
        onSubmit={() => void send(sellPayload(f, lot, today), (b) => api.post(`/v1/balance-lots/${lot.id}/sell`, b), () => onSaved(`Đã ghi bán lô ${item.name} ngày ${dateText(f.day)}.`))}
      />
    </Sheet>
  );
}

/** Giá chốt lời / cắt lỗ của một lô (một đơn vị): hai ô, để trống = bỏ. */
function LotTargetsSheet({ item, lot, onClose, onSaved }: { item: BalanceItem; lot: BalanceLot; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState({ takeProfit: lot.takeProfitPrice ?? 0, stopLoss: lot.stopLossPrice ?? 0 });
  const { busy, error, errors, send } = useSend();
  return (
    <Sheet open title="Giá chốt lời / cắt lỗ" onClose={onClose}>
      <p class="fhint" style={{ paddingTop: "10px" }}>
        {lotTitle(lot, item.unit)}
      </p>
      <Field id="t-tp" label={`Chốt lời (một ${item.unit ?? "đơn vị"})`}>
        <AmountInput id="t-tp" value={f.takeProfit} onChange={(n) => setF((x) => ({ ...x, takeProfit: n }))} />
      </Field>
      <Field id="t-sl" label={`Cắt lỗ (một ${item.unit ?? "đơn vị"})`} error={errors.stopLoss}>
        <AmountInput id="t-sl" value={f.stopLoss} onChange={(n) => setF((x) => ({ ...x, stopLoss: n }))} />
      </Field>
      <Hint>Để trống là bỏ. Chỉ để nhìn — app không tự bán, không nhắc.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Lưu"
        onSubmit={() => void send(targetsPayload(f), (b) => api.patch(`/v1/balance-lots/${lot.id}`, b), () => onSaved(`Đã lưu giá chốt lời / cắt lỗ của lô ${item.name}.`))}
      />
    </Sheet>
  );
}

/** Mục theo giá trị: giá mua (tổng vốn), ngày mua, giá chốt lời / cắt lỗ theo giá trị cả mục. */
function ItemTargetsSheet({ item, today, onClose, onSaved }: { item: BalanceItem; today: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [f, setF] = useState({ costBasis: item.costBasis ?? 0, acquiredOn: item.acquiredOn ?? "", takeProfit: item.takeProfitValue ?? 0, stopLoss: item.stopLossValue ?? 0 });
  const { busy, error, errors, send } = useSend();
  return (
    <Sheet open title={`Giá mua & mục tiêu · ${item.name}`} onClose={onClose}>
      <Field id="g-cost" label="Giá mua (tổng vốn)" first>
        <AmountInput id="g-cost" value={f.costBasis} onChange={(n) => setF((x) => ({ ...x, costBasis: n }))} autoFocus />
      </Field>
      <Field id="g-day" label="Ngày mua" error={errors.acquiredOn}>
        <input id="g-day" class="ctl" type="date" max={today} value={f.acquiredOn} onInput={(e) => setF((x) => ({ ...x, acquiredOn: e.currentTarget.value }))} />
      </Field>
      <Field id="g-tp" label="Chốt lời (giá trị cả mục)">
        <AmountInput id="g-tp" value={f.takeProfit} onChange={(n) => setF((x) => ({ ...x, takeProfit: n }))} />
      </Field>
      <Field id="g-sl" label="Cắt lỗ (giá trị cả mục)" error={errors.stopLoss}>
        <AmountInput id="g-sl" value={f.stopLoss} onChange={(n) => setF((x) => ({ ...x, stopLoss: n }))} />
      </Field>
      <Hint>Để trống là bỏ. Có ngày mua và giữ từ 1 năm thì hiện CAGR so với lợi suất kỳ vọng.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Lưu"
        onSubmit={() => void send(itemTargetsPayload(f, today), (b) => api.patch(`/v1/balance-items/${encodeURIComponent(item.id)}`, b), () => onSaved(`Đã lưu giá mua & mục tiêu của ${item.name}.`))}
      />
    </Sheet>
  );
}

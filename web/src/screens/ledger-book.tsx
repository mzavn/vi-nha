// Sổ giao dịch (pwa UC-716): xem lại sổ theo tháng, lọc, tìm, đọc tổng theo nghĩa tiền thật; chạm một dòng mở sheet
// chi tiết dùng chung (UC-715) để sửa / xoá / gán lại; "Ghi khoản" mở màn Nhập với ngày trong tháng đang xem.
// Dữ liệu: GET /v1/transactions (50 dòng mỗi lượt, con trỏ before) và GET /v1/transactions/summary cùng bộ lọc (ledger UC-111).

import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, request } from "../lib/api";
import { formatVnd, groupDigits } from "../lib/money";
import { monthLabel, timeHM } from "../lib/period";
import { MEANING_LABEL, txLabel, txSign } from "../lib/transactions";
import {
  BOOK_MEANINGS,
  BOOK_PAGE,
  bookPath,
  clearFilters,
  defaultFilter,
  entryDay,
  filterChips,
  groupByDay,
  removeChip,
  searchText,
  stepMonth,
  summaryParts,
  summaryPath,
  toggleMeaning,
  type BookFilter,
} from "../lib/tx-filter";
import type { Bootstrap, TxRow, TxSummary } from "../lib/types";
import { useResource, type Resource } from "../state/resource";
import { getState, go, openTx, setState, useApp } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, PageHeader, Seg, Sheet, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";

export function LedgerBook() {
  const app = useApp();
  const wide = useWide();
  const now = new Date();
  const filter = app.book ?? defaultFilter(now);
  const setFilter = (f: BookFilter) => setState({ book: f });
  const [query, setQuery] = useState(filter.q);
  const [filtering, setFiltering] = useState(false);

  // Gõ xong 0,3 giây mới tìm: không hỏi server theo từng chữ.
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = getState().book ?? defaultFilter(new Date());
      if (cur.q !== query) setState({ book: { ...cur, q: query } });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const list = useBookRows(filter, app.version);
  const sum = useResource<TxSummary>(summaryPath(filter));
  const chips = filterChips(filter, app.boot);
  const prevMonth = stepMonth(filter.month, -1, now);
  const nextMonth = stepMonth(filter.month, 1, now);
  const shortQuery = query.trim().length === 1;

  const add = () => go("entry", { entryPreset: { day: entryDay(filter.month, now), back: "ledger" } });

  return (
    <>
      <PageHeader
        title="Sổ giao dịch"
        sub={filter.month ? monthLabel(filter.month) : "Cả sổ, mọi tháng"}
        action={
          <button type="button" class="btn btn-primary" onClick={add}>
            <Icon name="plus" size={16} />
            Ghi khoản
          </button>
        }
      />

      <div class="book-bar">
        <div class="book-month" role="group" aria-label="Tháng">
          <button type="button" class="btn book-step" aria-label="Tháng trước" disabled={!prevMonth} onClick={() => prevMonth && setFilter({ ...filter, month: prevMonth })}>
            <Icon name="chevron-left" size={18} />
          </button>
          <span class="book-month-t" aria-live="polite">
            {filter.month ? monthLabel(filter.month) : "Mọi tháng"}
          </span>
          <button type="button" class="btn book-step" aria-label="Tháng sau" disabled={!nextMonth} onClick={() => nextMonth && setFilter({ ...filter, month: nextMonth })}>
            <Icon name="chevron-right" size={18} />
          </button>
          <button
            type="button"
            class="btn book-all"
            aria-pressed={filter.month === null}
            onClick={() => setFilter({ ...filter, month: filter.month === null ? defaultFilter(now).month : null })}
          >
            {filter.month === null ? "Theo tháng" : "Mọi tháng"}
          </button>
        </div>
        <div class="book-find">
          <label class="book-q">
            <Icon name="search" size={16} />
            <span class="sr-only">Tìm trong sổ</span>
            <input
              type="search"
              class="ctl full"
              placeholder="Tìm ghi chú, nội dung, tên"
              enterKeyHint="search"
              maxLength={100}
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <button type="button" class="btn" onClick={() => setFiltering(true)} aria-haspopup="dialog">
            <Icon name="filter" size={16} />
            Lọc{chips.length ? ` (${chips.length})` : ""}
          </button>
        </div>
        {shortQuery && <p class="hint book-hint">Gõ ít nhất 2 chữ để tìm.</p>}
        {chips.length > 0 && (
          <div class="seg book-chips" role="group" aria-label="Bộ lọc đang bật">
            {chips.map((c) => (
              <button type="button" key={`${c.key}:${c.value ?? ""}`} aria-pressed="true" aria-label={`Bỏ lọc ${c.label}`} onClick={() => setFilter(removeChip(filter, c))}>
                {c.label}
                <Icon name="x" size={14} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Summary res={sum} />

      <Card flush class="book-list">
        <BookList
          list={list}
          boot={app.boot}
          wide={wide}
          filtered={chips.length > 0 || searchText(filter.q) !== null}
          onClear={() => {
            setQuery("");
            setFilter({ ...clearFilters(filter), q: "" });
          }}
        />
      </Card>

      {filtering && <FilterSheet filter={filter} boot={app.boot} onChange={setFilter} onClose={() => setFiltering(false)} />}
    </>
  );
}

interface BookRows {
  rows: TxRow[];
  more: boolean;
  loading: boolean;
  error: ApiError | null;
  loadMore: () => void;
  reload: () => void;
}

/**
 * Danh sách theo bộ lọc, tải thêm từng 50 dòng theo con trỏ `before`. Đổi bộ lọc → đọc lại từ đầu. Sổ vừa đổi (ghi / sửa /
 * xoá ở bất cứ đâu, `version` tăng) → đọc lại đúng số dòng đang hiện (tối đa 199) để danh sách và vị trí cuộn giữ nguyên.
 */
function useBookRows(filter: BookFilter, version: number): BookRows {
  const key = bookPath(filter);
  const [st, setSt] = useState<{ rows: TxRow[]; more: boolean; loading: boolean; error: ApiError | null }>({ rows: [], more: false, loading: true, error: null });
  const seq = useRef(0);
  const shown = useRef(0);
  shown.current = st.rows.length;

  function load(before: number | undefined, size: number, append: boolean) {
    const mine = ++seq.current;
    setSt((s) => ({ ...s, loading: true, error: null }));
    request<TxRow[]>(bookPath(filter, before, size))
      .then(({ data }) => {
        if (mine !== seq.current) return;
        const page = data.slice(0, size);
        setSt((s) => ({ rows: append ? [...s.rows, ...page] : page, more: data.length > size, loading: false, error: null }));
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setSt((s) => ({ ...s, loading: false, error: err instanceof ApiError ? err : new ApiError(0, "offline", "Không có mạng.") }));
      });
  }

  useEffect(() => {
    setSt({ rows: [], more: false, loading: true, error: null });
    load(undefined, BOOK_PAGE, false);
  }, [key]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load(undefined, Math.min(Math.max(shown.current, BOOK_PAGE), 199), false);
  }, [version]);

  return {
    ...st,
    loadMore: () => {
      const last = st.rows[st.rows.length - 1];
      if (last && st.more && !st.loading) load(last.id, BOOK_PAGE, true);
    },
    reload: () => load(undefined, Math.min(Math.max(shown.current, BOOK_PAGE), 199), false),
  };
}

/** Dòng tổng theo bộ lọc: Chi (đã trừ hoàn tiền), Thu, rồi các loại khác có số; chuyển nội bộ không cộng vào thu chi. */
function Summary({ res }: { res: Resource<TxSummary> }) {
  const s = res.data;
  if (!s) return res.loading ? <Skeleton rows={1} /> : null;
  const parts = summaryParts(s);
  const notes = [`${groupDigits(s.count)} giao dịch`];
  if (s.refund > 0) notes.push(`chi đã trừ ${formatVnd(s.refund)} hoàn tiền`);
  if (s.transfer > 0) notes.push("chuyển nội bộ không tính vào thu chi");
  // Mất mạng: service worker trả bản lưu gần nhất của đúng bộ lọc này — nói rõ là số lúc nào.
  if (res.cachedAt) notes.push(`số lúc ${timeHM(res.cachedAt)}`);
  return (
    <section class="card book-sum" aria-label="Tổng theo bộ lọc">
      <dl class="book-sum-grid">
        {parts.map((p) => (
          <div key={p.label}>
            <dt>{p.label}</dt>
            <dd>
              <Money value={p.amount} tone={false} />
            </dd>
          </div>
        ))}
      </dl>
      <div class="note">{notes.join(" · ")}</div>
    </section>
  );
}

function BookList({ list, boot, wide, filtered, onClear }: { list: BookRows; boot: Bootstrap | null; wide: boolean; filtered: boolean; onClear: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  // Ngày đang thu gọn (bấm tiêu đề ngày để thu / mở); giữ khi tải thêm hay sổ đọc lại, mất khi rời màn.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (day: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (!next.delete(day)) next.add(day);
      return next;
    });
  // Cuộn gần cuối thì tự tải thêm; nút "Tải thêm" vẫn có cho bàn phím và khi trình duyệt không có IntersectionObserver.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && list.loadMore(), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });

  if (list.rows.length === 0) {
    if (list.loading) return <Skeleton rows={6} />;
    if (list.error) {
      return (
        <Empty title={list.error.offline ? "Không có mạng. Sổ giao dịch cần mạng." : list.error.message}>
          <div style={{ marginTop: "10px" }}>
            <button type="button" class="btn" onClick={list.reload}>
              Tải lại
            </button>
          </div>
        </Empty>
      );
    }
    return (
      <Empty title={filtered ? "Không có giao dịch nào khớp bộ lọc." : "Không có giao dịch nào trong thời gian này."}>
        {filtered && (
          <div style={{ marginTop: "10px" }}>
            <button type="button" class="btn" onClick={onClear}>
              Bỏ lọc và tìm
            </button>
          </div>
        )}
      </Empty>
    );
  }

  const groups = groupByDay(list.rows);
  return (
    <>
      <table class={wide ? "data dk-table book-table" : "data book-table"}>
        {wide && (
          <thead>
            <tr>
              <th scope="col">Giờ</th>
              <th scope="col">Số tiền ₫</th>
              <th scope="col" class="l">
                Khoản
              </th>
              <th scope="col" class="l">
                Danh mục / Ví
              </th>
              <th scope="col" class="l">
                Tài khoản
              </th>
              <th scope="col" class="l">
                Người
              </th>
            </tr>
          </thead>
        )}
        {groups.map((g) => {
          const open = !closed.has(g.day);
          return (
            <tbody key={g.day}>
              <tr class="group">
                <th scope="rowgroup" colSpan={wide ? 6 : 2}>
                  <button type="button" class="day-toggle" aria-expanded={open} onClick={() => toggle(g.day)}>
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={18} />
                    <span class="day-head">{g.heading}</span>
                    <span class="day-count">{open ? "" : `${g.rows.length} khoản`}</span>
                  </button>
                </th>
              </tr>
              {open && g.rows.map((r) => (wide ? <WideRow key={r.id} r={r} boot={boot} /> : <PhoneRow key={r.id} r={r} boot={boot} />))}
            </tbody>
          );
        })}
      </table>
      <div class="book-more" ref={sentinel}>
        {list.error ? (
          <>
            <span class="hint">{list.error.offline ? "Không có mạng." : list.error.message}</span>
            <button type="button" class="btn" onClick={list.more ? list.loadMore : list.reload}>
              Thử lại
            </button>
          </>
        ) : list.more ? (
          <button type="button" class="btn" disabled={list.loading} onClick={list.loadMore}>
            {list.loading ? "Đang tải…" : `Tải thêm ${BOOK_PAGE} khoản`}
          </button>
        ) : (
          <span class="hint">Đã hết các khoản khớp bộ lọc.</span>
        )}
      </div>
    </>
  );
}

const who = (r: TxRow, boot: Bootstrap | null) => (boot && boot.members.length > 1 ? boot.members.find((m) => m.id === r.by_member_id)?.name : undefined);

/** Tài khoản của dòng: tiền ra → tiền vào khi có cả hai (chuyển nội bộ), không thì bên nào có. */
function accountText(r: TxRow, boot: Bootstrap | null): string {
  const name = (id: string | null) => (id ? (boot?.accounts.find((a) => a.id === id)?.name ?? id) : null);
  return [name(r.account_id), name(r.counter_account_id)].filter(Boolean).join(" → ");
}

function Amount({ r }: { r: TxRow }) {
  const sign = txSign(r);
  return (
    <td class={`num${sign === "+" ? " dk-in" : ""}${r.status !== "active" ? " dk-void" : ""}`}>
      {sign}
      {groupDigits(r.amount)}
    </td>
  );
}

const Voided = ({ r }: { r: TxRow }) =>
  r.status !== "active" ? (
    <>
      {" "}
      <span class="chip">đã xoá</span>
    </>
  ) : null;

/** Điện thoại: hai cột — khoản (giờ · ghi chú · ví · tài khoản · người ở dòng phụ) và số tiền. Cả hàng chạm được. */
function PhoneRow({ r, boot }: { r: TxRow; boot: Bootstrap | null }) {
  const sub = [timeHM(r.at), r.note, r.wallet_name, accountText(r, boot), who(r, boot)].filter(Boolean).join(" · ");
  return (
    <tr class="tx-row" onClick={() => openTx(r.id, r)}>
      <td class="l">
        <button type="button" class="tx-open" aria-label={`Xem ${txLabel(r)} ${formatVnd(r.amount)}`}>
          {txLabel(r)}
        </button>
        <Voided r={r} />
        <div class="sub-line">{sub}</div>
      </td>
      <Amount r={r} />
    </tr>
  );
}

/** Máy tính: Giờ · Số tiền (đứng đầu cho dễ nhìn) · Khoản (loại, ghi chú) · Danh mục / Ví · Tài khoản · Người. */
function WideRow({ r, boot }: { r: TxRow; boot: Bootstrap | null }) {
  const kind = r.category_name ? (MEANING_LABEL[r.meaning] ?? r.meaning) : txLabel(r);
  return (
    <tr class="tx-row" onClick={() => openTx(r.id, r)}>
      <td class="dk-when">{timeHM(r.at)}</td>
      <Amount r={r} />
      <td class="l">
        <button type="button" class="tx-open" aria-label={`Xem ${txLabel(r)} ${formatVnd(r.amount)}`}>
          {kind}
        </button>
        <Voided r={r} />
        {r.note && <div class="sub-line">{r.note}</div>}
      </td>
      <td class="l">
        {r.category_name ?? ""}
        {r.wallet_name && <div class="sub-line">{r.wallet_name}</div>}
      </td>
      <td class="l">{accountText(r, boot)}</td>
      <td class="l">{who(r, boot) ?? ""}</td>
    </tr>
  );
}

/** Sheet Lọc: đổi đâu áp ngay (danh sách và tổng tải lại phía sau); "Xong" đóng sheet. */
function FilterSheet({ filter, boot, onChange, onClose }: { filter: BookFilter; boot: Bootstrap | null; onChange: (f: BookFilter) => void; onClose: () => void }) {
  const pick = (id: string, label: string, value: string | null, options: { id: string; name: string }[], set: (v: string | null) => void) => (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} class="ctl" value={value ?? ""} onChange={(e) => set(e.currentTarget.value || null)}>
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <Sheet open title="Lọc sổ giao dịch" onClose={onClose}>
      <div class="pad">
        <div class="book-sheet-k" id="f-book-types">
          Loại
        </div>
        <div class="seg" role="group" aria-labelledby="f-book-types">
          {BOOK_MEANINGS.map((m) => (
            <button type="button" key={m.value} aria-pressed={filter.meanings.includes(m.value)} onClick={() => onChange(toggleMeaning(filter, m.value))}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {pick("f-book-cat", "Danh mục", filter.categoryId, boot?.categories ?? [], (v) => onChange({ ...filter, categoryId: v }))}
      {pick("f-book-wallet", "Ví", filter.walletId, boot?.wallets ?? [], (v) => onChange({ ...filter, walletId: v }))}
      {pick("f-book-acct", "Tài khoản", filter.accountId, boot?.accounts ?? [], (v) => onChange({ ...filter, accountId: v }))}
      {(boot?.members.length ?? 0) > 1 && pick("f-book-member", "Người ghi", filter.memberId, boot?.members ?? [], (v) => onChange({ ...filter, memberId: v }))}
      <div class="field">
        <span class="k">Nguồn</span>
        <Seg
          label="Nguồn"
          value={filter.source ?? "all"}
          onChange={(v) => onChange({ ...filter, source: v === "all" ? null : v })}
          options={[
            { value: "all", label: "Tất cả" },
            { value: "manual", label: "Ghi tay" },
            { value: "bank", label: "Ngân hàng" },
          ]}
        />
      </div>
      <div class="field">
        <label class="check" for="f-book-void">
          <input id="f-book-void" type="checkbox" checked={filter.showVoid} onChange={(e) => onChange({ ...filter, showVoid: e.currentTarget.checked })} />
          Hiện khoản đã xoá
        </label>
      </div>
      <div class="note">Khoản đã xoá vẫn nằm trong sổ để xem lại, không tính vào tổng nào.</div>
      <div class="pad book-sheet-act">
        <button type="button" class="btn" onClick={() => onChange(clearFilters(filter))}>
          Bỏ hết bộ lọc
        </button>
        <button type="button" class="btn btn-primary" onClick={onClose}>
          Xong
        </button>
      </div>
    </Sheet>
  );
}

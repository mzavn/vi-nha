// Cài đặt (#settings): mở từ nút bánh răng ở Hôm nay, không phải tab thứ năm.
// Mười một phần, mỗi phần một card (Thông báo có hai: giờ nhắc của cả nhà và thông báo trên máy này);
// mọi chỗ sửa nằm trong sheet (DESIGN.md §4: sheet là nơi mọi edge case được giải).
// Thứ tự theo mức hay sửa của nhà (audit 261001 F05): ví & số nạp trước, khoá kết nối, Claude, tham số và nhật ký thay đổi gom vào "Nâng cao".
// Điện thoại: các card xếp dọc, hàng chip dính dưới thanh tiêu đề để nhảy tới phần cần sửa; "Nâng cao" gập sẵn;
// cuối trang là "Máy này" (giao diện sáng/tối, đăng xuất).
// Máy tính (≥1024px): hai cột — danh sách phần bên trái, nội dung phần đang chọn bên phải; tài khoản, ví, mã là bảng.
// Cần mạng: offline thì hiện bản tải gần nhất, chỉ xem.

import { Fragment, type ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, ApiError, errorText } from "../lib/api";
import { connectionRows } from "../lib/ai-connections";
import { canAddMember, passwordLine } from "../lib/members";
import { formatVnd } from "../lib/money";
import { dayKey, previousDay, shortDate } from "../lib/period";
import { ACCOUNT_KIND_LABEL, allocationSummary, auditView, bankName, formatPercent, groupWallets, MATCH_LABEL, MEANING_LABEL, scheduleRows, secretLabel, sepayLabel, streamSummary, syncRangeError } from "../lib/settings";
import { deviceLabel, isIos, lastOkText, seriesView, sqliteUtcToIso, type PushState } from "../lib/push";
import { balanceText } from "../lib/rental";
import type {
  Allocation,
  AuditEntry,
  IncomeStream,
  McpSettings,
  PushInfo,
  Rental,
  Rule,
  Secret,
  SecretKey,
  SendTestResult,
  SepayConnection,
  SepaySecretKey,
  SepaySyncResult,
  SepayTestResult,
  SettingsAccount,
  SettingsData,
  SettingsMember,
  SettingsWallet,
  Tenant,
  TenantFee,
  ZaloWebhookResult,
} from "../lib/types";
import { useResource } from "../state/resource";
import { cacheKey, go, loadCached, refresh, setState, toast, useApp } from "../state/store";
import { boundSubscriptionId, cancelTestSeries, enablePush, loadPushInfo, onPushChange, readPushState, sendTestPush, startTestSeries, unbindPush } from "../state/push";
import { copyText } from "../ui/clipboard";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, PageHeader, Seg, Skeleton } from "../ui/parts";
import { signOutEverywhereNote, useLogout, useTheme, useWide } from "../ui/shell";
import {
  AccountSheet,
  ConfigSheet,
  FeeSheet,
  MemberNewSheet,
  MemberPasswordSheet,
  MemberSheet,
  NotifyScheduleSheet,
  RentalConfigSheet,
  RuleSheet,
  SecretSheet,
  SepayConnectionSheet,
  StreamSheet,
  TenantSheet,
  WalletSheet,
} from "./settings-sheets";

const SECTIONS = [
  { id: "wallets-allocation", label: "Ví & số tiền nạp", advanced: false },
  { id: "accounts", label: "Tài khoản", advanced: false },
  { id: "rental", label: "Cho thuê", advanced: false },
  { id: "income-streams", label: "Nguồn thu", advanced: false },
  { id: "transfer-codes", label: "Mã chuyển khoản", advanced: false },
  { id: "notifications", label: "Thông báo", advanced: false },
  { id: "members", label: "Thành viên", advanced: false },
  // Làm một lần khi dựng nhà, gần như không đụng lại.
  { id: "connections", label: "Kết nối", advanced: true },
  // Địa chỉ MCP và các kết nối OAuth của từng người: gỡ khi thấy ứng dụng lạ.
  { id: "ai-connections", label: "Claude và ứng dụng AI", advanced: true },
  { id: "parameters", label: "Tham số", advanced: true },
  // Ai đổi gì, lúc nào (ADR-90): xem khi nghi có người lạ đụng vào.
  { id: "audit-log", label: "Nhật ký thay đổi", advanced: true },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const MAIN = SECTIONS.filter((x) => !x.advanced);
const ADVANCED = SECTIONS.filter((x) => x.advanced);
/** Khoá chưa có trong bản cài đặt lưu offline cũ (trước khi có Zalo) coi như chưa đặt. */
const NO_SECRET: Secret = { set: false, hint: null };

export type Edit =
  | { kind: "account"; item: SettingsAccount | null }
  | { kind: "wallet"; item: SettingsWallet | null }
  | { kind: "rule"; item: Rule | null }
  | { kind: "member"; item: SettingsMember }
  | { kind: "member-new" }
  | { kind: "member-password"; item: SettingsMember }
  | { kind: "secret"; key: SecretKey }
  | { kind: "sepay"; item: SepayConnection | null }
  | { kind: "sepay-secret"; connection: SepayConnection; key: SepaySecretKey }
  | { kind: "config" }
  | { kind: "notify" }
  | { kind: "stream"; item: IncomeStream | null }
  | { kind: "tenant"; item: Tenant | null }
  | { kind: "fee"; tenant: Tenant; item: TenantFee | null }
  | { kind: "rental-config"; rental: Rental };

interface SectionProps {
  d: SettingsData;
  /** Chỉ xem: offline hoặc đang hiện bản cũ. */
  ro: boolean;
  wide: boolean;
  open: (e: Edit) => void;
}

/** Tải /v1/settings; lưu bản gần nhất theo người dùng để offline vẫn xem được. */
function useSettings() {
  const { member, online } = useApp();
  const [st, setSt] = useState<{ data: SettingsData | null; stale: boolean; error: string | null; loading: boolean }>({ data: null, stale: false, error: null, loading: true });
  const load = useCallback(async () => {
    if (!member) return;
    setSt((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await loadCached<SettingsData>(cacheKey(member.id, "settings"), "/v1/settings");
      setSt({ data: r.data, stale: r.stale, error: null, loading: false });
    } catch (err) {
      setSt((s) => ({ ...s, error: errorText(err), loading: false }));
    }
  }, [member?.id]);
  useEffect(() => void load(), [load, online]);
  return { ...st, reload: load };
}

export function Settings() {
  const { online, settingsFocus, member } = useApp();
  const s = useSettings();
  const wide = useWide();
  const [section, setSection] = useState<SectionId>(settingsFocus ?? "wallets-allocation");
  const [advanced, setAdvanced] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const ro = !online || s.stale;
  // Mở thẳng một phần (vd "Đổi tài khoản" ở Hôm nay): màn rộng chọn sẵn phần đó; điện thoại cuộn tới khi cài đặt đã có.
  const loaded = Boolean(s.data);
  useEffect(() => {
    if (!settingsFocus || !loaded) return;
    if (!wide) document.getElementById(settingsFocus)?.scrollIntoView({ block: "start" });
    setState({ settingsFocus: null });
  }, [settingsFocus, loaded]);

  /** Sau mỗi lần lưu: báo kết quả, tải lại cài đặt và số của cả app để các màn khác thấy thay đổi. */
  const saved = async (text: string) => {
    toast(text);
    await Promise.all([s.reload(), refresh()]);
  };

  const header = (
    <PageHeader
      title="Cài đặt"
      sub="Ví, tài khoản, cho thuê, thông báo"
      action={
        <button type="button" class="btn" onClick={() => go("today")}>
          Xong
        </button>
      }
    />
  );

  if (!s.data) {
    return (
      <>
        {header}
        {s.error ? (
          <div class="banner b-bad" role="alert">
            <span class="ic" aria-hidden="true">
              !
            </span>
            <div class="txt">
              <strong>Chưa tải được cài đặt.</strong> {s.error} {!online && "Cài đặt cần mạng."}
            </div>
            <button type="button" class="link act" onClick={() => void s.reload()}>
              Thử lại
            </button>
          </div>
        ) : (
          <Card>
            <Skeleton rows={5} />
          </Card>
        )}
      </>
    );
  }

  const props: SectionProps = { d: s.data, ro, wide, open: setEdit };
  const render = (id: SectionId) =>
    ({
      "connections": (
        <>
          <Connections {...props} />
          <SepaySync {...props} />
        </>
      ),
      "ai-connections": <AiConnections ro={ro} />,
      "notifications": (
        <>
          <NotifyScheduleCard {...props} />
          <PushNotifications />
        </>
      ),
      "accounts": <Accounts {...props} />,
      "wallets-allocation": <Wallets {...props} />,
      "transfer-codes": <Rules {...props} />,
      "income-streams": <Streams {...props} />,
      "rental": <RentalSettings {...props} />,
      "members": <Members {...props} />,
      "parameters": <Params {...props} />,
      "audit-log": <AuditLog />,
    })[id];

  return (
    <>
      {header}
      {ro && (
        <div class="status-row" role="status">
          <Icon name="cloud-off" size={16} />
          <span style={{ flex: 1, minWidth: 0 }}>Cài đặt cần mạng. Đang hiện bản tải gần nhất, chỉ xem được.</span>
        </div>
      )}
      {wide ? (
        <div class="set-layout">
          <nav class="card set-nav" aria-label="Các phần cài đặt">
            {SECTIONS.map((x, i) => (
              <Fragment key={x.id}>
                {x.advanced && !SECTIONS[i - 1]?.advanced && <div class="set-nav-h">Nâng cao</div>}
                <button type="button" aria-current={section === x.id ? "true" : undefined} onClick={() => setSection(x.id)}>
                  {x.label}
                </button>
              </Fragment>
            ))}
          </nav>
          <div class="min-w-0">{render(section)}</div>
        </div>
      ) : (
        <>
          <JumpBar
            onAdvanced={() => {
              setAdvanced(true);
              requestAnimationFrame(() => document.getElementById("advanced")?.scrollIntoView({ block: "start" }));
            }}
          />
          {MAIN.map((x) => (
            <div key={x.id}>{render(x.id)}</div>
          ))}
          <section class="card" id="advanced">
            <button type="button" class="srow" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
              <span class="srow-main">
                <span class="srow-t">Nâng cao</span>
                <span class="srow-s">{ADVANCED.map((x) => x.label).join(" · ")}: khoá SePay, Telegram, Zalo, nối Claude, ngưỡng tự chia, Quỹ an tâm, ai đổi gì lúc nào</span>
              </span>
              <span class="srow-r">
                <Icon name={advanced ? "chevron-up" : "chevron-down"} size={16} />
              </span>
            </button>
          </section>
          {advanced &&
            ADVANCED.map((x) => (
              <div key={x.id}>{render(x.id)}</div>
            ))}
          <DeviceCard />
        </>
      )}

      {edit?.kind === "account" && <AccountSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "wallet" && <WalletSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "rule" && <RuleSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "member" && (
        <MemberSheet
          item={edit.item}
          self={edit.item.id === member?.id}
          zaloReady={Boolean(s.data.integrations.zalo_bot_token?.set && s.data.integrations.zalo_webhook_secret?.set)}
          onPassword={() => setEdit({ kind: "member-password", item: edit.item })}
          onClose={() => setEdit(null)}
          onSaved={saved}
        />
      )}
      {edit?.kind === "member-new" && <MemberNewSheet members={s.data.members} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "member-password" && <MemberPasswordSheet item={edit.item} self={edit.item.id === member?.id} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "secret" && <SecretSheet secretKey={edit.key} secret={s.data.integrations[edit.key] ?? NO_SECRET} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "sepay" && <SepayConnectionSheet item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "sepay-secret" && (
        <SecretSheet secretKey={edit.key} secret={edit.connection[edit.key]} connection={edit.connection} onClose={() => setEdit(null)} onSaved={saved} />
      )}
      {edit?.kind === "config" && <ConfigSheet config={s.data.config} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "notify" && s.data.notifySchedule && <NotifyScheduleSheet schedule={s.data.notifySchedule} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "stream" && <StreamSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "tenant" && <TenantSheet item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "fee" && <FeeSheet tenant={edit.tenant} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "rental-config" && <RentalConfigSheet d={s.data} rental={edit.rental} onClose={() => setEdit(null)} onSaved={saved} />}
    </>
  );
}

/**
 * Hàng nhảy tới phần (điện thoại): dính dưới thanh tiêu đề, chip của phần đang xem được tô và cuộn vào tầm nhìn.
 * "Nâng cao" mở phần gập rồi mới nhảy tới.
 */
function JumpBar({ onAdvanced }: { onAdvanced: () => void }) {
  const bar = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState<string>("wallets-allocation");
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Phần vừa nhảy tới dừng ngay dưới hàng chip (lệch lẻ vài px): chừa 16px để chip của nó được tô.
        const line = (bar.current?.getBoundingClientRect().bottom ?? 0) + 16;
        const ids = [...MAIN.map((x) => x.id), "advanced"];
        const seen = ids.filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line);
        setCurrent(seen[seen.length - 1] ?? ids[0]!);
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", on);
    };
  }, []);
  useEffect(() => {
    const nav = bar.current;
    const chip = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (nav && chip) nav.scrollTo({ left: chip.offsetLeft - 12, behavior: "smooth" });
  }, [current]);
  return (
    <nav ref={bar} class="tabs sticky" aria-label="Nhảy tới phần">
      {MAIN.map((x) => (
        <button type="button" key={x.id} aria-current={current === x.id ? "true" : undefined} onClick={() => document.getElementById(x.id)?.scrollIntoView({ block: "start" })}>
          {x.label}
        </button>
      ))}
      <button type="button" aria-current={current === "advanced" ? "true" : undefined} onClick={onAdvanced}>
        Nâng cao
      </button>
    </nav>
  );
}

/** Máy này (điện thoại): giao diện sáng/tối, đăng xuất, đăng xuất mọi máy — trước nằm cuối Hôm nay. Máy tính đã có ở thanh bên. */
function DeviceCard() {
  const { member } = useApp();
  const [theme, changeTheme] = useTheme();
  const { confirmOut, unsynced, onLogout } = useLogout();
  const all = useLogout(true);
  return (
    <Card id="this-device" title="Máy này" flush>
      <div class="field" style={{ borderTop: 0, flexWrap: "wrap" }}>
        <span class="k">Giao diện</span>
        <Seg
          label="Giao diện"
          value={theme}
          onChange={changeTheme}
          options={[
            { value: "auto", label: "Theo máy" },
            { value: "light", label: "Sáng" },
            { value: "dark", label: "Tối" },
          ]}
        />
      </div>
      <div class="field">
        <span class="k">Hướng dẫn</span>
        <button type="button" class="btn" onClick={() => go("guide")}>
          Mở hướng dẫn
        </button>
      </div>
      <div class="field">
        <span class="k">Đang dùng: {member?.name}</span>
        <button type="button" class="btn" onClick={onLogout}>
          {confirmOut ? "Vẫn đăng xuất" : "Đăng xuất"}
        </button>
      </div>
      {confirmOut && (
        <div class="note" role="alert">
          Còn {unsynced} khoản của {member?.name} chưa lên sổ. Chúng nằm lại trên máy này và chỉ gửi khi {member?.name} đăng nhập lại.
        </div>
      )}
      <div class="field">
        <span class="k">Mất máy, lộ mật khẩu?</span>
        <button type="button" class="btn" onClick={all.onLogout}>
          {all.confirmOut ? "Vẫn đăng xuất mọi máy" : "Đăng xuất mọi máy"}
        </button>
      </div>
      {all.confirmOut && (
        <div class="note" role="alert">
          {signOutEverywhereNote(member?.name, all.unsynced)}
        </div>
      )}
    </Card>
  );
}

// ── Hàng dùng chung ──────────────────────────────────────────────

/** Hàng danh sách: bấm được thì là nút mở sheet, chỉ xem thì là div. */
function Row(props: { title: ComponentChildren; sub?: ComponentChildren; sub2?: ComponentChildren; right?: ComponentChildren; onClick?: () => void }) {
  const inner = (
    <>
      <span class="srow-main">
        <span class="srow-t">{props.title}</span>
        {props.sub && <span class="srow-s">{props.sub}</span>}
        {props.sub2 && <span class="srow-s2">{props.sub2}</span>}
      </span>
      <span class="srow-r">
        {props.right}
        {props.onClick && <Icon name="chevron-right" size={16} />}
      </span>
    </>
  );
  return props.onClick ? (
    <button type="button" class="srow" onClick={props.onClick}>
      {inner}
    </button>
  ) : (
    <div class="srow">{inner}</div>
  );
}

function AddButton({ ro, label, onClick }: { ro: boolean; label: string; onClick: () => void }) {
  if (ro) return null;
  return (
    <button type="button" class="btn btn-ghost" style={{ marginRight: "-8px" }} onClick={onClick}>
      <Icon name="plus" size={16} />
      {label}
    </button>
  );
}

function EditCell({ ro, label, onClick }: { ro: boolean; label: string; onClick: () => void }) {
  if (ro) return <td />;
  return (
    <td>
      <button type="button" class="btn btn-ghost set-edit" aria-label={label} onClick={onClick}>
        Sửa
      </button>
    </td>
  );
}

const nameOf = (list: { id: string; name: string }[], id: string | null | undefined) => (id ? (list.find((x) => x.id === id)?.name ?? id) : null);

// ── 1. Kết nối ───────────────────────────────────────────────────

function Connections({ d, ro, open }: SectionProps) {
  const { integrations: it } = d;
  const connections = it.sepay_connections ?? [];
  const [tests, setTests] = useState<Record<string, { busy: boolean; result: SepayTestResult | null; error: string | null }>>({});
  const [tg, setTg] = useState<Record<string, { busy: boolean; text: string; bad: boolean }>>({});
  const [zaloHook, setZaloHook] = useState<{ busy: boolean; text: string; bad: boolean } | null>(null);
  const zaloSet = Boolean(it.zalo_bot_token?.set && it.zalo_webhook_secret?.set);

  async function copy() {
    try {
      await navigator.clipboard.writeText(it.webhook_url);
      toast("Đã chép địa chỉ webhook. Dán vào mục Webhook của SePay.");
    } catch {
      toast("Không chép được. Chạm giữ vào địa chỉ để chép tay.");
    }
  }

  async function testSepay(c: SepayConnection) {
    setTests((s) => ({ ...s, [c.id]: { busy: true, result: null, error: null } }));
    try {
      const result = await api.post<SepayTestResult>(`/v1/settings/sepay/connections/${encodeURIComponent(c.id)}/test`);
      setTests((s) => ({ ...s, [c.id]: { busy: false, result, error: null } }));
    } catch (err) {
      setTests((s) => ({ ...s, [c.id]: { busy: false, result: null, error: errorText(err) } }));
    }
  }

  async function testTelegram(m: SettingsMember) {
    setTg((s) => ({ ...s, [m.id]: { busy: true, text: "", bad: false } }));
    try {
      const r = await api.post<SendTestResult>("/v1/settings/test/telegram", { member_id: m.id });
      setTg((s) => ({ ...s, [m.id]: { busy: false, text: r.sent ? `Đã gửi tin thử cho ${m.name}. Xem Telegram.` : `Chưa gửi được: ${r.error ?? "Telegram không nhận."}`, bad: !r.sent } }));
    } catch (err) {
      setTg((s) => ({ ...s, [m.id]: { busy: false, text: errorText(err), bad: true } }));
    }
  }

  async function setZaloWebhook() {
    setZaloHook({ busy: true, text: "", bad: false });
    try {
      const r = await api.post<ZaloWebhookResult>("/v1/settings/zalo/webhook");
      const text = !r.ok
        ? `Chưa đặt được: ${r.error ?? "Zalo không nhận."}`
        : r.verified === false
          ? (r.error ?? "Zalo đã lưu địa chỉ nhưng gọi thử chưa được.")
          : "Đã đặt webhook. Giờ nối Zalo cho từng người ở phần Thành viên.";
      setZaloHook({ busy: false, text, bad: !r.ok || r.verified === false });
    } catch (err) {
      setZaloHook({ busy: false, text: errorText(err), bad: true });
    }
  }

  const secret = (key: SecretKey, label: string, sub: string) => (
    <Row title={label} sub={sub} right={<span class="srow-v">{secretLabel(it[key] ?? NO_SECRET)}</span>} onClick={ro ? undefined : () => open({ kind: "secret", key })} />
  );

  const sepaySecret = (c: SepayConnection, key: SepaySecretKey, label: string, sub: string) => (
    <Row
      title={label}
      sub={sub}
      right={
        <span class="srow-v">
          {secretLabel(c[key])}
          {c[key].source === "server" && <span class="sub-line">đặt ở máy chủ</span>}
        </span>
      }
      onClick={ro ? undefined : () => open({ kind: "sepay-secret", connection: c, key })}
    />
  );

  return (
    <Card id="connections" title="Kết nối" flush note="Khoá và token chỉ ghi: đã lưu thì app chỉ hiện 2 ký tự cuối, không bao giờ hiện lại cả khoá.">
      <div class="set-sub">SePay</div>
      <div class="srow srow-stack">
        <span class="srow-t">Địa chỉ webhook</span>
        <span class="srow-s">Mọi tài khoản SePay dán cùng địa chỉ này vào mục Webhook, mỗi tài khoản kèm khoá webhook riêng của nó.</span>
        <span class="copyrow">
          <code class="num">{it.webhook_url}</code>
          <button type="button" class="btn" onClick={() => void copy()} aria-label="Chép địa chỉ webhook">
            <Icon name="copy" size={16} />
            Chép
          </button>
        </span>
      </div>
      {connections.map((c) => {
        const t = tests[c.id];
        const names = c.accounts.map((id) => nameOf(d.accounts, id));
        return (
          <Fragment key={c.id}>
            <div class="set-sub">
              {c.name} {!c.active && <span class="chip">Đã tắt</span>}
            </div>
            {sepaySecret(c, "webhook_key", "Khoá webhook (API Key)", "Khoá SePay gửi kèm mỗi giao dịch")}
            {sepaySecret(c, "api_token", "Token API", "Dùng để rà soát lại giao dịch lúc 2 giờ sáng và khi đồng bộ lại")}
            <div class="srow srow-stack">
              <span class="copyrow">
                <span class="srow-s">{names.length ? `Nối ${names.length} tài khoản: ${names.join(", ")}` : "Chưa tài khoản nào nối qua đây — bật Nối SePay ở phần Tài khoản."}</span>
                <span class="srow-r">
                  {!ro && (
                    <button type="button" class="btn" aria-label={`Sửa ${c.name}`} onClick={() => open({ kind: "sepay", item: c })}>
                      Sửa
                    </button>
                  )}
                  <button type="button" class="btn" disabled={ro || t?.busy} onClick={() => void testSepay(c)}>
                    {t?.busy ? "Đang kiểm tra…" : "Kiểm tra"}
                  </button>
                </span>
              </span>
              <div aria-live="polite">
                {t?.error && <p class="err">{t.error}</p>}
                {t?.result && (
                  <ul class="set-results">
                    <li>
                      <strong>{t.result.ok ? "SePay trả lời." : "SePay có lỗi."}</strong> {t.result.error && <span class="err">{t.result.error}</span>}
                    </li>
                    {t.result.linked.map((l) => (
                      <li key={l.account_number}>
                        SePay đang nối: {[bankName(l.bank), l.account_number].filter(Boolean).join(" ")}
                        {l.label && ` (${l.label})`}
                      </li>
                    ))}
                    {t.result.ok && !t.result.linked.length && <li>SePay chưa báo tài khoản ngân hàng nào cho token này.</li>}
                    {t.result.accounts.map((a) => (
                      <li key={a.id}>
                        {a.name}: {a.error ? <span class="err">{a.error}</span> : `đọc được ${a.transactions} giao dịch`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      <div class="srow">
        <span class="srow-main">
          <span class="srow-s">Mỗi tài khoản SePay một khoá webhook và một token. Nhà dùng hai tài khoản SePay thì thêm kết nối thứ hai.</span>
        </span>
        <span class="srow-r">
          <AddButton ro={ro} label="Thêm kết nối SePay" onClick={() => open({ kind: "sepay", item: null })} />
        </span>
      </div>

      <div class="set-sub">Telegram</div>
      {secret("telegram_bot_token", "Bot token", "Token của bot nhắc việc, lấy từ @BotFather")}
      {d.members.map((m) => {
        const r = tg[m.id];
        const why = !it.telegram_bot_token.set ? "chưa đặt bot token" : !m.tg_chat_id ? "chưa có chat_id — đặt ở phần Thành viên" : `chat_id ${m.tg_chat_id}`;
        return (
          <div class="srow" key={m.id}>
            <span class="srow-main">
              <span class="srow-t">{m.name}</span>
              <span class="srow-s">{why}</span>
              {r?.text && <span class={r.bad ? "srow-s2 err" : "srow-s2"}>{r.text}</span>}
            </span>
            <span class="srow-r">
              <button type="button" class="btn" disabled={ro || r?.busy || !m.tg_chat_id || !it.telegram_bot_token.set} onClick={() => void testTelegram(m)}>
                {r?.busy ? "Đang gửi…" : "Gửi thử"}
              </button>
            </span>
          </div>
        );
      })}

      <div class="set-sub">Zalo Bot</div>
      <div class="srow srow-stack">
        <span class="srow-s">
          Tạo bot trong app Zalo: tìm “Zalo Bot Manager”, chọn Zalo Bot Creator, đặt tên bot — Zalo gửi Bot Token. Dán token ở dưới, tự đặt một khoá webhook, rồi bấm Đặt webhook.
          Gói miễn phí: 3.000 tin mỗi tháng, tối đa 50 người.
        </span>
      </div>
      {secret("zalo_bot_token", "Bot token", "Token Zalo gửi khi tạo bot")}
      {secret("zalo_webhook_secret", "Khoá webhook", "Chuỗi tự đặt; Zalo gửi kèm mỗi tin nhắn để app biết là thật")}
      <div class="srow srow-stack">
        <span class="srow-t">Địa chỉ webhook</span>
        <span class="copyrow">
          <code class="num">{it.zalo_webhook_url ?? "—"}</code>
          <button type="button" class="btn" disabled={ro || zaloHook?.busy || !zaloSet} onClick={() => void setZaloWebhook()}>
            {zaloHook?.busy ? "Đang đặt…" : "Đặt webhook"}
          </button>
        </span>
        <div aria-live="polite">
          {zaloHook?.bad ? (
            <p class="err">{zaloHook.text}</p>
          ) : (
            <span class="srow-s">{zaloHook?.text || (zaloSet ? "Bấm Đặt webhook một lần sau khi lưu hoặc đổi token, khoá. Zalo giới hạn số lần đặt mỗi ngày." : "Lưu bot token và khoá webhook trước.")}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Đồng bộ lại SePay: lấy lại giao dịch của một khoảng ngày (giờ VN) khi app lỡ mất; giao dịch đã có không ghi lần hai. */
function SepaySync({ d, ro }: SectionProps) {
  const connections = d.integrations.sepay_connections ?? [];
  const today = dayKey(new Date());
  const [from, setFrom] = useState(() => previousDay(today));
  const [to, setTo] = useState(today);
  const [connection, setConnection] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const problem = syncRangeError(from, to, today);

  async function sync() {
    setBusy(true);
    setErrors([]);
    try {
      const r = await api.post<SepaySyncResult>("/v1/settings/sepay/sync", { from, to, ...(connection ? { connection_id: connection } : {}) });
      const early = r.beforeOpening > 0 ? ` ${r.beforeOpening} giao dịch trước ngày mở sổ — đã có trong số dư đầu, không ghi lại.` : "";
      // Kết nối lỗi thì toast phải nói, không chỉ "Đã lấy thêm 0 giao dịch" như thể xong xuôi — lý do nằm dưới nút.
      const failed = r.errors.length > 0 ? " Có chỗ chưa lấy được — xem lý do dưới nút Đồng bộ." : "";
      toast(`Đã lấy thêm ${r.added} giao dịch, ${r.duplicates} đã có sẵn.${early}${failed}`);
      setErrors(r.errors);
      await refresh(true);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="sepay-sync" title="Đồng bộ lại SePay" flush note="Lấy lại giao dịch SePay của những ngày app lỡ mất. Giao dịch đã có không bị ghi hai lần. Mỗi lần tối đa 31 ngày.">
      <div class="field" style={{ borderTop: 0 }}>
        <label for="sync-from">Từ ngày</label>
        <input id="sync-from" class="ctl" type="date" max={today} value={from} onInput={(ev) => setFrom(ev.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="sync-to">Đến ngày</label>
        <input id="sync-to" class="ctl" type="date" max={today} value={to} onInput={(ev) => setTo(ev.currentTarget.value)} />
      </div>
      {connections.length >= 2 && (
        <div class="field">
          <label for="sync-conn">Kết nối</label>
          <select id="sync-conn" class="ctl" value={connection} onChange={(ev) => setConnection(ev.currentTarget.value)}>
            <option value="">Tất cả</option>
            {connections
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <div class="pad">
        {problem && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {problem}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={ro || busy || !!problem} onClick={() => void sync()}>
          {busy ? "Đang đồng bộ…" : "Đồng bộ"}
        </button>
        {errors.length > 0 && (
          <ul class="set-results" aria-live="polite">
            <li>Có chỗ chưa lấy được:</li>
            {errors.map((e) => (
              <li key={e} class="err">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Claude và ứng dụng AI ────────────────────────────────────────

/**
 * Địa chỉ MCP để dán vào Claude, cách nối, và các kết nối đang có của cả nhà (OAuth, mỗi kết nối gắn một người).
 * Ai đăng nhập cũng gỡ được kết nối của bất kỳ ai (thành viên ngang quyền). Bấm Gỡ hai lần: lần đầu hỏi lại.
 */
function AiConnections({ ro }: { ro: boolean }) {
  const mcp = useResource<McpSettings>("/v1/settings/mcp");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = mcp.data ? connectionRows(mcp.data.connections, new Date()) : [];

  async function revoke(row: (typeof rows)[number]) {
    if (confirmRevoke !== row.key) return setConfirmRevoke(row.key);
    setConfirmRevoke(null);
    setBusy(true);
    setError(null);
    try {
      await api.del(row.revokePath);
      toast(`Đã gỡ ${row.title}. Trong vòng 1 phút ứng dụng đó hết quyền vào Ví nhà.`);
      mcp.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="ai-connections"
      title="Claude và ứng dụng AI"
      flush
      note="Mỗi người tự nối bằng mật khẩu của mình; ứng dụng chỉ thấy những gì người đó thấy trong app. Đổi mật khẩu riêng, tắt người hay Đăng xuất mọi máy cũng gỡ kết nối."
    >
      <div class="srow srow-stack">
        <span class="srow-t">Địa chỉ MCP</span>
        <span class="srow-s">
          Trong Claude: Settings › Connectors › Add custom connector › dán địa chỉ này › đăng nhập Ví nhà › chọn quyền Xem hoặc Xem + Ghi. Ứng dụng AI khác có nối MCP cũng dùng địa chỉ này.
        </span>
        {mcp.data ? (
          <span class="copyrow">
            <code class="num">{mcp.data.endpoint}</code>
            <button type="button" class="btn" onClick={() => void copyText(mcp.data!.endpoint, "địa chỉ MCP")} aria-label="Chép địa chỉ MCP">
              <Icon name="copy" size={16} />
              Chép
            </button>
          </span>
        ) : (
          !mcp.error && <Skeleton rows={1} />
        )}
      </div>
      <div class="set-sub">Đang nối</div>
      {mcp.error && !mcp.data ? (
        <div class="srow">
          <span class="srow-s err">{mcp.error.message}</span>
        </div>
      ) : !mcp.data ? (
        <Skeleton rows={2} />
      ) : rows.length === 0 ? (
        <Row title="Chưa nối ứng dụng nào" sub="Làm theo các bước ở trên để Claude đọc và ghi sổ bằng lời." />
      ) : (
        rows.map((r) => (
          <Row
            key={r.key}
            title={
              <>
                {r.title} {r.domain && <span class="chip">{r.domain}</span>}
              </>
            }
            sub={r.sub}
            sub2={r.sub2}
            right={
              <button type="button" class={confirmRevoke === r.key ? "btn btn-bad" : "btn"} disabled={ro || busy} onClick={() => void revoke(r)}>
                {confirmRevoke === r.key ? "Gỡ hẳn" : "Gỡ"}
              </button>
            }
          />
        ))
      )}
      {error && (
        <div class="srow" aria-live="polite">
          <span class="srow-s err">{error}</span>
        </div>
      )}
    </Card>
  );
}

// ── Thông báo: giờ nhắc của cả nhà ───────────────────────────────

function NotifyScheduleCard({ d, ro, open }: SectionProps) {
  const s = d.notifySchedule;
  const edit = ro ? undefined : () => open({ kind: "notify" });
  return (
    <Card
      id="notifications"
      title="Giờ nhắc"
      flush
      note="Áp dụng cho cả nhà. Giao dịch chưa gán: kiểm tra mỗi 15 phút (đêm 1–4 giờ: mỗi giờ). Giờ trong 01:00–04:00 chạy theo lượt mỗi giờ. Rà soát ngân hàng vẫn chạy 02:00, không gửi tin."
    >
      {s ? (
        scheduleRows(s).map((r) => <Row key={r.title} title={r.title} sub={r.sub} right={<span class="srow-v">{r.value}</span>} onClick={edit} />)
      ) : (
        <Row title="Chưa có giờ nhắc trong bản đã lưu" sub="Mở lại Cài đặt khi có mạng để xem và sửa." />
      )}
    </Card>
  );
}

// ── Thông báo trên máy này ───────────────────────────────────────

/** Trạng thái push của máy này + danh sách mọi máy đã bật. Không theo `ro` của cài đặt: đây là việc của máy, chỉ cần mạng. */
function PushNotifications() {
  const { member, online } = useApp();
  const [state, setState] = useState<PushState | null>(null);
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async () => {
    setState(await readPushState());
    try {
      setInfo(await loadPushInfo());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => void load(), [load, online, member?.id]);
  useEffect(() => onPushChange(() => void load()), [load]);
  const series = seriesView(info?.series ?? null);
  // Lượt gửi thử đang chạy: đọc lại mỗi 5 giây để số tin đã gửi và nút Huỷ khớp server khi app còn mở.
  useEffect(() => {
    if (!series.active || !online) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [series.active, online, load]);

  /** Chạy một thao tác của thẻ: khoá nút, ghi kết quả, đọc lại trạng thái và danh sách máy. */
  const run = async (fn: () => Promise<{ text: string; bad: boolean } | null>) => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await fn());
    } catch (err) {
      setResult({ text: errorText(err), bad: true });
    }
    setBusy(false);
    await load();
  };

  const enable = () =>
    run(async () => {
      if (!member || !info) return null;
      const permission = await enablePush(member.id, info.publicKey);
      if (permission === "granted") return { text: "Đã bật. Máy này sẽ nhận tin sáng, tổng kết tuần và nhắc gán giao dịch.", bad: false };
      return permission === "denied" ? null : { text: "Chưa cho phép thông báo. Bấm Bật thông báo rồi chọn Cho phép.", bad: true };
    });
  const test = () =>
    run(async () => {
      try {
        const r = await sendTestPush();
        if (r.sent === 0) return { text: "Chưa gửi được: máy không nhận. Tắt rồi bật lại thông báo.", bad: true };
        return { text: `Đã gửi tin thử tới ${r.sent} máy${r.failed ? `, ${r.failed} máy không nhận` : ""}. Xem thông báo.`, bad: r.failed > 0 };
      } catch (err) {
        if (err instanceof ApiError && err.code === "no_subscription") return { text: "Server không còn giữ máy này. Tắt rồi bật lại thông báo.", bad: true };
        throw err;
      }
    });
  const disable = () =>
    run(async () => {
      await unbindPush();
      return { text: "Đã tắt. Máy này không nhận thông báo nữa; tin vẫn tới Telegram, Zalo.", bad: false };
    });
  const startSeries = () =>
    run(async () => {
      try {
        await startTestSeries();
        return null; // dòng lượt gửi thử (đọc lại sau run) hiện hướng dẫn tắt app
      } catch (err) {
        if (err instanceof ApiError && err.code === "no_subscription") return { text: "Server không còn giữ máy này. Tắt rồi bật lại thông báo.", bad: true };
        if (err instanceof ApiError && err.code === "series_running") return { text: "Đang có một lượt gửi thử chưa xong. Đợi xong hoặc bấm Huỷ.", bad: true };
        throw err;
      }
    });
  const cancelSeries = () =>
    run(async () => {
      await cancelTestSeries();
      return null;
    });
  /** Gỡ một máy trong danh sách (máy lạ cũng gỡ được). Bấm hai lần: lần đầu hỏi lại. Máy này thì tắt hẳn như nút Tắt. */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const remove = (id: number) => {
    if (confirmRemove !== id) return setConfirmRemove(id);
    setConfirmRemove(null);
    if (id === thisId && state === "on") return void disable();
    void run(async () => {
      await api.del(`/v1/push/subscriptions/${id}`);
      return { text: "Đã gỡ máy đó. Máy đó không nhận thông báo nữa.", bad: false };
    });
  };

  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints;
  const thisDevice = deviceLabel(ua, touch);
  const thisId = boundSubscriptionId();
  const ios = isIos(ua, touch);

  const status = (() => {
    switch (state) {
      case null:
        return <Skeleton rows={1} />;
      case "unsupported":
        return <Row title="Máy này không nhận được thông báo" sub={`${thisDevice} không hỗ trợ thông báo đẩy. Tin vẫn tới Telegram, Zalo.`} />;
      case "needs-install":
        return (
          <Row
            title="Thêm Ví nhà vào màn hình chính trước"
            sub="iPhone, iPad chỉ nhận thông báo khi app mở từ icon ngoài màn hình chính. Trong Safari bấm Chia sẻ → Thêm vào MH chính, rồi mở Ví nhà từ icon đó và bật ở đây."
          />
        );
      case "blocked":
        return (
          <Row
            title="Thông báo đang bị chặn"
            sub={
              ios
                ? "Mở Cài đặt của máy → Thông báo → Ví nhà → bật Cho phép thông báo, rồi quay lại đây."
                : "Bấm biểu tượng cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang. App cài trên Android: Cài đặt → Ứng dụng → Ví nhà → Thông báo."
            }
          />
        );
      case "off":
        return (
          <Row
            title="Chưa bật"
            sub={`Bật để ${thisDevice} nhận tin sáng, tổng kết tuần và nhắc gán giao dịch.`}
            right={
              <button type="button" class="btn" disabled={!online || busy || !info} onClick={() => void enable()}>
                {busy ? "Đang bật…" : "Bật thông báo"}
              </button>
            }
          />
        );
      case "on":
        return (
          <>
            <Row
              title={`Đang bật cho ${member?.name ?? "người đang dùng"}`}
              sub={thisDevice}
              right={
                <>
                  <button type="button" class="btn" disabled={!online || busy} onClick={() => void test()}>
                    Gửi thử
                  </button>
                  <button type="button" class="btn" disabled={!online || busy} onClick={() => void disable()}>
                    Tắt
                  </button>
                </>
              }
            />
            <Row
              title={series.title}
              sub={series.sub}
              right={
                series.active ? (
                  <button type="button" class="btn" disabled={!online || busy} onClick={() => void cancelSeries()}>
                    Huỷ
                  </button>
                ) : (
                  <button type="button" class="btn" disabled={!online || busy || !info} onClick={() => void startSeries()}>
                    Thử khi tắt app
                  </button>
                )
              }
            />
          </>
        );
    }
  })();

  return (
    <Card id="device-notifications" title="Thông báo trên máy này" flush note="Tin gửi cho mỗi người tới Telegram và Zalo (bản đầy đủ) và mọi máy người đó đã bật ở đây (bản ngắn, việc cần làm trước). Đổi người hay đăng xuất thì máy này tự tắt.">
      {status}
      {result && (
        <div class="srow" aria-live="polite">
          <span class={result.bad ? "srow-s err" : "srow-s"}>{result.text}</span>
        </div>
      )}
      <div class="set-sub">Các máy đang nhận</div>
      {error && !info ? (
        <div class="srow">
          <span class="srow-s err">{error}</span>
        </div>
      ) : !info ? (
        <Skeleton rows={2} />
      ) : info.subscriptions.length === 0 ? (
        <Row title="Chưa máy nào bật" sub="Mở Ví nhà trên điện thoại của từng người và bật ở đây." />
      ) : (
        info.subscriptions.map((x) => (
          <Row
            key={x.id}
            title={
              <>
                {x.memberName} {x.id === thisId && state === "on" && <span class="chip">máy này</span>}
              </>
            }
            sub={x.device ?? "Máy không rõ"}
            sub2={`bật ngày ${shortDate(sqliteUtcToIso(x.createdAt))} · ${lastOkText(x.lastOkAt)}`}
            right={
              <button type="button" class={confirmRemove === x.id ? "btn btn-bad" : "btn"} disabled={!online || busy} onClick={() => remove(x.id)}>
                {confirmRemove === x.id ? "Gỡ hẳn" : "Gỡ"}
              </button>
            }
          />
        ))
      )}
    </Card>
  );
}

// ── 2. Tài khoản ─────────────────────────────────────────────────

function Accounts({ d, ro, wide, open }: SectionProps) {
  const rows = [...d.accounts].sort((a, b) => Number(b.active) - Number(a.active));
  const owner = (a: SettingsAccount) => nameOf(d.members, a.owner_member_id) ?? "chung";
  const connections = d.integrations.sepay_connections ?? [];
  // Nhà có từ hai kết nối SePay thì nhãn kèm tên kết nối để biết tài khoản về qua đâu.
  const sepay = (a: SettingsAccount) => sepayLabel(a, connections.length >= 2 ? nameOf(connections, a.sepay_connection_id) : null);
  return (
    <Card
      id="accounts"
      title="Tài khoản"
      right={<AddButton ro={ro} label="Thêm" onClick={() => open({ kind: "account", item: null })} />}
      flush
      note="Tiền vào tài khoản nối SePay tự về, không nhập tay; tiền ra cũng vậy nếu tài khoản bật “SePay báo cả tiền ra” — còn không thì khoản chi từ nó nhập tay."
    >
      {wide ? (
        <div class="table-wrap">
          <table class="data dk-acct">
            <thead>
              <tr>
                <th>Tên</th>
                <th class="l">Loại</th>
                <th class="l">Ngân hàng</th>
                <th class="l">Số tài khoản</th>
                <th class="l">SePay</th>
                <th class="l">Chủ</th>
                <th>Số dư đầu (₫)</th>
                <th class="l">Trạng thái</th>
                <th>
                  <span class="sr-only">Sửa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td class="l">{ACCOUNT_KIND_LABEL[a.kind]}</td>
                  <td class="l">{bankName(a.bank) ?? "—"}</td>
                  <td class="l num">
                    {a.account_no ?? "—"}
                    {a.sub_account && <div class="sub-line">VA {a.sub_account}</div>}
                  </td>
                  <td class="l">{sepay(a) ?? "ghi tay"}</td>
                  <td class="l">{owner(a)}</td>
                  <td class="num">
                    <Money value={a.opening_balance} unit={false} mono />
                  </td>
                  <td class="l">{a.active ? "đang dùng" : <span class="chip">ngừng dùng</span>}</td>
                  <EditCell ro={ro} label={`Sửa ${a.name}`} onClick={() => open({ kind: "account", item: a })} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        rows.map((a) => (
          <Row
            key={a.id}
            title={
              <>
                {a.name} {a.sepay_enabled && <span class="chip">{sepay(a)}</span>} {!a.active && <span class="chip">ngừng dùng</span>}
              </>
            }
            sub={[ACCOUNT_KIND_LABEL[a.kind], bankName(a.bank), a.account_no, owner(a)].filter(Boolean).join(" · ")}
            right={
              <span class="srow-v">
                <Money value={a.opening_balance} />
                <span class="sub-line">số dư đầu</span>
              </span>
            }
            onClick={ro ? undefined : () => open({ kind: "account", item: a })}
          />
        ))
      )}
    </Card>
  );
}

// ── 3. Ví & số tiền nạp ──────────────────────────────────────────

/** Tách cách nạp thành các ô cho bảng máy tính. */
function allocCells(a: Allocation | null): { how: string; value: ComponentChildren; floor: ComponentChildren; when: string } {
  const money = (n: number | null) => (n ? <Money value={n} unit={false} mono /> : "—");
  if (!a) return { how: "không nạp tự động", value: "—", floor: "—", when: "—" };
  switch (a.mode) {
    case "flat":
      return { how: "cố định", value: money(a.amount), floor: money(a.floor_amount), when: a.period === "week" ? "mỗi tuần" : "mỗi tháng" };
    case "percent":
      return { how: "theo %", value: <span class="num">{formatPercent(a.percent ?? 0)}%</span>, floor: "—", when: "mỗi khoản thu" };
    case "goal":
      return { how: "mục tiêu", value: money(a.target_amount), floor: "—", when: a.target_date ? `trước ${a.target_date.split("-").reverse().join("/")}` : "—" };
    case "lump":
      return { how: "một cục", value: money(a.amount ?? a.target_amount), floor: money(a.floor_amount), when: "mỗi tháng" };
    case "remainder":
      return { how: "nhận phần còn lại", value: "—", floor: "—", when: "—" };
  }
}

function Wallets({ d, ro, wide, open }: SectionProps) {
  const groups = groupWallets(d.wallets);
  const account = (w: SettingsWallet) => nameOf(d.accounts, w.account_id) ?? "chưa gán tài khoản";
  const chips = (w: SettingsWallet) => (
    <>
      {w.scope === "personal" && <span class="chip">riêng {nameOf(d.members, w.member_id)}</span>} {!w.active && <span class="chip">ngừng dùng</span>}
    </>
  );
  return (
    <Card
      id="wallets-allocation"
      title="Ví & số tiền nạp"
      right={<AddButton ro={ro} label="Thêm ví" onClick={() => open({ kind: "wallet", item: null })} />}
      flush
      note="Mỗi lần chia tiền rót theo thứ tự Tích sản → Thuế → Hưởng thụ → Vận hành (Must rồi Có thì tốt); trong một tầng, ưu tiên số nhỏ được rót trước. Đổi số nạp có hiệu lực từ lần chia tiền tới."
    >
      {wide ? (
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Ví</th>
                <th class="l">Cách nạp</th>
                <th>Số (₫)</th>
                <th>Sàn (₫)</th>
                <th class="l">Kỳ / hạn</th>
                <th>Ưu tiên</th>
                <th class="l">Nằm ở tài khoản</th>
                <th>
                  <span class="sr-only">Sửa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr class="group">
                    <td colSpan={8}>
                      <span class="set-gl">
                        <i class={`dot ${g.lock ? "d-lock" : g.key === "have" ? "d-have" : g.key === "must" ? "d-must" : "d-nice"}`} aria-hidden="true" />
                        {g.label}
                      </span>
                    </td>
                  </tr>
                  {g.wallets.map((w) => {
                    const c = allocCells(w.allocation);
                    return (
                      <tr key={w.id}>
                        <td>
                          {w.name} {chips(w)}
                        </td>
                        <td class="l">{c.how}</td>
                        <td class="num">{c.value}</td>
                        <td class="num">{c.floor}</td>
                        <td class="l">{c.when}</td>
                        <td class="num">{w.allocation && w.allocation.mode !== "remainder" ? w.allocation.priority : "—"}</td>
                        <td class="l">{account(w)}</td>
                        <EditCell ro={ro} label={`Sửa ví ${w.name}`} onClick={() => open({ kind: "wallet", item: w })} />
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div class="set-sub set-gl">
              <i class={`dot ${g.lock ? "d-lock" : g.key === "have" ? "d-have" : g.key === "must" ? "d-must" : "d-nice"}`} aria-hidden="true" />
              {g.label}
            </div>
            {g.wallets.map((w) => (
              <Row
                key={w.id}
                title={
                  <>
                    {w.name} {chips(w)}
                  </>
                }
                sub={allocationSummary(w.allocation)}
                sub2={`${account(w)}${w.allocation && w.allocation.mode !== "remainder" ? ` · ưu tiên ${w.allocation.priority}` : ""}`}
                onClick={ro ? undefined : () => open({ kind: "wallet", item: w })}
              />
            ))}
          </div>
        ))
      )}
    </Card>
  );
}

// ── 4. Mã chuyển khoản ───────────────────────────────────────────

function Rules({ d, ro, wide, open }: SectionProps) {
  const rows = [...d.rules].sort((a, b) => Number(b.active) - Number(a.active) || a.priority - b.priority);
  const target = (r: Rule) => [nameOf(d.wallets, r.wallet_id), nameOf(d.categories, r.category_id)].filter(Boolean).join(" · ") || "—";
  const streamName = (r: Rule) => (r.meaning === "income" ? nameOf(d.incomeStreams ?? [], r.incomeStreamId) : null);
  return (
    <Card
      id="transfer-codes"
      title="Mã chuyển khoản"
      right={<AddButton ro={ro} label="Thêm mã" onClick={() => open({ kind: "rule", item: null })} />}
      flush
      note="Mã theo quy ước của nhà: ba chữ cái, bắt đầu bằng Q hoặc E (EXE xăng, EMS mua sắm online), ghi trong nội dung chuyển khoản. Giao dịch khớp mã tự gán ví và danh mục; không khớp thì chờ ở màn Gán."
    >
      {rows.length === 0 && <p class="empty">Chưa có mã nào.</p>}
      {wide && rows.length > 0 ? (
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Mẫu</th>
                <th class="l">Khớp theo</th>
                <th class="l">Nghĩa</th>
                <th class="l">Ví · danh mục</th>
                <th class="l">Người chi</th>
                <th>Ưu tiên</th>
                <th class="l">Trạng thái</th>
                <th>
                  <span class="sr-only">Sửa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td class="num">{r.pattern}</td>
                  <td class="l">{MATCH_LABEL[r.match_type]}</td>
                  <td class="l">
                    {MEANING_LABEL[r.meaning]}
                    {streamName(r) && <div class="sub-line">{streamName(r)}</div>}
                  </td>
                  <td class="l">{target(r)}</td>
                  <td class="l">{nameOf(d.members, r.by_member_id) ?? "—"}</td>
                  <td class="num">{r.priority}</td>
                  <td class="l">{r.active ? "đang dùng" : <span class="chip">ngừng dùng</span>}</td>
                  <EditCell ro={ro} label={`Sửa mã ${r.pattern}`} onClick={() => open({ kind: "rule", item: r })} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        rows.map((r) => (
          <Row
            key={r.id}
            title={
              <>
                <span class="num">{r.pattern}</span> <span class="chip">{MATCH_LABEL[r.match_type].toLowerCase()}</span> {!r.active && <span class="chip">ngừng dùng</span>}
              </>
            }
            sub={`${MEANING_LABEL[r.meaning]}${streamName(r) ? ` · ${streamName(r)}` : ""} → ${target(r)}`}
            sub2={[r.by_member_id ? `của ${nameOf(d.members, r.by_member_id)}` : null, `ưu tiên ${r.priority}`].filter(Boolean).join(" · ")}
            onClick={ro ? undefined : () => open({ kind: "rule", item: r })}
          />
        ))
      )}
    </Card>
  );
}

// ── Nguồn thu ────────────────────────────────────────────────────

function Streams({ d, ro, open }: SectionProps) {
  const streams = [...(d.incomeStreams ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort);
  return (
    <Card
      id="income-streams"
      title="Nguồn thu"
      right={<AddButton ro={ro} label="Thêm nguồn" onClick={() => open({ kind: "stream", item: null })} />}
      flush
      note="Mỗi nguồn có phần khóa riêng, cắt trước dòng thác. Khoản thu không chọn nguồn thì chia theo luật % chung như cũ. Chọn nguồn cho mã lương ở Mã chuyển khoản."
    >
      {streams.length === 0 && <p class="empty">Chưa có nguồn thu nào.</p>}
      {streams.map((s) => (
        <Row
          key={s.id}
          title={
            <>
              {s.name} {!s.active && <span class="chip">ngừng dùng</span>}
            </>
          }
          sub={streamSummary(s, d.wallets)}
          onClick={ro ? undefined : () => open({ kind: "stream", item: s })}
        />
      ))}
    </Card>
  );
}

// ── Cho thuê ─────────────────────────────────────────────────────

function RentalSettings({ d, ro, open }: SectionProps) {
  const res = useResource<Rental>("/v1/rental");
  const r = res.data;
  return (
    <Card
      id="rental"
      title="Cho thuê"
      right={<AddButton ro={ro || !r} label="Thêm người thuê" onClick={() => open({ kind: "tenant", item: null })} />}
      flush
      note="Người thuê không phải thành viên, không đăng nhập. Mỗi tháng: phí cố định + chi chung chia đều theo số người; chốt ở Ví & quỹ › Người thuê."
    >
      {!r ? (
        res.loading ? (
          <Skeleton rows={2} />
        ) : (
          <p class="empty">
            Chưa tải được: {errorText(res.error)}{" "}
            <button type="button" class="link" onClick={res.reload}>
              Tải lại
            </button>
          </p>
        )
      ) : (
        <>
          <Row
            title="Chi chung"
            sub={`${r.headcount} người chia · ${r.sharedCategoryIds.map((id) => nameOf(d.categories, id)).join(", ") || "chưa chọn danh mục"}`}
            sub2={`Tiền người thuê trả vào nguồn: ${nameOf(d.incomeStreams ?? [], r.incomeStreamId) ?? "mặc định"}`}
            onClick={ro ? undefined : () => open({ kind: "rental-config", rental: r })}
          />
          {r.tenants.length === 0 && <p class="empty">Chưa có người thuê.</p>}
          {r.tenants.map((t) => (
            <div key={t.id}>
              <div class="set-sub flex justify-between items-center">
                <span>
                  {t.name} {!t.active && <span class="chip">đã ra</span>}
                </span>
                <span class="tnum">{balanceText(t.balance)}</span>
              </div>
              <Row title="Tên, đang ở" sub={t.active ? "đang ở" : "đã ra"} onClick={ro ? undefined : () => open({ kind: "tenant", item: t })} />
              {t.fees.map((fee) => (
                <Row
                  key={fee.id}
                  title={
                    <>
                      {fee.name} {!fee.active && <span class="chip">ngừng thu</span>}
                    </>
                  }
                  sub="phí cố định mỗi tháng"
                  right={<Money value={fee.amount} class="srow-amt" />}
                  onClick={ro ? undefined : () => open({ kind: "fee", tenant: t, item: fee })}
                />
              ))}
              {!ro && (
                <div class="pad" style={{ paddingTop: "4px", paddingBottom: "8px" }}>
                  <button type="button" class="btn btn-ghost" onClick={() => open({ kind: "fee", tenant: t, item: null })}>
                    <Icon name="plus" size={16} /> Thêm phí cố định
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

// ── 5. Thành viên ────────────────────────────────────────────────

function Members({ d, ro, open }: SectionProps) {
  const full = !canAddMember(d.members);
  return (
    <Card
      id="members"
      title="Thành viên"
      right={full ? <span class="chip">đủ 6 người</span> : <AddButton ro={ro} label="Thêm người" onClick={() => open({ kind: "member-new" })} />}
      flush
      note="Chạm tên người để đặt mật khẩu riêng, tắt hay bật lại. Telegram: nhắn một tin bất kỳ cho bot của nhà, rồi nhắn @userinfobot — nó trả lại dãy số chat_id. Zalo: chạm tên người, bấm Nối Zalo rồi nhắn mã cho bot Zalo của nhà."
    >
      {d.members.map((m) => (
        <Row
          key={m.id}
          title={
            <>
              {m.name} {m.role === "owner" && <span class="chip">chủ hộ</span>} {!m.active && <span class="chip">ngừng dùng</span>}
            </>
          }
          sub={
            <>
              {m.tg_chat_id ? <span class="num">chat_id {m.tg_chat_id}</span> : "chưa có chat_id Telegram"} · {m.zalo_chat_id ? "đã nối Zalo" : "chưa nối Zalo"}
            </>
          }
          sub2={passwordLine(m)}
          onClick={ro ? undefined : () => open({ kind: "member", item: m })}
        />
      ))}
    </Card>
  );
}

// ── 6. Tham số ───────────────────────────────────────────────────

function Params({ d, ro, open }: SectionProps) {
  const c = d.config;
  const edit = ro ? undefined : () => open({ kind: "config" });
  return (
    <Card id="parameters" title="Tham số" flush>
      <Row
        title="Ngưỡng tự chia lương"
        sub="Khoản khớp mẫu lương từ mức này trở lên thì tự ghi và tự chia; nhỏ hơn thì chờ ở màn Gán"
        right={<span class="srow-v">{c.salary_min_amount ? formatVnd(c.salary_min_amount) : "không ngưỡng"}</span>}
        onClick={edit}
      />
      <Row
        title="Quỹ an tâm"
        sub="Số tháng chi Must giữ trong Tích sản trước khi mua tài sản"
        right={<span class="srow-v">{c.safety_fund_months} tháng</span>}
        onClick={edit}
      />
    </Card>
  );
}

// ── 7. Nhật ký thay đổi ──────────────────────────────────────────

/** 50 thay đổi mới nhất (huỷ/sửa giao dịch, khoá, kênh báo tin, máy nhận thông báo…), mới trước. Chỉ xem. */
function AuditLog() {
  const log = useResource<AuditEntry[]>("/v1/settings/audit");
  return (
    <Card
      id="audit-log"
      title="Nhật ký thay đổi"
      flush
      note="50 thay đổi gần nhất: ai làm, qua đâu, lúc nào. Thấy việc lạ (máy lạ, khoá bị đổi) thì gỡ ngay ở phần tương ứng và đổi mật khẩu."
    >
      {log.error && !log.data ? (
        <div class="srow">
          <span class="srow-s err">{log.error.message}</span>
        </div>
      ) : !log.data ? (
        <Skeleton rows={3} />
      ) : log.data.length === 0 ? (
        <Row title="Chưa có thay đổi nào" />
      ) : (
        log.data.map((e) => {
          const v = auditView(e);
          return <Row key={e.id} title={v.title} sub={v.sub} sub2={v.fields ?? undefined} />;
        })
      )}
    </Card>
  );
}

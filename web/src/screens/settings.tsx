// Cài đặt (#settings): mở từ nút bánh răng ở Hôm nay, không phải tab thứ năm.
// Mười hai phần, mỗi phần một card (Thông báo có hai: giờ nhắc của cả nhà và thông báo trên máy này);
// mọi chỗ sửa nằm trong sheet (DESIGN.md §4: sheet là nơi mọi edge case được giải).
// Thứ tự theo mức hay sửa của nhà (audit 261001 F05): ba ngăn và tài khoản trước; khoá kết nối, Claude, tham số, nhật ký thay đổi và cập nhật bản mới gom vào "Nâng cao".
// Điện thoại: các card xếp dọc, hàng tab dính dưới thanh tiêu đề để nhảy tới phần cần sửa; "Nâng cao" gập sẵn;
// cuối trang là "Máy này" (giao diện sáng/tối, đăng xuất).
// Máy tính (≥1024px): cột mục lục bên trái, nội dung phần đang chọn bên phải (SectionNav, DESIGN §4.18); tài khoản, mã là bảng.
// Cần mạng: offline thì hiện bản tải gần nhất, chỉ xem.

import { Fragment, type ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { api, ApiError, errorText } from "../lib/api";
import { LATEST_RELEASE_API, releaseTag, UPDATE_COMMAND, UPDATE_GUIDE_URL, updateView, type UpdateView } from "../lib/app-update";
import { connectionRows } from "../lib/ai-connections";
import { canAddMember, passwordLine } from "../lib/members";
import { formatVnd } from "../lib/money";
import { dayKey, previousDay, shortDate } from "../lib/period";
import { conversionSettingsRow } from "../lib/convert";
import { SETTINGS_SECTIONS } from "../lib/nav";
import { groupAccountsByPocket, groupSummary, unconfirmedChip } from "../lib/pockets";
import { nestAccounts } from "../lib/accounts-total";
import {
  ACCOUNT_KIND_LABEL,
  type AccountForm,
  appVersionLabel,
  auditView,
  bankName,
  debtGoalSuggestions,
  depositPreset,
  fiConfigSummary,
  GOAL_SECTION_LABEL,
  type GoalForm,
  type GoalListGroup,
  type GoalRowView,
  goalListGroups,
  goalRowView,
  MATCH_LABEL,
  MEANING_LABEL,
  operatingGoalRows,
  scheduleRows,
  secretLabel,
  sepayLabel,
  sepaySyncText,
  streamSummary,
  syncRangeError,
} from "../lib/settings";
import { deviceLabel, isIos, lastOkText, seriesView, sqliteUtcToIso, type PushState } from "../lib/push";
import { balanceText } from "../lib/rental";
import { GUIDE_URL, SEPAY_REGISTER_URL, SOURCE_URL } from "../lib/splits";
import type {
  AuditEntry,
  CategoryGroup,
  DebtsData,
  IncomeStream,
  McpSettings,
  PushInfo,
  Rental,
  ReserveGoal,
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
  TenantSummary,
  ZaloWebhookResult,
} from "../lib/types";
import { useResource } from "../state/resource";
import { cacheKey, go, loadCached, refresh, setCompact, setState, toast, useApp } from "../state/store";
import { boundSubscriptionId, cancelTestSeries, enablePush, loadPushInfo, onPushChange, readPushState, sendTestPush, startTestSeries, unbindPush } from "../state/push";
import { copyText } from "../ui/clipboard";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Chip, PageHeader, Row as ListRow, SectionNav, Seg, Skeleton } from "../ui/parts";
import { signOutEverywhereNote, useLogout, useTheme, useWide } from "../ui/shell";
import { PinRow } from "./pin-sheet";
import {
  AccountSheet,
  ConfigSheet,
  GoalOrderSheet,
  GoalSheet,
  FiConfigSheet,
  GroupSheet,
  MemberNewSheet,
  MemberPasswordSheet,
  MemberSheet,
  NotifyScheduleSheet,
  PocketsSheet,
  RentalConfigSheet,
  RuleSheet,
  SecretSheet,
  SepayConnectionSheet,
  StreamSheet,
  TenantSheet,
} from "./settings-sheets";

const SECTIONS = SETTINGS_SECTIONS;
type SectionId = (typeof SECTIONS)[number]["id"];
const MAIN = SECTIONS.filter((x) => !x.advanced);
const ADVANCED = SECTIONS.filter((x) => x.advanced);
/** Khoá chưa có trong bản cài đặt lưu offline cũ (trước khi có Zalo) coi như chưa đặt. */
const NO_SECRET: Secret = { set: false, hint: null };

export type Edit =
  | { kind: "account"; item: SettingsAccount | null; preset?: Partial<AccountForm> }
  | { kind: "rule"; item: Rule | null }
  | { kind: "member"; item: SettingsMember }
  | { kind: "member-new" }
  | { kind: "member-password"; item: SettingsMember }
  | { kind: "secret"; key: SecretKey }
  | { kind: "sepay"; item: SepayConnection | null }
  | { kind: "sepay-secret"; connection: SepayConnection; key: SepaySecretKey }
  | { kind: "config" }
  | { kind: "fi-config" }
  | { kind: "notify" }
  | { kind: "stream"; item: IncomeStream | null }
  | { kind: "tenant"; item: TenantSummary | null }
  | { kind: "rental-config"; rental: Rental }
  | { kind: "pockets" }
  | { kind: "goal"; item: ReserveGoal | null; prefill?: GoalForm }
  | { kind: "goal-order"; accountId: string }
  | { kind: "group"; item: CategoryGroup | null };

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
  const { online, settingsFocus, member, compact } = useApp();
  const s = useSettings();
  const wide = useWide();
  const [section, setSection] = useState<SectionId>(settingsFocus === "pocket-goals" ? "pockets" : settingsFocus === "streams" ? "income-streams" : (settingsFocus ?? "pockets"));
  const [advanced, setAdvanced] = useState(settingsFocus === "parameters");
  const [edit, setEdit] = useState<Edit | null>(null);
  const ro = !online || s.stale;
  // Mở thẳng một phần (vd "Đổi ngăn" ở Hôm nay, "Đổi" % Tích luỹ ở Ví & quỹ): màn rộng chọn sẵn phần đó; điện thoại mở Nâng cao
  // nếu cần rồi cuộn tới khi cài đặt đã có.
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
      sub="Ba ngăn, tài khoản, thông báo"
      action={
        <button type="button" class="btn" onClick={() => go("today")}>
          Xong
        </button>
      }
    />
  );

  if (compact) {
    return (
      <>
        {header}
        <div class="status-row status-compact-hint" role="status">
          <span>Đang ở chế độ gọn. Tắt để thấy đủ các mục.</span>
        </div>
        <DeviceCard />
      </>
    );
  }

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
        {/* Bản lỗi không tải được cài đặt vẫn cập nhật được. */}
        {s.error && <AppUpdate />}
        {/* Máy này (giao diện, mã PIN, đăng xuất) chỉ lưu ở máy: hiện cả khi cài đặt chưa tải được hoặc offline. */}
        {!wide && <DeviceCard />}
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
      "pockets": <Pockets {...props} />,
      "transfer-codes": <Rules {...props} />,
      "income-streams": <Streams {...props} />,
      "rental": <RentalSettings {...props} />,
      "members": <Members {...props} />,
      "parameters": <Params {...props} />,
      "audit-log": <AuditLog />,
      "app-update": <AppUpdate />,
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
        <div class="sec-layout">
          <SectionNav
            wide
            label="Các phần cài đặt"
            items={SECTIONS.map((x) => ({ value: x.id, label: x.label, group: x.advanced ? "Nâng cao" : undefined }))}
            value={section}
            onChange={setSection}
          />
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
                <span class="srow-s">Ngân hàng, tin nhắn, Trợ lý AI, ngưỡng, nhật ký, bản mới</span>
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

      {edit?.kind === "account" && (
        <AccountSheet
          key={edit.item?.id ?? `+new${edit.preset?.parent_account_id ?? ""}`}
          d={s.data}
          item={edit.item}
          preset={edit.preset}
          onAddDeposit={(parent) => setEdit({ kind: "account", item: null, preset: depositPreset(parent) })}
          onClose={() => setEdit(null)}
          onSaved={saved}
        />
      )}
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
      {edit?.kind === "config" && <ConfigSheet d={s.data} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "fi-config" && <FiConfigSheet config={s.data.config} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "notify" && s.data.notifySchedule && <NotifyScheduleSheet schedule={s.data.notifySchedule} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "stream" && <StreamSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "tenant" && <TenantSheet item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "rental-config" && <RentalConfigSheet d={s.data} rental={edit.rental} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "pockets" && <PocketsSheet d={s.data} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "goal" && <GoalSheet d={s.data} item={edit.item} prefill={edit.prefill} onClose={() => setEdit(null)} onSaved={saved} />}
      {edit?.kind === "goal-order" && (
        <GoalOrderSheet
          d={s.data}
          accountId={edit.accountId}
          onClose={() => setEdit(null)}
          onSaved={saved}
          onReload={() => {
            setEdit(null);
            void s.reload();
          }}
        />
      )}
      {edit?.kind === "group" && <GroupSheet d={s.data} item={edit.item} onClose={() => setEdit(null)} onSaved={saved} />}
    </>
  );
}

/** Mục của hàng tab điện thoại: các phần chính + "Nâng cao" (mở phần gập rồi mới nhảy tới). */
const JUMP_ITEMS = [...MAIN.map((x) => ({ value: x.id as string, label: x.label })), { value: "advanced", label: "Nâng cao" }];

/**
 * Hàng tab nhảy tới phần (điện thoại, SectionNav): dính dưới thanh tiêu đề, tab của phần đang xem được tô và cuộn vào tầm nhìn.
 * "Nâng cao" mở phần gập rồi mới nhảy tới.
 */
function JumpBar({ onAdvanced }: { onAdvanced: () => void }) {
  const [current, setCurrent] = useState<string>("pockets");
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Phần đang xem: phần cuối cùng có đầu đã qua vạch đọc — một phần ba khoảng màn dưới hàng tab, nên card vừa cuộn
        // tới (đầu cách hàng tab vài chục px) được tô, không phải phần trước nó.
        const bottom = document.querySelector(".sec-tabs")?.getBoundingClientRect().bottom ?? 0;
        const line = bottom + Math.max(16, (innerHeight - bottom) / 3);
        const ids = JUMP_ITEMS.map((x) => x.value);
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
  return (
    <SectionNav
      wide={false}
      label="Đi tới mục"
      items={JUMP_ITEMS}
      value={current}
      onChange={(id) => (id === "advanced" ? onAdvanced() : document.getElementById(id)?.scrollIntoView({ block: "start" }))}
    />
  );
}

/** Máy này (điện thoại): giao diện sáng/tối, mã PIN, đăng xuất, đăng xuất mọi máy — trước nằm cuối Hôm nay. Máy tính đã có ở thanh bên. */
function DeviceCard() {
  const { member, compact } = useApp();
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
      <label class="field check-row">
        <span>Chế độ gọn (chỉ ghi chi)</span>
        <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.currentTarget.checked)} />
      </label>
      <PinRow />
      <Row title="Hướng dẫn" href={GUIDE_URL} />
      <Row title="Mã nguồn" sub={`Ví nhà · ${appVersionLabel(__APP_VERSION__)}`} href={SOURCE_URL} />
      <Row title={confirmOut ? "Vẫn đăng xuất" : "Đăng xuất"} sub={`Đang dùng: ${member?.name ?? ""}`} onClick={onLogout} />
      {confirmOut && (
        <div class="note" role="alert">
          Còn {unsynced} khoản của {member?.name} chưa lên sổ, tạm lưu trên máy này và chỉ gửi khi {member?.name} đăng nhập lại.
        </div>
      )}
      <Row title={all.confirmOut ? "Vẫn đăng xuất mọi máy" : "Đăng xuất mọi máy"} sub="Khi mất máy, lộ mật khẩu" onClick={all.onLogout} />
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
function Row(props: { title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span class="srow-main">
        <span class="srow-t">{props.title}</span>
        {props.sub && <span class="srow-s">{props.sub}</span>}
      </span>
      <span class="srow-r">
        {props.right}
        {(props.onClick || props.href) && <Icon name="chevron-right" size={16} />}
      </span>
    </>
  );
  if (props.href)
    return (
      <a class="srow" href={props.href} target="_blank" rel="noopener">
        {inner}
      </a>
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
    <Card id="connections" title="Kết nối" flush note="Để bảo mật, lưu xong app chỉ hiện 2 ký tự cuối, không hiện lại cả khoá.">
      <div class="set-sub">SePay</div>
      <div class="srow srow-stack">
        <span class="srow-t">Chưa có tài khoản SePay?</span>
        <span class="srow-s">SePay báo giao dịch ngân hàng về app, khỏi nhập tay. Đăng ký qua link giới thiệu của Ví nhà.</span>
        <span class="copyrow">
          <a class="btn" href={SEPAY_REGISTER_URL} target="_blank" rel="noopener">
            Đăng ký SePay
          </a>
        </span>
      </div>
      <div class="srow srow-stack">
        <span class="srow-t">Địa chỉ webhook</span>
        <span class="srow-s">Dán địa chỉ này vào mục Webhook trên SePay, mỗi tài khoản đi kèm khoá riêng.</span>
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
                <span class="srow-s">{names.length ? `Nối ${names.length} tài khoản: ${names.join(", ")}` : "Chưa tài khoản nào nối qua đây. Bật Nối SePay ở phần Tài khoản."}</span>
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
      {!ro && <Row title="Thêm kết nối SePay" sub="Mỗi tài khoản SePay một kết nối" onClick={() => open({ kind: "sepay", item: null })} />}

      <div class="set-sub">Telegram</div>
      {secret("telegram_bot_token", "Bot token", "Token của bot nhắc việc, lấy từ @BotFather")}
      {d.members.map((m) => {
        const r = tg[m.id];
        const why = !it.telegram_bot_token.set ? "chưa đặt bot token" : !m.tg_chat_id ? "chưa có chat_id, đặt ở phần Thành viên" : `chat_id ${m.tg_chat_id}`;
        return (
          <div class="srow" key={m.id}>
            <span class="srow-main">
              <span class="srow-t">{m.name}</span>
              <span class={r?.bad ? "srow-s err" : "srow-s"}>{r?.text || why}</span>
            </span>
            <span class="srow-r">
              <button type="button" class="btn btn-ghost" disabled={ro || r?.busy || !m.tg_chat_id || !it.telegram_bot_token.set} onClick={() => void testTelegram(m)}>
                {r?.busy ? "Đang gửi…" : "Gửi thử"}
              </button>
            </span>
          </div>
        );
      })}

      <div class="set-sub">Zalo Bot</div>
      <div class="srow srow-stack">
        <span class="srow-s">
          Tạo bot trong Zalo: tìm “Zalo Bot Manager”, chọn Zalo Bot Creator, đặt tên bot để nhận Bot Token. Dán token ở dưới, tự đặt khoá webhook rồi bấm Đặt webhook. Gói miễn phí: 3.000 tin mỗi tháng, tối đa 50 người.
        </span>
      </div>
      {secret("zalo_bot_token", "Bot token", "Token Zalo gửi khi tạo bot")}
      {secret("zalo_webhook_secret", "Khoá webhook", "Chuỗi tự đặt, Zalo gửi kèm mỗi tin nhắn để app biết tin thật")}
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

/** Tải lại từ SePay: lấy lại giao dịch của một khoảng ngày (giờ VN) khi app lỡ mất; giao dịch đã có không ghi lần hai. */
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
      toast(sepaySyncText(r));
      setErrors(r.errors);
      await refresh(true);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="sepay-sync" title="Tải lại từ SePay" flush note="Lấy lại giao dịch SePay của những ngày app lỡ mất. Giao dịch đã có không bị ghi hai lần. Mỗi lần tối đa 31 ngày.">
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

// ── Trợ lý AI ────────────────────────────────────────

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
      title="Trợ lý AI"
      flush
      note="Mỗi người tự nối bằng mật khẩu riêng, app chỉ thấy những gì người đó thấy. Đổi mật khẩu, tắt thành viên hay Đăng xuất mọi máy cũng tự gỡ kết nối."
    >
      <div class="srow srow-stack">
        <span class="srow-t">Địa chỉ MCP</span>
        <span class="srow-s">
          Trong Claude: Settings › Connectors › Add custom connector › dán địa chỉ này › đăng nhập Ví nhà › chọn Xem hoặc Xem + Ghi. App AI khác có nối MCP cũng dùng địa chỉ này.
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
            right={
              <button type="button" class={confirmRevoke === r.key ? "btn btn-bad" : "btn btn-ghost"} disabled={ro || busy} onClick={() => void revoke(r)}>
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
      note="Áp dụng cho cả nhà. Giao dịch chưa gán kiểm tra mỗi 15 phút (đêm 1–4 giờ: mỗi giờ). Giờ nhắc từ 01:00–04:00 gửi theo lượt mỗi giờ. Rà soát ngân hàng vẫn chạy 02:00, không gửi tin."
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
        if (err instanceof ApiError && err.code === "no_subscription") return { text: "Máy chủ đã gỡ máy này khỏi danh sách nhận tin. Tắt rồi bật lại thông báo.", bad: true };
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
        if (err instanceof ApiError && err.code === "no_subscription") return { text: "Máy chủ đã gỡ máy này khỏi danh sách nhận tin. Tắt rồi bật lại thông báo.", bad: true };
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
        return (
          <>
            <Row title="Máy này không nhận được thông báo" />
            <p class="row-note">{thisDevice} không hỗ trợ thông báo. Tin vẫn tới Telegram, Zalo.</p>
          </>
        );
      case "needs-install":
        return (
          <>
            <Row title="Thêm Ví nhà vào màn hình chính trước" />
            <p class="row-note">iPhone, iPad chỉ nhận thông báo khi mở từ màn hình chính. Trong Safari, bấm Chia sẻ → Thêm vào MH chính, rồi mở Ví nhà từ đó để bật.</p>
          </>
        );
      case "blocked":
        return (
          <>
            <Row title="Thông báo đang bị chặn" />
            <p class="row-note">
              {ios
                ? "Mở Cài đặt của máy → Thông báo → Ví nhà → bật Cho phép thông báo, rồi quay lại đây."
                : "Bấm biểu tượng cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang. App cài trên Android: Cài đặt → Ứng dụng → Ví nhà → Thông báo."}
            </p>
          </>
        );
      case "off":
        return (
          <Row
            title="Chưa bật"
            sub="Tin sáng, tổng kết tuần, nhắc gán"
            right={<span class="srow-v">{busy ? "Đang bật…" : "Bật thông báo"}</span>}
            onClick={!online || busy || !info ? undefined : () => void enable()}
          />
        );
      case "on":
        return (
          <>
            <Row title={`Đang bật cho ${member?.name ?? "người đang dùng"}`} sub={thisDevice} />
            <Row title="Gửi thử" onClick={!online || busy ? undefined : () => void test()} />
            <Row title="Tắt" onClick={!online || busy ? undefined : () => void disable()} />
            <Row
              title={series.title}
              sub={series.sub}
              right={<span class="srow-v">{series.active ? "Huỷ" : "Thử khi tắt app"}</span>}
              onClick={!online || busy || (!series.active && !info) ? undefined : () => void (series.active ? cancelSeries() : startSeries())}
            />
          </>
        );
    }
  })();

  return (
    <Card id="device-notifications" title="Thông báo trên máy này" flush note="Telegram và Zalo nhận tin đầy đủ; các máy bật ở đây nhận tin ngắn với việc cần làm trước. Đổi người hay đăng xuất thì máy này tự tắt.">
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
            sub={`${x.device ?? "Máy không rõ"} · ${lastOkText(x.lastOkAt)}`}
            right={
              <button type="button" class={confirmRemove === x.id ? "btn btn-bad" : "btn btn-ghost"} disabled={!online || busy} onClick={() => remove(x.id)}>
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
  // Khoản gửi kỳ hạn đang dùng lồng ngay dưới mẹ (ADR-140): "Gửi 6 tháng · 100.000.000 ₫" thụt 16px, mẹ "gồm 1 khoản gửi · tổng …".
  const nested = nestAccounts(rows, (a) => ({ id: a.id, name: a.name, balance: a.book_balance ?? 0, parentId: a.active ? (a.parent_account_id ?? null) : null }));
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
      note="Tiền vào tài khoản nối SePay tự về, không cần nhập tay. Tiền ra cũng tự về nếu bật “SePay báo cả tiền ra”, nếu không thì khoản chi vẫn nhập tay."
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
              {nested.map(({ row: a, child, line, sub }) => (
                <tr key={a.id} class={child ? "acct-child" : undefined}>
                  <td>
                    {child ? line : a.name}
                    {sub && <div class="sub-line">{sub}</div>}
                  </td>
                  <td class="l">{ACCOUNT_KIND_LABEL[a.kind]}</td>
                  <td class="l">{bankName(a.bank) ?? "—"}</td>
                  <td class="l num">
                    {a.account_no ?? "—"}
                    {a.sub_account && <div class="sub-line">VA {a.sub_account}</div>}
                  </td>
                  <td class="l">{sepay(a) ?? "ghi tay"}</td>
                  <td class="l">{owner(a)}</td>
                  <td class="num">
                    <Money value={a.opening_balance} unit={false} />
                  </td>
                  <td class="l">{a.active ? "đang dùng" : <span class="chip">ngừng dùng</span>}</td>
                  <EditCell ro={ro} label={`Sửa ${a.name}`} onClick={() => open({ kind: "account", item: a })} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        nested.map(({ row: a, child, line, sub }) => (
          <div key={a.id} class={child ? "acct-child" : undefined}>
            <Row
              title={
                <>
                  {child ? line : a.name} {a.sepay_enabled && <span class="chip">{sepay(a)}</span>} {!a.active && <span class="chip">ngừng dùng</span>}
                </>
              }
              sub={sub ?? `${bankName(a.bank) ?? ACCOUNT_KIND_LABEL[a.kind]} · ${owner(a)}`}
              right={
                <span class="srow-v">
                  <Money value={a.opening_balance} unit={false} />
                  <span class="sub-line">số dư đầu</span>
                </span>
              }
              onClick={ro ? undefined : () => open({ kind: "account", item: a })}
            />
          </div>
        ))
      )}
    </Card>
  );
}

// ── Ba ngăn ──────────────────────────────────────────────────────

/**
 * Hàng mục tiêu (UC-709 AC-36, AC-53; DESIGN §4.5): `Row` tên · số bên phải, chip "Thiếu …" / "Đủ" nhỏ dưới số, một dòng phụ,
 * thanh 2px màu Dự phòng (đủ thì --pos). Mục tiêu của tài khoản chung thụt 16px dưới hàng đầu nhóm. Chưa có tài khoản thật thì
 * bên phải là "Mở tài khoản ›" (chạm hàng mở sheet mục tiêu để gắn / tạo tài khoản).
 */
function GoalRow({ v, off, indent, onClick }: { v: GoalRowView; off: boolean; indent?: boolean; onClick?: () => void }) {
  const full = v.chip?.tone === "ok";
  return (
    <ListRow
      title={
        <>
          {v.name}
          {off && <Chip>ngừng dùng</Chip>}
        </>
      }
      sub={v.sub}
      value={v.needsAccount ? <span class="row-act">Mở tài khoản ›</span> : (v.amount ?? undefined)}
      valueSub={v.chip && <Chip tone={full ? "pos" : "warn"}>{v.chip.text}</Chip>}
      track={v.pct !== null ? { pct: v.pct, pocket: "reserve", tone: full ? "pos" : undefined } : null}
      indent={indent}
      onClick={onClick}
    />
  );
}

/**
 * Ba ngăn (UC-709 AC-35…39, AC-46, AC-48): hàng "Chuyển sang ba ngăn · còn N bước ›" khi đang chuyển đổi, xếp tài khoản vào ngăn
 * (chip "N chưa xác nhận"), mục tiêu Dự phòng nhóm theo tài khoản (nhóm chung có nút Đổi thứ tự) kèm gợi ý "Tạo mục tiêu Trả
 * nợ" từ sổ nợ, nhóm danh mục & hạn mức mềm. Số tiền đều qua bộ định dạng có che số (UC-718).
 */
function Pockets({ d, ro, open }: SectionProps) {
  const snap = useApp().snap;
  const conversion = conversionSettingsRow(snap?.conversion);
  const chip = unconfirmedChip(d.accounts);
  const counts = groupAccountsByPocket(d.accounts, Object.fromEntries(d.accounts.map((a) => [a.id, a.pocket ?? null])))
    .filter((g) => g.accounts.length > 0)
    .map((g) => `${g.label} ${g.accounts.length}`)
    .join(" · ");
  const goalGroups = goalListGroups(d);
  const saving = goalGroups.filter((g) => g.key !== "+off" && g.key !== "+none");
  const loose = goalGroups.filter((g) => g.key === "+none");
  const stopped = goalGroups.filter((g) => g.key === "+off");
  const monthly = operatingGoalRows(d.goals, new Map(snap?.pockets?.operating.goals.map((g) => [g.id, g.monthAmount])));
  const openGoal = (g: ReserveGoal) => (ro ? undefined : () => open({ kind: "goal", item: g }));
  const goalGroupView = (grp: GoalListGroup) => (
    <Fragment key={grp.key}>
      {grp.head && (
        <ListRow
          title={grp.head.name}
          sub={grp.head.meta}
          value={grp.head.balance}
          valueSub={
            grp.reorder && !ro ? (
              <button type="button" class="row-act" onClick={() => open({ kind: "goal-order", accountId: grp.accountId! })}>
                Đổi thứ tự
              </button>
            ) : undefined
          }
        />
      )}
      {grp.goals.map((g) => (
        <GoalRow key={g.id} v={goalRowView(g)} off={!g.active} indent={Boolean(grp.head)} onClick={openGoal(g)} />
      ))}
      {grp.note && <p class="row-note">{grp.note}</p>}
    </Fragment>
  );
  const groups = [...(d.categoryGroups ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.sort - b.sort);
  const debts = useResource<DebtsData>(ro ? null : "/v1/debts");
  const suggestions = debts.data ? debtGoalSuggestions(debts.data.debts, d.goals, dayKey(new Date())) : [];
  return (
    <>
      <Card id="pockets" title="Ba ngăn" flush note="Tiền về tài khoản nào là tiền của ngăn đó. Thẻ tín dụng để ở Vận hành.">
        {conversion && <Row title={conversion} sub="Xếp ngăn, gắn mục tiêu, đối chiếu Tích luỹ" onClick={() => go("convert")} />}
        <Row
          title={
            <>
              Xếp tài khoản vào ngăn {chip && <span class="chip warn">{chip}</span>}
            </>
          }
          sub={counts}
          onClick={ro ? undefined : () => open({ kind: "pockets" })}
        />
      </Card>
      <Card
        id="pocket-goals"
        title="Mục tiêu Dự phòng"
        right={<AddButton ro={ro} label="Thêm" onClick={() => open({ kind: "goal", item: null })} />}
        flush
        note="Số dư một tài khoản lấp lần lượt các mục tiêu theo thứ tự ưu tiên. Khoản trả từ tiền chi tiêu không cần tài khoản riêng."
      >
        {goalGroups.length === 0 && monthly.length === 0 && suggestions.length === 0 && <p class="empty">Chưa có mục tiêu nào.</p>}
        {saving.length > 0 && <div class="list-h">{GOAL_SECTION_LABEL.account}</div>}
        {saving.map(goalGroupView)}
        {loose.length > 0 && <div class="list-h">{GOAL_SECTION_LABEL.none}</div>}
        {loose.map(goalGroupView)}
        {monthly.length > 0 && (
          <div class="list-h">
            <i class="card-head-dot pocket-operating" aria-hidden="true" />
            {GOAL_SECTION_LABEL.operating}
          </div>
        )}
        {monthly.map((r) => (
          <ListRow key={r.goal.id} title={r.goal.name} sub={r.sub} value={r.amount} onClick={openGoal(r.goal)} />
        ))}
        {stopped.length > 0 && <div class="list-h">Ngừng dùng</div>}
        {stopped.map(goalGroupView)}
        {suggestions.length > 0 && <div class="list-h">Gợi ý từ sổ nợ</div>}
        {suggestions.map((s) => (
          <ListRow key={s.debt.id} title={s.text} sub="Nợ ngắn hạn chưa có mục tiêu" onClick={ro ? undefined : () => open({ kind: "goal", item: null, prefill: s.prefill })} />
        ))}
      </Card>
      <Card
        title="Danh mục và hạn mức"
        right={<AddButton ro={ro} label="Thêm nhóm" onClick={() => open({ kind: "group", item: null })} />}
        flush
        note="Hạn mức mềm chỉ để theo dõi, không giữ tiền, không âm, không bù"
      >
        {groups.length === 0 && <p class="empty">Chưa có nhóm danh mục nào.</p>}
        {groups.map((g) => {
          const cats = d.categories.filter((c) => c.groupId === g.id);
          return (
            <Row
              key={g.id}
              title={
                <>
                  {g.name} {!g.active && <span class="chip">ngừng dùng</span>}
                </>
              }
              sub={groupSummary(g, cats.length)}
              onClick={ro ? undefined : () => open({ kind: "group", item: g })}
            />
          );
        })}
      </Card>
    </>
  );
}

// ── 4. Mã chuyển khoản ───────────────────────────────────────────

function Rules({ d, ro, wide, open }: SectionProps) {
  const rows = [...d.rules].sort((a, b) => Number(b.active) - Number(a.active) || a.priority - b.priority);
  // Rule chi cũ chỉ có ví, không danh mục: không còn tự gán (ingest UC-307) — nhắc chọn danh mục.
  const needsCategory = (r: Rule) => r.meaning === "spend" && !r.category_id;
  const target = (r: Rule) => nameOf(d.categories, r.category_id) || "—";
  const streamName = (r: Rule) => (r.meaning === "income" ? nameOf(d.incomeStreams ?? [], r.incomeStreamId) : null);
  return (
    <Card
      id="transfer-codes"
      title="Mã chuyển khoản"
      right={<AddButton ro={ro} label="Thêm mã" onClick={() => open({ kind: "rule", item: null })} />}
      flush
      note="Mã theo quy ước của nhà: ba chữ cái, bắt đầu bằng Q hoặc E (EXE xăng, EMS mua sắm online), ghi trong nội dung chuyển khoản. Giao dịch khớp mã tự gán danh mục; không khớp thì chờ ở màn Gán."
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
                <th class="l">Danh mục</th>
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
                  <td class="l">{needsCategory(r) ? <span class="chip">Cần chọn danh mục</span> : target(r)}</td>
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
                <span class="num">{r.pattern}</span> <span class="chip">{MATCH_LABEL[r.match_type].toLowerCase()}</span> {!r.active && <span class="chip">ngừng dùng</span>}{" "}
                {needsCategory(r) && <span class="chip">Cần chọn danh mục</span>}
              </>
            }
            sub={`${MEANING_LABEL[r.meaning]}${streamName(r) ? ` · ${streamName(r)}` : ""} → ${target(r)}`}
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
      note="Bật Nguồn lương: lương về từ nguồn này sẽ nhắc trích Tích luỹ ở Hôm nay. Chọn nguồn cho mã lương ở Mã chuyển khoản."
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
          sub={streamSummary(s) || undefined}
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
      note="Người thuê không phải thành viên, không đăng nhập. Mỗi tháng lập bản tính ở Tài khoản › Cho thuê: chép tháng trước, sửa số, chốt & gửi."
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
            title="Nguồn thu"
            sub={`Tiền người thuê trả vào nguồn: ${nameOf(d.incomeStreams ?? [], r.incomeStreamId) ?? "chưa chọn"}`}
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
      note="Chạm tên người để đặt mật khẩu riêng, tắt hay bật lại. Telegram: nhắn tin bất kỳ cho bot của nhà, rồi nhắn @userinfobot để lấy số chat_id. Zalo: chạm tên người, bấm Nối Zalo rồi nhắn mã cho bot Zalo của nhà."
    >
      {d.members.map((m) => (
        <Row
          key={m.id}
          title={
            <>
              {m.name} {m.role === "owner" && <span class="chip">chủ hộ</span>} {!m.active && <span class="chip">ngừng dùng</span>}
            </>
          }
          sub={[passwordLine(m), m.zalo_chat_id ? "đã nối Zalo" : null, m.tg_chat_id ? "có Telegram" : null].filter(Boolean).join(" · ")}
          onClick={ro ? undefined : () => open({ kind: "member", item: m })}
        />
      ))}
    </Card>
  );
}

// ── 6. Ngưỡng và tỉ lệ ───────────────────────────────────────────────────

function Params({ d, ro, open }: SectionProps) {
  const c = d.config;
  const edit = ro ? undefined : () => open({ kind: "config" });
  return (
    <Card id="parameters" title="Ngưỡng và tỉ lệ" flush>
      <Row
        title="Ngưỡng tự nhận lương"
        sub="Khoản khớp mẫu lương từ mức này trở lên thì tự ghi; nhỏ hơn thì chờ ở màn Gán"
        right={<span class="srow-v">{c.salary_min_amount ? formatVnd(c.salary_min_amount) : "không ngưỡng"}</span>}
        onClick={edit}
      />
      {/* Bản cài đặt lưu offline từ trước v2.5 thiếu khoá này thì chưa hiện hàng (UC-709 AC-55). */}
      {c.salary_reminder_min !== undefined && (
        <Row
          title="Ngưỡng nhắc trích Tích luỹ"
          sub="Khoản thu không chọn nguồn từ mức này trở lên thì ô “Đây là lương” bật sẵn"
          right={<span class="srow-v">{formatVnd(c.salary_reminder_min)}</span>}
          onClick={edit}
        />
      )}
      {/* Bản cài đặt lưu offline từ trước bản lãi tiền gửi thiếu khoá này thì chưa hiện hàng. */}
      {c.interest_max_amount !== undefined && (
        <Row
          title="Lãi tiền gửi: tự ghi khoản dưới"
          sub="Lãi ngân hàng trả dưới mức này sẽ tự ghi vào tài khoản nhận"
          right={<span class="srow-v">{c.interest_max_amount ? formatVnd(c.interest_max_amount) : "tắt"}</span>}
          onClick={edit}
        />
      )}
      <Row
        title="Phần an tâm"
        sub="Số tháng vận hành muốn có ở Dự phòng, ngoài các mục tiêu"
        right={<span class="srow-v">{c.safety_fund_months} tháng</span>}
        onClick={edit}
      />
      {/* Bản cài đặt lưu offline từ trước ngày lương (ADR-118) thiếu khoá này thì chưa hiện hàng. */}
      {c.payday_day !== undefined && (
        <Row title="Ngày lương" sub="Thẻ Vận hành ở Hôm nay đếm ngược tới ngày này; tháng ít ngày hơn lấy ngày cuối tháng" right={<span class="srow-v">ngày {c.payday_day}</span>} onClick={edit} />
      )}
      {/* Bản cài đặt lưu offline từ trước v2 thiếu khoá này thì chưa hiện hàng. */}
      {c.savings_pct !== undefined && <Row title="% Tích luỹ khi lương về" sub="Số gợi ý trích sang Tích luỹ khi lương về" right={<span class="srow-v">{c.savings_pct}%</span>} onClick={edit} />}
      {/* Bản cài đặt lưu offline từ trước Đợt C thiếu khoá dư cuối tháng thì chưa hiện hai hàng này. */}
      {c.surplus_savings_pct !== undefined && (
        <>
          <Row title="Dư cuối tháng vào Tích luỹ (%)" sub="Phần còn lại vào Ví Thưởng khi chia dư tháng vừa hết" right={<span class="srow-v">{c.surplus_savings_pct}%</span>} onClick={edit} />
          <Row
            title="Ví Thưởng"
            sub="Tài khoản ngăn Dự phòng nhận phần dư cuối tháng; chưa chọn thì phần đó ở lại Vận hành"
            right={<span class="srow-v">{c.surplus_reward_account ? (nameOf(d.accounts, c.surplus_reward_account) ?? c.surplus_reward_account) : "Chưa chọn"}</span>}
            onClick={edit}
          />
        </>
      )}
      {/* Bản cài đặt lưu offline từ trước 0031 thiếu các khoá fi_* thì chưa hiện hàng này. */}
      {c.fi_safety_months !== undefined && (
        <Row title="Báo cáo" sub={fiConfigSummary(c)} right={<Icon name="chevron-right" size={16} />} onClick={ro ? undefined : () => open({ kind: "fi-config" })} />
      )}
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
      note="50 thay đổi gần nhất: ai làm, qua đâu, lúc nào. Thấy máy lạ hay khoá bị đổi thì gỡ ngay và đổi mật khẩu."
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
          return <Row key={e.id} title={v.title} sub={v.fields ? `${v.sub} · ${v.fields}` : v.sub} />;
        })
      )}
    </Card>
  );
}

/**
 * Cập nhật Ví nhà (UC-709 AC-30): hỏi GitHub bản phát hành mới nhất **chỉ khi bấm**, rồi chỉ cách cập nhật theo cách đã cài —
 * nút Deploy: mở workflow "Cập nhật Ví nhà" trong repo của nhà; cài bằng lệnh: lệnh để chạy trên máy. Không cần cài đặt đã tải.
 */
function AppUpdate() {
  const { online } = useApp();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateView | "error" | null>(null);

  async function check() {
    setBusy(true);
    try {
      const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
      const latest = res.ok ? releaseTag(await res.json()) : null;
      setResult((latest && updateView(__APP_VERSION__, latest, __INSTALL__)) || "error");
    } catch {
      setResult("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="app-update" title="Cập nhật Ví nhà" flush note="Ví nhà chỉ hỏi GitHub bản mới nhất khi bạn bấm Kiểm tra. Cập nhật không đụng tới số liệu của nhà.">
      {__APP_VERSION__ ? (
        <div class="field" style={{ borderTop: 0 }}>
          <span class="k">Đang chạy bản {__APP_VERSION__}</span>
          <button type="button" class="btn" disabled={!online || busy} onClick={() => void check()}>
            {busy ? "Đang kiểm tra…" : "Kiểm tra bản mới"}
          </button>
        </div>
      ) : (
        <Row title="Bản phát triển, cập nhật bằng git." />
      )}
      {result === "error" && (
        <div class="srow">
          <span class="srow-s err">Chưa kiểm tra được. Thử lại sau.</span>
        </div>
      )}
      {result && result !== "error" && result.state === "latest" && <Row title={result.text} />}
      {result && result !== "error" && result.state === "newer" && (
        <div class="srow srow-stack">
          <span class="srow-t">{result.text}</span>
          {result.action.kind === "workflow" && <span class="srow-s">Trên GitHub bấm Run workflow, rồi bấm Run workflow lần nữa. Vài phút sau Cloudflare cài xong bản mới.</span>}
          {result.action.kind === "actions-hint" && <span class="srow-s">Mở repo Ví nhà của bạn trên GitHub › Actions › Cập nhật Ví nhà › Run workflow.</span>}
          {result.action.kind === "command" && (
            <>
              <span class="srow-s">Trong thư mục vi-nha trên máy, chạy:</span>
              <span class="copyrow">
                <code class="num">{result.action.command}</code>
                <button type="button" class="btn" onClick={() => void copyText(UPDATE_COMMAND, "lệnh cập nhật")} aria-label="Chép lệnh cập nhật">
                  <Icon name="copy" size={16} />
                  Chép
                </button>
              </span>
            </>
          )}
          <span class="copyrow" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            {result.action.kind === "workflow" && (
              <a class="btn btn-primary" href={result.action.url} target="_blank" rel="noopener">
                Cập nhật
              </a>
            )}
            <a class="btn" href={result.notesUrl} target="_blank" rel="noopener">
              Xem có gì mới
            </a>
            <a class="btn" href={UPDATE_GUIDE_URL} target="_blank" rel="noopener">
              Hướng dẫn cập nhật
            </a>
          </span>
        </div>
      )}
    </Card>
  );
}

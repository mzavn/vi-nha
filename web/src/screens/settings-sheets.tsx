// Các sheet sửa của màn Cài đặt. Kiểm tra form và dựng thân yêu cầu nằm ở lib/settings.ts (có test);
// ở đây chỉ vẽ ô nhập, gửi, và hiện lỗi server nguyên văn (server trả câu tiếng Việt).

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BANKS, bankByCode } from "../../../src/domain/banks";
import { DEFAULT_PAYDAY_DAY } from "../../../src/domain/snapshot";
import { api, errorText } from "../lib/api";
import { goalAccountRequest, goalCreateRequest, type GoalAccountResult } from "../lib/convert";
import { groupPayload, groupToForm, OUTSIDE_LABEL, POCKET_LABEL, POCKET_ORDER, type PocketChoice, pocketsPayload } from "../lib/pockets";
import {
  ACCOUNT_KIND_LABEL,
  accountGoals,
  accountParentField,
  accountParentHint,
  accountParentOptions,
  canAddDeposit,
  TAX_OWN_ACCOUNT,
  GOAL_PLACE_LABEL,
  goalPlace,
  OPERATING_HINT,
  operatingChoice,
  parentPocketText,
  PLACE_LABEL,
  pocketSheetGroups,
  POCKETS_SHEET_HEAD,
  sliderPct,
  type AccountForm,
  accountPayload,
  accountSubmitError,
  accountToForm,
  bankHint,
  canSetOwner,
  canSetPrivate,
  clearSecretPayload,
  configPayload,
  connectionPicker,
  type FeedMode,
  feedFromSuggestion,
  feedFromText,
  type FiConfigForm,
  fiConfigPayload,
  fiConfigToForm,
  type Errors,
  GOAL_MODE_LABEL,
  GOAL_POCKET_LOCK,
  goalAccountNote,
  goalAccountOptions,
  type GoalForm,
  goalOrderError,
  goalOrderPayload,
  goalOrderPreview,
  goalPayload,
  goalSubmitError,
  goalToForm,
  followsCodeConvention,
  isoFromVnInput,
  MATCH_LABEL,
  MEANING_LABEL,
  linkCodeLeft,
  memberPayload,
  OPENS_CYCLE_HINT,
  normalizePattern,
  notifyPayload,
  type Result,
  rewardAccountOptions,
  rulePayload,
  ruleToForm,
  secretLabel,
  secretPayload,
  sepayConnectionPayload,
  type SepayConnectionForm,
  sepayOutDefault,
  sepayOutHint,
  streamPayload,
  streamToForm,
  vnDateTimeInput,
  WEEKDAY_LABEL,
} from "../lib/settings";
import { memberSubmitError, newMemberPayload, passwordPayload, proofMode } from "../lib/members";
import { dateText } from "../lib/net-worth";
import { rentalConfigPayload, tenantPayload } from "../lib/rental";
import type {
  CategoryGroup,
  DebtsData,
  IncomeStream,
  NotifySchedule,
  Pocket,
  Rental,
  Rule,
  Secret,
  SecretKey,
  SendTestResult,
  SepayConnection,
  SepaySecretKey,
  ReserveGoal,
  SettingsAccount,
  SettingsConfig,
  SettingsData,
  SettingsMember,
  TenantSummary,
  ZaloLinkCode,
} from "../lib/types";
import { signedOut, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { NeedsNetwork, Seg, Sheet } from "../ui/parts";
import { useResource } from "../state/resource";
import { SavingsSlider } from "../ui/savings-slider";
import { SAVINGS_SCALE_TEXT } from "../lib/savings-scale";

type Saved = (toastText: string) => Promise<void>;

/**
 * Gửi một yêu cầu: chặn bấm hai lần, giữ lỗi server để hiện trên nút. `mapError`: lỗi server nào thuộc ô nào
 * (vd trùng tên → ô Tên) — có ô thì hiện dưới ô đó thay vì trên nút.
 */
function useSubmit(onSaved: Saved, onClose: () => void, mapError?: (err: unknown) => { field: string | null; message: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  async function run<T>(result: Result<T>, send: (body: T) => Promise<unknown>, toastText: string) {
    if (!result.ok) {
      setErrors(result.errors);
      setError("Còn ô chưa đúng, xem dòng đỏ.");
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await send(result.value);
      await onSaved(toastText);
      onClose();
    } catch (err) {
      const mapped = mapError?.(err);
      if (mapped?.field) setErrors({ [mapped.field]: mapped.message });
      else setError(mapped?.message ?? errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, errors, run };
}

/** Một hàng field: nhãn trái, ô phải, lỗi ngay dưới hàng. Dùng chung với màn Thiết lập. */
export function Field(props: { id: string; label: string; error?: string; wrap?: boolean; first?: boolean; children: ComponentChildren }) {
  const style = { ...(props.wrap ? { flexWrap: "wrap" as const } : {}), ...(props.first ? { borderTop: 0 } : {}) };
  return (
    <>
      <div class="field" style={style}>
        <label for={props.id}>{props.label}</label>
        {props.children}
      </div>
      {props.error && (
        <p class="err ferr" id={`${props.id}-err`}>
          {props.error}
        </p>
      )}
    </>
  );
}

export function Hint({ children }: { children: ComponentChildren }) {
  return <p class="fhint">{children}</p>;
}

export function Check(props: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; error?: string; disabled?: boolean }) {
  return (
    <>
      <div class="field">
        <label class="check" for={props.id} style={{ color: props.disabled ? "var(--fg-2)" : "var(--fg)" }}>
          <input id={props.id} type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.checked)} />
          {props.label}
        </label>
      </div>
      {props.error && <p class="err ferr">{props.error}</p>}
    </>
  );
}

function Footer(props: { busy: boolean; error: string | null; label: string; onSubmit: () => void; children?: ComponentChildren }) {
  const { online } = useApp();
  return (
    <div class="pad">
      {props.error && (
        <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
          {props.error}
        </p>
      )}
      <button type="button" class="btn btn-primary btn-wide" disabled={!online || props.busy} onClick={props.onSubmit}>
        {props.busy ? "Đang lưu…" : props.label}
      </button>
      {props.children}
      {!online && <NeedsNetwork what="Lưu cài đặt" />}
    </div>
  );
}

/** aria cho ô bị lỗi; `id` là id của ô, lỗi nằm ở `${id}-err` (xem Field). */
export const invalid = (errors: Errors, key: string, id: string) => (errors[key] ? { "aria-invalid": "true" as const, "aria-describedby": `${id}-err` } : {});

/** Danh mục ngân hàng cho ô chọn: nhóm có SePay trước, ghi tay sau. */
export function BankOptions() {
  return (
    <>
      <optgroup label="Có SePay">
        {BANKS.filter((b) => b.sepay).map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Ghi tay">
        {BANKS.filter((b) => !b.sepay).map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </optgroup>
    </>
  );
}

// ── Tài khoản ─────────────────────────────────────────────────────

/** Lời dặn dưới hàng "SePay theo dõi từ" (ADR-113). */
const FEED_HINT: Record<FeedMode, string> = {
  enabled:
    "Sổ đã có giao dịch của tài khoản này (nhập tay, hay ghi từ tài khoản kia): app chỉ nhận giao dịch SePay từ lúc bật, khoản trước đó không về lần nữa. Tài khoản chưa có gì trong sổ thì app lấy cả lịch sử từ ngày số dư đầu.",
  opening: "App nhận mọi giao dịch SePay từ ngày số dư đầu — chọn khi các khoản đó chưa có trong sổ.",
  time: "Giao dịch SePay trước giờ này coi như đã có trong sổ, app bỏ qua; khoản trước giờ này nhập tay được.",
};

/**
 * Thêm / sửa tài khoản. `preset`: điền sẵn khi thêm (vd "Tạo tài khoản mới" cho mục tiêu: tên mục tiêu, ngăn Dự phòng; "+ Thêm
 * khoản gửi kỳ hạn": mẹ); `create`: thêm theo đường khác thay POST /v1/settings/accounts — "Tạo tài khoản mới" cho mục tiêu gửi
 * một yêu cầu tạo và gắn (pocket UC-1208 bước 2.2, UC-1209 bước 8), hoặc giữ thân để sheet mục tiêu gửi sau; `toast` dựng câu
 * báo theo tên. `onAddDeposit`: nút "+ Thêm khoản gửi kỳ hạn" khi tài khoản đang sửa làm mẹ được (ADR-140, UC-709 AC-51).
 * Lỗi thì sheet giữ nguyên các ô, Lưu lại gửi lại đúng thân đó (cùng tên → cùng mã, không sinh tài khoản thứ hai).
 */
export function AccountSheet({
  d,
  item,
  preset,
  create,
  onAddDeposit,
  onClose,
  onSaved,
}: {
  d: SettingsData;
  item: SettingsAccount | null;
  preset?: Partial<AccountForm>;
  create?: { send: (body: Record<string, unknown>) => Promise<void>; toast: (name: string) => string };
  onAddDeposit?: (parent: SettingsAccount) => void;
  onClose: () => void;
  onSaved: Saved;
}) {
  const [f, setF] = useState(() => ({ ...accountToForm(item), ...preset }));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, accountSubmitError);
  const isNew = !item;
  const e = (k: string) => ({ id: `a-${k}`, error: errors[k] });
  // Công tắc Riêng tư (access UC-504): chỉ chủ tài khoản (theo chủ đã lưu) thấy và đổi.
  const me = useApp().member?.id ?? null;
  const showPrivate = canSetPrivate(item, me);
  // Tài khoản riêng tư của người khác: ô Chủ tài khoản chỉ đọc (UC-709 AC-47).
  const ownerLocked = !canSetOwner(item, me);
  // Tài khoản của mục tiêu đang dùng: ngăn khoá ở Dự phòng (UC-1209 bước 3, server 409 `account_has_goal`).
  const goalNames = item ? accountGoals(item.id, d.goals).map((g) => g.name).join(", ") : "";
  const goal = goalNames ? { name: goalNames } : undefined;
  // Khoản gửi kỳ hạn (ADR-140): ô "Thuộc tài khoản" chỉ với tài khoản ngân hàng; tài khoản đang là mẹ không có ô.
  const reward = d.config.surplus_reward_account;
  const parentField = f.kind === "bank" ? accountParentField(item, d.accounts, d.goals, reward) : { show: false, disabled: null };
  const parentOptions = accountParentOptions(d.accounts, item, reward);
  const parent = f.parent_account_id ? (d.accounts.find((a) => a.id === f.parent_account_id) ?? { id: f.parent_account_id, name: f.parent_account_id }) : null;
  function submit() {
    const name = f.name.trim();
    const tail = !f.sepay_enabled
      ? ""
      : f.sepay_out
        ? " Tiền vào và tiền ra của tài khoản này giờ tự về từ ngân hàng."
        : " Tiền vào tài khoản này giờ tự về từ ngân hàng; khoản chi từ nó vẫn nhập tay.";
    void run(
      // Chỉ gửi kết nối khi có ô "Nối qua"; một kết nối thì server tự dùng nó.
      accountPayload({ ...f, sepay_connection_id: picker?.value ?? "" }, item, me),
      async (body) => {
        if (!isNew) return api.patch(`/v1/settings/accounts/${encodeURIComponent(item.id)}`, body);
        if (create) return create.send(body);
        await api.post<SettingsAccount>("/v1/settings/accounts", body);
      },
      isNew && create ? create.toast(name) : `${isNew ? "Đã thêm" : "Đã lưu"} tài khoản ${name}.${tail}`,
    );
  }
  const catalogBank = f.kind === "bank" || f.kind === "credit";
  const bank = bankByCode(f.bank);
  // SePay chỉ bật được cho ngân hàng SePay hỗ trợ; đang bật sẵn (tài khoản cũ) thì vẫn tắt được.
  const sepayLocked = !bank?.sepay && !f.sepay_enabled;
  const pickBank = (code: string) => set({ bank: code, ...(f.sepay_enabled ? { sepay_out: sepayOutDefault(code) } : {}) });
  const picker = f.kind === "bank" ? connectionPicker(d.integrations.sepay_connections ?? [], f.sepay_connection_id, item?.sepay_connection_id ?? "") : null;
  // Mốc theo dõi SePay (ADR-113): chỉ khi sửa tài khoản; "Lúc bật" chỉ có nghĩa khi đang bật SePay ở lần lưu này.
  const feedSuggestion = feedFromSuggestion(item);
  const feedOptions: { value: FeedMode; label: string }[] = [
    ...(f.sepay_enabled && !item?.sepay_enabled ? [{ value: "enabled" as const, label: "Lúc bật" }] : []),
    { value: "opening", label: "Ngày số dư đầu" },
    { value: "time", label: "Giờ tuỳ chọn" },
  ];

  return (
    <Sheet open title={isNew ? "Thêm tài khoản" : `Sửa ${item.name}`} onClose={onClose}>
      <Field {...e("name")} label="Tên" first>
        <input id="a-name" class="ctl" value={f.name} maxLength={60} placeholder="MB (vợ)" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "a-name")} />
      </Field>
      <Field id="a-kind" label="Loại" wrap>
        <Seg
          label="Loại tài khoản"
          value={f.kind}
          onChange={(kind) =>
            set({
              kind,
              ...(kind !== "bank" ? { sepay_enabled: false, sepay_out: false, parent_account_id: "" } : {}),
              // Ngân hàng/thẻ chọn trong danh mục, ví điện tử gõ tên: đổi qua lại thì bỏ giá trị cũ.
              ...((kind === "ewallet") !== (f.kind === "ewallet") ? { bank: "" } : {}),
            })
          }
          options={(Object.keys(ACCOUNT_KIND_LABEL) as SettingsAccount["kind"][]).map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))}
        />
      </Field>
      {parentField.show && (
        <>
          <Field {...e("parent_account_id")} label="Thuộc tài khoản">
            <select
              id="a-parent_account_id"
              class="ctl"
              value={f.parent_account_id}
              disabled={parentField.disabled !== null}
              onChange={(ev) => set({ parent_account_id: ev.currentTarget.value, ...(ev.currentTarget.value ? { sepay_enabled: false, sepay_out: false } : {}) })}
            >
              <option value="">Không</option>
              {parent && !parentOptions.some((a) => a.id === parent.id) && <option value={parent.id}>{parent.name} (không còn chọn được)</option>}
              {parentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Hint>{parentField.disabled ?? accountParentHint(parent?.name ?? "tài khoản mẹ")}</Hint>
        </>
      )}
      {goal && <Hint>Tài khoản của mục tiêu {goal.name}</Hint>}
      <Field id="a-pocket" label="Ngăn">
        {parent ? (
          <span id="a-pocket">{parentPocketText(parent.name)}</span>
        ) : goal ? (
          <span id="a-pocket">{POCKET_LABEL.reserve}</span>
        ) : (
          <PocketSelect id="a-pocket" value={f.pocket} onChange={(p) => set({ pocket: p, pocket_touched: true })} />
        )}
      </Field>
      {!parent && (
        <Hint>
          {goal
            ? `${GOAL_POCKET_LOCK}.`
            : `Tiền về tài khoản nào là tiền của ngăn đó. Thẻ tín dụng để ở Vận hành.${item && item.pocket_confirmed === false ? " Ngăn này app mới đề xuất — lưu là xác nhận." : ""}`}
        </Hint>
      )}
      {f.kind !== "cash" && (
        <>
          <Field {...e("bank")} label={f.kind === "ewallet" ? "Nhà cung cấp" : "Ngân hàng"}>
            {catalogBank ? (
              <select id="a-bank" class="ctl" value={f.bank} onChange={(ev) => pickBank(ev.currentTarget.value)}>
                <option value="">Chọn ngân hàng</option>
                {f.bank && !bank && <option value={f.bank}>{f.bank} (tên cũ — chọn lại)</option>}
                <BankOptions />
              </select>
            ) : (
              <input id="a-bank" class="ctl" value={f.bank} maxLength={40} placeholder="MoMo" onInput={(ev) => set({ bank: ev.currentTarget.value })} />
            )}
          </Field>
          {catalogBank && bankHint(f.bank) && <Hint>{bankHint(f.bank)}</Hint>}
          <Field {...e("account_no")} label="Số tài khoản">
            <input
              id="a-account_no"
              class="ctl num"
              inputMode="numeric"
              autocomplete="off"
              value={f.account_no}
              maxLength={30}
              onInput={(ev) => set({ account_no: ev.currentTarget.value })}
              {...invalid(errors, "account_no", "a-account_no")}
            />
          </Field>
        </>
      )}
      {f.kind === "bank" && !parent && (
        <>
          <Check
            id="a-sepay"
            label="Nối SePay"
            checked={f.sepay_enabled}
            disabled={sepayLocked}
            onChange={(v) => set({ sepay_enabled: v, sepay_out: v && sepayOutDefault(f.bank) })}
            error={errors.sepay_enabled}
          />
          <Hint>
            Chiều tiền SePay báo về thì không nhập tay được — nhập thêm là đếm một khoản hai lần. Tiền vào luôn tự về; tiền ra chỉ tự về khi bật “SePay báo cả tiền ra”.
          </Hint>
          {f.sepay_enabled && (
            <>
              {picker && (
                <Field id="a-sepay-conn" label="Nối qua">
                  <select id="a-sepay-conn" class="ctl" value={picker.value} onChange={(ev) => set({ sepay_connection_id: ev.currentTarget.value })}>
                    {picker.options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.active ? c.name : `${c.name} (đã tắt)`}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Check id="a-sepay-out" label="SePay báo cả tiền ra" checked={f.sepay_out} onChange={(v) => set({ sepay_out: v })} />
              <Hint>{sepayOutHint(f.bank)}</Hint>
              <Field {...e("sub_account")} label="Tài khoản ảo (VA)">
                <input
                  id="a-sub_account"
                  class="ctl num"
                  autocomplete="off"
                  value={f.sub_account}
                  maxLength={30}
                  placeholder={bank?.sepay?.vaRequired ? "số VA trên SePay" : "không bắt buộc"}
                  onInput={(ev) => set({ sub_account: ev.currentTarget.value })}
                />
              </Field>
              {!isNew && (
                <>
                  <Field id="a-feed" label="SePay theo dõi từ" wrap error={errors.feed_from}>
                    <Seg
                      label="SePay theo dõi từ"
                      value={f.feed_mode}
                      onChange={(feed_mode) => set({ feed_mode, ...(feed_mode === "time" && !f.feed_from ? { feed_from: feedSuggestion ?? "" } : {}) })}
                      options={feedOptions}
                    />
                  </Field>
                  {f.feed_mode === "time" && (
                    <Field id="a-feed-at" label="Giờ bắt đầu (giờ VN)">
                      <input
                        id="a-feed-at"
                        class="ctl"
                        type="datetime-local"
                        step={1}
                        value={vnDateTimeInput(f.feed_from)}
                        onInput={(ev) => set({ feed_from: isoFromVnInput(ev.currentTarget.value) })}
                      />
                    </Field>
                  )}
                  <Hint>{FEED_HINT[f.feed_mode]}</Hint>
                  {feedSuggestion && f.feed_mode !== "time" && (
                    <Hint>
                      Giao dịch SePay sớm nhất của tài khoản này lúc {feedFromText(feedSuggestion)}, sau ngày số dư đầu — có vẻ tài khoản nối SePay khi sổ đã ghi các
                      khoản trước đó. Đặt mốc lúc đó để rà soát đêm hay Đồng bộ lại không đưa chúng về lần nữa.{" "}
                      <button type="button" class="btn btn-ghost" onClick={() => set({ feed_mode: "time", feed_from: feedSuggestion })}>
                        Đặt mốc lúc đó
                      </button>
                    </Hint>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <Field id="a-owner" label="Chủ tài khoản">
        {parent ? (
          <span id="a-owner">{parentPocketText(parent.name)}</span>
        ) : ownerLocked ? (
          <span id="a-owner">{d.members.find((m) => m.id === f.owner_member_id)?.name ?? f.owner_member_id}</span>
        ) : (
          <select id="a-owner" class="ctl" value={f.owner_member_id} onChange={(ev) => set({ owner_member_id: ev.currentTarget.value })}>
            <option value="">Chung</option>
            {d.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {parent && <Hint>Khoản gửi kỳ hạn theo {parent.name}: cùng ngăn, cùng chủ, cùng riêng tư.</Hint>}
      {!parent && ownerLocked && <Hint>Tài khoản riêng tư: chỉ chủ tài khoản đổi được chủ.</Hint>}
      {!parent && showPrivate && (
        <>
          <Check id="a-private" label="Riêng tư — người khác chỉ thấy tổng" checked={f.private} onChange={(v) => set({ private: v })} />
          <Hint>Người khác vẫn thấy số dư, không thấy từng khoản chi.</Hint>
        </>
      )}
      <Field id="a-opening" label="Số dư đầu">
        <AmountInput id="a-opening" value={f.opening_balance} onChange={(n) => set({ opening_balance: n })} />
      </Field>
      <Field id="a-opened" label="Số dư đầu tính tới ngày" error={errors.opened_at}>
        <input id="a-opened" class="ctl" type="date" value={f.opened_at} onInput={(ev) => set({ opened_at: ev.currentTarget.value })} />
      </Field>
      <Hint>Giao dịch ngân hàng trước ngày này đã nằm trong số dư đầu, app bỏ qua.</Hint>
      {!isNew && <Check id="a-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      {!isNew && !f.active && goal && <Hint>Tài khoản của mục tiêu {goal.name}: bỏ gắn hoặc tắt mục tiêu trước khi tắt tài khoản.</Hint>}
      {!isNew && !f.active && (
        <Hint>
          Ngừng dùng thì tài khoản không còn hiện ở chỗ chọn; lịch sử vẫn giữ nguyên.
          {item.deactivated_at ? ` Đã tắt từ ${dateText(item.deactivated_at)} — bảng cân đối vẫn tính nó ở các tháng trước ngày đó.` : " Bảng cân đối vẫn tính nó ở các tháng trước ngày tắt."}
        </Hint>
      )}
      {item && onAddDeposit && item.active && canAddDeposit(item, d.accounts, reward) && (
        <div class="pad">
          <button type="button" class="btn" onClick={() => onAddDeposit(item)}>
            <Icon name="plus" size={16} />
            Thêm khoản gửi kỳ hạn
          </button>
        </div>
      )}
      <Footer busy={busy} error={error} label={isNew && create && error ? "Lưu lại" : isNew ? "Thêm tài khoản" : "Lưu tài khoản"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Mã chuyển khoản ───────────────────────────────────────────────

export function RuleSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: Rule | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => ruleToForm(item));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  const pattern = normalizePattern(f.match_type, f.pattern);
  const e = (k: string) => ({ id: `r-${k}`, error: errors[k] });

  function submit() {
    const category = f.meaning === "spend" ? d.categories.find((c) => c.id === f.category_id)?.name : undefined;
    void run(
      rulePayload(f, isNew),
      (body) => (isNew ? api.post("/v1/rules", body) : api.patch(`/v1/settings/rules/${item.id}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} ${MATCH_LABEL[f.match_type].toLowerCase()} ${pattern}.${f.active && category ? ` Giao dịch mới khớp sẽ tự vào ${category}.` : ""}`,
    );
  }

  return (
    <Sheet open title={isNew ? "Thêm mã chuyển khoản" : `Sửa ${pattern}`} onClose={onClose}>
      <Seg
        class="pad"
        label="Khớp theo"
        value={f.match_type}
        onChange={(match_type) => set({ match_type })}
        options={(Object.keys(MATCH_LABEL) as Rule["match_type"][]).map((k) => ({ value: k, label: MATCH_LABEL[k] }))}
      />
      <Field {...e("pattern")} label={MATCH_LABEL[f.match_type]}>
        <input
          id="r-pattern"
          class="ctl num"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck={false}
          maxLength={40}
          placeholder={f.match_type === "code" ? "EXE" : f.match_type === "content" ? "SHOPEE" : "0888123456"}
          value={f.pattern}
          onInput={(ev) => set({ pattern: f.match_type === "code" ? ev.currentTarget.value.toUpperCase() : ev.currentTarget.value })}
          {...invalid(errors, "pattern", "r-pattern")}
        />
      </Field>
      {f.match_type === "code" && pattern && !errors.pattern && !followsCodeConvention(pattern) && <Hint>Mã nhà đang dùng có dạng Exx hoặc Qxx (ba ký tự). Mã khác vẫn lưu được.</Hint>}
      {f.match_type === "content" && <Hint>So với nội dung chuyển khoản đã bỏ dấu, viết hoa: "đổ xăng" khớp mẫu XANG.</Hint>}
      {f.match_type === "account" && <Hint>Số tài khoản bên kia của giao dịch.</Hint>}
      <Field id="r-meaning" label="Nghĩa" wrap>
        <Seg
          label="Nghĩa của giao dịch"
          value={f.meaning}
          onChange={(meaning) => set({ meaning })}
          options={(Object.keys(MEANING_LABEL) as Rule["meaning"][]).map((k) => ({ value: k, label: MEANING_LABEL[k] }))}
        />
      </Field>
      {f.meaning === "income" && <Hint>Khoản khớp mẫu lương từ ngưỡng tự nhận lương trở lên thì tự ghi; nguồn bật “Mở kỳ lương” thì lương về mở kỳ lương.</Hint>}
      {f.meaning === "income" && !isNew && (
        <>
          <Field id="r-stream" label="Nguồn thu">
            <select id="r-stream" class="ctl" value={f.income_stream_id} onChange={(ev) => set({ income_stream_id: ev.currentTarget.value })}>
              <option value="">Không nguồn (không mở kỳ lương)</option>
              {(d.incomeStreams ?? [])
                .filter((s) => s.active || s.id === f.income_stream_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Hint>Khoản thu khớp mã này gắn nguồn đã chọn.</Hint>
        </>
      )}
      {f.meaning === "spend" && (
        <Field {...e("category_id")} label="Danh mục">
          <select
            id="r-category_id"
            class="ctl"
            value={f.category_id}
            onChange={(ev) => set({ category_id: ev.currentTarget.value })}
            {...invalid(errors, "category_id", "r-category_id")}
          >
            <option value="">Chọn danh mục</option>
            {d.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!isNew && (
        <Field id="r-by" label="Người chi">
          <select id="r-by" class="ctl" value={f.by_member_id} onChange={(ev) => set({ by_member_id: ev.currentTarget.value })}>
            <option value="">Không rõ</option>
            {d.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field {...e("priority")} label="Ưu tiên">
        <input id="r-priority" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={f.priority} onInput={(ev) => set({ priority: ev.currentTarget.value })} {...invalid(errors, "priority", "r-priority")} />
      </Field>
      <Hint>Nhiều mẫu cùng khớp thì mẫu có số ưu tiên nhỏ hơn thắng.</Hint>
      {!isNew && <Check id="r-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      {!isNew && !f.active && <Hint>Ngừng dùng thì giao dịch mới không còn tự gán theo mẫu này; giao dịch cũ giữ nguyên.</Hint>}
      <Footer busy={busy} error={error} label={isNew ? "Thêm mã" : "Lưu mã"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Thành viên ────────────────────────────────────────────────────

export function MemberSheet({
  item,
  self,
  zaloReady,
  onPassword,
  onClose,
  onSaved,
}: {
  item: SettingsMember;
  /** Người này là người đang dùng máy. */
  self: boolean;
  zaloReady: boolean;
  onPassword: () => void;
  onClose: () => void;
  onSaved: Saved;
}) {
  const [f, setF] = useState({ name: item.name, tg_chat_id: item.tg_chat_id ?? "" });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);

  function submit() {
    const r = memberPayload(f, item);
    if (r.ok && Object.keys(r.value).length === 0) return onClose();
    void run(r, (body) => api.patch(`/v1/settings/members/${encodeURIComponent(item.id)}`, body), `Đã lưu ${f.name.trim()}.`);
  }

  return (
    <Sheet open title={`Sửa ${item.name}`} onClose={onClose}>
      <Field id="m-name" label="Tên" error={errors.name} first>
        <input id="m-name" class="ctl" value={f.name} maxLength={40} onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "m-name")} />
      </Field>
      <Field id="m-tg_chat_id" label="Telegram chat_id" error={errors.tg_chat_id}>
        <input
          id="m-tg_chat_id"
          class="ctl num"
          inputMode="text"
          autocomplete="off"
          spellcheck={false}
          placeholder="123456789"
          value={f.tg_chat_id}
          onInput={(ev) => setF({ ...f, tg_chat_id: ev.currentTarget.value })}
          {...invalid(errors, "tg_chat_id", "m-tg_chat_id")}
        />
      </Field>
      <Hint>Nhắn một tin bất kỳ cho bot của nhà, rồi nhắn @userinfobot để lấy chat_id. Để trống là không nhận tin nhắc.</Hint>
      <ZaloLink member={item} ready={zaloReady} onClose={onClose} onSaved={onSaved} />
      <div class="set-sub">Mật khẩu</div>
      <div class="field">
        <span class="k">{item.has_password ? "Đang dùng mật khẩu riêng" : "Đang dùng mật khẩu chung"}</span>
        <button type="button" class="btn" onClick={onPassword}>
          {item.has_password ? "Đổi / gỡ" : "Đặt mật khẩu riêng"}
        </button>
      </div>
      <MemberActive member={item} self={self} onClose={onClose} onSaved={onSaved} />
      <Footer busy={busy} error={error} label="Lưu" onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Tắt / bật lại một người (UC-507 AC-12): hỏi lại một lần trước khi làm. Tắt chính mình thì máy này về màn đăng nhập
 * (server đã xoá phiên). Chủ hộ không tắt được.
 */
function MemberActive({ member, self, onClose, onSaved }: { member: SettingsMember; self: boolean; onClose: () => void; onSaved: Saved }) {
  const { online } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const turningOff = member.active;
  if (turningOff && member.role === "owner") {
    return (
      <>
        <div class="set-sub">Đang dùng</div>
        <Hint>{member.name} là chủ hộ, luôn đang dùng — không tắt được.</Hint>
      </>
    );
  }

  async function toggle() {
    if (!confirm) return setConfirm(true);
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/v1/settings/members/${encodeURIComponent(member.id)}`, { active: !turningOff });
      if (turningOff && self) {
        onClose();
        toast(`Đã tắt ${member.name}. Máy này đã đăng xuất.`);
        await signedOut();
        return;
      }
      await onSaved(turningOff ? `Đã tắt ${member.name}. Mọi máy của ${member.name} đã đăng xuất.` : `Đã bật lại ${member.name}.`);
      onClose();
    } catch (err) {
      setMsg(memberSubmitError(err).message);
      setBusy(false);
    }
  }

  const warning = turningOff
    ? `Tắt thì ${member.name} không vào app được nữa, mọi máy của ${member.name} đăng xuất ngay${self ? ", cả máy này" : ""}. Tài khoản, giao dịch giữ nguyên; tài khoản riêng tư của ${member.name} hiện cho cả nhà thấy. Bật lại được bất cứ lúc nào.`
    : `Bật lại thì ${member.name} vào app được như trước; tài khoản riêng tư của ${member.name} lại ẩn với người khác. Nhà có tối đa 6 người đang dùng.`;
  return (
    <>
      <div class="set-sub">Đang dùng</div>
      {confirm && (
        <p class="fhint" role="alert" style={{ paddingTop: "10px" }}>
          {warning}
        </p>
      )}
      <div class="pad zalo-actions">
        <button type="button" class={turningOff ? "btn btn-bad" : "btn"} disabled={!online || busy} onClick={() => void toggle()}>
          {busy ? "Đang lưu…" : confirm ? (turningOff ? `Tắt hẳn ${member.name}` : `Bật lại ${member.name}`) : turningOff ? "Tắt" : "Bật lại"}
        </button>
        {confirm && !busy && (
          <button type="button" class="btn btn-ghost" onClick={() => setConfirm(false)}>
            Thôi
          </button>
        )}
      </div>
      {msg && (
        <p class="fhint err" role="alert">
          {msg}
        </p>
      )}
    </>
  );
}

/** Thêm người (UC-507 AC-11): tên, mật khẩu riêng tuỳ chọn. Trùng tên / quá 6 người: server báo, hiện đúng chỗ. */
export function MemberNewSheet({ members, onClose, onSaved }: { members: SettingsMember[]; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState({ name: "", password: "" });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);
  const name = f.name.trim();

  function submit() {
    void run(
      newMemberPayload(f, members),
      (body) => api.post("/v1/settings/members", body),
      f.password ? `Đã thêm ${name}. ${name} vào bằng mật khẩu riêng vừa đặt.` : `Đã thêm ${name}. ${name} vào bằng mật khẩu chung của nhà.`,
    );
  }

  return (
    <Sheet open title="Thêm người" onClose={onClose}>
      <Field id="mn-name" label="Tên" error={errors.name} first>
        <input id="mn-name" class="ctl" value={f.name} maxLength={40} autocomplete="off" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "mn-name")} />
      </Field>
      <Field id="mn-password" label="Mật khẩu riêng" error={errors.password}>
        <input
          id="mn-password"
          class="ctl"
          type="password"
          autocomplete="new-password"
          placeholder="không bắt buộc"
          value={f.password}
          onInput={(ev) => setF({ ...f, password: ev.currentTarget.value })}
          {...invalid(errors, "password", "mn-password")}
        />
      </Field>
      <Hint>
        Để trống thì người mới vào bằng mật khẩu chung của nhà. Đặt mật khẩu riêng (ít nhất 8 ký tự) thì chỉ vào được bằng mật khẩu đó. Tối đa 6 người đang dùng; ai
        cũng xem và ghi được như nhau.
      </Hint>
      <Footer busy={busy} error={error} label="Thêm" onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Đặt / đổi / gỡ mật khẩu riêng (UC-507 AC-13). Của mình: hỏi mật khẩu đang dùng (quên thì dùng mật khẩu chung);
 * của người khác: hỏi mật khẩu chung. Xong thì mọi máy của người đó phải vào lại; máy này nếu là mình thì server cấp phiên mới.
 */
export function MemberPasswordSheet({ item, self, onClose, onSaved }: { item: SettingsMember; self: boolean; onClose: () => void; onSaved: Saved }) {
  const has = Boolean(item.has_password);
  const [f, setF] = useState({ proof: "", password: "", remove: false, useHousehold: false });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);
  const mode = proofMode({ self, hasPassword: has, useHousehold: f.useHousehold });
  const doneText = f.remove
    ? `Đã gỡ mật khẩu riêng của ${item.name}. ${item.name} vào bằng mật khẩu chung.`
    : `${has ? "Đã đổi" : "Đã đặt"} mật khẩu riêng cho ${item.name}.`;
  const others = self ? "Các máy khác của bạn" : `Mọi máy của ${item.name}`;

  function submit() {
    void run(passwordPayload(f, mode), (body) => api.put(`/v1/settings/members/${encodeURIComponent(item.id)}/password`, body), doneText);
  }

  return (
    <Sheet open title={`Mật khẩu của ${item.name}`} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <span class="k">Đang dùng</span>
        <span>{has ? "mật khẩu riêng" : "mật khẩu chung của nhà"}</span>
      </div>
      {has && (
        <Field id="mp-action" label="Việc" wrap>
          <Seg
            label="Đổi hay gỡ mật khẩu riêng"
            value={f.remove ? "remove" : "change"}
            onChange={(v) => set({ remove: v === "remove", password: "" })}
            options={[
              { value: "change", label: "Đổi" },
              { value: "remove", label: "Gỡ" },
            ]}
          />
        </Field>
      )}
      <Field id="mp-proof" label={mode === "current" ? "Mật khẩu riêng đang dùng" : "Mật khẩu chung"} error={errors.proof}>
        <input id="mp-proof" class="ctl" type="password" autocomplete="current-password" value={f.proof} onInput={(ev) => set({ proof: ev.currentTarget.value })} {...invalid(errors, "proof", "mp-proof")} />
      </Field>
      {self && has && <Check id="mp-household" label="Quên? Xác nhận bằng mật khẩu chung" checked={f.useHousehold} onChange={(v) => set({ useHousehold: v, proof: "" })} />}
      {!f.remove && (
        <Field id="mp-password" label="Mật khẩu riêng mới" error={errors.password}>
          <input
            id="mp-password"
            class="ctl"
            type="password"
            autocomplete="new-password"
            value={f.password}
            onInput={(ev) => set({ password: ev.currentTarget.value })}
            {...invalid(errors, "password", "mp-password")}
          />
        </Field>
      )}
      <Hint>
        {f.remove
          ? `Gỡ thì ${item.name} vào bằng mật khẩu chung của nhà. ${others} phải đăng nhập lại.`
          : `Ít nhất 8 ký tự. Từ giờ ${item.name} chỉ vào được bằng mật khẩu riêng này, không bằng mật khẩu chung. ${others} phải đăng nhập lại.`}
      </Hint>
      <Footer busy={busy} error={error} label={f.remove ? "Gỡ mật khẩu riêng" : has ? "Đổi mật khẩu" : "Đặt mật khẩu riêng"} onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Nối Zalo bằng mã (ADR-80): Zalo chỉ cho biết chat khi người dùng nhắn bot, nên app đưa mã 6 số (hạn 15 phút), người đó
 * nhắn mã cho bot Zalo của nhà, máy chủ ghi chat Zalo. "Đã nhắn xong" đọc lại cài đặt xem đã nối chưa.
 */
function ZaloLink({ member, ready, onClose, onSaved }: { member: SettingsMember; ready: boolean; onClose: () => void; onSaved: Saved }) {
  const { online } = useApp();
  const [link, setLink] = useState<ZaloLinkCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const left = link ? linkCodeLeft(link.expires_at, now) : null;
  const path = `/v1/settings/members/${encodeURIComponent(member.id)}`;

  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [link]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ text: errorText(err), bad: true });
    } finally {
      setBusy(false);
    }
  }
  const newCode = () =>
    act(async () => {
      const code = await api.post<ZaloLinkCode>(`${path}/zalo-code`);
      setNow(Date.now());
      setLink(code);
    });
  const checkLinked = () =>
    act(async () => {
      const d = await api.get<SettingsData>("/v1/settings", true);
      if (!d.members.find((m) => m.id === member.id)?.zalo_chat_id) {
        setMsg({ text: "Chưa thấy tin nhắn mã. Kiểm tra đã nhắn đúng bot Zalo của nhà, đủ 6 số, rồi bấm lại.", bad: true });
        return;
      }
      await onSaved(`Đã nối Zalo cho ${member.name}.`);
      onClose();
    });
  const sendTest = () =>
    act(async () => {
      const r = await api.post<SendTestResult>("/v1/settings/test/zalo", { member_id: member.id });
      setMsg(r.sent ? { text: `Đã gửi tin thử. Xem Zalo của ${member.name}.`, bad: false } : { text: `Chưa gửi được: ${r.error ?? "Zalo không nhận."}`, bad: true });
    });
  function unlink() {
    if (!confirmUnlink) return setConfirmUnlink(true);
    void act(async () => {
      await api.patch(path, { zalo_chat_id: null });
      await onSaved(`Đã bỏ nối Zalo của ${member.name}.`);
      onClose();
    });
  }
  const disabled = !online || busy;

  return (
    <>
      <div class="set-sub">Zalo</div>
      {member.zalo_chat_id ? (
        <>
          <Hint>Đã nối Zalo: tin nhắc tới Zalo của {member.name}, bản đầy đủ như Telegram.</Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn" disabled={disabled} onClick={() => void sendTest()}>
              {busy ? "Đang gửi…" : "Gửi thử"}
            </button>
            <button type="button" class="btn btn-bad" disabled={disabled} onClick={unlink}>
              {confirmUnlink ? "Bỏ nối hẳn" : "Bỏ nối Zalo"}
            </button>
          </div>
        </>
      ) : !ready ? (
        <Hint>Chưa nối được: đặt bot token và khoá webhook Zalo ở Cài đặt › Kết nối, bấm Đặt webhook, rồi quay lại đây.</Hint>
      ) : link && left ? (
        <>
          <p class="zalo-code num" aria-live="polite">
            {link.code}
          </p>
          <Hint>
            Mở Zalo, nhắn mã {link.code} cho bot Zalo của nhà. Mã còn dùng được <span class="num">{left}</span>. Nhắn xong bấm “Đã nhắn xong”.
          </Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn btn-primary" disabled={disabled} onClick={() => void checkLinked()}>
              {busy ? "Đang kiểm tra…" : "Đã nhắn xong"}
            </button>
            <button type="button" class="btn" disabled={disabled} onClick={() => void newCode()}>
              Tạo mã mới
            </button>
          </div>
        </>
      ) : (
        <>
          <Hint>{link ? "Mã đã hết hạn. Tạo mã mới để nối." : `Bấm Nối Zalo để lấy mã 6 số, rồi ${member.name} nhắn mã đó cho bot Zalo của nhà.`}</Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn" disabled={disabled} onClick={() => void newCode()}>
              {busy ? "Đang tạo mã…" : link ? "Tạo mã mới" : "Nối Zalo"}
            </button>
          </div>
        </>
      )}
      {msg && (
        <p class={msg.bad ? "fhint err" : "fhint"} role="status">
          {msg.text}
        </p>
      )}
    </>
  );
}

// ── Khoá, token (chỉ ghi) ─────────────────────────────────────────

const SECRET_INFO: Record<SecretKey | SepaySecretKey, { title: string; hint: string; done: string }> = {
  webhook_key: { title: "Khoá webhook (API Key)", hint: "Dán đúng API Key đã đặt trong cấu hình webhook của tài khoản SePay này. Khoá mới cần ít nhất 24 ký tự; khoá đang dùng vẫn chạy bình thường.", done: "khoá webhook" },
  api_token: { title: "Token API SePay", hint: "Token để máy chủ đọc lại giao dịch của tài khoản SePay này lúc 2 giờ sáng và khi đồng bộ lại.", done: "token API SePay" },
  telegram_bot_token: { title: "Bot token Telegram", hint: "Lấy từ @BotFather khi tạo bot, dạng 123456:ABC…", done: "bot token" },
  zalo_bot_token: { title: "Bot token Zalo", hint: "Zalo gửi Bot Token khi tạo bot ở Zalo Bot Creator, dạng 12345689:abc-xyz.", done: "bot token Zalo" },
  zalo_webhook_secret: {
    title: "Khoá webhook Zalo",
    hint: "Tự đặt một chuỗi 8–256 ký tự, chỉ chữ không dấu, số, - và _. Zalo gửi kèm khoá này mỗi tin nhắn để app biết là thật. Đổi khoá thì bấm Đặt webhook lại.",
    done: "khoá webhook Zalo",
  },
};

/** Khoá chỉ ghi. Có `connection` thì là khoá của kết nối SePay đó (lưu qua kết nối), không thì là khoá chung của nhà. */
export function SecretSheet({
  secretKey,
  secret,
  connection,
  onClose,
  onSaved,
}: {
  secretKey: SecretKey | SepaySecretKey;
  secret: Secret;
  connection?: SepayConnection;
  onClose: () => void;
  onSaved: Saved;
}) {
  const info = SECRET_INFO[secretKey];
  const done = connection ? `${info.done} của ${connection.name}` : info.done;
  const save = (body: object) => (connection ? api.patch(`/v1/settings/sepay/connections/${encodeURIComponent(connection.id)}`, body) : api.put("/v1/settings/integrations", body));
  const [value, setValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const { online } = useApp();
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);

  return (
    <Sheet open title={connection ? `${info.title} · ${connection.name}` : info.title} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <span class="k">Hiện tại</span>
        <span class="num">{secretLabel(secret)}</span>
      </div>
      <Field id="s-secret" label={secret.set ? "Khoá mới" : "Khoá"} error={errors.secret}>
        <input
          id="s-secret"
          class="ctl"
          type="password"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={value}
          onInput={(ev) => setValue(ev.currentTarget.value)}
          {...invalid(errors, "secret", "s-secret")}
        />
      </Field>
      <Hint>{info.hint} Lưu xong app chỉ hiện 2 ký tự cuối.</Hint>
      <Footer
        busy={busy}
        error={error}
        label={secret.set ? "Thay khoá" : "Lưu khoá"}
        onSubmit={() => void run(secretPayload(secretKey, value), save, `Đã lưu ${done} mới.`)}
      >
        {secret.set && secret.source === "server" && <Hint>Khoá này đang đặt trên máy chủ (wrangler secret): lưu khoá mới ở đây sẽ dùng khoá mới, còn xoá thì phải xoá trên Cloudflare.</Hint>}
        {secret.set && secret.source !== "server" && (
          <button
            type="button"
            class="btn btn-bad"
            style={{ width: "100%", marginTop: "8px" }}
            disabled={!online || busy}
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true);
              void run({ ok: true, value: clearSecretPayload(secretKey) }, save, `Đã xoá ${done}.`);
            }}
          >
            {confirmClear ? "Xoá hẳn khoá này" : "Xoá khoá"}
          </button>
        )}
      </Footer>
    </Sheet>
  );
}

// ── Kết nối SePay ─────────────────────────────────────────────────

/** Thêm (tên + token, khoá nếu có sẵn) hoặc sửa tên / tạm tắt một kết nối SePay. Khoá của kết nối có sẵn sửa ở SecretSheet. */
export function SepayConnectionSheet({ item, onClose, onSaved }: { item: SepayConnection | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState<SepayConnectionForm>({ name: item?.name ?? "", active: item?.active ?? true, api_token: "", webhook_key: "" });
  const set = (patch: Partial<SepayConnectionForm>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;

  function submit() {
    const r = sepayConnectionPayload(f, item);
    if (r.ok && Object.keys(r.value).length === 0) return onClose();
    const name = f.name.trim();
    void run(
      r,
      (body) => (isNew ? api.post("/v1/settings/sepay/connections", body) : api.patch(`/v1/settings/sepay/connections/${encodeURIComponent(item.id)}`, body)),
      isNew ? `Đã thêm kết nối ${name}.` : f.active !== item.active ? `Đã ${f.active ? "bật lại" : "tạm tắt"} kết nối ${name}.` : `Đã lưu kết nối ${name}.`,
    );
  }

  const secretField = (key: SepaySecretKey, label: string) => (
    <Field id={`sc-${key}`} label={label} error={errors[key]}>
      <input
        id={`sc-${key}`}
        class="ctl"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="đặt sau cũng được"
        value={f[key]}
        onInput={(ev) => set({ [key]: ev.currentTarget.value })}
        {...invalid(errors, key, `sc-${key}`)}
      />
    </Field>
  );

  return (
    <Sheet open title={isNew ? "Thêm kết nối SePay" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="sc-name" label="Tên" error={errors.name} first>
        <input id="sc-name" class="ctl" value={f.name} maxLength={40} placeholder="SePay của vợ" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "sc-name")} />
      </Field>
      {isNew ? (
        <>
          {secretField("api_token", "Token API")}
          {secretField("webhook_key", "Khoá webhook")}
          <Hint>Lấy token và đặt khoá webhook trong tài khoản SePay của người này; khoá webhook ít nhất 24 ký tự. Lưu xong app chỉ hiện 2 ký tự cuối.</Hint>
        </>
      ) : (
        <>
          <Check id="sc-off" label="Tạm tắt kết nối này" checked={!f.active} onChange={(v) => set({ active: !v })} />
          <Hint>
            {f.active
              ? "Token và khoá webhook sửa ở hai hàng ngay dưới tên kết nối."
              : "Tắt thì app không nhận và không đồng bộ giao dịch qua kết nối này cho tới khi bật lại. Tài khoản đang nối qua nó vẫn giữ nguyên."}
          </Hint>
        </>
      )}
      <Footer busy={busy} error={error} label={isNew ? "Thêm kết nối" : "Lưu kết nối"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Tham số ───────────────────────────────────────────────────────

export function ConfigSheet({ d, onClose, onSaved }: { d: SettingsData; onClose: () => void; onSaved: Saved }) {
  const config = d.config;
  const [salary, setSalary] = useState(config.salary_min_amount);
  // Bản cài đặt lưu offline từ trước bản lãi tiền gửi thiếu khoá này: mặc định như server.
  const [interest, setInterest] = useState(config.interest_max_amount ?? 10_000);
  const [months, setMonths] = useState(String(config.safety_fund_months));
  // Bản cài đặt lưu offline từ trước Đợt C thiếu hai khoá này: không hiện ô, không gửi.
  const [surplusPct, setSurplusPct] = useState(config.surplus_savings_pct === undefined ? undefined : String(config.surplus_savings_pct));
  const [reward, setReward] = useState(config.surplus_reward_account ?? "");
  const [payday, setPayday] = useState(String(config.payday_day ?? DEFAULT_PAYDAY_DAY));
  // Bản cài đặt lưu offline từ trước v2 thiếu khoá này: không hiện ô, không gửi.
  const [savingsPct, setSavingsPct] = useState(config.savings_pct === undefined ? undefined : String(config.savings_pct));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  // Ví Thưởng đã chọn mà nay đã tắt / không còn ở ngăn Dự phòng / đã gắn mục tiêu vẫn hiện để biết (dư kỳ trước coi như chưa chọn).
  const options = rewardAccountOptions(d.accounts, d.goals);
  const stale = reward && !options.some((a) => a.id === reward) ? (d.accounts.find((a) => a.id === reward) ?? { id: reward, name: reward }) : undefined;
  return (
    <Sheet open title="Tham số" onClose={onClose}>
      <Field id="c-salary" label="Ngưỡng tự nhận lương" error={errors.salary_min_amount} first>
        <AmountInput id="c-salary" value={salary} onChange={setSalary} />
      </Field>
      <Hint>Khoản khớp mẫu lương từ mức này trở lên thì tự ghi (nguồn bật “Mở kỳ lương” thì mở kỳ lương); nhỏ hơn thì chờ ở màn Gán như mọi tiền vào khác. Để 0 là không có ngưỡng.</Hint>
      <Field id="c-interest" label="Lãi tiền gửi: tự ghi khoản dưới" error={errors.interest_max_amount}>
        <AmountInput id="c-interest" value={interest} onChange={setInterest} />
      </Field>
      <Hint>Tiền vào nhỏ hơn mức này mà nội dung trống, chỉ "BankAPINotify" hay có "lãi tiền gửi" thì máy tự ghi là lãi vào chính tài khoản nhận (Thu nhập thụ động). Để 0 là tắt.</Hint>
      <Field id="c-months" label="Phần an tâm (số tháng vận hành)" error={errors.safety_fund_months}>
        <input id="c-months" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={months} onInput={(ev) => setMonths(ev.currentTarget.value)} {...invalid(errors, "safety_fund_months", "c-months")} />
      </Field>
      <Hint>Thẻ Dự phòng ở Hôm nay so phần an tâm với số tháng này (chi vận hành trung bình 3 kỳ lương gần nhất).</Hint>
      <Field id="c-payday" label="Ngày lương" error={errors.payday_day}>
        <input id="c-payday" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={payday} onInput={(ev) => setPayday(ev.currentTarget.value)} {...invalid(errors, "payday_day", "c-payday")} />
      </Field>
      <Hint>Kỳ vận hành tính từ ngày lương tới trước ngày lương tháng sau; tháng ít ngày hơn lấy ngày cuối tháng. Thẻ Vận hành ở Hôm nay đếm ngược tới ngày này.</Hint>
      {savingsPct !== undefined && (
        <>
          <Field id="c-savings-pct" label="% Tích luỹ mỗi kỳ lương" error={errors.savings_pct}>
            <input
              id="c-savings-pct"
              class="ctl money"
              inputMode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              value={savingsPct}
              onInput={(ev) => setSavingsPct(ev.currentTarget.value)}
              {...invalid(errors, "savings_pct", "c-savings-pct")}
            />
          </Field>
          <SavingsSlider pct={sliderPct(savingsPct)} onPct={(p) => setSavingsPct(String(p))} />
          <Hint>{SAVINGS_SCALE_TEXT}</Hint>
        </>
      )}
      {surplusPct !== undefined && (
        <>
          <Field id="c-surplus-pct" label="Dư cuối kỳ vào Tích luỹ (%)" error={errors.surplus_savings_pct}>
            <input
              id="c-surplus-pct"
              class="ctl money"
              inputMode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              value={surplusPct}
              onInput={(ev) => setSurplusPct(ev.currentTarget.value)}
              {...invalid(errors, "surplus_savings_pct", "c-surplus-pct")}
            />
          </Field>
          <Field id="c-reward" label="Ví Thưởng" error={errors.surplus_reward_account}>
            <select id="c-reward" class="ctl" value={reward} onChange={(ev) => setReward(ev.currentTarget.value)}>
              <option value="">Chưa chọn</option>
              {stale && <option value={stale.id}>{stale.name} (không còn dùng được)</option>}
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Hint>Lương mở kỳ mới thì dư Vận hành kỳ trước gợi ý chia: phần trăm này vào Tích luỹ, còn lại chuyển vào Ví Thưởng (một tài khoản ngăn Dự phòng không gắn mục tiêu). Chưa chọn Ví Thưởng thì phần còn lại ở Vận hành.</Hint>
        </>
      )}
      <Footer
        busy={busy}
        error={error}
        label="Lưu tham số"
        onSubmit={() =>
          void run(
            configPayload({
              salary_min_amount: salary,
              interest_max_amount: interest,
              safety_fund_months: months,
              surplus_savings_pct: surplusPct,
              ...(surplusPct === undefined ? {} : { surplus_reward_account: reward }),
              payday_day: payday,
              savings_pct: savingsPct,
            }),
            (body) => api.put("/v1/settings/config", body),
            "Đã lưu tham số. Áp dụng từ kỳ lương tới.",
          )
        }
      />
    </Sheet>
  );
}

/** Tham số nhóm "Tài sản & tự do" (access UC-507 AC-16): ô % cho tỷ lệ, chi phí tháng để trống = theo sổ, năm sinh, tuổi mục tiêu. */
export function FiConfigSheet({ config, onClose, onSaved }: { config: SettingsConfig; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState<FiConfigForm>(() => fiConfigToForm(config));
  const set = (patch: Partial<FiConfigForm>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const pct = (id: string, key: keyof FiConfigForm, label: string, first = false) => (
    <Field id={id} label={label} error={errors[key]} first={first}>
      <input id={id} class="ctl money" inputMode="decimal" autocomplete="off" value={String(f[key])} onInput={(ev) => set({ [key]: ev.currentTarget.value })} {...invalid(errors, key, id)} />
    </Field>
  );
  return (
    <Sheet open title="Tài sản & tự do" onClose={onClose}>
      {pct("fi-swr", "swr", "Tỷ lệ rút an toàn (SWR) %", true)}
      {pct("fi-inf", "inflation", "Lạm phát %/năm")}
      {pct("fi-fat", "fat", "Hệ số dự phòng Tự do 2 %")}
      {pct("fi-legacy", "legacy", "Lãi thực Tự do 3 %")}
      {pct("fi-high", "highInterest", "Lãi cao từ %/năm")}
      <Hint>Khoản nợ có lãi suất từ mức này xếp vào nhóm Lãi cao ở bảng cân đối.</Hint>
      <Field id="fi-safe" label="Mốc an tâm (tháng)" error={errors.safetyMonths}>
        <input id="fi-safe" class="ctl money" autocomplete="off" value={f.safetyMonths} onInput={(ev) => set({ safetyMonths: ev.currentTarget.value })} {...invalid(errors, "safetyMonths", "fi-safe")} />
      </Field>
      <Hint>Ba số tháng chi phí, tăng dần. Khác phần an tâm ở thẻ Dự phòng.</Hint>
      <Field id="fi-exp" label="Chi phí tháng">
        <AmountInput id="fi-exp" value={f.expense} onChange={(n) => set({ expense: n })} />
      </Field>
      <Field id="fi-must" label="Chi thiết yếu tháng">
        <AmountInput id="fi-must" value={f.expenseMust} onChange={(n) => set({ expenseMust: n })} />
      </Field>
      <Hint>Để trống là lấy từ sổ (trung bình 3 tháng đã kết thúc).</Hint>
      <Field id="fi-birth" label="Năm sinh" error={errors.birthYear}>
        <input id="fi-birth" class="ctl money" inputMode="numeric" autocomplete="off" placeholder="chưa đặt" value={f.birthYear} onInput={(ev) => set({ birthYear: ev.currentTarget.value })} />
      </Field>
      {(["f1", "f2", "f3"] as const).map((k, i) => (
        <Field key={k} id={`fi-${k}`} label={`Tuổi Tự do ${i + 1}`} error={errors[k]}>
          <input id={`fi-${k}`} class="ctl money" inputMode="numeric" autocomplete="off" placeholder="chưa đặt" value={f[k]} onInput={(ev) => set({ [k]: ev.currentTarget.value })} />
        </Field>
      ))}
      <Footer
        busy={busy}
        error={error}
        label="Lưu tham số"
        onSubmit={() => void run(fiConfigPayload(f, new Date().getFullYear()), (body) => api.put("/v1/settings/config", body), "Đã lưu tham số Tài sản & tự do.")}
      />
    </Sheet>
  );
}

// ── Giờ nhắc (cả nhà) ─────────────────────────────────────────────

export function NotifyScheduleSheet({ schedule, onClose, onSaved }: { schedule: NotifySchedule; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(schedule);
  const set = (patch: Partial<NotifySchedule>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const time = (id: string, key: "dailyTime" | "weeklyTime" | "quietStart" | "quietEnd", errKey: string) => (
    <input id={id} class="ctl" type="time" step={900} required value={f[key]} onInput={(ev) => set({ [key]: ev.currentTarget.value })} {...invalid(errors, errKey, id)} />
  );
  return (
    <Sheet open title="Giờ nhắc" onClose={onClose}>
      <Hint>Áp dụng cho cả nhà: mọi người nhận cùng giờ, trên Telegram, Zalo và mọi máy đã bật thông báo. Giờ Việt Nam, bước 15 phút. Giờ trong 01:00–04:00 chạy theo lượt mỗi giờ.</Hint>
      <div class="set-sub">Tin sáng</div>
      <Check id="n-daily-on" label="Gửi tin sáng" checked={f.dailyEnabled} onChange={(v) => set({ dailyEnabled: v })} />
      <Field id="n-daily" label="Giờ gửi" error={errors.daily_time}>
        {time("n-daily", "dailyTime", "daily_time")}
      </Field>
      <Hint>Đổi giờ sau khi hôm nay đã gửi thì mai mới áp dụng.</Hint>
      <div class="set-sub">Tổng kết tuần</div>
      <Check id="n-weekly-on" label="Gửi tổng kết tuần" checked={f.weeklyEnabled} onChange={(v) => set({ weeklyEnabled: v })} />
      <Field id="n-weekday" label="Ngày" error={errors.weekly_day}>
        <select id="n-weekday" class="ctl" value={String(f.weeklyDay)} onChange={(ev) => set({ weeklyDay: Number(ev.currentTarget.value) })} {...invalid(errors, "weekly_day", "n-weekday")}>
          {Object.entries(WEEKDAY_LABEL).map(([day, label]) => (
            <option key={day} value={day}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="n-weekly" label="Giờ gửi" error={errors.weekly_time}>
        {time("n-weekly", "weeklyTime", "weekly_time")}
      </Field>
      <Hint>Thứ Hai đến thứ Bảy tổng kết tuần vừa hết; Chủ nhật tổng kết tuần đang kết thúc hôm đó.</Hint>
      <div class="set-sub">Giao dịch chưa gán</div>
      <Check id="n-pending-on" label="Báo giao dịch chưa gán (kiểm tra mỗi 15 phút)" checked={f.pendingEnabled} onChange={(v) => set({ pendingEnabled: v })} />
      <Field id="n-quiet-start" label="Yên lặng từ" error={errors.quiet_start}>
        {time("n-quiet-start", "quietStart", "quiet_start")}
      </Field>
      <Field id="n-quiet-end" label="Đến" error={errors.quiet_end}>
        {time("n-quiet-end", "quietEnd", "quiet_end")}
      </Field>
      <Hint>Trong giờ yên lặng không báo; giao dịch chưa gán gom lại thành một tin lúc hết giờ yên lặng. Đặt hai giờ bằng nhau là không có giờ yên lặng.</Hint>
      <Footer busy={busy} error={error} label="Lưu giờ nhắc" onSubmit={() => void run(notifyPayload(f), (body) => api.patch("/v1/settings/notify-schedule", body), "Đã lưu giờ nhắc cho cả nhà.")} />
    </Sheet>
  );
}

// ── Nguồn thu ─────────────────────────────────────────────────────

export function StreamSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: IncomeStream | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => streamToForm(item));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  // Nguồn cho thuê không mở kỳ lương (pocket UC-1205): không có công tắc.
  const rental = useResource<Rental>("/v1/rental");
  const isRental = !!item && rental.data?.incomeStreamId === item.id;

  function submit() {
    void run(
      streamPayload(f, isNew, isRental),
      (body) => (isNew ? api.post("/v1/settings/income-streams", body) : api.patch(`/v1/settings/income-streams/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} nguồn ${f.name.trim()}. Áp dụng từ khoản thu tới.`,
    );
  }

  return (
    <Sheet open title={isNew ? "Thêm nguồn thu" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="s-name" label="Tên" error={errors.name} first>
        <input id="s-name" class="ctl" value={f.name} maxLength={60} placeholder="Lương vợ" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "s-name")} />
      </Field>
      <Field id="s-pocket" label="Ngăn của tiền về">
        <select id="s-pocket" class="ctl" value={f.pocket ?? ""} onChange={(ev) => setF({ ...f, pocket: (ev.currentTarget.value || null) as Pocket | null })}>
          <option value="">Theo tài khoản nhận</option>
          {(["savings", "reserve", "operating"] as const).map((p) => (
            <option key={p} value={p}>
              {POCKET_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <Hint>Theo tài khoản nhận: tiền về tài khoản ngăn nào là tiền của ngăn đó. Chọn một ngăn khi tiền của nguồn này thuộc ngăn khác (vd tiền thuê là Tích luỹ).</Hint>
      {!isRental && (
        <>
          <Check id="s-opens-cycle" label="Mở kỳ lương" checked={f.opens_cycle} onChange={(v) => setF({ ...f, opens_cycle: v })} error={errors.opens_cycle} />
          <Hint>{OPENS_CYCLE_HINT}</Hint>
        </>
      )}
      {!isNew && <Check id="s-active" label="Đang dùng" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      <Footer busy={busy} error={error} label={isNew ? "Thêm nguồn thu" : "Lưu nguồn thu"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Cho thuê ──────────────────────────────────────────────────────

export function TenantSheet({ item, onClose, onSaved }: { item: TenantSummary | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState({ name: item?.name ?? "", opening: 0, openingSign: 1 as 1 | -1, active: item?.active ?? true });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  function submit() {
    void run(
      tenantPayload(f, isNew),
      (body) => (isNew ? api.post("/v1/rental/tenants", body) : api.patch(`/v1/rental/tenants/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} người thuê ${f.name.trim()}.`,
    );
  }
  return (
    <Sheet open title={isNew ? "Thêm người thuê" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="t-name" label="Tên" error={errors.name} first>
        <input id="t-name" class="ctl" value={f.name} maxLength={60} placeholder="Anh An" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "t-name")} />
      </Field>
      {isNew && (
        <>
          <Field id="t-opening" label="Số dư mở sổ">
            <AmountInput id="t-opening" value={f.opening} onChange={(opening) => setF({ ...f, opening })} />
          </Field>
          {!!f.opening && (
            <Seg
              class="pad"
              label="Số dư mở sổ là"
              value={f.openingSign > 0 ? "owe" : "over"}
              onChange={(v) => setF({ ...f, openingSign: v === "owe" ? 1 : -1 })}
              options={[
                { value: "owe", label: "Người thuê còn nợ" },
                { value: "over", label: "Đã trả dư" },
              ]}
            />
          )}
          <Hint>Số người thuê đang nợ lúc bắt đầu dùng sổ. Để 0 nếu không có.</Hint>
        </>
      )}
      {!isNew && <Check id="t-active" label="Đang ở" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      {!isNew && !f.active && <Hint>Tắt sau khi đã gửi bản tính tháng cuối. Số dư khác 0 thì vẫn hiện ở màn Người thuê tới khi về 0.</Hint>}
      <Footer busy={busy} error={error} label={isNew ? "Thêm người thuê" : "Lưu người thuê"} onSubmit={submit} />
    </Sheet>
  );
}

export function RentalConfigSheet({ d, rental, onClose, onSaved }: { d: SettingsData; rental: Rental; onClose: () => void; onSaved: Saved }) {
  const [stream, setStream] = useState(rental.incomeStreamId ?? "");
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  return (
    <Sheet open title="Cấu hình cho thuê" onClose={onClose}>
      <Field id="rc-stream" label="Tiền người thuê vào nguồn" error={errors.income_stream_id} first>
        <select id="rc-stream" class="ctl" value={stream} onChange={(ev) => setStream(ev.currentTarget.value)} {...invalid(errors, "income_stream_id", "rc-stream")}>
          {!stream && <option value="">Chọn nguồn thu</option>}
          {(d.incomeStreams ?? [])
            .filter((s) => s.active || s.id === stream)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Field>
      <Hint>Tài khoản nhận tiền (mã QR) chọn trên từng bản tính ở Ví & quỹ › Người thuê.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Lưu cấu hình"
        onSubmit={() =>
          void run(rentalConfigPayload({ income_stream_id: stream }), (body) => api.patch("/v1/rental/config", body), "Đã lưu cấu hình cho thuê.")
        }
      />
    </Sheet>
  );
}

// ── Ba ngăn ───────────────────────────────────────────────────────

/** Ô chọn ngăn của một tài khoản: Tích luỹ / Dự phòng / Vận hành / Ngoài ngăn (null). */
function PocketSelect(props: { id: string; value: Pocket | null; label?: string; onChange: (p: Pocket | null) => void }) {
  return (
    <select id={props.id} class="ctl" aria-label={props.label} value={props.value ?? ""} onChange={(ev) => props.onChange((ev.currentTarget.value || null) as Pocket | null)}>
      {POCKET_ORDER.map((p) => (
        <option key={p ?? "outside"} value={p ?? ""}>
          {p ? POCKET_LABEL[p] : OUTSIDE_LABEL}
        </option>
      ))}
    </select>
  );
}

/** Câu của sheet xếp ngăn — cũng là bước 1 của màn chuyển đổi (pocket UC-1208). */
export const POCKETS_SHEET_NOTE = `${POCKETS_SHEET_HEAD} Thẻ tín dụng để ở Vận hành. Khoản gửi kỳ hạn theo ngăn của tài khoản mẹ. Mỗi khoản phải trả để dành ở một tài khoản Dự phòng; nhiều khoản dùng chung được một tài khoản.`;

/**
 * Xếp tài khoản vào ngăn (UC-709 AC-35): đổi ngăn từng dòng, Xác nhận gửi một lô PUT /v1/settings/pockets. Tài khoản của mục
 * tiêu đang dùng khoá ở Dự phòng; khoản gửi kỳ hạn không có ô, nằm dưới mẹ "theo {mẹ}" (server bỏ qua dòng của con).
 * Màn chuyển đổi dùng lại sheet này ở bước 1 (`onSaved` gửi tiếp "bước này xong").
 */
export function PocketsSheet({ d, onClose, onSaved }: { d: SettingsData; onClose: () => void; onSaved: Saved }) {
  const [choice, setChoice] = useState<PocketChoice>(() => Object.fromEntries(d.accounts.filter((a) => a.active).map((a) => [a.id, a.pocket ?? null])));
  const { busy, error, run } = useSubmit(onSaved, onClose);
  const groups = pocketSheetGroups(d.accounts, choice);
  const count = d.accounts.filter((a) => a.active).length;
  // Dòng của con gửi đúng ngăn mẹ đang chọn: con luôn theo mẹ.
  const sent = { ...choice, ...Object.fromEntries(groups.flatMap((g) => g.rows.flatMap((r) => r.children.map((c) => [c.id, choice[r.account.id] ?? null])))) };
  return (
    <Sheet open title="Xếp tài khoản vào ngăn" onClose={onClose}>
      <Hint>{POCKETS_SHEET_NOTE}</Hint>
      {groups.map((g) => (
        <div key={g.key}>
          <div class="set-sub">{g.label}</div>
          {g.rows.length === 0 && <Hint>Chưa có tài khoản nào.</Hint>}
          {g.rows.map(({ account: a, children }) => {
            const names = accountGoals(a.id, d.goals).map((g) => g.name).join(", ");
            const goal = names ? { name: names } : undefined;
            return (
              <div key={a.id}>
                <Field id={`p-${a.id}`} label={a.pocket_confirmed === false ? `${a.name} (chưa xác nhận)` : a.name}>
                  {goal ? (
                    <span id={`p-${a.id}`}>{POCKET_LABEL.reserve}</span>
                  ) : (
                    <PocketSelect id={`p-${a.id}`} value={choice[a.id] ?? null} onChange={(p) => setChoice((x) => ({ ...x, [a.id]: p }))} />
                  )}
                </Field>
                {goal && (
                  <Hint>
                    Tài khoản của mục tiêu {goal.name}. {GOAL_POCKET_LOCK}.
                  </Hint>
                )}
                {children.map((c) => (
                  <div key={c.id} class="field child-row">
                    <span class="k">↳ {c.name}</span>
                    <span class="sub-line">{parentPocketText(a.name)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      <Footer
        busy={busy}
        error={error}
        label="Xác nhận"
        onSubmit={() => void run({ ok: true, value: pocketsPayload(d.accounts, sent) }, (body) => api.put("/v1/settings/pockets", body), `Đã xác nhận ngăn của ${count} tài khoản.`)}
      />
    </Sheet>
  );
}

/** Giá trị của "Tạo tài khoản mới" trong ô Tài khoản của mục tiêu (mã tài khoản là slug, không có dấu +). */
export const NEW_ACCOUNT = "+new";
/** Tài khoản mới đang chờ gửi cùng mục tiêu mới (thêm mục tiêu: tạo mục tiêu trước, rồi tạo + gắn tài khoản). */
const PENDING_ACCOUNT = "+pending";

/**
 * Thêm / sửa mục tiêu Dự phòng (UC-709 AC-36, AC-39, AC-49, pocket UC-1209): tên, Tài khoản (tài khoản Dự phòng đang dùng,
 * không phải Ví Thưởng, kèm "dùng chung với …", luật Thuế tắt kèm lý do; câu mềm khi tài khoản đang thiếu / "Tạo tài khoản
 * mới" / "Chưa có"), cách đặt số, hạn, gắn nợ. "Tạo tài khoản mới" mở sheet tài khoản
 * điền sẵn tên mục tiêu, ngăn Dự phòng (pocket UC-1208, sheet mục tiêu): sửa mục tiêu đã có → lưu sheet tài khoản là tạo và
 * gắn ngay (`POST /v1/settings/goals/:id/account`); thêm mục tiêu mới → giữ thân tài khoản, Lưu tạo mục tiêu (không
 * `account_id`) rồi tạo + gắn. Bước hai lỗi → sheet thành sửa mục tiêu vừa tạo, giữ lựa chọn và thân; Lưu lại chỉ gửi bước
 * hai. `prefill`: gợi ý "Tạo mục tiêu Trả nợ" điền sẵn.
 */
export function GoalSheet({ d, item, prefill, onClose, onSaved }: { d: SettingsData; item: ReserveGoal | null; prefill?: GoalForm; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState<GoalForm>(() => prefill ?? goalToForm(item));
  const set = (patch: Partial<GoalForm>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, (err) => goalSubmitError(err, accounts, f.account_id));
  const [creating, setCreating] = useState(false);
  // Tài khoản vừa tạo ở sheet con: cài đặt tải lại sau, nên giữ ở đây để ô chọn có ngay.
  const [created, setCreated] = useState<SettingsAccount | null>(null);
  // Thêm mục tiêu mới: thân tài khoản chờ gửi; mục tiêu đã tạo ở bước một khi bước hai lỗi.
  const [pendingAccount, setPendingAccount] = useState<Record<string, unknown> | null>(null);
  const [createdGoal, setCreatedGoal] = useState<ReserveGoal | null>(null);
  const goal = item ?? createdGoal;
  const debts = useResource<DebtsData>("/v1/debts");
  const isNew = !goal;
  const e = (k: string) => ({ id: `g-${k}`, error: errors[k] });
  const accounts = created && !d.accounts.some((a) => a.id === created.id) ? [...d.accounts, created] : d.accounts;
  const options = goalAccountOptions(accounts, d.goals, d.config.surplus_reward_account, goal?.id ?? null, f.mode === "pct");
  const chosen = options.find((a) => a.id === f.account_id);
  const chosenNote = [chosen?.deposits, chosen?.shared].filter(Boolean).join(" · ") || null;
  // "Tiền để ở đâu" (ADR-141): trả thẳng từ tiền chi tiêu chỉ cho khoản mỗi tháng; Thuế chỉ có tài khoản.
  const opChoice = operatingChoice(f);
  const place = goalPlace(f);
  const note = f.account_id ? goalAccountNote(d, f.account_id, { id: goal?.id ?? null, due_date: f.due_date }) : null;
  // Tài khoản đã gắn mà nay không chọn được vẫn hiện để biết.
  const stale = f.account_id && !options.some((a) => a.id === f.account_id) ? (accounts.find((a) => a.id === f.account_id) ?? { id: f.account_id, name: f.account_id }) : null;
  const debtOptions = (debts.data?.debts ?? []).filter((x) => x.active || x.id === f.debt_id);

  /** Tạo tài khoản và gắn vào mục tiêu `goalId` trong một yêu cầu (pocket UC-1209 bước 8); gửi lại cùng thân không tạo thêm. */
  async function createGoalAccount(goalId: string, body: Record<string, unknown>) {
    const r = goalAccountRequest(goalId, body);
    const res = await api.post<GoalAccountResult>(r.path, r.body);
    setCreated(res.account);
    set({ account_id: res.account.id });
    setPendingAccount(null);
  }

  function submit() {
    const name = f.name.trim();
    const pendingName = String(pendingAccount?.name ?? "");
    // Trả thẳng từ tiền chi tiêu: không có tài khoản, bỏ qua tài khoản mới đang chờ.
    const waiting = place === "account" ? pendingAccount : null;
    if (waiting && createdGoal) {
      // Lưu lại sau khi bước hai lỗi: chỉ gửi lại bước hai, đúng thân cũ.
      return void run({ ok: true, value: waiting }, (body) => createGoalAccount(createdGoal.id, body), `Đã tạo ${pendingName} và gắn vào ${createdGoal.name}`);
    }
    if (waiting && !goal) {
      const account = waiting;
      return void run(
        goalPayload(f, null),
        async (body) => {
          const r = goalCreateRequest(body);
          const g = await api.post<ReserveGoal>(r.path, r.body);
          setCreatedGoal(g);
          await createGoalAccount(g.id, account);
        },
        `Đã thêm mục tiêu ${name}, tạo ${pendingName} và gắn vào.`,
      );
    }
    void run(
      goalPayload(f, goal),
      (body) => (goal ? api.patch(`/v1/settings/goals/${encodeURIComponent(goal.id)}`, body) : api.post("/v1/settings/goals", body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} mục tiêu ${name}.`,
    );
  }

  return (
    <Sheet open title={goal ? `Sửa ${goal.name}` : prefill ? `Tạo mục tiêu ${prefill.name}` : "Thêm mục tiêu Dự phòng"} onClose={onClose}>
      <Field {...e("name")} label="Tên" first>
        <input id="g-name" class="ctl" value={f.name} maxLength={60} placeholder="Học phí" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "g-name")} />
      </Field>
      <Field id="g-place" label={GOAL_PLACE_LABEL} wrap>
        {opChoice.show ? (
          <Seg
            label={GOAL_PLACE_LABEL}
            value={place}
            onChange={(pays_from) => set({ pays_from })}
            options={[
              { value: "account" as const, label: PLACE_LABEL.account },
              { value: "operating" as const, label: PLACE_LABEL.operating, disabled: opChoice.disabled !== null },
            ]}
          />
        ) : (
          <span id="g-place">{PLACE_LABEL.account}</span>
        )}
      </Field>
      {!opChoice.show && <Hint>{TAX_OWN_ACCOUNT}</Hint>}
      {opChoice.show && opChoice.disabled && <Hint>{PLACE_LABEL.operating}: {opChoice.disabled}</Hint>}
      {place === "operating" ? (
        <Hint>{OPERATING_HINT}</Hint>
      ) : (
        <>
          <Field {...e("account_id")} label="Tài khoản">
            <select
              id="g-account_id"
              class="ctl"
              value={pendingAccount ? PENDING_ACCOUNT : f.account_id}
              onChange={(ev) => {
                const v = ev.currentTarget.value;
                if (v === NEW_ACCOUNT) {
                  // Ô chọn giữ giá trị cũ cho tới khi tài khoản mới lưu xong.
                  ev.currentTarget.value = pendingAccount ? PENDING_ACCOUNT : f.account_id;
                  setCreating(true);
                } else if (v !== PENDING_ACCOUNT) {
                  setPendingAccount(null);
                  set({ account_id: v });
                }
              }}
            >
              <option value="">Chưa có</option>
              {stale && <option value={stale.id}>{stale.name} (không còn chọn được)</option>}
              {options.map((a) => (
                <option key={a.id} value={a.id} disabled={a.blocked !== null && a.id !== f.account_id}>
                  {`${a.name}${a.deposits ? ` (${a.deposits})` : ""}${a.shared ? ` — ${a.shared}` : ""}${a.blocked ? ` (${a.blocked})` : ""}`}
                </option>
              ))}
              {pendingAccount && <option value={PENDING_ACCOUNT}>Tài khoản mới: {String(pendingAccount.name ?? "")}</option>}
              <option value={NEW_ACCOUNT}>Tạo tài khoản mới</option>
            </select>
            {/* Ô chọn cắt chữ ở 390px: "gồm khoản gửi kỳ hạn" / "dùng chung với …" của tài khoản đang chọn hiện đủ ở dòng dưới. */}
            {chosenNote && <span class="sub-line">{chosenNote}</span>}
          </Field>
          {note && <Hint>{note}</Hint>}
          <Hint>Để dành ở một tài khoản Dự phòng; nhiều khoản dùng chung được một tài khoản — số dư (gồm cả khoản gửi kỳ hạn của tài khoản đó) chia theo thứ tự ưu tiên (đổi ở danh sách mục tiêu). Chưa có tài khoản thì chưa có việc nạp ở ngày lương.</Hint>
        </>
      )}
      <Field id="g-mode" label="Cách đặt số" wrap>
        <Seg label="Cách đặt số" value={f.mode} onChange={(mode) => set({ mode })} options={(["repeat", "once", "pct"] as const).map((m) => ({ value: m, label: GOAL_MODE_LABEL[m] }))} />
      </Field>
      {f.mode === "repeat" && (
        <>
          <Field {...e("monthly_amount")} label="Số mỗi tháng">
            <AmountInput id="g-monthly_amount" value={f.monthly_amount} invalid={Boolean(errors.monthly_amount)} onChange={(n) => set({ monthly_amount: n })} />
          </Field>
          <Field {...e("repeat_months")} label="Mấy tháng một lần">
            <input
              id="g-repeat_months"
              class="ctl money"
              inputMode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              value={f.repeat_months}
              onInput={(ev) => set({ repeat_months: ev.currentTarget.value })}
              {...invalid(errors, "repeat_months", "g-repeat_months")}
            />
          </Field>
          <Hint>Số cần mỗi lần = số mỗi tháng × số tháng (vd 2.000.000/tháng, 3 tháng một lần → 6.000.000).</Hint>
        </>
      )}
      {f.mode === "once" && (
        <Field {...e("target_amount")} label="Số cần">
          <AmountInput id="g-target_amount" value={f.target_amount} invalid={Boolean(errors.target_amount)} onChange={(n) => set({ target_amount: n })} />
        </Field>
      )}
      {f.mode === "pct" && (
        <>
          <Field {...e("target_pct")} label="% thu chịu thuế">
            <input
              id="g-target_pct"
              class="ctl money"
              inputMode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              value={f.target_pct}
              placeholder="10"
              onInput={(ev) => set({ target_pct: ev.currentTarget.value })}
              {...invalid(errors, "target_pct", "g-target_pct")}
            />
          </Field>
          <Hint>Không có số cần cố định; số cần tính theo các khoản thu chịu thuế.</Hint>
        </>
      )}
      <Field {...e("due_date")} label={f.mode === "repeat" ? "Hạn kế tiếp" : "Hạn"}>
        <input id="g-due_date" class="ctl" type="date" value={f.due_date} onInput={(ev) => set({ due_date: ev.currentTarget.value })} />
      </Field>
      <Field {...e("debt_id")} label="Gắn khoản nợ">
        <select id="g-debt_id" class="ctl" value={f.debt_id} onChange={(ev) => set({ debt_id: ev.currentTarget.value })}>
          <option value="">Không</option>
          {f.debt_id && !debtOptions.some((x) => x.id === f.debt_id) && <option value={f.debt_id}>{f.debt_id}</option>}
          {debtOptions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      {!isNew && <Check id="g-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      {!isNew && !f.active && <Hint>Tắt lúc nào cũng được: tiền vẫn nằm trong tài khoản, tài khoản thành tài khoản Dự phòng thường. Không xoá — lịch sử vẫn giữ.</Hint>}
      <Footer busy={busy} error={error} label={pendingAccount && createdGoal ? "Lưu lại" : isNew ? "Thêm mục tiêu" : "Lưu mục tiêu"} onSubmit={submit} />
      {creating && (
        <AccountSheet
          d={d}
          item={null}
          preset={{ name: f.name.trim(), pocket: "reserve", pocket_touched: true }}
          create={
            goal
              ? { send: (body) => createGoalAccount(goal.id, body), toast: (name) => `Đã tạo ${name} và gắn vào ${goal.name}` }
              : {
                  // Mục tiêu chưa có mã: giữ thân, Lưu mục tiêu gửi cả hai bước.
                  send: async (body) => {
                    setPendingAccount(body);
                    set({ account_id: "" });
                  },
                  toast: (name) => name,
                }
          }
          onClose={() => setCreating(false)}
          onSaved={goal ? onSaved : async () => {}}
        />
      )}
    </Sheet>
  );
}

/**
 * Đổi thứ tự ưu tiên các mục tiêu của một tài khoản chung (UC-709 bước 4u, AC-48): kéo tay cầm (≥ 44px) hoặc ↑ ↓ từng hàng,
 * xem trước số mới bằng `fillGoals`; Lưu gửi đúng một `PUT /v1/settings/goals/order` với mọi mục tiêu đang dùng (mục tiêu
 * ngoài tài khoản giữ chỗ). 400 `invalid_order` (máy khác vừa đổi) → câu tải lại và nút Tải lại.
 */
export function GoalOrderSheet({ d, accountId, onClose, onSaved, onReload }: { d: SettingsData; accountId: string; onClose: () => void; onSaved: Saved; onReload: () => void }) {
  const { online } = useApp();
  const [ids, setIds] = useState(() => accountGoals(accountId, d.goals).map((g) => g.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; reload: boolean } | null>(null);
  const rows = goalOrderPreview(d, accountId, ids);
  const name = d.accounts.find((a) => a.id === accountId)?.name ?? accountId;
  const moveTo = (id: string, to: number) =>
    setIds((list) => {
      const next = list.filter((x) => x !== id);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
      return next;
    });

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.put("/v1/settings/goals/order", goalOrderPayload(d.goals, accountId, ids));
      await onSaved(`Đã đổi thứ tự mục tiêu trong ${name}.`);
      onClose();
    } catch (err) {
      setProblem(goalOrderError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`Đổi thứ tự · ${name}`} onClose={onClose}>
      <Hint>Số dư lấp mục tiêu đứng trên trước. Kéo tay cầm hoặc bấm ↑ ↓; số dưới mỗi mục tiêu là số sau khi đổi.</Hint>
      <ul class="goal-order">
        {rows.map((r, i) => (
          <li
            key={r.id}
            data-goal-id={r.id}
            class={dragging === r.id ? "goal-order-row dragging" : "goal-order-row"}
          >
            <button
              type="button"
              class="goal-order-handle"
              aria-label={`Kéo ${r.name}`}
              onPointerDown={(ev) => {
                ev.currentTarget.setPointerCapture(ev.pointerId);
                setDragging(r.id);
              }}
              onPointerMove={(ev) => {
                if (dragging !== r.id) return;
                const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-goal-id]")?.dataset.goalId;
                if (over && over !== r.id) moveTo(r.id, ids.indexOf(over));
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
            >
              ⋮⋮
            </button>
            <div class="goal-order-main">
              <div>
                {i + 1}. {r.name}
              </div>
              <div class="sub-line">{r.text}</div>
            </div>
            <button type="button" class="btn btn-ghost" aria-label={`Đưa ${r.name} lên`} disabled={i === 0} onClick={() => moveTo(r.id, i - 1)}>
              ↑
            </button>
            <button type="button" class="btn btn-ghost" aria-label={`Đưa ${r.name} xuống`} disabled={i === rows.length - 1} onClick={() => moveTo(r.id, i + 1)}>
              ↓
            </button>
          </li>
        ))}
      </ul>
      <div class="pad">
        {problem && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {problem.message}
          </p>
        )}
        {problem?.reload ? (
          <button type="button" class="btn btn-primary btn-wide" onClick={onReload}>
            Tải lại
          </button>
        ) : (
          <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy} onClick={() => void save()}>
            {busy ? "Đang lưu…" : "Lưu thứ tự"}
          </button>
        )}
        {!online && <NeedsNetwork what="Lưu cài đặt" />}
      </div>
    </Sheet>
  );
}

/**
 * Thêm / sửa nhóm danh mục và hạn mức mềm mỗi kỳ lương (UC-709 AC-39). Sửa thì chọn danh mục vào / ra nhóm ngay
 * (PATCH /v1/categories/:id), không cần bấm Lưu.
 */
export function GroupSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: CategoryGroup | null; onClose: () => void; onSaved: Saved }) {
  const { online } = useApp();
  const [f, setF] = useState(() => groupToForm(item));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const isNew = !item;
  const groups = d.categoryGroups ?? [];
  const inGroup = item ? d.categories.filter((c) => c.groupId === item.id) : [];
  const others = item ? d.categories.filter((c) => c.groupId !== item.id) : [];

  async function move(categoryId: string, groupId: string | null, text: string) {
    setMoving(true);
    setMoveError(null);
    try {
      await api.patch(`/v1/categories/${encodeURIComponent(categoryId)}`, { group_id: groupId });
      await onSaved(text);
    } catch (err) {
      setMoveError(errorText(err));
    } finally {
      setMoving(false);
    }
  }

  return (
    <Sheet open title={isNew ? "Thêm nhóm danh mục" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="g-name" label="Tên" error={errors.name} first>
        <input id="g-name" class="ctl" value={f.name} maxLength={60} placeholder="Ăn uống" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "g-name")} />
      </Field>
      <Check id="g-essential" label="Thiết yếu" checked={f.essential} onChange={(v) => set({ essential: v })} />
      <Field id="g-limit" label="Hạn mức mỗi kỳ lương">
        <AmountInput id="g-limit" value={f.cycle_limit} onChange={(n) => set({ cycle_limit: n })} />
      </Field>
      <Hint>Để trống là không đặt. Hạn mức mềm chỉ để nhìn lại, không giữ tiền, không âm, không bù.</Hint>
      {!isNew && <Check id="g-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      <Footer
        busy={busy}
        error={error}
        label={isNew ? "Thêm nhóm" : "Lưu nhóm"}
        onSubmit={() =>
          void run(
            groupPayload(f, item),
            (body) => (isNew ? api.post("/v1/settings/category-groups", body) : api.patch(`/v1/settings/category-groups/${encodeURIComponent(item.id)}`, body)),
            `${isNew ? "Đã thêm" : "Đã lưu"} nhóm ${f.name.trim()}.`,
          )
        }
      />
      {item && (
        <>
          <div class="set-sub">Danh mục trong nhóm</div>
          {inGroup.length === 0 && <Hint>Chưa có danh mục nào.</Hint>}
          {inGroup.map((c) => (
            <div key={c.id} class="field">
              <span class="k">{c.name}</span>
              <button type="button" class="btn btn-ghost" disabled={!online || moving} onClick={() => void move(c.id, null, `Đã bỏ ${c.name} khỏi nhóm ${item.name}.`)}>
                Bỏ khỏi nhóm
              </button>
            </div>
          ))}
          {item.active && others.length > 0 && (
            <Field id="g-add" label="Thêm danh mục">
              <select
                id="g-add"
                class="ctl"
                value=""
                disabled={!online || moving}
                onChange={(ev) => {
                  const c = others.find((x) => x.id === ev.currentTarget.value);
                  if (c) void move(c.id, item.id, `Đã chuyển ${c.name} vào nhóm ${item.name}.`);
                }}
              >
                <option value="">Chọn danh mục</option>
                {others.map((c) => {
                  const from = groups.find((g) => g.id === c.groupId)?.name;
                  return (
                    <option key={c.id} value={c.id}>
                      {from ? `${c.name} (đang ở ${from})` : c.name}
                    </option>
                  );
                })}
              </select>
            </Field>
          )}
          {moveError && (
            <p class="err" role="alert">
              {moveError}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

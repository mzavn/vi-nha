// Giờ nhắc của cả nhà (Cài đặt › Thông báo › Giờ nhắc): đọc từ bảng config, giờ VN, bội số 15 phút
// vì cron chạy mỗi 15 phút (đêm 01:00–03:59 mỗi giờ — ADR-70).

export interface NotifySchedule {
  dailyTime: string;
  /** 1 = thứ Hai .. 7 = Chủ nhật (ISO). */
  weeklyDay: number;
  weeklyTime: string;
  quietStart: string;
  quietEnd: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  pendingEnabled: boolean;
}

export const NOTIFY_CONFIG_KEYS = {
  dailyTime: "notify_daily_time",
  weeklyDay: "notify_weekly_day",
  weeklyTime: "notify_weekly_time",
  quietStart: "notify_quiet_start",
  quietEnd: "notify_quiet_end",
  dailyEnabled: "notify_daily_enabled",
  weeklyEnabled: "notify_weekly_enabled",
  pendingEnabled: "notify_pending_enabled",
} as const satisfies Record<keyof NotifySchedule, string>;

export const NOTIFY_DEFAULTS: NotifySchedule = {
  dailyTime: "07:00",
  weeklyDay: 1,
  weeklyTime: "08:00",
  quietStart: "22:00",
  quietEnd: "06:30",
  dailyEnabled: true,
  weeklyEnabled: true,
  pendingEnabled: true,
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → phút trong ngày; null nếu không đúng dạng. */
export function clockMinutes(hhmm: string): number | null {
  const m = CLOCK.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Dòng config (k → v) thành lịch; giá trị thiếu hay hỏng thì dùng mặc định chứ không làm hỏng cron. */
export function parseNotifySchedule(config: Record<string, string>): NotifySchedule {
  const clock = (k: keyof NotifySchedule) => {
    const v = config[NOTIFY_CONFIG_KEYS[k]];
    return v !== undefined && clockMinutes(v) !== null ? v : (NOTIFY_DEFAULTS[k] as string);
  };
  const flag = (k: keyof NotifySchedule) => {
    const v = config[NOTIFY_CONFIG_KEYS[k]];
    return v === "1" ? true : v === "0" ? false : (NOTIFY_DEFAULTS[k] as boolean);
  };
  const day = Number(config[NOTIFY_CONFIG_KEYS.weeklyDay]);
  return {
    dailyTime: clock("dailyTime"),
    weeklyDay: Number.isInteger(day) && day >= 1 && day <= 7 ? day : NOTIFY_DEFAULTS.weeklyDay,
    weeklyTime: clock("weeklyTime"),
    quietStart: clock("quietStart"),
    quietEnd: clock("quietEnd"),
    dailyEnabled: flag("dailyEnabled"),
    weeklyEnabled: flag("weeklyEnabled"),
    pendingEnabled: flag("pendingEnabled"),
  };
}

/**
 * Phút `minute` có nằm trong giờ yên lặng [start, end) không. Khung qua nửa đêm (22:00–06:30) được hiểu là
 * từ start tối nay tới end sáng mai. start = end nghĩa là không đặt giờ yên lặng.
 */
export function inQuietHours(minute: number, quietStart: string, quietEnd: string): boolean {
  const start = clockMinutes(quietStart)!;
  const end = clockMinutes(quietEnd)!;
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

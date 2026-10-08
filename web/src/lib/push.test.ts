import { describe, expect, it } from "vitest";
import { base64UrlToBytes, deviceLabel, isIos, lastOkText, pushState, seriesView, sqliteUtcToIso, type PushCaps } from "./push";
import type { PushTestSeries } from "./types";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const WIN_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";

const caps = (over: Partial<PushCaps>): PushCaps => ({ supported: true, ios: false, standalone: false, permission: "default", subscribed: false, ...over });

describe("pushState", () => {
  it("iPhone chưa thêm vào màn hình chính thì chỉ cách cài, kể cả khi Safari không có PushManager", () => {
    expect(pushState(caps({ ios: true, standalone: false, supported: false }))).toBe("needs-install");
    expect(pushState(caps({ ios: true, standalone: false, supported: true }))).toBe("needs-install");
  });

  it("iPhone mở từ màn hình chính đi theo quyền như máy khác; iOS cũ không có PushManager là không hỗ trợ", () => {
    expect(pushState(caps({ ios: true, standalone: true }))).toBe("off");
    expect(pushState(caps({ ios: true, standalone: true, supported: false }))).toBe("unsupported");
  });

  it("máy không có push là không hỗ trợ, bất kể quyền", () => {
    expect(pushState(caps({ supported: false, permission: "granted", subscribed: true }))).toBe("unsupported");
  });

  it("bị chặn thắng cả khi còn subscription cũ", () => {
    expect(pushState(caps({ permission: "denied", subscribed: true }))).toBe("blocked");
  });

  it("chỉ 'đã bật' khi vừa có quyền vừa có subscription", () => {
    expect(pushState(caps({ permission: "granted", subscribed: true }))).toBe("on");
    expect(pushState(caps({ permission: "granted", subscribed: false }))).toBe("off");
    expect(pushState(caps({ permission: "default", subscribed: true }))).toBe("off");
  });
});

describe("isIos", () => {
  it("nhận iPhone và iPadOS tự nhận là Mac khi có cảm ứng", () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(isIos(IPAD_DESKTOP, 5)).toBe(true);
  });

  it("Mac thật (không cảm ứng) và Android không phải iOS", () => {
    expect(isIos(IPAD_DESKTOP, 0)).toBe(false);
    expect(isIos(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("base64UrlToBytes", () => {
  it("giải base64url không đệm, có - và _", () => {
    expect([...base64UrlToBytes("-_8")]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes("AQID")]).toEqual([1, 2, 3]);
  });

  it("khoá công khai P-256 dạng raw ra đúng 65 byte, mở đầu 0x04", () => {
    const raw = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
    const b64url = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const out = base64UrlToBytes(b64url);
    expect(out.length).toBe(65);
    expect([...out]).toEqual([...raw]);
  });
});

describe("deviceLabel", () => {
  it("gọi máy theo thiết bị · trình duyệt", () => {
    expect(deviceLabel(IPHONE)).toBe("iPhone · Safari");
    expect(deviceLabel(IPHONE_CHROME)).toBe("iPhone · Chrome");
    expect(deviceLabel(IPAD_DESKTOP, 5)).toBe("iPad · Safari");
    expect(deviceLabel(IPAD_DESKTOP, 0)).toBe("Mac · Safari");
    expect(deviceLabel(ANDROID_CHROME)).toBe("Android · Chrome");
    expect(deviceLabel(SAMSUNG)).toBe("Android · Samsung Internet");
    expect(deviceLabel(WIN_EDGE)).toBe("Windows · Edge");
    expect(deviceLabel(MAC_FIREFOX)).toBe("Mac · Firefox");
  });

  it("user agent lạ vẫn có nhãn", () => {
    expect(deviceLabel("")).toBe("Máy không rõ");
  });
});

describe("lastOkText", () => {
  it("giờ SQLite (UTC, không múi) đọc theo giờ VN", () => {
    expect(sqliteUtcToIso("2026-10-01 01:05:00")).toBe("2026-10-01T01:05:00Z");
    expect(lastOkText("2026-10-01 01:05:00")).toBe("nhận tin gần nhất 08:05 1/10");
    expect(lastOkText("2026-09-30T18:30:00.000Z")).toBe("nhận tin gần nhất 01:30 1/10");
  });

  it("máy chưa nhận tin nào", () => {
    expect(lastOkText(null)).toBe("chưa nhận tin nào");
  });
});

describe("seriesView", () => {
  const s = (over: Partial<PushTestSeries>): PushTestSeries => ({ id: 1, status: "running", sent: 0, count: 2, interval_s: 10, createdAt: "2026-10-01 01:00:00", ...over });

  it("đang gửi thì hiện hướng dẫn tắt app theo đúng nhịp của lượt, kèm nút Huỷ", () => {
    expect(seriesView(s({}))).toEqual({
      active: true,
      title: "Đang gửi thử: 0/2 tin",
      sub: "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây, tin 2 sau khoảng 20 giây.",
    });
    expect(seriesView(s({ sent: 0, count: 1 }))).toMatchObject({ active: true, sub: "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây." });
    expect(seriesView(s({ status: "pending" })).active).toBe(true);
  });

  it("xong, huỷ hay chưa có lượt nào thì không còn nút Huỷ; xong mà không gửi được tin nào thì báo lỗi", () => {
    expect(seriesView(null).active).toBe(false);
    expect(seriesView(s({ status: "done", sent: 2 }))).toMatchObject({ active: false, title: "Đã gửi thử 2/2 tin" });
    expect(seriesView(s({ status: "done", sent: 0 }))).toMatchObject({ active: false, title: "Chưa gửi được tin thử nào" });
    expect(seriesView(s({ status: "cancelled", sent: 1 }))).toEqual({ active: false, title: "Đã huỷ gửi thử", sub: "Đã gửi 1/2 tin trước khi huỷ." });
  });
});

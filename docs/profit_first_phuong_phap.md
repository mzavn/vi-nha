# Profit First cho hộ gia đình — NGUYÊN LÝ (v0.5)

> Bộ tài liệu: **file này (nguyên lý)** · `core_design_rules.md` (luật thi hành) ·
> `schema.sql` + `seed.sql` (DB) · `wireframe.md` (giao diện).
> v0.5 = v0.4 (7/2026) hợp nhất sổ tay 9/2026: thuế 10%, Must/Have, danh mục, đa tài khoản.

---

## 0. Luật gốc — hiến pháp

> **1. Tiền là thật, chi là chi thật.** Chỉ ghi và chỉ chia tiền **đã thật sự về tài khoản**.
> **2. Phân bổ trước rồi mới chi.** Cắt Tích sản + Thuế ra trước và **khóa lại**;
> chi phí sống bằng đúng phần còn lại và **tự co cho vừa**.

Hai hệ quả bắt buộc:
- **Không mượn ngược** từ phần đã khóa. Thiếu thì bóp chi, không đụng Tích sản.
- **Sự eo hẹp phải nhìn thấy được.** Nếu app giấu chuyện thiếu tiền thì nó vô dụng.

---

## 1. Vì sao đảo công thức

| | Công thức | Hệ quả |
|---|---|---|
| Truyền thống | `Doanh thu − Chi phí = Lợi nhuận` | lợi nhuận là *phần dư* → gần như luôn bằng 0 |
| Profit First | `Doanh thu − Lợi nhuận = Chi phí` | lợi nhuận lấy trước, phải sống bằng phần còn lại |

Sức mạnh nằm ở **hành vi**, không ở toán học:
1. **Định luật Parkinson** — chi tiêu phình ra lấp đầy nguồn lực thấy được → giảm số tiền *nhìn thấy* để chi.
2. **Đĩa nhỏ / phong bì** — tách nhiều ví để mắt thấy ranh giới, thay vì một cục tiền chung.
3. **Ma sát** — Tích sản và Thuế để ở **ngân hàng khác**, khó rút. Hệ thống làm việc thay cho ý chí.

Sổ tay 9/2026 ghi đúng cùng một ý: `DT − CP = LN` ⇒ `DT − LN = CP` — *sống với phần còn lại*.

---

## 2. Bốn phe (tier) và hai thứ tự ngược nhau

Thứ tự **RÓT** (khi tiền về):
```
Thu nhập ─► Tích sản ─► Thuế ─► Hưởng thụ ─► Vận hành (nhận PHẦN CÒN LẠI)
```
Thứ tự **BÓP** (khi tiền thiếu) — **ngược lại**:
```
Có-thì-tốt về 0 ─► Hưởng thụ bóp ─► Vận hành bóp tới SÀN CỨNG ─► KHÔNG BAO GIỜ chạm Tích sản
```

> Lẫn hai thứ tự này là lỗi phổ biến nhất. Vận hành rót *cuối* nhưng được *bảo vệ bằng sàn cứng*;
> Hưởng thụ rót *sớm hơn* nhưng bị bóp *trước*.
>
> Khi đủ tiền, hai thứ tự cho cùng một kết quả. Khi thiếu, **thứ tự bóp quyết định** — nên engine thực thi theo
> ưu tiên: Tích sản → Thuế → sàn Must → Must đủ → Hưởng thụ → Có-thì-tốt (`core_design_rules.md` §4).

| Phe | Ý nghĩa cá nhân | Vai trò |
|---|---|---|
| `holding` — Thu nhập | mọi dòng tiền vào | **trạm trung chuyển, không tiêu từ đây** |
| `wealth_building` — Tích sản | của cải dài hạn | trả cho bản thân tương lai; khóa, khó chạm |
| `tax` — Thuế | dự phòng thuế | xem §3 |
| `nice` — Hưởng thụ | chơi, mua sắm, du lịch | phần thưởng cho hiện tại; **bị bóp đầu tiên** |
| `must` — Vận hành | chi phí sống | chia hai nhóm: **Must** (sàn cứng) và **Have** (co giãn, nhận phần dư) |

**Must vs Have** (sổ tay 9/2026): Must ~80% là thứ không có thì đời sống gãy — nhà, ăn, điện nước, đi lại.
Have ~20% là có-thì-tốt — xe cộ, thiết bị, y tế, tập luyện, biếu bố mẹ, cho vay. Have là ví `remainder`:
**chính nó là chỗ "sống với phần còn lại" diễn ra**.

---

## 3. Thuế — chỗ hoàn cảnh người làm công làm đổi cuộc chơi

Lương đã khấu trừ tại nguồn → phần đó **không trích thuế nữa** (`taxable = 0`).
Thu nhập ngoài (dự án, cổ tức, bán hàng) → trích **10% tạm tính** vào ví Thuế ngay khi tiền về.

Cuối năm quyết toán:
- Thiếu → nộp thêm từ ví Thuế.
- **Thừa → chuyển phần thừa sang Tích sản**, không tiêu.

Ví Thuế đứng **sau** Tích sản trong thứ tự rót (A2 Profit First trên A4 Thuế trong sổ tay),
nhưng cả hai đều thuộc phần **đã khóa** — không có ngoại lệ nào rút ra để chi.

---

## 4. Ranh giới hộ gia đình

Đơn vị kinh tế là **hộ**, không phải từng người.

- Tiền vợ chuyển cho chồng → **chuyển nội bộ**, loại khỏi sổ thu/chi. Không phải thu nhập.
- **Không ghi nợ nội bộ.** Tiền đã chung thì không ai nợ ai.
- `by_member_id` chỉ là **nhãn "ai chi"**, không phải "tiền của ai".
- Ví riêng (Chơi-chồng, Chơi-vợ) là để *tự do không phải giải trình*, không phải để chia tài sản.

Hệ quả kỹ thuật: mọi giao dịch giữa các tài khoản trong hộ đều là `transfer` — kể cả rút ATM ra tiền mặt.

---

## 5. Tích sản: MỘT quỹ, HAI trạng thái tiền

```
tiền vào Tích sản ──► CASH ──(buy_asset, bất cứ lúc nào còn cash)──► ASSETS
                       │                                              (vàng, CK, CCQ, BĐS)
                       └── Quỹ an tâm chỉ đếm phần CASH
```

- **Quỹ an tâm không phải ví riêng, cũng không phải con số cứng.** Nó là *ngưỡng tính động* bên trong ví Tích sản:
  `Quỹ an tâm = safety_fund_months × chi Must trung bình 3 tháng gần nhất`. Mức sống lên thì Quỹ an tâm tự lên — không phải sửa tay.
- Quỹ an tâm **chỉ tính tiền mặt** của Tích sản; vàng và tài sản khác là tích lũy dài hạn, không tính vào Quỹ an tâm. Mua tài sản (vd vàng khi giá xuống) được làm **bất cứ lúc nào** Tích sản còn tiền mặt, không cần đợi Quỹ an tâm đầy — chỉ là quỹ sẽ đầy chậm hơn (ADR-62, `specs/decisions.md`).
- `buy_asset` không làm giảm số dư Tích sản — chỉ đổi **trạng thái** tiền từ cash sang assets.
- Đây là chỉ số game tài chính: assets tăng đều = đang thắng (khớp Kiyosaki: mua tài sản, không mua tiêu sản).

---

## 6. Ba trục độc lập — ví, tài khoản, danh mục

| Trục | Trả lời | Ví dụ |
|---|---|---|
| **Ví** | tiền này *được phép* tiêu vào việc gì, còn bao nhiêu? | Must-Đi lại |
| **Tài khoản** | tiền đang *nằm ở đâu* thật? | Tiền mặt, VCB, TCB |
| **Danh mục** | khoản này *thuộc loại gì* để phân tích? | Xăng xe |

*Chi 250k tiền mặt mua xăng* = ví **Đi lại** · tài khoản **Tiền mặt** · danh mục **Xăng xe**.

Ví là đơn vị **ngân sách** (~10 cái, có target). Danh mục là **nhãn phân tích** (~20 cái, không có target).
Nếu mỗi danh mục thành một ví thì có 20+ phong bì — không ai duy trì nổi.

**Tiền mặt là một tài khoản**, không phải ngoại lệ. Rút ATM = `transfer` bank → cash, **không phải chi tiêu**
(ghi nhầm chỗ này là sổ báo tiêu gấp đôi). Tiền mặt không có feed nên đối soát bằng **đếm ví**.

---

## 7. Ba câu hỏi giải mọi tình huống chưa gặp

1. Tiền có **vượt ranh giới hộ gia đình** không? *(không → chuyển nội bộ, loại khỏi sổ)*
2. Có phải **tiền thật** hay chỉ ghi nhận? *(không thật → không vào sổ)*
3. Thuộc phe **khóa / must / nice**?

---

## 8. Ánh xạ sang doanh nghiệp sau này

Cùng bộ luật áp thẳng: ví cá nhân → tài khoản PF doanh nghiệp (Income, Profit, Owner's Pay, Tax, OpEx).
Luật "tiền thật, chi thật" + loại transfer nội bộ chính là thứ chặn **lãi giả lỗ thật**
(xuất hàng ghi doanh thu ngay → sổ báo lãi, nhưng khách trả sau, tiền mặt đã bay → túi rỗng).

> ⚠️ Profit First là lớp **quản trị dòng tiền theo tư duy tiền mặt**, **không thay** sổ kế toán luật định.
> Chạy song song: PF để *điều hành*, sổ thuế để *tuân thủ*.

---

## Nguồn tham khảo
Mike Michalowicz — *Profit First* (2014) · Brex, Relay, Monkhouse & Co (hướng dẫn tỷ lệ TAPs/CAPs) ·
Robert Kiyosaki — định nghĩa tài sản/tiêu sản theo chiều dòng tiền.
Mọi nội dung ở đây diễn giải lại bằng lời của tài liệu này.

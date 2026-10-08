# Entity Model — <Tên context>

Không phải sơ đồ cơ sở dữ liệu: chỉ tên nghiệp vụ, nghĩa, trạng thái, quan hệ, bất biến.

## <Entity, ví dụ Đơn hàng (Order)>
- Là: <một câu định nghĩa>
- Trạng thái: <nháp, chờ thanh toán, đã thanh toán, đã huỷ>
- Có nhiều: <Entity con>
- Thuộc: <Entity cha>
- Thuộc tính đáng ghi:
  - `<field>`: <nghĩa>; đặt khi <rule + thời điểm>; <đổi về sau không>; phục vụ BR-XX
- Bất biến: <điều luôn đúng>

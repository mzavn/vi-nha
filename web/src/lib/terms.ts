// Một câu giải thích cho mỗi thuật ngữ, hiện tại chỗ khi bấm ⓘ (pwa UC-711 AC-35). Không số tiền, ≤ 140 ký tự, viết cho người
// chưa đọc hướng dẫn. Nghĩa theo docs/glossary.md.

export type Term = "operating" | "reserve" | "savings" | "moneyAge" | "peace" | "payables" | "reward";

export const TERMS: Record<Term, { label: string; text: string }> = {
  operating: { label: "Vận hành", text: "Tiền sống hằng ngày tới ngày lương: ăn uống, đi lại, hoá đơn. Số chi mỗi ngày tính từ ngăn này." },
  reserve: { label: "Dự phòng", text: "Tiền để riêng cho các khoản đã biết sẽ phải trả, như học phí, bảo hiểm, cùng phần an tâm khi có việc bất ngờ." },
  savings: { label: "Tích luỹ", text: "Phần trích ra ngay khi lương về để dành lâu dài. Không dùng cho chi tiêu hằng ngày." },
  moneyAge: { label: "Tuổi tiền", text: "Tiền đang tiêu về tay cách đây bao nhiêu ngày. Từ một tháng trở lên là đã có đệm một tháng." },
  peace: { label: "Phần an tâm", text: "Tiền Dự phòng không gắn mục tiêu nào, tính bằng số tháng chi tiêu mà nó đủ trả nếu mất thu nhập." },
  payables: { label: "Khoản phải trả", text: "Hoá đơn trả hằng tháng từ tiền Vận hành, như điện, nước, học thêm. Đã chừa sẵn trước khi tính chi mỗi ngày." },
  reward: { label: "Ví Thưởng", text: "Tài khoản nhận một phần tiền dư cuối tháng, để tiêu tự do mà không ảnh hưởng tiền sống." },
};

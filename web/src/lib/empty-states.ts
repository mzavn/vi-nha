// Một nguồn chữ trạng thái rỗng cho mọi danh sách (pwa UC-711 AC-37).
// Mỗi mục gồm câu nói danh sách chứa gì và gợi ý bước tiếp, ≤ 140 ký tự, không chữ số.

export interface EmptyAction {
  label: string;
}

export interface EmptyState {
  title: string;
  hint?: string;
  action?: EmptyAction;
}

export type EmptyStateKey =
  | "ledgerMonth"
  | "ledgerFilter"
  | "assign"
  | "recent"
  | "pocketOperating"
  | "pocketSavings"
  | "pocketReserve"
  | "pocketOther"
  | "holdingAssets"
  | "reserveGoals"
  | "spending"
  | "debtsIowe"
  | "debtsOwedMe"
  | "tenants"
  | "reportSheet"
  | "reportCashFlow"
  | "reportIncome"
  | "reportFreedom"
  | "pendingQueue";

export const EMPTY_STATES: Record<EmptyStateKey, EmptyState> = {
  ledgerMonth: {
    title: "Không có giao dịch nào trong tháng này.",
    hint: "Các khoản chi tiêu hoặc thu nhập của tháng sẽ hiện ở đây.",
    action: { label: "Ghi khoản" },
  },
  ledgerFilter: {
    title: "Không có giao dịch nào khớp bộ lọc.",
    hint: "Thử chọn tài khoản khác hoặc xoá bớt điều kiện lọc.",
  },
  assign: {
    title: "Không còn giao dịch nào cần gán.",
    hint: "Mọi biến động ngân hàng đã được xếp vào sổ đầy đủ.",
  },
  recent: {
    title: "Chưa có giao dịch gần đây.",
    hint: "Các giao dịch mới ghi sẽ xuất hiện tại đây.",
    action: { label: "Ghi khoản" },
  },
  pocketOperating: {
    title: "Chưa có tài khoản ở ngăn Vận hành.",
    hint: "Thêm tài khoản chi tiêu hằng ngày để theo dõi ngân sách sống.",
    action: { label: "Cài đặt tài khoản" },
  },
  pocketSavings: {
    title: "Chưa có tài khoản ở ngăn Tích luỹ.",
    hint: "Dành riêng một tài khoản để nhận tiền trích mỗi khi lương về.",
    action: { label: "Cài đặt tài khoản" },
  },
  pocketReserve: {
    title: "Chưa có tài khoản ở ngăn Dự phòng.",
    hint: "Để tiền cho các việc đã biết sẽ phải trả và phần an tâm.",
    action: { label: "Cài đặt tài khoản" },
  },
  pocketOther: {
    title: "Không có tài khoản ngoài ba ngăn.",
    hint: "Mọi tài khoản của nhà đã được xếp vào đúng ba ngăn.",
  },
  holdingAssets: {
    title: "Chưa có tài sản tích luỹ nào.",
    hint: "Ghi lại vàng hoặc tài sản giữ lâu dài bằng nút Mua tài sản.",
    action: { label: "Mua tài sản" },
  },
  reserveGoals: {
    title: "Chưa có mục tiêu dự phòng nào.",
    hint: "Lên kế hoạch cho các khoản chi lớn trong năm để không bất ngờ.",
    action: { label: "Thêm mục tiêu" },
  },
  spending: {
    title: "Chưa có dữ liệu chi tiêu trong kỳ.",
    hint: "Các khoản chi theo nhóm danh mục sẽ được tổng hợp tại đây.",
  },
  debtsIowe: {
    title: "Không có khoản nợ nào cần trả.",
    hint: "Ghi nhận các khoản vay hoặc nợ thẻ để theo dõi lịch trả.",
    action: { label: "Thêm khoản nợ" },
  },
  debtsOwedMe: {
    title: "Không có khoản nào người khác đang nợ.",
    hint: "Ghi lại các khoản cho vay hoặc tiền cần thu hồi.",
    action: { label: "Thêm khoản phải thu" },
  },
  tenants: {
    title: "Chưa có hợp đồng hoặc người thuê nào.",
    hint: "Theo dõi tiền thuê nhà và tiền điện nước từng phòng tại đây.",
    action: { label: "Thêm người thuê" },
  },
  reportSheet: {
    title: "Chưa có số liệu trong bảng cân đối.",
    hint: "Số dư các tài khoản và nợ sẽ tạo nên bức tranh tài sản ròng.",
  },
  reportCashFlow: {
    title: "Chưa có dòng tiền trong khoảng thời gian này.",
    hint: "Biểu đồ tiền vào và tiền ra giúp nhìn rõ nhịp sống cả nhà.",
  },
  reportIncome: {
    title: "Chưa có số liệu thu chi trong kỳ.",
    hint: "Báo cáo so sánh tổng thu nhập và chi phí để biết tháng này dư hay hụt.",
  },
  reportFreedom: {
    title: "Chưa có kế hoạch tự do tài chính.",
    hint: "Thiết lập mốc tự do để biết ngày tiền làm việc thay mình.",
    action: { label: "Đặt mục tiêu" },
  },
  pendingQueue: {
    title: "Mọi khoản đã được gửi lên sổ.",
    hint: "Các khoản nhập khi mất mạng sẽ tạm lưu ở đây và tự gửi khi có mạng.",
  },
};

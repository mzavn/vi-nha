// Màn Hướng dẫn (#guide, UC-711 AC-13/14): nhúng GitBook ngay trong app, không rời PWA trên điện thoại.
// Khung chiếm hết chiều cao còn lại (lớp `app-guide` của <main> giữ trang không cuộn hai lớp); không `sandbox` vì
// GitBook cần chạy script. Mở màn lúc đang mất mạng thì báo, không vẽ khung; khung đã tải mà rớt mạng thì để nguyên.
// Mở một lần thì khung sống tới hết phiên (ẩn khi sang màn khác): quay lại là hiện ngay, đúng trang đang đọc, không tải lại.
// Chưa mở thì không tải gì — chỉ kết nối sẵn tới GitBook (preconnect trong index.html).

import { useState } from "preact/hooks";
import { GUIDE_URL } from "../lib/splits";
import { useApp } from "../state/store";
import { Empty, PageHeader } from "../ui/parts";

let visited = false;

/** Chỗ của màn Hướng dẫn trong <main>: chưa mở lần nào thì không vẽ; đã mở thì giữ khung, chỉ ẩn. */
export function GuideSlot() {
  const app = useApp();
  const active = app.tab === "guide";
  if (active) visited = true;
  return visited ? <Guide active={active} /> : null;
}

function Guide({ active }: { active: boolean }) {
  const app = useApp();
  // Chỉ xét mạng lúc mở màn: đã vẽ khung thì không gỡ khi rớt mạng giữa chừng.
  const [startedOnline] = useState(app.online);
  const [loaded, setLoaded] = useState(false);
  const open = (
    <a class="btn" href={GUIDE_URL} target="_blank" rel="noopener">
      Mở ở tab mới
    </a>
  );
  return (
    <div class="guide" hidden={!active}>
      {/* Tiêu đề chỉ vẽ khi đang xem: nó đo chiều cao thanh tiêu đề cho cả trang, bản ẩn sẽ đo ra 0. */}
      {active && <PageHeader title="Hướng dẫn" action={open} />}
      {startedOnline ? (
        <div class="guide-body">
          {!loaded && (
            <p class="guide-loading" role="status">
              Đang tải hướng dẫn…
            </p>
          )}
          <iframe class="guide-frame" src={GUIDE_URL} title="Hướng dẫn Ví nhà" referrerpolicy="no-referrer" onLoad={() => setLoaded(true)} />
        </div>
      ) : (
        <Empty title="Hướng dẫn cần mạng">Có mạng lại thì mở màn này lần nữa, hoặc bấm Mở ở tab mới.</Empty>
      )}
    </div>
  );
}

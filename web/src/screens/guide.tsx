// Màn Hướng dẫn (#guide, UC-711 AC-13/14): nhúng GitBook ngay trong app, không rời PWA trên điện thoại.
// Khung chiếm hết chiều cao còn lại (lớp `app-guide` của <main> giữ trang không cuộn hai lớp); không `sandbox` vì
// GitBook cần chạy script. Mở màn lúc đang mất mạng thì báo, không vẽ khung; khung đã tải mà rớt mạng thì để nguyên.

import { useState } from "preact/hooks";
import { GUIDE_URL } from "../lib/splits";
import { useApp } from "../state/store";
import { Empty, PageHeader } from "../ui/parts";

export function Guide() {
  const app = useApp();
  // Chỉ xét mạng lúc mở màn: đã vẽ khung thì không gỡ khi rớt mạng giữa chừng.
  const [startedOnline] = useState(app.online);
  const open = (
    <a class="btn" href={GUIDE_URL} target="_blank" rel="noopener">
      Mở ở tab mới
    </a>
  );
  return (
    <>
      <PageHeader title="Hướng dẫn" action={open} />
      {startedOnline ? (
        <iframe class="guide-frame" src={GUIDE_URL} title="Hướng dẫn Ví nhà" referrerpolicy="no-referrer" />
      ) : (
        <Empty title="Hướng dẫn cần mạng">Có mạng lại thì mở màn này lần nữa, hoặc bấm Mở ở tab mới.</Empty>
      )}
    </>
  );
}

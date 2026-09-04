# Đăng ký Tải tăng cường — Migrate Front end sang Vercel

## Kiến trúc

```
User (kể cả email ngoài GHN)
   │  (chỉ chạm Vercel, không chạm google.com)
   ▼
Vercel: index.html + /api/submit + /api/search-warehouse
   │
   ▼
Supabase: bảng warehouses (đã có sẵn), bảng tickets (mới)
   ▲                                    │
   │  (Apps Script tự gọi RA ngoài,     │ (Apps Script pull mỗi 1 phút)
   │   không phải ai "vào" Google)      ▼
   └──────────────  Apps Script (Sync.gs)
                           │
                           ▼
              Google Sheet: Responses, Nội thành, Nội vùng
                           │
                    (giám sát duyệt trực tiếp trong Sheet — LINK KHÔNG ĐỔI)
                           │
                           ▼
                 checkAndSendStatusUpdates (có sẵn, không đổi) → Telegram
```

Link Google Sheet mà GSVT dùng để duyệt **không đổi**. Chỉ link đăng ký (front end) đổi từ URL Apps Script sang URL Vercel.

## Thứ tự deploy

### 1. Supabase

Bảng `m12.warehouses` thật đã xác nhận có cấu trúc: `warehouse_id` (mã bưu cục, vd "2388"), `name`, `name_norm` (không dấu, để search), `district_name`, `province_name` (2 cột này có thể trống), `active`, `lat/lng`. Code đã cập nhật khớp với cấu trúc này (không phải `id/name/region` như bản nháp ban đầu).

1. Mở project Supabase đã có sẵn bảng `m12.warehouses`.
2. **Bắt buộc**: vào Project Settings -> API -> "Exposed schemas" (Data API settings), thêm `m12` vào danh sách. Không làm bước này thì mọi request (kể cả dùng đúng service_role key) tới bảng trong schema `m12` sẽ lỗi.
3. Vào SQL Editor, dán nội dung `supabase/migration.sql` (tạo thêm `m12.tickets` + sequence, gồm cả cột `photo_url`; không đụng gì tới `m12.warehouses` có sẵn).
4. **Trước khi chạy**, đổi `start with 1000` trong `create sequence m12.ticket_id_seq` thành số **lớn hơn** Ticket_id cao nhất hiện có trong sheet Nội thành (mở sheet, xem cột B dòng cuối, vd đang là TTC-320 thì set `start with 400`).
5. Chạy migration.
6. **Bắt buộc thêm (tính năng ảnh hàng tồn kho)**: vào Storage -> New bucket, tạo bucket tên `ticket-photos`, bật **Public bucket = ON** (để link ảnh dùng thẳng được trong Google Sheet mà không cần ký lại URL). Không tạo được bucket bằng SQL, phải làm thủ công ở Dashboard.
7. Lấy `Project URL` và `service_role key` (Project Settings -> API) — cần cho cả bước 2 và bước 3.

⚠️ **Cần kiểm tra thêm — chưa verify được vì chỉ có 1 dòng mẫu:** dòng mẫu bạn gửi có `province_name = null`. Code đang áp dụng đúng fallback cũ (`province_name` trống -> mặc định "Hồ Chí Minh", giống hệt `processForm()` gốc). Nhưng nếu `province_name` CÓ giá trị ở các dòng khác, cần đảm bảo giá trị đó khớp CHÍNH XÁC (kể cả dấu, viết hoa) với tên tỉnh trong `TELEGRAM_CONFIG.groups` của Code.js ("Hồ Chí Minh", "Tiền Giang", "Cần Thơ", "Long An", "Bình Dương", "Tây Ninh", "Bến Tre", "Đồng Tháp") — vì đây là so khớp chuỗi tuyệt đối, lệch 1 ký tự là ticket sẽ rơi vào nhóm Telegram "Default". Chạy thử `select distinct province_name from m12.warehouses where province_name is not null` rồi đối chiếu giúp trước khi cutover thật.

### 2. Vercel (front end)

1. Push thư mục `vercel-app/` lên 1 repo GitHub (hoặc dùng Vercel CLI `vercel deploy` trực tiếp từ thư mục này).
2. Import repo vào Vercel, tạo project mới.
3. Trong Project Settings -> Environment Variables, thêm:
   - `SUPABASE_URL` = Project URL ở bước 1
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key ở bước 1
4. Deploy. URL Vercel sinh ra (vd `dang-ky-tai-tang-cuong.vercel.app`) chính là link đăng ký mới — thay cho link Apps Script cũ.
5. Test: mở link, đăng ký thử 1 ticket (bắt buộc chụp/dán ảnh hàng tồn kho), kiểm tra bảng `tickets` trong Supabase có dòng mới với `synced_to_sheet = false` và `photo_url` có link ảnh.

**Tính năng chụp/upload ảnh hàng tồn kho (mới thêm):**
- Trên điện thoại: nút icon camera mở thẳng camera sau (`capture="environment"`), trình duyệt sẽ hỏi quyền truy cập camera lần đầu.
- Trên máy tính: có thể bấm nút để chọn file, hoặc **Ctrl/Cmd+V dán ảnh** (screenshot/copy từ nơi khác) thẳng vào trang.
- Ảnh được nén lại ở trình duyệt (canvas, giới hạn 1600px, JPEG chất lượng 0.75) trước khi upload, để nhẹ và không vượt giới hạn kích thước payload của Vercel Serverless Function.
- Flow submit giờ là 2 bước: `/api/upload-photo` (ảnh -> Supabase Storage -> trả về public URL) rồi mới `/api/submit` (kèm `photo_url`). Nếu chưa chọn/chụp ảnh, form sẽ chặn không cho submit.
- Giao diện đã đổi theo tông màu cam GHN (`#F05A1E`) + banner cố định (sticky) ở đầu trang có logo + tên form.

### 3. Apps Script (sync 2 chiều)

Trong project Apps Script hiện tại (nơi đang có Code.js, Index.html, sl_chua_xl.js, warning_blacklist):

1. Tạo file mới, dán nội dung `apps-script/Sync.gs` vào.
2. Mở file `warning_blacklist` gốc, **thay thế** `onEdit_v1`/`onEdit_v2` bằng nội dung `apps-script/warning_blacklist_updated.gs` (đọc kỹ comment trong file — có 1 lỗi nhỏ ở code gốc đã được sửa kèm giải thích).
3. Vào Project Settings (bánh răng bên trái) -> Script Properties, thêm:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key
4. Chạy thủ công 1 lần (chọn hàm trong dropdown trên cùng -> nút Run):
   - `setupSyncTrigger` (chiều 1, mỗi 1 phút)
   - `setupReconcileTrigger` (chiều 2 dự phòng, mỗi 15 phút)
   - `setupOnEditTrigger` (chiều 2 tức thời — **chỉ chạy nếu** onEdit đang gắn kiểu installable trigger; nếu đang là simple trigger `function onEdit(e)` thì đổi tên hàm trong file thành `onEdit` thay vì gọi setup, xem comment trong file).
5. Cấp quyền khi được hỏi (popup OAuth) — không phát sinh scope mới vì `UrlFetchApp` đã được dùng sẵn cho Telegram.
6. Test: quay lại ticket vừa đăng ký thử ở bước 2 — sau tối đa 1 phút phải thấy xuất hiện trong sheet Responses + Nội thành/Nội vùng, và có tin Telegram báo ticket mới.
7. Test chiều ngược: vào sheet, sửa cột "Trạng thái" của ticket vừa tạo thành "Có xe" + điền BKS — kiểm tra bảng `tickets` trong Supabase có cập nhật `trang_thai`, `bks` tương ứng.
8. **Thêm nhãn cột thủ công (1 lần, tính năng ảnh hàng tồn kho)**: `Sync.gs` ghi link ảnh vào cột AE của cả 3 sheet (Responses, Nội thành, Nội vùng) — cột hoàn toàn mới, không dùng cột N vì N đã là "Trạng thái", và không đụng cột nào từ A→AD đang được `checkAndSendStatusUpdates`/blacklist/`tangcuong_adhoc_bot.py` dùng. Nội thành/Nội vùng đã có tiêu đề "Hình kho" ở AE1 — chỉ cần thêm tiêu đề tương tự ở ô AE1 của Responses.

### 4. Cutover

Khi đã test ổn cả 2 chiều:
- Đổi link đăng ký đang gửi cho các NCC/tài xế/user sang URL Vercel mới.
- Có thể tắt hẳn deployment Web App cũ của Apps Script (hoặc để đó cũng không sao, không ai vào được nữa thì thôi).

## Những điều cần bạn xác nhận/theo dõi thêm

- Đã xác nhận cấu trúc thật của `m12.warehouses` — code đã cập nhật khớp.
- Đối chiếu giá trị `province_name` thực tế (khi có) với tên tỉnh trong `TELEGRAM_CONFIG.groups` — xem mục ⚠️ ở bước Supabase phía trên.
- Nhớ thêm `m12` vào "Exposed schemas" trong Supabase — dễ bị bỏ sót nhất, gây lỗi khó hiểu nếu quên.
- Giá trị bắt đầu của `ticket_id_seq` (phải > Ticket_id lớn nhất hiện có).
- Sheet "Nội thành" có đúng là sheet mà bot `tangcuong_adhoc_bot.py` (flow tạo tăng cường ad-hoc) đang đọc không — nếu đúng, không đụng cột Z→AD khi thao tác thủ công.
- ⚠️ **Đã xảy ra thực tế, đã fix**: `rowToStatusPayload()` (dùng cho cả `reconcileAllToSupabase` và onEdit) trước đây KHÔNG set `synced_to_sheet: true` — ticket cũ được tạo mới trong Supabase qua đường reconcile bị mặc định `synced_to_sheet=false`, khiến `syncFromVercel()` hiểu nhầm là ticket mới, ghi trùng vào sheet + spam Telegram cho ticket cũ. Nếu gặp lại tình trạng bot bắn Telegram dồn dập cho ticket cũ: (1) xoá tạm trigger `syncFromVercel` để chặn spam, (2) chạy `update m12.tickets set synced_to_sheet = true, synced_at = now() where synced_to_sheet = false and msnv is null;` để dọn các dòng "mồ côi", (3) đảm bảo `Sync.gs` đang dùng bản mới nhất (có `synced_to_sheet: true` trong `rowToStatusPayload`), (4) tạo lại trigger.
- Đã tạo bucket Storage `ticket-photos` (Public ON) chưa — nếu chưa, `/api/upload-photo` sẽ lỗi 500 dù `m12.tickets` đã có cột `photo_url`.
- Đã thêm tiêu đề cột AE1 ở Responses chưa (Nội thành/Nội vùng đã có sẵn "Hình kho") — bước thủ công, chỉ để dễ nhìn, không bắt buộc để hệ thống chạy được.
- ⚠️ **Đã xảy ra thực tế, đã fix**: `rowToStatusPayload()` trước đây CHỈ đẩy các cột trạng thái (N→U) lên Supabase — ticket cũ/ticket chưa từng đi qua `/api/submit` (chỉ được biết tới qua `reconcileAllToSupabase`) bị null hết region/warehouse_name/msnv/sdt/so_kien/the_tich/ngày giờ/ghi chú dù sheet có đủ dữ liệu. Đã fix: hàm này giờ đọc luôn cột A→M của sheet để điền đủ các cột đó. **Sau khi cập nhật `Sync.gs` bản mới, cần chạy tay 1 lần hàm `reconcileAllToSupabase`** (chọn hàm trong dropdown Apps Script → Run) để backfill lại toàn bộ ticket cũ đã bị thiếu dữ liệu.

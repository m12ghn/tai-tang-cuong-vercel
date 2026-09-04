-- ============================================================
-- Migration: Tickets "Đăng ký Tải tăng cường" — Vercel + Supabase
-- ============================================================
-- Chạy trong Supabase SQL Editor của PROJECT ĐÃ CÓ SẴN bảng m12.warehouses.
--
-- ⚠️ TRƯỚC KHI CHẠY:
--   1. Vào Project Settings -> API -> "Exposed schemas" (Data API settings),
--      thêm `m12` vào danh sách. Không làm bước này thì mọi request qua
--      REST API (kể cả dùng service_role key) tới bảng trong schema m12
--      sẽ lỗi, vì PostgREST chỉ serve các schema được khai báo ở đây.
--   2. Đổi `start with 1000` trong `create sequence` bên dưới thành số
--      LỚN HƠN Ticket_id cao nhất đang có trong sheet "Nội thành" hiện tại.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Bảng m12.warehouses — ĐÃ CÓ SẴN, không tạo/không đổi ở đây.
--    Cấu trúc thật (do user cung cấp):
--      id (uuid, PK nội bộ), warehouse_id (text, mã bưu cục vd "2388"),
--      name (text), name_norm (text, không dấu/lowercase để search),
--      district_name (text, nullable), province_name (text, nullable),
--      lat, lng (float), active (boolean), created_at, updated_at.
--    LƯU Ý: không có cột "region" sẵn — code dùng province_name thay thế,
--    và áp dụng fallback "trống -> Hồ Chí Minh" giống hệt processForm() cũ
--    khi cột region/province trống.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 2. Sequence sinh ticket_id — atomic, không race condition
--    như "TTC-" + lastRow+1 kiểu cũ.
-- ------------------------------------------------------------
create sequence if not exists m12.ticket_id_seq start with 1000; -- ⚠️ ĐỔI SỐ NÀY

-- ------------------------------------------------------------
-- 3. Bảng m12.tickets — cột A→M map với dữ liệu form (chiều 1: tạo ticket),
--    cột trạng thái map với cột N→U của sheet Nội thành (chiều 2: đồng bộ ngược).
--    warehouse_id để dạng text KHÔNG ràng buộc FK cứng tới m12.warehouses
--    (tránh động vào bảng có sẵn của project khác / tránh lỗi nếu
--    warehouse_id ở đó chưa có unique constraint).
-- ------------------------------------------------------------
create table if not exists m12.tickets (
  id                     uuid primary key default gen_random_uuid(),
  ticket_id              text unique not null default ('TTC-' || nextval('m12.ticket_id_seq')),
  created_at             timestamptz not null default now(),

  -- === Dữ liệu từ front end (map cột A-M sheet Nội thành) ===
  region                 text,
  warehouse_id           text,              -- tham chiếu mềm tới m12.warehouses.warehouse_id
  warehouse_name         text,              -- "warehouse_id - name" đã ghép sẵn, hoặc "Khác: ..."
  warehouse_khac         text,              -- chỉ có giá trị khi chọn "Khác"
  lo_trinh               text,
  msnv                   text,
  telegram               text,
  sdt                    text,
  so_kien                integer,
  the_tich               text,
  ngay_mong_muon         text,              -- "dd/MM"
  gio_mong_muon          text,              -- "HH:mm"
  ghi_chu                text,
  photo_url              text,              -- link ảnh hàng tồn kho (Supabase Storage public URL)

  -- === Trạng thái đồng bộ chiều 1 (Vercel -> Sheet) ===
  synced_to_sheet        boolean not null default false,
  synced_at              timestamptz,

  -- === Trạng thái duyệt, đồng bộ ngược chiều 2 (Sheet -> Supabase) ===
  trang_thai             text,              -- "Có xe" / "Không có xe" / "Hủy..."
  ngay_duyet             text,
  gio_toi                text,
  ma_chuyen              text,
  ten_ncc                text,
  bks                    text,
  tai_trong              text,
  thong_tin_tx           text,
  ve_ktc                 text,
  updated_from_sheet_at  timestamptz
);

create index if not exists idx_tickets_pending on m12.tickets (synced_to_sheet) where synced_to_sheet = false;
create unique index if not exists idx_tickets_ticket_id on m12.tickets (ticket_id);
create index if not exists idx_tickets_warehouse_id on m12.tickets (warehouse_id);

-- ------------------------------------------------------------
-- 4. RLS: khoá mặc định, không expose cho client (anon key).
--    Cả Vercel API routes lẫn Apps Script đều dùng SERVICE ROLE KEY
--    (bypass RLS), browser của user KHÔNG BAO GIỜ gọi thẳng Supabase.
-- ------------------------------------------------------------
alter table m12.tickets enable row level security;
-- Không tạo policy nào cho anon -> mặc định deny all với anon/authenticated key.
-- service_role key luôn bypass RLS nên không cần policy riêng.
-- (Không đụng RLS của m12.warehouses vì bảng đó thuộc project/flow khác.)

-- ------------------------------------------------------------
-- 5. Storage bucket lưu ảnh hàng tồn kho — TẠO THỦ CÔNG trong
--    Supabase Dashboard -> Storage -> New bucket:
--      Tên: ticket-photos
--      Public bucket: BẬT (để link ảnh dùng được thẳng trong Google Sheet
--      mà không cần ký lại URL mỗi lần hết hạn)
--    Không tạo được bucket bằng SQL thuần, phải làm qua Dashboard hoặc
--    Management API.
-- ------------------------------------------------------------

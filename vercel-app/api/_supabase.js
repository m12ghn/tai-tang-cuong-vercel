// Client Supabase dùng chung cho mọi API route.
// Dùng SERVICE ROLE KEY (chỉ chạy server-side trong Vercel Functions,
// KHÔNG BAO GIỜ để lộ ra front end / browser).
//
// Set 2 biến môi trường này trong Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[WARN] Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong env vars.');
}

// Bảng warehouses (đã có sẵn) và tickets (mới) đều nằm trong schema `m12`,
// không phải `public` mặc định.
//
// ⚠️ Bắt buộc: vào Supabase Dashboard -> Project Settings -> API ->
// "Exposed schemas" (Data API settings), thêm `m12` vào danh sách schema
// được PostgREST expose — nếu không, mọi request tới bảng trong schema
// này sẽ lỗi dù dùng đúng service_role key.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: 'm12' } }
);

module.exports = { supabase };

// GET /api/search-warehouse?q=xxx
// Thay thế cho hàm searchWarehouses() cũ trong Apps Script.
// Bảng m12.warehouses thật có cột: warehouse_id, name, name_norm,
// district_name, province_name, active (KHÔNG có sẵn 1 cột "id - name"
// gộp sẵn như sheet cũ) -> tự ghép "warehouse_id - name" ở đây để giữ
// nguyên UX/format cho front end (datalist + logic split theo '-').

const { supabase } = require('./_supabase');

// Bỏ dấu tiếng Việt + lowercase, để so khớp với cột name_norm
function stripVietnameseTones(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const q = (req.query.q || '').toString().trim();
  if (q.length < 2) {
    res.status(200).json([]);
    return;
  }

  const qNorm = stripVietnameseTones(q);

  const { data, error } = await supabase
    .from('warehouses')
    .select('warehouse_id,name')
    .eq('active', true)
    .or(`warehouse_id.ilike.%${q}%,name_norm.ilike.%${qNorm}%`)
    .limit(15);

  if (error) {
    console.error('search-warehouse error:', error.message);
    res.status(500).json({ error: 'Lỗi tìm kiếm bưu cục' });
    return;
  }

  // Trả về format "warehouse_id - name" giống hệt sheet Warehouses cũ
  // để không phải đổi logic parse ở front end.
  const results = (data || []).map((w) => `${w.warehouse_id} - ${w.name}`);
  res.status(200).json(results);
};

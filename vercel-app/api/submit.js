// POST /api/submit
// Thay thế cho hàm processForm() cũ trong Apps Script.
// Ghi ticket vào Supabase (bảng tickets, synced_to_sheet = false).
// KHÔNG gửi Telegram ở đây — việc đó do Apps Script làm khi sync
// ticket này vào Google Sheet (để bot token không phải đưa lên Vercel).

const { supabase } = require('./_supabase');

const REQUIRED_FIELDS = ['warehouse', 'lo_trinh', 'msnv', 'sdt', 'so_kien', 'the_tich', 'ngay', 'gio', 'photo_url'];

const ALLOWED_LOAI_XE = ['E-Van', 'Van Gaz', '1T9', '5T', '8T'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] && body[field] !== 0) {
      res.status(400).json({ error: `Thiếu trường bắt buộc: ${field}` });
      return;
    }
  }

  const rawWarehouse = body.warehouse.toString().trim();
  let warehouse_id = null;
  let warehouse_name = rawWarehouse;
  let warehouse_khac = null;
  let region = null;

  if (rawWarehouse.toLowerCase() === 'khác') {
    warehouse_name = 'Khác: ' + (body.warehouse_khac || '');
    warehouse_khac = body.warehouse_khac || '';
    region = body.tinh_khac || 'Default';
  } else {
    // Format hiển thị: "2388 - Tên kho" -> lấy phần trước dấu '-' làm warehouse_id
    const cleanId = rawWarehouse.split('-')[0].trim();

    // Bảng m12.warehouses thật không có cột "region" — dùng province_name.
    // Nhiều dòng đang để trống province_name (chưa update dữ liệu gốc),
    // nên áp dụng đúng fallback mà processForm() cũ đã dùng khi region trống.
    const { data: match, error: matchErr } = await supabase
      .from('warehouses')
      .select('warehouse_id,name,province_name')
      .eq('warehouse_id', cleanId)
      .eq('active', true)
      .maybeSingle();

    if (matchErr) {
      console.error('lookup warehouse error:', matchErr.message);
    }

    if (match) {
      warehouse_id = match.warehouse_id;
      warehouse_name = `${match.warehouse_id} - ${match.name}`;
      region = (match.province_name && match.province_name.trim() !== '')
        ? match.province_name.trim()
        : 'Hồ Chí Minh';
    } else {
      // Không tìm thấy (hoặc không active) trong bảng warehouses -> giữ nguyên
      // input, region "Chưa phân loại" (giống hệt hành vi processForm cũ).
      region = 'Chưa phân loại';
    }
  }

  const insertPayload = {
    region,
    warehouse_id,
    warehouse_name,
    warehouse_khac,
    lo_trinh: body.lo_trinh,
    msnv: body.msnv.toString(),
    telegram: body.telegram || null,
    sdt: body.sdt.toString(),
    so_kien: parseInt(body.so_kien, 10) || 0,
    the_tich: body.the_tich,
    ngay_mong_muon: body.ngay,
    gio_mong_muon: body.gio,
    ghi_chu: body.ghi_chu || null,
    loai_xe: ALLOWED_LOAI_XE.includes(body.loai_xe) ? body.loai_xe : null,
    photo_url: body.photo_url,
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('ticket_id')
    .single();

  if (error) {
    console.error('insert ticket error:', error.message);
    res.status(500).json({ error: 'Không ghi được ticket, vui lòng thử lại.' });
    return;
  }

  res.status(200).json({ ticket_id: data.ticket_id });
};

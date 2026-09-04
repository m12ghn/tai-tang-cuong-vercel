// POST /api/upload-photo
// Nhận ảnh dạng base64 (đã được front end resize/nén trước bằng canvas),
// upload lên Supabase Storage bucket "ticket-photos", trả về public URL.
//
// Bucket "ticket-photos" phải được tạo THỦ CÔNG trong Supabase Dashboard
// -> Storage -> New bucket, đặt Public = BẬT (xem ghi chú trong migration.sql).

const { supabase } = require('./_supabase');

const BUCKET = 'ticket-photos';
const MAX_BYTES = 8 * 1024 * 1024; // 8MB, đã nén ở client nên thường chỉ vài trăm KB

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const dataUrl = body.image; // dạng "data:image/jpeg;base64,...."

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'Thiếu hoặc sai định dạng ảnh' });
    return;
  }

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: 'Không đọc được dữ liệu ảnh' });
    return;
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > MAX_BYTES) {
    res.status(400).json({ error: 'Ảnh quá lớn, vui lòng chụp/chọn ảnh khác' });
    return;
  }

  const ext = mimeType.split('/')[1] || 'jpg';
  const fileName = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    console.error('upload-photo error:', uploadError.message);
    res.status(500).json({ error: 'Không tải ảnh lên được, vui lòng thử lại' });
    return;
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);

  res.status(200).json({ url: publicUrlData.publicUrl });
};

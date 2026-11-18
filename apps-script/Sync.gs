// ============================================================
// SYNC 2 CHIỀU: Google Sheet <-> Supabase/Vercel
// Thêm file này vào project Apps Script hiện tại (giữ nguyên
// Code.js, Index.html cũ không cần xoá — Index.html sẽ không
// còn ai gọi tới vì front end thật đã chuyển sang Vercel, nhưng
// để lại không ảnh hưởng gì).
//
// SETUP 1 LẦN (bắt buộc trước khi chạy):
//   1. Vào Project Settings (bánh răng) -> Script Properties, thêm:
//        SUPABASE_URL                = https://xxxx.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY   = <service role key, KHÔNG phải anon key>
//   2. Chạy hàm setupSyncTrigger() một lần thủ công (Chọn hàm -> Run).
//   3. Chạy hàm setupReconcileTrigger() một lần thủ công.
//   4. Cấp quyền OAuth khi được hỏi (script.external_request — script này
//      đã dùng scope đó sẵn cho Telegram nên không phát sinh yêu cầu duyệt mới).
// ============================================================

const SHEET_NAMES_TO_SYNC = ['Nội thành', 'Nội vùng']; // 2 sheet giờ đã đồng nhất cấu trúc cột

function getSupabaseConfig() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong Script Properties');
  }
  return { url: url.replace(/\/$/, ''), key };
}

// Bảng tickets/warehouses nằm trong schema `m12`, không phải `public` mặc định
// của PostgREST -> phải khai báo qua header Accept-Profile (GET) /
// Content-Profile (POST/PATCH/DELETE). Nhớ cũng thêm `m12` vào "Exposed
// schemas" trong Supabase Dashboard (Project Settings -> API), nếu không
// mọi request tới bảng này sẽ lỗi dù key đúng.
function supabaseHeaders(extra) {
  const { key } = getSupabaseConfig();
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Accept-Profile': 'm12',
    'Content-Profile': 'm12'
  };
  if (extra) Object.assign(headers, extra);
  return headers;
}

// Supabase trả created_at dạng "2026-09-04 05:42:47.765932+00" (cách nhau bằng
// dấu space, offset "+00" KHÔNG có dấu ":"). Đây không phải chuẩn ISO 8601, nên
// new Date(...) parse trực tiếp có thể không nhận ra "+00" là UTC offset và coi
// chuỗi giờ này như giờ ĐỊA PHƯƠNG (theo timezone của script, thường là
// Asia/Ho_Chi_Minh) thay vì UTC -> lệch mất đúng 7 tiếng khi hiển thị trong
// sheet (bug thực tế: cột A thiếu +7 so với giờ VN). Chuẩn hoá về ISO 8601 có
// "Z" trước khi parse để luôn ra đúng giờ UTC.
function parseSupabaseTimestamp(ts) {
  if (!ts) return new Date();
  const iso = ts.toString().replace(' ', 'T').replace(/\+00(:00)?$/, 'Z');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(ts) : d;
}

// ============================================================
// CHIỀU 1: PULL ticket mới từ Supabase -> ghi vào Sheet + Telegram
// (thay thế phần "ghi sheet + gửi Telegram" mà processForm() cũ làm,
// chỉ khác nguồn input là Supabase thay vì form trực tiếp)
// ============================================================
function syncFromVercel() {
  const { url } = getSupabaseConfig();
  const endpoint = url + '/rest/v1/tickets?synced_to_sheet=eq.false&order=created_at.asc&select=*';

  const res = UrlFetchApp.fetch(endpoint, { headers: supabaseHeaders(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    console.log('syncFromVercel: lỗi gọi Supabase (' + res.getResponseCode() + ') - ' + res.getContentText());
    return;
  }

  const tickets = JSON.parse(res.getContentText());
  if (!tickets || tickets.length === 0) return;

  const ss = SpreadsheetApp.openById('1CEh9tvVTFTZXHRH9qTRsiHQeRX3V6NwUKFMb1CblQkQ'); // đổi nếu spreadsheet ID khác
  const mainSheet = ss.getSheetByName('Responses');
  if (!mainSheet) {
    console.log('syncFromVercel: không tìm thấy sheet Responses');
    return;
  }

  tickets.forEach(t => {
    try {
      const ngayGio = (t.ngay_mong_muon || '') + ' ' + (t.gio_mong_muon || '');
      const rowData = [
        parseSupabaseTimestamp(t.created_at), t.ticket_id, t.region, t.warehouse_name,
        t.warehouse_khac || '', t.lo_trinh, t.msnv, t.telegram || '', t.sdt,
        t.so_kien, t.the_tich, ngayGio, t.ghi_chu || ''
      ];

      mainSheet.appendRow(rowData);
      // Ghi photo_url vào cột AE (31) của Responses — KHÔNG dùng cột N vì cột đó
      // đã là "Trạng thái" theo cấu trúc sheet thật (giống Nội thành/Nội vùng).
      // Dùng cùng cột AE như 2 sheet Nội thành/Nội vùng cho đồng nhất.
      mainSheet.getRange(mainSheet.getLastRow(), 31).setValue(t.photo_url || '');
      // Loại xe mong muốn -> cột AG (33)
      mainSheet.getRange(mainSheet.getLastRow(), 33).setValue(t.loai_xe || '');

      distributeDataByRegionWithPhoto(rowData, t.photo_url, t.loai_xe); // bản có ghi thêm ảnh — xem cuối file

      // Gửi Telegram ticket mới — dùng lại getRegionConfig()/sendTeleRaw() có sẵn trong Code.js
      const config = getRegionConfig(t.region);
      const displayName = (t.warehouse_name || '').replace('Khác: ', '');
      const message = `<b>🚛 Đăng ký tải tăng cường mới</b>\n\n` +
                    `<b>Mã ticket:</b> ${t.ticket_id}\n` +
                    `<b>Bưu cục:</b> ${displayName}\n` +
                    `<b>Lộ trình:</b> ${t.lo_trinh}\n` +
                    (t.loai_xe ? `<b>Loại xe:</b> ${t.loai_xe}\n` : '') +
                    `<b>Ngày:</b> ${t.ngay_mong_muon} <b>Giờ:</b> ${t.gio_mong_muon}\n` +
                    `<b>Người request:</b> ${t.telegram || "N/A"}\n\n` +
                    `<i>GSVT sẽ sắp xếp xe và sẽ phản hồi.</i>\n\n` +
                    `👉 <a href="${config.link}">Link theo dõi chi tiết các Yêu cầu tải tăng cường</a>`;
      sendTeleRaw(config.id, message);

      markSyncedToSheet(t.id);
    } catch (err) {
      console.log('syncFromVercel: lỗi xử lý ticket ' + t.ticket_id + ' - ' + err.message);
      // Không mark synced -> ticket này sẽ được thử lại ở lần chạy kế tiếp (1 phút sau)
    }
  });
}

function markSyncedToSheet(rowId) {
  const { url } = getSupabaseConfig();
  const endpoint = url + '/rest/v1/tickets?id=eq.' + rowId;
  UrlFetchApp.fetch(endpoint, {
    method: 'patch',
    headers: supabaseHeaders(),
    payload: JSON.stringify({ synced_to_sheet: true, synced_at: new Date().toISOString() }),
    muteHttpExceptions: true
  });
}

function setupSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncFromVercel') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromVercel').timeBased().everyMinutes(1).create();
}

// ============================================================
// CHIỀU 2: PUSH trạng thái duyệt (Sheet -> Supabase)
// Cột A-U của Nội thành/Nội vùng (2 sheet giờ đồng nhất cấu trúc), giống
// hệt thứ tự rowData mà syncFromVercel() ghi vào lúc tạo ticket:
//   0=Timestamp 1=Ticket_id 2=Vùng 3=Tên BC (hoặc "Khác: ...") 4=Khác
//   5=Lộ trình 6=MSNV 7=Telegram 8=SĐT 9=Số kiện 10=Thể tích
//   11=Ngày+Giờ mong muốn (vd "04/09 19:30") 12=Ghi chú
//   13=N(Trạng thái) 14=O(Ngày duyệt) 15=P(Giờ tới) 16=Q(Mã chuyến)
//   17=R(Tên NCC) 18=S(BKS) 19=T(Tải trọng) 20=U(Thông tin tx)
// ============================================================

// Gửi 1 batch upsert lên Supabase (on_conflict theo ticket_id) —
// dùng chung cho cả onEdit (1 dòng) lẫn reconcile định kỳ (nhiều dòng),
// để tránh gọi UrlFetchApp quá nhiều lần (tốn quota) khi reconcile toàn sheet.
function pushStatusRows(rows) {
  if (!rows || rows.length === 0) return;
  const { url } = getSupabaseConfig();
  const endpoint = url + '/rest/v1/tickets?on_conflict=ticket_id';
  UrlFetchApp.fetch(endpoint, {
    method: 'post',
    headers: supabaseHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
}

function rowToStatusPayload(values) {
  // Tách "Ngày+Giờ mong muốn" (1 cột duy nhất trong sheet, vd "04/09 19:30")
  // ra 2 trường riêng cho khớp cấu trúc bảng tickets.
  const ngayGio = (values[11] || '').toString();
  const spaceIdx = ngayGio.indexOf(' ');
  const ngayMongMuon = spaceIdx >= 0 ? ngayGio.slice(0, spaceIdx) : ngayGio;
  const gioMongMuon = spaceIdx >= 0 ? ngayGio.slice(spaceIdx + 1) : '';

  // Tách warehouse_id từ "id - tên" (chỉ áp dụng khi không phải "Khác: ...").
  const warehouseName = (values[3] || '').toString();
  let warehouseId = null;
  if (warehouseName && warehouseName.indexOf('Khác') !== 0) {
    const idPart = warehouseName.split('-')[0].trim();
    if (idPart) warehouseId = idPart;
  }

  const soKienRaw = (values[9] || '').toString().trim();
  const soKien = soKienRaw ? (parseInt(soKienRaw, 10) || null) : null;

  return {
    ticket_id: values[1],
    // QUAN TRỌNG: dòng này lấy dữ liệu TỪ sheet ra (onEdit hoặc reconcile định kỳ),
    // nên chắc chắn ticket đã có sẵn trong sheet rồi. Nếu không set true ở đây,
    // ticket cũ (chưa từng có trong bảng tickets) khi được upsert lần đầu sẽ rơi
    // về default synced_to_sheet=false -> syncFromVercel() hiểu nhầm là ticket MỚI,
    // ghi trùng vào sheet + bắn Telegram cho ticket cũ (bug đã xảy ra thực tế).
    synced_to_sheet: true,
    synced_at: new Date().toISOString(),

    // Dữ liệu gốc của ticket (cột A-M) — BẮT BUỘC đưa vào đây, không chỉ mỗi
    // cột trạng thái, để ticket cũ/ticket tạo thẳng trong sheet (chưa từng đi
    // qua /api/submit, chỉ được biết tới qua reconcile) không bị null hết các
    // cột này trong Supabase (bug thực tế: TTC-5724 và nhiều ticket cũ khác).
    region: values[2] || null,
    warehouse_id: warehouseId,
    warehouse_name: warehouseName || null,
    warehouse_khac: values[4] || null,
    lo_trinh: values[5] || null,
    msnv: values[6] || null,
    telegram: values[7] || null,
    sdt: values[8] || null,
    so_kien: soKien,
    the_tich: values[10] || null,
    ngay_mong_muon: ngayMongMuon || null,
    gio_mong_muon: gioMongMuon || null,
    ghi_chu: values[12] || null,

    trang_thai: values[13],
    ngay_duyet: values[14],
    gio_toi: values[15],
    ma_chuyen: values[16],
    ten_ncc: values[17],
    bks: values[18],
    tai_trong: values[19],
    thong_tin_tx: values[20],
    updated_from_sheet_at: new Date().toISOString()
  };
}

function pushStatusToSupabase(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 21).getDisplayValues()[0]; // cột A -> U
  if (!values[1]) return; // không có ticket_id thì bỏ qua
  pushStatusRows([rowToStatusPayload(values)]);
}

// Job dự phòng, chạy định kỳ 15 phút — quét lại toàn bộ 2 sheet, upsert lại hết.
// An toàn vì upsert theo ticket_id (idempotent), chạy lại nhiều lần không sao.
//
// LƯU Ý: các ticket cũ tạo TRƯỚC khi migrate (không tồn tại sẵn trong bảng
// tickets của Supabase) sẽ được upsert thành dòng MỚI, thiếu các cột từ
// front end (msnv, sdt...) — vô hại, chỉ là dữ liệu không đầy đủ cho các
// ticket lịch sử. Có thể bỏ qua hoặc lọc theo ticket_id bắt đầu từ mốc
// migrate nếu muốn dữ liệu Supabase sạch hơn.
function reconcileAllToSupabase() {
  const ss = SpreadsheetApp.openById('1CEh9tvVTFTZXHRH9qTRsiHQeRX3V6NwUKFMb1CblQkQ');
  const BATCH_SIZE = 200;

  SHEET_NAMES_TO_SYNC.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const data = sheet.getRange(2, 1, lastRow - 1, 21).getDisplayValues();
    const rows = data.filter(v => v[1]).map(rowToStatusPayload);

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      pushStatusRows(rows.slice(i, i + BATCH_SIZE));
    }
  });
}

function setupReconcileTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'reconcileAllToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcileAllToSupabase').timeBased().everyMinutes(15).create();
}

// ============================================================
// ẢNH HÀNG TỒN KHO
// Bản sao của distributeDataByRegion() gốc trong Code.js, KHÔNG sửa hàm
// gốc (tránh ảnh hưởng chỗ khác có thể đang gọi nó) — chỉ thêm 1 bước ghi
// photo_url vào cột AE (31), một cột hoàn toàn mới, nằm sau cột AD (30 -
// "Đã tạo app") mà bot tangcuong_adhoc_bot.py đang dùng. Không đụng bất kỳ
// cột nào từ A đến AD.
//
// LƯU Ý: cột AE của Nội thành/Nội vùng đã được đặt tên "Hình kho". Nên đặt
// tiêu đề tương tự ở ô AE1 của Responses cho đồng nhất (bước thủ công).
// ============================================================
function distributeDataByRegionWithPhoto(rowData, photoUrl, loaiXe) {
  const ss = SpreadsheetApp.openById('1CEh9tvVTFTZXHRH9qTRsiHQeRX3V6NwUKFMb1CblQkQ');
  const province = rowData[2];
  let targetRowData = [...rowData];
  while (targetRowData.length < 24) { targetRowData.push(''); }
  targetRowData[24] = 'N';

  const targetSheetName = (province === 'Hồ Chí Minh') ? 'Nội thành' : 'Nội vùng';
  const targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) return;

  targetSheet.appendRow(targetRowData);
  targetSheet.getRange(targetSheet.getLastRow(), 31).setValue(photoUrl || ''); // cột AE
  targetSheet.getRange(targetSheet.getLastRow(), 33).setValue(loaiXe || ''); // cột AG: Loại xe mong muốn
}

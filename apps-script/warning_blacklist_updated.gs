// ============================================================
// BẢN CẬP NHẬT của file warning_blacklist gốc — THAY THẾ 2 hàm
// onEdit_v2 / onEdit_v1 cũ bằng bản này (gộp chung 1 hàm cho cả
// 2 sheet vì giờ đã đồng nhất cấu trúc cột, đỡ trùng code).
//
// Thêm: mỗi khi GSVT sửa cột N->U (Trạng thái, Ngày, Giờ tới,
// Mã chuyến, Tên NCC, BKS, Tải trọng, Thông tin tx) thì đẩy ngay
// dòng đó lên Supabase (gần như tức thời), không cần đợi job
// reconcile 15 phút.
//
// ⚠️ Đã sửa 1 lỗi có sẵn trong code gốc: bản cũ gọi
// `e.source.openById(...)` — nhưng trong simple trigger, `e.source`
// CHÍNH LÀ Spreadsheet rồi (không có method openById trên object
// Spreadsheet), gọi vậy sẽ throw lỗi runtime. Bản dưới dùng thẳng
// `e.source.getSheetByName(...)`. Nếu trigger onEdit cũ trong dự án
// của bạn vẫn đang chạy được, có thể nó được gắn theo cách khác —
// cứ thay bằng bản này là an toàn nhất.
// ============================================================

function onEditSyncAndBlacklist(e) {
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (sheetName !== 'Nội thành' && sheetName !== 'Nội vùng') return;

  const range = e.range;
  const col = range.getColumn();
  const row = range.getRow();
  if (row <= 1) return; // bỏ qua header

  // Cột N(14) -> U(21): vùng trạng thái duyệt -> đẩy lên Supabase
  if (col >= 14 && col <= 21) {
    try {
      pushStatusToSupabase(sheet, row); // hàm đã định nghĩa trong Sync.gs
    } catch (err) {
      console.log('onEditSyncAndBlacklist: lỗi push Supabase - ' + err.message);
    }
  }

  // Cảnh báo blacklist — giữ nguyên logic gốc, chỉ áp dụng khi sửa đúng cột N (Trạng thái)
  if (col === 14) {
    const blacklistValue = sheet.getRange(row, 27).getValue(); // cột AA
    if (blacklistValue.toString().toLowerCase() === 'bl') {
      SpreadsheetApp.getUi().alert(
        '⚠️ CẢNH BÁO BLACKLIST',
        "Đây là bưu cục thuộc *blacklist* của team network. Hãy cân nhắc khi sắp xếp tải.\n\n" +
        'Nếu từ chối hãy chọn option: Hủy - Bưu cục thuộc blacklist',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    }
  }
}

// ============================================================
// CÁCH GẮN TRIGGER:
// Nếu file warning_blacklist gốc đang gắn onEdit_v1/onEdit_v2 dưới
// dạng SIMPLE TRIGGER (không cần chạy setup, Apps Script tự nhận
// hàm tên "onEdit") thì đổi tên hàm trên thành "onEdit" luôn.
//
// Nếu đang gắn dưới dạng INSTALLABLE TRIGGER (qua Triggers UI hoặc
// ScriptApp.newTrigger), chạy hàm setupOnEditTrigger() dưới đây 1 lần:
// ============================================================
function setupOnEditTrigger() {
  const ss = SpreadsheetApp.openById('1CEh9tvVTFTZXHRH9qTRsiHQeRX3V6NwUKFMb1CblQkQ');
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onEditSyncAndBlacklist') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditSyncAndBlacklist')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
}

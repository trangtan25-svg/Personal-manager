/**
 * GOOGLE APPS SCRIPT DATABASE ENGINE FOR PERSONAL MANAGER HUB
 * 
 * HƯỚNG DẪN CÀI ĐẶT:
 * 1. Mở Google Sheet của bạn (https://docs.google.com/spreadsheets/d/1XriLKH8Y8q7x6aBHkKTURbVfF1FvLe0QUjGSsyj-ZxQ/edit)
 * 2. Trên thanh menu, chọn Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xóa toàn bộ mã mặc định trong tệp `Code.gs` và dán toàn bộ mã dưới đây vào.
 * 4. Thay đổi mã `SECURITY_TOKEN` bên dưới nếu bạn muốn tăng tính bảo mật (hãy khớp mã này với cài đặt trong web).
 * 5. Nhấn Lưu (Save - biểu tượng đĩa mềm).
 * 6. Bấm Triển khai (Deploy) -> Triển khai mới (New deployment).
 * 7. Chọn loại triển khai là Ứng dụng web (Web app).
 * 8. Cấu hình:
 *    - Mô tả: Personal Manager Database API
 *    - Thực thi dưới danh nghĩa: Tôi (địa chỉ gmail của bạn)
 *    - Ai có quyền truy cập: Bất kỳ ai (Anyone) -> Điều này cực kỳ quan trọng để trang web có thể gọi API.
 * 9. Bấm Triển khai. Google sẽ yêu cầu ủy quyền truy cập Drive/Sheets, hãy bấm Tiếp tục và Cho phép (Allow).
 * 10. Copy URL ứng dụng web được cấp (đầu URL có dạng https://script.google.com/macros/s/...) và dán vào tab Cài đặt trong trang web!
 */

// Mã bảo mật tùy chọn để ngăn người lạ đồng bộ (khớp với mật khẩu trong tab Cài đặt của bạn)
const SECURITY_TOKEN = "PersonalManagerHub2026";

// Cấu trúc các bảng và tiêu đề cột tương ứng
const SCHEMAS = {
  "Thu_Nhap": ["ID", "Amount", "Category", "Date", "Notes", "Type"],
  "Khoan_No": ["ID", "Creditor", "Amount", "Type", "InterestRate", "DueDate", "Status", "Repayments"],
  "Ke_Hoach": ["ID", "Title", "TargetAmount", "CurrentAmount", "DueDate", "Timeframe", "Milestones"],
  "Cong_Viec": ["ID", "Title", "Description", "Status", "DueDate", "Priority"],
  "Ghi_Chu": ["ID", "Title", "Content", "CreatedAt"],
  "Tep_Tin": ["ID", "Name", "Type", "Size", "UploadedAt"]
};

// Xử lý yêu cầu lấy dữ liệu (GET)
function doGet(e) {
  const params = e.parameter;
  
  // Xác thực token bảo mật
  if (params.token !== SECURITY_TOKEN) {
    return createJsonResponse({ success: false, error: "Unauthorized access: Invalid security token." }, 401);
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = {};
    
    // Đọc tất cả các bảng dữ liệu
    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        // Nếu chưa có sheet, tự tạo mới với header mặc định
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(SCHEMAS[sheetName]);
      }
      
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const items = [];
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        // Bỏ qua dòng trống nếu có
        if (!row[0]) continue; 
        
        const item = {};
        headers.forEach((header, index) => {
          let value = row[index];
          // Tránh lỗi JSON khi parse dữ liệu đặc biệt như ngày tháng
          if (value instanceof Date) {
            value = value.toISOString().split('T')[0];
          }
          item[header.toLowerCase()] = value;
        });
        items.push(item);
      }
      
      data[sheetName] = items;
    });
    
    return createJsonResponse({ success: true, data: data });
  } catch (err) {
    return createJsonResponse({ success: false, error: err.toString() }, 500);
  }
}

// Xử lý yêu cầu cập nhật/đồng bộ dữ liệu (POST)
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    
    // Xác thực token bảo mật
    if (postData.token !== SECURITY_TOKEN) {
      return createJsonResponse({ success: false, error: "Unauthorized access: Invalid security token." }, 401);
    }
    
    const payload = postData.data;
    if (!payload) {
      return createJsonResponse({ success: false, error: "Data payload is empty." }, 400);
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Lặp qua từng bảng dữ liệu được gửi lên
    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      
      // Xóa toàn bộ nội dung cũ để ghi đè dữ liệu đồng bộ nguyên tử
      sheet.clear();
      
      // Thiết lập lại tiêu đề cột
      const headers = SCHEMAS[sheetName];
      sheet.appendRow(headers);
      
      const items = payload[sheetName] || [];
      if (items.length > 0) {
        const rowsToWrite = [];
        
        items.forEach(item => {
          const row = headers.map(header => {
            const key = header.toLowerCase();
            let val = item[key] !== undefined ? item[key] : "";
            // Nếu giá trị là Object/Array, stringify lại trước khi ghi xuống trang tính
            if (typeof val === 'object' && val !== null) {
              val = JSON.stringify(val);
            }
            return val;
          });
          rowsToWrite.push(row);
        });
        
        // Ghi nhanh hàng loạt dữ liệu (Bulk Write) để tăng tốc độ xử lý
        sheet.getRange(2, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);
      }
    });
    
    return createJsonResponse({ success: true, message: "Sync successfully!" });
  } catch (err) {
    return createJsonResponse({ success: false, error: err.toString() }, 500);
  }
}

// Hàm bổ trợ đóng gói dữ liệu trả về dạng JSON chuẩn CORS
function createJsonResponse(obj, statusCode = 200) {
  const JSONString = JSON.stringify(obj);
  return ContentService.createTextOutput(JSONString)
    .setMimeType(ContentService.MimeType.JSON);
}

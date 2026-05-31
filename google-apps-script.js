/**
 * GOOGLE APPS SCRIPT DATABASE ENGINE FOR PERSONAL MANAGER HUB
 * 
 * HƯỚNG DẪN CÀI ĐẶT CHI TIẾT:
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
  "Khoan_No": ["ID", "Creditor", "Amount", "Type", "InterestRate", "DueDate", "Status", "Repayments", "InstallmentsCount", "InstallmentAmount"],
  "Ke_Hoach": ["ID", "Title", "TargetAmount", "CurrentAmount", "DueDate", "Timeframe", "Milestones", "Savings", "InstallmentsCount", "InstallmentAmount"],
  "Cong_Viec": ["ID", "Title", "Description", "Status", "DueDate", "Priority"],
  "Ghi_Chu": ["ID", "Title", "Content", "CreatedAt"],
  "Tep_Tin": ["ID", "Name", "Type", "Size", "UploadedAt"]
};

// --- TỰ ĐỘNG KHỞI TẠO MENU TRÊN GOOGLE SHEETS ---
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 Personal Hub AI')
    .addItem('✨ Khởi tạo cấu trúc các bảng', 'initializeDatabase')
    .addToUi();
}

// Hàm khởi tạo toàn bộ cấu trúc cơ sở dữ liệu trên Google Sheets với định dạng chuyên nghiệp
function initializeDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const ui = SpreadsheetApp.getUi();
  
  try {
    // 1. Tạo và định dạng từng Sheet theo Schema định nghĩa sẵn
    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      
      // Clear nội dung và đặt tiêu đề cột
      sheet.clear();
      const headers = SCHEMAS[sheetName];
      sheet.appendRow(headers);
      
      // Định dạng dòng tiêu đề (Header row) trông rất cao cấp
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setFontColor("#ffffff");
      headerRange.setBackgroundColor("#1f2937"); // Dark Gray sang trọng
      headerRange.setHorizontalAlignment("center");
      
      // Cố định dòng tiêu đề (Freeze top row)
      sheet.setFrozenRows(1);
      
      // Tự động căn chỉnh độ rộng cột
      for (let col = 1; col <= headers.length; col++) {
        sheet.autoResizeColumn(col);
        // Thiết lập độ rộng tối thiểu để dễ nhìn
        if (sheet.getColumnWidth(col) < 120) {
          sheet.setColumnWidth(col, 130);
        }
      }
      
      // Định dạng số cho cột số tiền nếu là các bảng tài chính
      if (sheetName === "Thu_Nhap") {
        sheet.getRange("B2:B").setNumberFormat('#,##0 "₫"'); // Cột Amount
      } else if (sheetName === "Khoan_No") {
        sheet.getRange("C2:C").setNumberFormat('#,##0 "₫"'); // Cột Amount
        sheet.getRange("E2:E").setNumberFormat('0.0 "%"');   // Cột InterestRate
      } else if (sheetName === "Ke_Hoach") {
        sheet.getRange("C2:D").setNumberFormat('#,##0 "₫"'); // Cột Target & Current
      }
    });
    
    // Xóa trang tính "Trang tính1" (Sheet1) mặc định nếu nó trống
    let defaultSheet = ss.getSheetByName("Trang tính1") || ss.getSheetByName("Sheet1");
    if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
    
    ui.alert('Thành công', 'Đã khởi tạo toàn bộ 6 bảng dữ liệu (Thu_Nhap, Khoan_No, Ke_Hoach, Cong_Viec, Ghi_Chu, Tep_Tin) kèm cấu trúc định dạng chuẩn tài chính thành công!', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Lỗi khởi tạo', err.toString(), ui.ButtonSet.OK);
  }
}

// Xử lý yêu cầu lấy dữ liệu (GET)
function doGet(e) {
  try {
    console.log("=== BẮT ĐẦU TẢI DỮ LIỆU (doGet) ===");
    if (!e || !e.parameter) {
      console.error("LỖI: Request Parameters bị trống!");
      return createJsonResponse({ success: false, error: "Request parameters are missing." }, 400);
    }
    
    const params = e.parameter;
    console.log("Mã Token bảo mật nhận được: '" + params.token + "'");
    console.log("Mã Token bảo mật cấu hình: '" + SECURITY_TOKEN + "'");
    
    // Xác thực token bảo mật
    if (params.token !== SECURITY_TOKEN) {
      console.warn("LỖI: Token bảo mật không trùng khớp!");
      return createJsonResponse({ success: false, error: "Unauthorized access: Invalid security token." }, 401);
    }
    
    console.log("Xác thực Token thành công!");
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      console.error("LỖI: Không tìm thấy Spreadsheet hoạt động! Hãy đảm bảo script được gắn liền (Container-Bound) với Google Sheet.");
      return createJsonResponse({ success: false, error: "Spreadsheet not found." }, 500);
    }
    console.log("Đã tìm thấy Google Sheet có tên: " + ss.getName());
    
    const data = {};
    
    // Đọc tất cả các bảng dữ liệu
    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        console.log("Bảng " + sheetName + " chưa tồn tại. Tự khởi động tạo mới...");
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(SCHEMAS[sheetName]);
      }
      
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0];
      const items = [];
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue; // Bỏ qua dòng trống
        
        const item = {};
        headers.forEach((header, index) => {
          let value = row[index];
          if (value instanceof Date) {
            value = value.toISOString().split('T')[0];
          }
          item[header.toLowerCase()] = value;
        });
        items.push(item);
      }
      
      console.log("Bảng " + sheetName + " đã đọc xong " + items.length + " dòng dữ liệu.");
      data[sheetName] = items;
    });
    
    console.log("=== TẢI DỮ LIỆU HOÀN THÀNH THÀNH CÔNG ===");
    return createJsonResponse({ success: true, data: data });
  } catch (err) {
    console.error("LỖI NGOẠI LỆ TRONG doGet: " + err.toString());
    return createJsonResponse({ success: false, error: err.toString() }, 500);
  }
}

// Xử lý yêu cầu cập nhật/đồng bộ dữ liệu (POST)
function doPost(e) {
  try {
    console.log("=== BẮT ĐẦU ĐỒNG BỘ DỮ LIỆU TỐI ƯU (doPost) ===");
    
    if (!e || !e.postData || !e.postData.contents) {
      console.error("LỖI: Request Body trống rỗng!");
      return createJsonResponse({ success: false, error: "Empty request body" }, 400);
    }
    
    const postData = JSON.parse(e.postData.contents);
    
    // Xác thực token bảo mật
    if (postData.token !== SECURITY_TOKEN) {
      console.warn("LỖI: Token bảo mật không trùng khớp!");
      return createJsonResponse({ success: false, error: "Unauthorized access: Invalid security token." }, 401);
    }
    
    // --- 1. XỬ LÝ TẢI FILE LÊN GOOGLE DRIVE ---
    if (postData.action === "uploadFile") {
      console.log("⚡ Nhận yêu cầu tải tệp tin lên Google Drive!");
      const fileData = postData.fileData; // Chuỗi Base64
      const fileName = postData.fileName;
      const fileType = postData.fileType;
      
      // Giải mã Base64 sang Blob
      const decoded = Utilities.base64Decode(fileData);
      const blob = Utilities.newBlob(decoded, fileType, fileName);
      
      // Tìm hoặc tạo thư mục "PersonalManagerHub_Storage" trong Drive
      const folderName = "PersonalManagerHub_Storage";
      const folders = DriveApp.getFoldersByName(folderName);
      let folder;
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder(folderName);
      }
      
      // Lưu tệp tin
      const file = folder.createFile(blob);
      
      // Thiết lập quyền xem cho bất kỳ ai có link (để xem/tải trực tiếp từ Hub)
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return createJsonResponse({
        success: true,
        fileId: file.getId(),
        fileName: file.getName(),
        fileSize: file.getSize(),
        fileUrl: file.getUrl(),
        downloadUrl: "https://docs.google.com/uc?export=download&id=" + file.getId()
      });
    }

    // --- 2. XỬ LÝ XÓA FILE TRÊN GOOGLE DRIVE ---
    if (postData.action === "deleteFile") {
      console.log("⚡ Nhận yêu cầu xóa tệp tin trong Google Drive!");
      const fileId = postData.fileId;
      const file = DriveApp.getFileById(fileId);
      file.setTrashed(true); // Di chuyển vào thùng rác của Drive
      
      return createJsonResponse({ success: true });
    }
    
    const payload = postData.data;
    if (!payload) {
      console.warn("LỖI: Thuộc tính data rỗng!");
      return createJsonResponse({ success: false, error: "Data payload is empty." }, 400);
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      console.error("LỖI: Không tìm thấy Spreadsheet hoạt động!");
      return createJsonResponse({ success: false, error: "Spreadsheet not found." }, 500);
    }
    
    // Lặp qua từng bảng dữ liệu được gửi lên để cập nhật
    Object.keys(SCHEMAS).forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      let isNew = false;
      if (!sheet) {
        console.log("Bảng " + sheetName + " chưa tồn tại. Tiến hành tạo mới...");
        sheet = ss.insertSheet(sheetName);
        isNew = true;
      }
      
      const headers = SCHEMAS[sheetName];
      
      // Nếu là sheet mới hoặc chưa có tiêu đề, tiến hành ghi tiêu đề và định dạng dòng 1 lần đầu tiên
      if (isNew || sheet.getLastRow() === 0) {
        sheet.clear();
        sheet.appendRow(headers);
        
        // Định dạng dòng tiêu đề cho chuyên nghiệp
        const headerRange = sheet.getRange(1, 1, 1, headers.length);
        headerRange.setFontWeight("bold");
        headerRange.setFontColor("#ffffff");
        headerRange.setBackgroundColor("#1f2937");
        headerRange.setHorizontalAlignment("center");
        sheet.setFrozenRows(1);
        
        // Căn chỉnh độ rộng cột lần đầu (chạy chậm nên chỉ chạy khi tạo mới)
        for (let col = 1; col <= headers.length; col++) {
          sheet.autoResizeColumn(col);
          if (sheet.getColumnWidth(col) < 120) {
            sheet.setColumnWidth(col, 130);
          }
        }
        console.log("Đã khởi tạo và định dạng xong tiêu đề bảng mới: " + sheetName);
      } else {
        // Nếu bảng đã có sẵn cấu trúc, chỉ xóa phần dữ liệu cũ từ dòng 2 trở đi để giữ nguyên tiêu đề và độ rộng cột
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        }
        console.log("Đã dọn dẹp nhanh dữ liệu cũ bảng: " + sheetName);
      }
      
      const items = payload[sheetName] || [];
      console.log("Bảng " + sheetName + " chuẩn bị ghi: " + items.length + " dòng.");
      
      if (items.length > 0) {
        const rowsToWrite = [];
        
        items.forEach(item => {
          const row = headers.map(header => {
            const key = header.toLowerCase();
            // Hỗ trợ cả key chính xác theo Header (CamelCase) và key viết thường (lowercase)
            let val = "";
            if (item[header] !== undefined) {
              val = item[header];
            } else if (item[key] !== undefined) {
              val = item[key];
            }
            
            if (typeof val === 'object' && val !== null) {
              val = JSON.stringify(val);
            }
            return val;
          });
          rowsToWrite.push(row);
        });
        
        // Ghi dữ liệu hàng loạt bắt đầu từ dòng thứ 2
        sheet.getRange(2, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);
        console.log("Đã ghi xong " + rowsToWrite.length + " dòng vào bảng " + sheetName);
        
        // Định dạng cột số tiền/lãi suất nhanh
        if (sheetName === "Thu_Nhap") {
          sheet.getRange("B2:B" + (rowsToWrite.length + 1)).setNumberFormat('#,##0 "₫"');
        } else if (sheetName === "Khoan_No") {
          sheet.getRange("C2:C" + (rowsToWrite.length + 1)).setNumberFormat('#,##0 "₫"');
          sheet.getRange("E2:E" + (rowsToWrite.length + 1)).setNumberFormat('0.0 "%"');
        } else if (sheetName === "Ke_Hoach") {
          sheet.getRange("C2:D" + (rowsToWrite.length + 1)).setNumberFormat('#,##0 "₫"');
        }
      }
    });
    
    console.log("=== ĐỒNG BỘ DỮ LIỆU HOÀN THÀNH THÀNH CÔNG ===");
    return createJsonResponse({ 
      success: true, 
      message: "Sync successfully!",
      spreadsheetName: ss.getName(),
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl()
    });
  } catch (err) {
    console.error("LỖI NGOẠI LỆ TRONG doPost: " + err.toString());
    return createJsonResponse({ success: false, error: err.toString() }, 500);
  }
}

// Hàm bổ trợ đóng gói dữ liệu trả về dạng JSON chuẩn CORS
function createJsonResponse(obj, statusCode = 200) {
  const JSONString = JSON.stringify(obj);
  return ContentService.createTextOutput(JSONString)
    .setMimeType(ContentService.MimeType.JSON);
}

// --- HÀM BỔ TRỢ KÍCH HOẠT HỘP THOẠI CẤP QUYỀN TRUY CẬP DRIVE CỦA GOOGLE ---
// Cách dùng: Chọn hàm này trên thanh công cụ của Apps Script và nhấn nút "Chạy" (Run) để kích hoạt phê duyệt quyền truy cập Drive!
function testDriveAccess() {
  try {
    var folderName = "PersonalManagerHub_Storage";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    console.log("✅ Kết nối Drive thành công! Thư mục hoạt động: " + folder.getName() + " (ID: " + folder.getId() + ")");
  } catch (err) {
    console.error("❌ Lỗi kết nối Drive: " + err.toString());
  }
}

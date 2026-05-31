// ==================== KHỞI TẠO STATE & BIẾN CẤU HÌNH TOÀN CỤC ====================

// State của ứng dụng (được lưu trữ dưới dạng mã hóa AES trong LocalStorage)
let appState = {
    transactions: [],  // Thu nhập & Chi tiêu: { id, type, date, amount, category, notes }
    debts: [],         // Khoản nợ: { id, creditor, amount, type, interestRate, dueDate, status, repayments: [] }
    goals: [],         // Kế hoạch: { id, title, targetAmount, currentAmount, dueDate, timeframe, milestones: [] }
    tasks: [],         // Công việc: { id, title, description, status, priority, dueDate }
    notes: [],         // Ghi chú: { id, title, content, createdAt }
    storageFiles: [],  // Tài liệu lưu trữ (Metadata): { id, name, type, size, uploadedAt }
    isDirty: false,    // Cờ hiệu báo dữ liệu thay đổi chưa đồng bộ lên Sheets
    settings: {
        sheetUrl: "https://docs.google.com/spreadsheets/d/1XriLKH8Y8q7x6aBHkKTURbVfF1FvLe0QUjGSsyj-ZxQ/edit?gid=0#gid=0",
        webAppUrl: "",
        syncToken: "PersonalManagerHub2026"
    }
};

// Khóa giải mã dẫn xuất từ Master Password của người dùng
let derivedKey = "";
let autoLockTimer = null;
let autoSyncInterval = null;
let isPushing = false;  // Cờ hiệu bảo vệ chống trùng lặp đẩy dữ liệu lên Sheets
let isPulling = false;  // Cờ hiệu bảo vệ chống trùng lặp kéo dữ liệu từ Sheets
let lastFocusSyncTime = 0; // Lưu thời gian đồng bộ refocus cuối cùng để chống double trigger
const LOCK_TIMEOUT = 15 * 60 * 1000; // 15 phút không hoạt động tự động khóa

// Cẩm nang mẹo lưu trữ tài liệu cá nhân mặc định
const INITIAL_STORAGE_TIPS = [
    { id: "tip-1", title: "Đặt tên tệp tin khoa học", content: "Hãy sử dụng chuẩn đặt tên file: `LOAI_YYYYMMDD_TenTaiLieu`. Ví dụ: `WORK_20260531_HopDongLaoDong.pdf`. Cách này giúp bạn tìm kiếm cực nhanh theo năm hoặc loại tài liệu.", pinned: true },
    { id: "tip-2", title: "Số hóa tài liệu giấy bằng smartphone", content: "Dùng ứng dụng Adobe Scan hoặc Microsoft Lens trên điện thoại quét tài liệu giấy của bạn. Chọn định dạng PDF trắng đen độ phân giải cao để lưu trữ nhẹ và sắc nét nhất trước khi tải lên.", pinned: false },
    { id: "tip-3", title: "Nguyên tắc bảo mật tài liệu nhạy cảm", content: "Không lưu trữ mật khẩu dưới dạng văn bản thuần (plaintext) trong ghi chú. Với các tài liệu tối mật như bản quét CCCD, Sổ đỏ, hãy nén file zip và đặt mật khẩu mã hóa trước khi lưu lên Google Drive.", pinned: false },
    { id: "tip-4", title: "Sao lưu (Backup) dữ liệu định kỳ", content: "Mặc dù dữ liệu đã đồng bộ lên Google Sheet, hãy định kỳ sử dụng nút 'Xuất dữ liệu sao lưu (JSON)' trong cài đặt lưu trữ ra ổ cứng ngoài hoặc USB để phòng ngừa sự cố mất tài khoản Google.", pinned: false }
];

// Danh mục thu chi mặc định
const CATEGORIES = {
    income: ["Lương tháng", "Freelance / Dự án ngoài", "Đầu tư / Tiết kiệm", "Kinh doanh", "Quà tặng / Khác"],
    expense: ["Ăn uống", "Nhà cửa / Điện nước", "Di chuyển / Xăng xe", "Giải trí / Mua sắm", "Y tế / Sức khỏe", "Học tập / Bản thân", "Trả khoản nợ", "Chi tiêu Khác"]
};

// --- HÀM VẼ ICON AN TOÀN TRÁNH CRASH SCRIPT KHI CDN CHƯA TẢI XONG ---
function safeCreateIcons() {
    if (typeof lucide !== 'undefined') {
        try {
            lucide.createIcons();
        } catch (e) {
            console.warn("Lỗi dựng Lucide Icons: ", e);
        }
    } else {
        console.warn("Thư viện Lucide Icons chưa được tải.");
    }
}

// ==================== KHỞI ĐỘNG ỨNG DỤNG (ENTRY POINT) ====================
document.addEventListener("DOMContentLoaded", () => {
    // 0. Tự động kiểm tra và cấu hình URL Google Sheets từ Biến môi trường Vercel (Vite)
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL) {
            const envUrl = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL;
            if (envUrl && envUrl.startsWith("https://script.google.com/macros/s/")) {
                appState.settings.webAppUrl = envUrl;
                if (derivedKey) {
                    saveStateToLocalStorage(false); // Không làm bẩn state khi chỉ cấu hình ENV
                }
                console.log("Đã tự động cấu hình URL Google Sheets từ Biến môi trường Vercel!");
            }
        }
    } catch (e) {
        console.warn("Không đọc được biến môi trường VITE_GOOGLE_APPS_SCRIPT_URL: ", e.message);
    }

    // 1. Kiểm tra xem thư viện mã hóa bảo mật CryptoJS đã được tải qua CDN chưa
    if (typeof CryptoJS === 'undefined') {
        const formContainer = document.getElementById("lock-form-container");
        if (formContainer) {
            formContainer.innerHTML = `
                <div class="ocr-status" style="background: rgba(255, 77, 77, 0.08); border-color: rgba(255, 77, 77, 0.2); color: var(--color-coral); text-align: left; padding: 16px; margin-bottom: 20px; line-height: 1.5; font-size:12px;">
                    <strong>⚠️ LỖI KẾT NỐI MẠNG (CDN ERROR):</strong><br>
                    Không thể tải thư viện bảo mật mã hóa <strong>CryptoJS</strong>. 
                    <br><br>
                    Để đảm bảo dữ liệu tài chính của bạn được mã hóa an toàn, vui lòng kết nối Internet (hoặc kiểm tra tường lửa/chặn file CDN cdnjs) và tải lại trang.
                </div>
                <button class="btn btn-secondary w-100" onclick="window.location.reload();">
                     Tải lại trang
                </button>
            `;
            const lockSub = document.getElementById("lock-subtitle");
            if (lockSub) lockSub.textContent = "Thiếu thư viện mã hóa bảo mật CryptoJS!";
            return;
        }
    }
    
    // 2. Nếu thư viện đã tải xong, khởi động màn hình khóa
    initLockScreen();
    resetAutoLockTimer();
    
    // Đăng ký bộ lắng nghe sự kiện hoạt động của người dùng để reset timer khóa tự động
    ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, resetAutoLockTimer);
    });

    // 3. Đăng ký Service Worker hỗ trợ PWA và Caching offline để tải trang trong 0ms
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('✅ Service Worker đã được đăng ký thành công với scope:', reg.scope))
                .catch(err => console.error('❌ Đăng ký Service Worker thất bại:', err));
        });
    }

    // 4. Bộ lắng nghe sự kiện Visibility & Focus để đồng bộ tự động thời gian thực khi quay lại ứng dụng
    ['visibilitychange', 'focus'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (evt === 'visibilitychange' && document.visibilityState !== 'visible') return;
            
            // Chống double trigger dồn dập (Chỉ chạy tối đa 1 lần mỗi 3 giây)
            const now = Date.now();
            if (now - lastFocusSyncTime < 3000) return;
            
            if (derivedKey && appState.settings && appState.settings.webAppUrl) {
                lastFocusSyncTime = now;
                console.log(`🔄 [Tự động Refocus] Phát hiện quay lại ứng dụng (${evt}), tiến hành kéo dữ liệu ngầm...`);
                pullAllDataFromGoogleSheets(false);
            }
        });
    });
});

// ==================== A. HỆ THỐNG ĐĂNG NHẬP & BẢO MẬT (LOCK SCREEN LOGIC) ====================

// Kiểm tra xem Mật khẩu chủ đã được thiết lập chưa và hiển thị giao diện phù hợp
function initLockScreen() {
    const lockScreen = document.getElementById("lock-screen");
    const appLayout = document.getElementById("app-layout");
    const formContainer = document.getElementById("lock-form-container");
    
    if (!lockScreen || !appLayout || !formContainer) return;
    
    lockScreen.classList.remove("hidden");
    appLayout.classList.add("hidden");
    
    const isPassphraseSet = localStorage.getItem("pmh_encrypted_key_test") !== null;
    
    if (!isPassphraseSet) {
        // Màn hình khởi tạo mật khẩu lần đầu
        formContainer.innerHTML = `
            <p style="font-size: 13px; color: var(--color-primary); margin-bottom: 10px; line-height: 1.4;">Chào mừng! Hãy thiết lập Mật khẩu chủ để kích hoạt mã hóa dữ liệu cục bộ.</p>
            <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 15px; line-height: 1.35; background: rgba(59, 130, 246, 0.05); padding: 10px; border-radius: 8px; border: 1px dashed rgba(59, 130, 246, 0.2); text-align: left;">
                💡 <strong>Thiết bị mới?</strong> Mật khẩu chủ chỉ lưu trữ mã hóa cục bộ trên thiết bị này. Nếu đây là điện thoại hoặc máy tính mới, bạn có thể thiết lập mật khẩu giống hoặc khác máy cũ. Dữ liệu của bạn sẽ tự động được kéo xuống từ Sheets sau khi kết nối.
            </p>
            <div class="form-group">
                <input type="password" id="setup-pass" class="form-input" placeholder="Tạo mật khẩu mở khóa Hub..." required>
            </div>
            <div class="form-group">
                <input type="password" id="setup-pass-confirm" class="form-input" placeholder="Nhập lại mật khẩu..." required>
            </div>
            <button id="btn-setup-lock" class="btn btn-primary-glow w-100" style="margin-top: 10px;">
                <i data-lucide="key-round"></i> Khởi tạo & Kích hoạt Hub
            </button>
        `;
        
        document.getElementById("btn-setup-lock").addEventListener("click", handleRegisterMasterPassword);
    } else {
        // Màn hình đăng nhập thông thường
        formContainer.innerHTML = `
            <div class="form-group" style="position: relative;">
                <input type="password" id="unlock-pass" class="form-input" placeholder="Nhập mật khẩu của bạn..." required>
                <button type="button" class="btn-action-small" id="btn-toggle-unlock-pass" style="position: absolute; right: 10px; top: 8px;">
                    <i data-lucide="eye" style="width: 18px; height: 18px;"></i>
                </button>
            </div>
            <button id="btn-submit-unlock" class="btn btn-primary-glow w-100" style="margin-top: 10px;">
                <i data-lucide="unlock"></i> Mở khóa Hub cá nhân
            </button>
        `;
        
        // Nhấn Enter để mở khóa
        document.getElementById("unlock-pass").addEventListener("keypress", (e) => {
            if (e.key === "Enter") handleUnlockApp();
        });
        
        document.getElementById("btn-submit-unlock").addEventListener("click", handleUnlockApp);
        
        // Nút ẩn hiện mật khẩu
        const toggleBtn = document.getElementById("btn-toggle-unlock-pass");
        const passInput = document.getElementById("unlock-pass");
        
        if (toggleBtn && passInput) {
            toggleBtn.addEventListener("click", () => {
                if (passInput.type === "password") {
                    passInput.type = "text";
                    toggleBtn.innerHTML = `<i data-lucide="eye-off" style="width: 18px; height: 18px;"></i>`;
                } else {
                    passInput.type = "password";
                    toggleBtn.innerHTML = `<i data-lucide="eye" style="width: 18px; height: 18px;"></i>`;
                }
                safeCreateIcons();
            });
        }
    }
    safeCreateIcons();
}

// Xử lý tạo Mật khẩu chủ mới lần đầu
function handleRegisterMasterPassword() {
    const setupPass = document.getElementById("setup-pass").value.trim();
    const setupPassConfirm = document.getElementById("setup-pass-confirm").value.trim();
    const lockCard = document.querySelector(".lock-card");
    
    if (!setupPass || setupPass.length < 4) {
        alert("Mật khẩu phải có độ dài tối thiểu là 4 ký tự.");
        shakeElement(lockCard);
        return;
    }
    
    if (setupPass !== setupPassConfirm) {
        alert("Mật khẩu xác nhận không trùng khớp.");
        shakeElement(lockCard);
        return;
    }
    
    try {
        // Tạo chuỗi kiểm chứng mã hóa
        derivedKey = CryptoJS.SHA256(setupPass).toString();
        const testPayload = "encryption-authorized-key";
        const encryptededTest = CryptoJS.AES.encrypt(testPayload, derivedKey).toString();
        
        // Lưu chuỗi kiểm chứng mã hóa lên LocalStorage
        localStorage.setItem("pmh_encrypted_key_test", encryptededTest);
        
        // Lưu dữ liệu trắng mặc định của state mới
        saveStateToLocalStorage(false); // Đăng ký tài khoản ban đầu không đánh dấu bẩn
        
        // Lưu danh sách mẹo lưu trữ mặc định
        localStorage.setItem("pmh_storage_tips", JSON.stringify(INITIAL_STORAGE_TIPS));
        
        alert("Khởi tạo bảo mật thành công! Chào mừng đến với Personal Hub.");
        unlockAppInterface();
    } catch (e) {
        alert("Lỗi bảo mật thiết bị: " + e.message);
    }
}

// Xử lý đăng nhập mở khóa
function handleUnlockApp() {
    const unlockPass = document.getElementById("unlock-pass").value;
    const lockCard = document.querySelector(".lock-card");
    const testPayloadEncrypted = localStorage.getItem("pmh_encrypted_key_test");
    
    if (!unlockPass) {
        shakeElement(lockCard);
        return;
    }
    
    try {
        const testKey = CryptoJS.SHA256(unlockPass).toString();
        const decryptedBytes = CryptoJS.AES.decrypt(testPayloadEncrypted, testKey);
        const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
        
        if (decryptedText === "encryption-authorized-key") {
            // Mật khẩu chính xác! Lưu khóa phiên hoạt động
            derivedKey = testKey;
            
            // Giải mã và load State thực tế
            loadStateFromLocalStorage();
            unlockAppInterface();
        } else {
            // Nhập sai mật khẩu
            shakeElement(lockCard);
            const passInput = document.getElementById("unlock-pass");
            if (passInput) {
                passInput.value = "";
                passInput.focus();
            }
        }
    } catch (err) {
        shakeElement(lockCard);
        alert("Giải mã dữ liệu thất bại. Có vẻ mật khẩu không chính xác hoặc dữ liệu cục bộ bị hỏng.");
    }
}

// Khóa ứng dụng ngay lập tức
function lockApp() {
    derivedKey = "";
    appState = {
        transactions: [], debts: [], goals: [], tasks: [], notes: [], storageFiles: [],
        settings: { sheetUrl: "https://docs.google.com/spreadsheets/d/1XriLKH8Y8q7x6aBHkKTURbVfF1FvLe0QUjGSsyj-ZxQ/edit?gid=0#gid=0", webAppUrl: "", syncToken: "PersonalManagerHub2026" }
    };
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
    document.getElementById("app-layout").classList.add("hidden");
    document.getElementById("lock-screen").classList.remove("hidden");
    initLockScreen();
}

// Mở khóa giao diện và hiển thị màn hình chính
function unlockAppInterface() {
    document.getElementById("lock-screen").classList.add("hidden");
    document.getElementById("app-layout").classList.remove("hidden");
    
    // Tự động khởi tạo giao diện Tabs & Nút điều hướng
    initNavigation();
    initAppComponents();
    renderAllViews();
    
    // Tự động đồng bộ kéo dữ liệu mới nhất ngầm khi đăng nhập (không cần người dùng nhấn nút)
    if (appState.settings && appState.settings.webAppUrl) {
        pullAllDataFromGoogleSheets(false); // Silent pull!
        startBackgroundSync();
    }
}

// Hàm khởi chạy vòng lặp tự động đồng bộ ngầm định kỳ
function startBackgroundSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    autoSyncInterval = setInterval(() => {
        if (derivedKey && appState.settings && appState.settings.webAppUrl) {
            if (!isPulling && !isPushing) {
                console.log("🔄 [Tự động ngầm] Đang kiểm tra cập nhật mới nhất từ Google Sheets...");
                pullAllDataFromGoogleSheets(false); // Quét ngầm cập nhật dữ liệu mới cực nhanh giữa máy tính và điện thoại
            } else {
                console.log("⏳ [Tự động ngầm] Bỏ qua vòng lặp do đang bận đồng bộ dữ liệu...");
            }
        }
    }, 15000); // Đồng bộ thời gian thực 15 giây một lần!
}

// Reset bộ đếm tự động khóa
function resetAutoLockTimer() {
    if (derivedKey === "") return; // Nếu chưa đăng nhập thì không đếm
    
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => {
        alert("Phiên làm việc của bạn đã hết hạn do không hoạt động. Trang web đã tự động khóa để bảo mật tài chính của bạn.");
        lockApp();
    }, LOCK_TIMEOUT);
}

// Tạo hiệu ứng rung lắc khi có lỗi đăng nhập
function shakeElement(el) {
    if (!el) return;
    el.classList.add("shake");
    setTimeout(() => {
        el.classList.remove("shake");
    }, 400);
}

// ==================== B. MÃ HÓA CỤC BỘ DỮ LIỆU STATE (CRYPTO AES STATE) ====================

// Lưu State đã mã hóa vào LocalStorage (hỗ trợ cờ đánh dấu dữ liệu chưa đồng bộ)
function saveStateToLocalStorage(setDirty = true) {
    if (!derivedKey) return;
    try {
        if (setDirty) {
            appState.isDirty = true;
        }
        const stateString = JSON.stringify(appState);
        const encryptedState = CryptoJS.AES.encrypt(stateString, derivedKey).toString();
        localStorage.setItem("pmh_encrypted_state_data", encryptedState);
    } catch (e) {
        console.error("Không thể mã hóa lưu trữ State: ", e);
    }
}

// Tải State đã mã hóa từ LocalStorage và giải mã
function loadStateFromLocalStorage() {
    if (!derivedKey) return;
    const encryptedState = localStorage.getItem("pmh_encrypted_state_data");
    
    if (encryptedState) {
        try {
            const decryptedBytes = CryptoJS.AES.decrypt(encryptedState, derivedKey);
            const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
            
            if (decryptedText) {
                appState = JSON.parse(decryptedText);
                
                // Đảm bảo tương thích ngược cờ isDirty
                if (appState.isDirty === undefined) {
                    appState.isDirty = false;
                }
                
                // Đảm bảo không bị thiếu các thuộc tính cài đặt mặc định
                if (!appState.settings) {
                    appState.settings = {};
                }
                if (!appState.settings.sheetUrl) {
                    appState.settings.sheetUrl = "https://docs.google.com/spreadsheets/d/1XriLKH8Y8q7x6aBHkKTURbVfF1FvLe0QUjGSsyj-ZxQ/edit?gid=0#gid=0";
                }
                if (appState.settings.webAppUrl === undefined) {
                    appState.settings.webAppUrl = "";
                }
                if (!appState.settings.syncToken) {
                    appState.settings.syncToken = "PersonalManagerHub2026";
                }
                
                // Tự động kiểm tra và áp dụng URL Google Sheets từ Biến môi trường Vercel (nếu có)
                // để tránh bị đè bởi giá trị rỗng từ localStorage cũ của người dùng
                try {
                    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL) {
                        const envUrl = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL;
                        if (envUrl && envUrl.startsWith("https://script.google.com/macros/s/")) {
                            appState.settings.webAppUrl = envUrl;
                            console.log("Đã tự động áp dụng URL Google Sheets từ Biến môi trường Vercel sau giải mã!");
                        }
                    }
                } catch (e) {
                    console.warn("Không đọc được biến môi trường trong loadStateFromLocalStorage: ", e.message);
                }
            }
        } catch (e) {
            console.error("Giải mã State cục bộ thất bại: ", e);
        }
    }
}

// ==================== C. ĐIỀU HƯỚNG TABS & BỐ CỤC (ROUTING & RESPONSIVE TABS) ====================

function initNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    const bottomNavItems = document.querySelectorAll(".bottom-nav-item");
    const panels = document.querySelectorAll(".tab-panel");
    
    function switchTab(tabName) {
        // Cập nhật trạng thái Active trên thanh Menu Sidebar
        navItems.forEach(item => {
            if (item.getAttribute("data-tab") === tabName) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
        
        // Cập nhật trạng thái Active trên thanh Bottom Navigation Bar di động
        bottomNavItems.forEach(item => {
            if (item.getAttribute("data-tab") === tabName) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
        
        // Chuyển đổi Tab Panel thực tế
        panels.forEach(panel => {
            if (panel.id === `tab-${tabName}`) {
                panel.classList.add("active");
            } else {
                panel.classList.remove("active");
            }
        });
        
        // Nếu chuyển sang tab Dashboard hoặc chuyển sang các tab khác, vẽ lại biểu đồ
        if (tabName === "dashboard") {
            renderDashboardCharts();
        }
    }
    
    // Đăng ký sự kiện click cho Sidebar Menu
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            switchTab(item.getAttribute("data-tab"));
        });
    });
    
    // Đăng ký sự kiện click cho Bottom Navigation Bar di động
    bottomNavItems.forEach(item => {
        item.addEventListener("click", () => {
            switchTab(item.getAttribute("data-tab"));
        });
    });
}

// ==================== D. TRÌNH TẠO MÃ GOOGLE APPS SCRIPT CHO CÀI ĐẶT ====================
function renderAppsScriptCode() {
    const displayElement = document.getElementById("apps-script-code-display");
    if (!displayElement) return;
    
    // Đọc mã Apps Script bằng JS và dán vào
    fetch("google-apps-script.js")
        .then(res => {
            if (!res.ok) throw new Error("File not found");
            return res.text();
        })
        .then(code => {
            displayElement.textContent = code;
        })
        .catch(() => {
            displayElement.textContent = "Không tìm thấy tệp tin chứa mã google-apps-script.js trong thư mục triển khai tĩnh hoặc do quy chế bảo mật của trình duyệt. Bạn có thể sao chép trực tiếp mã nguồn này từ tệp tin google-apps-script.js trong thư mục dự án hoặc sao chép từ tin nhắn chat của trợ lý AI!";
        });
}

// ==================== E. LOGIC TÀI CHÍNH: THU NHẬP & CHI TIÊU + OCR SCANNER ====================

// Quản lý thay đổi Loại giao dịch (Thu nhập/Chi tiêu) để thay đổi danh mục động
function updateCategoryDropdown(typeSelectId, categorySelectId) {
    const typeSelect = document.getElementById(typeSelectId);
    const catSelect = document.getElementById(categorySelectId);
    
    if (!typeSelect || !catSelect) return;
    
    const type = typeSelect.value;
    catSelect.innerHTML = "";
    
    CATEGORIES[type].forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        catSelect.appendChild(opt);
    });
}

function handleTransactionCategoryChange() {
    const catSelect = document.getElementById("trans-category");
    const linkGroup = document.getElementById("trans-link-group");
    const linkLabel = document.getElementById("trans-link-label");
    const linkSelect = document.getElementById("trans-link-id");
    
    if (!catSelect || !linkGroup || !linkLabel || !linkSelect) return;
    
    const cat = catSelect.value;
    
    if (cat === "Trả khoản nợ") {
        linkGroup.classList.remove("hidden");
        linkLabel.textContent = "Liên kết với Khoản nợ cần thanh toán đợt";
        linkSelect.innerHTML = '<option value="">-- Chọn khoản nợ cần trả --</option>';
        
        // Chỉ lấy nợ chưa trả hết
        const activeDebts = appState.debts.filter(d => {
            const paid = d.repayments ? d.repayments.reduce((s, r) => s + r.amount, 0) : 0;
            return d.status !== 'paid' && paid < d.amount;
        });
        
        if (activeDebts.length === 0) {
            linkSelect.innerHTML = '<option value="">⚠️ Không có khoản nợ hoạt động</option>';
        } else {
            activeDebts.forEach(d => {
                const paid = d.repayments ? d.repayments.reduce((s, r) => s + r.amount, 0) : 0;
                const remaining = d.amount - paid;
                const opt = document.createElement("option");
                opt.value = d.id;
                opt.textContent = `${d.creditor} (Còn nợ: ${remaining.toLocaleString('vi-VN')} ₫)`;
                linkSelect.appendChild(opt);
            });
        }
    } else if (cat === "Đầu tư / Tiết kiệm") {
        linkGroup.classList.remove("hidden");
        linkLabel.textContent = "Liên kết với Kế hoạch mục tiêu tích góp";
        linkSelect.innerHTML = '<option value="">-- Chọn kế hoạch cần tích góp --</option>';
        
        // Lấy kế hoạch chưa đạt mục tiêu
        const activeGoals = appState.goals.filter(g => {
            if (g.targetAmount === 0) return true; // Không giới hạn
            const saved = g.savings ? g.savings.reduce((s, x) => s + x.amount, 0) : g.currentAmount;
            return saved < g.targetAmount;
        });
        
        if (activeGoals.length === 0) {
            linkSelect.innerHTML = '<option value="">⚠️ Không có kế hoạch hoạt động</option>';
        } else {
            activeGoals.forEach(g => {
                const saved = g.savings ? g.savings.reduce((s, x) => s + x.amount, 0) : g.currentAmount;
                const remaining = g.targetAmount > 0 ? g.targetAmount - saved : 0;
                const opt = document.createElement("option");
                opt.value = g.id;
                opt.textContent = `${g.title} (Còn thiếu: ${remaining.toLocaleString('vi-VN')} ₫)`;
                linkSelect.appendChild(opt);
            });
        }
    } else {
        linkGroup.classList.add("hidden");
        linkSelect.innerHTML = "";
        linkSelect.value = "";
    }
}

// Cài đặt bộ quét OCR ảnh chuyển khoản ngân hàng bằng Tesseract.js cục bộ
function initOCRScanner() {
    const dropZone = document.getElementById("ocr-drop-zone");
    const fileInput = document.getElementById("ocr-file-input");
    const previewContainer = document.getElementById("ocr-preview-container");
    const previewImg = document.getElementById("ocr-preview-img");
    const statusMsg = document.getElementById("ocr-status-message");
    const statusText = document.getElementById("ocr-status-text");
    const scanLine = document.getElementById("ocr-scanner-line");
    
    if (!dropZone || !fileInput) return;
    
    // Sự kiện kéo thả
    dropZone.addEventListener("click", () => fileInput.click());
    
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });
    
    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });
    
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleOCRFile(e.dataTransfer.files[0]);
        }
    });
    
    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleOCRFile(e.target.files[0]);
        }
    });
    
    function handleOCRFile(file) {
        if (!file.type.startsWith("image/")) {
            alert("Vui lòng tải lên một tệp tin hình ảnh giao dịch hợp lệ.");
            return;
        }
        
        // Kiểm tra xem Tesseract đã tải chưa
        if (typeof Tesseract === 'undefined') {
            alert("Thư viện AI OCR Tesseract.js chưa được tải về máy của bạn. Vui lòng kết nối Internet để chạy tính năng này!");
            return;
        }
        
        // Hiển thị Preview ảnh hóa đơn giao dịch
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewContainer.classList.remove("hidden");
            scanLine.classList.remove("hidden");
            statusMsg.classList.remove("hidden");
            statusText.textContent = "Đang tải mô hình ngôn ngữ AI Tesseract...";
            
            // Bắt đầu xử lý OCR cục bộ bằng Tesseract.js
            runTesseractOCR(file);
        };
        reader.readAsDataURL(file);
    }
    
    function runTesseractOCR(file) {
        Tesseract.recognize(
            file,
            'vie+eng', // Kết hợp bộ nhận diện Tiếng Việt và Tiếng Anh ngân hàng
            { 
                logger: m => {
                    if (m.status === 'recognizing text') {
                        statusText.textContent = `Đang đọc ảnh: ${Math.round(m.progress * 100)}%...`;
                    }
                } 
            }
        ).then(({ data: { text } }) => {
            scanLine.classList.add("hidden");
            statusMsg.classList.add("hidden");
            
            // Tiến hành phân tích văn bản hóa đơn đã trích xuất
            parseTransactionText(text);
        }).catch(err => {
            scanLine.classList.add("hidden");
            statusMsg.classList.add("hidden");
            alert("Lỗi xử lý quét ảnh OCR: " + err.message);
        });
    }
}

// Hàm Regex nhận dạng các thông tin giao dịch chính của Việt Nam
function parseTransactionText(rawText) {
    let detectedAmount = 0;
    let detectedDate = new Date().toISOString().split('T')[0];
    let detectedNotes = "Quét ảnh hóa đơn";
    let detectedType = "expense"; // Mặc định là chi tiêu trừ phi nhận diện ra khoản cộng tiền
    
    // 1. Phân tích loại giao dịch (+) hay (-)
    const cleanText = rawText.replace(/\s+/g, ' ');
    if (cleanText.includes("+") || cleanText.toLowerCase().includes("nhan tien") || cleanText.toLowerCase().includes("cộng") || cleanText.toLowerCase().includes("thu nhap")) {
        detectedType = "income";
    }
    
    // 2. Nhận dạng Số tiền (Amount) - Tìm mẫu dạng +200.000, 200,000 VND, 50,000đ, v.v.
    const moneyRegex = /(?:\+|-)?\s*\b\d{1,3}(?:[.,]\d{3})+(?:\s*(?:VND|₫|đ|d|dong))?\b/gi;
    const matches = cleanText.match(moneyRegex);
    
    if (matches && matches.length > 0) {
        let maxVal = 0;
        matches.forEach(match => {
            const numericStr = match.replace(/[^\d]/g, '');
            const parsedVal = parseInt(numericStr, 10);
            if (parsedVal > maxVal && parsedVal < 500000000) { // Giới hạn hợp lý dưới 500 triệu tránh quét trúng số TK
                maxVal = parsedVal;
            }
        });
        if (maxVal > 0) detectedAmount = maxVal;
    }
    
    // 3. Nhận dạng Ngày giao dịch (Date) - Định dạng DD/MM/YYYY, DD-MM-YYYY
    const dateRegex = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g;
    const dateMatches = cleanText.match(dateRegex);
    if (dateMatches && dateMatches.length > 0) {
        const parts = dateMatches[0].split(/[\/-]/);
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);
        let year = parts[2].length === 2 ? 2000 + parseInt(parts[2], 10) : parseInt(parts[2], 10);
        
        // Đảm bảo định dạng ngày hợp lệ YYYY-MM-DD
        const formattedDay = day < 10 ? '0' + day : day;
        const formattedMonth = month < 10 ? '0' + month : month;
        detectedDate = `${year}-${formattedMonth}-${formattedDay}`;
    }
    
    // 4. Nhận dạng Nội dung/Ghi chú
    const contentKeywords = ["nội dung", "nd chuyển khoản", "lời nhắn", "nội dung chuyển", "nd", "message", "mo ta"];
    let foundNotes = "";
    
    contentKeywords.forEach(keyword => {
        const index = rawText.toLowerCase().indexOf(keyword);
        if (index !== -1 && !foundNotes) {
            const rest = rawText.substring(index + keyword.length).trim();
            const lines = rest.split('\n');
            if (lines.length > 0) {
                foundNotes = lines[0].replace(/[:\-]/g, '').trim();
                if (foundNotes.length < 5 && lines.length > 1) {
                    foundNotes += " " + lines[1].trim();
                }
            }
        }
    });
    
    if (foundNotes) detectedNotes = foundNotes;
    
    // 5. Tự động điền dữ liệu đã nhận dạng vào Biểu mẫu và tạo hiệu ứng Glow nổi bật
    document.getElementById("trans-type").value = detectedType;
    updateCategoryDropdown("trans-type", "trans-category");
    
    document.getElementById("trans-date").value = detectedDate;
    document.getElementById("trans-amount").value = detectedAmount;
    document.getElementById("trans-notes").value = `[AI OCR Quét Hóa Đơn] ${detectedNotes}`;
    
    // Hiệu ứng phát sáng các ô nhập liệu được auto-fill thành công
    const highlightInputs = [
        document.getElementById("trans-type"),
        document.getElementById("trans-date"),
        document.getElementById("trans-amount"),
        document.getElementById("trans-notes")
    ];
    
    highlightInputs.forEach(el => {
        if (!el) return;
        el.style.borderColor = "var(--color-emerald)";
        el.style.boxShadow = "0 0 15px var(--color-emerald-glow)";
        setTimeout(() => {
            el.style.borderColor = "";
            el.style.boxShadow = "";
        }, 3000);
    });
    
    alert(`Quét ảnh thành công!\n- Số tiền nhận diện: ${detectedAmount.toLocaleString('vi-VN')} ₫\n- Ngày: ${detectedDate}\n- Ghi chú: ${detectedNotes}`);
}

// Thêm hoặc cập nhật Giao dịch
function handleSaveTransaction(e) {
    e.preventDefault();
    
    const id = document.getElementById("trans-id").value;
    const type = document.getElementById("trans-type").value;
    const date = document.getElementById("trans-date").value;
    const amount = parseFloat(document.getElementById("trans-amount").value);
    const category = document.getElementById("trans-category").value;
    const notes = document.getElementById("trans-notes").value.trim();
    const linkId = document.getElementById("trans-link-id") ? document.getElementById("trans-link-id").value : "";
    
    if (isNaN(amount) || amount <= 0) {
        alert("Số tiền giao dịch phải lớn hơn 0 ₫.");
        return;
    }
    
    const newTrans = {
        id: id || "trans-" + Date.now(),
        type,
        date,
        amount,
        category,
        notes
    };
    
    if (id) {
        // Cập nhật giao dịch cũ
        const idx = appState.transactions.findIndex(t => t.id === id);
        if (idx !== -1) appState.transactions[idx] = newTrans;
    } else {
        // Thêm giao dịch mới
        appState.transactions.push(newTrans);
        
        // Xử lý liên kết tự động tới Khoản nợ hoặc Kế hoạch mục tiêu
        if (linkId) {
            if (category === "Trả khoản nợ") {
                const debt = appState.debts.find(d => d.id === linkId);
                if (debt) {
                    if (!debt.repayments) debt.repayments = [];
                    debt.repayments.push({
                        id: "rep-" + Date.now(),
                        amount: amount,
                        date: date
                    });
                    // Cập nhật trạng thái nợ nếu trả hết
                    const totalPaid = debt.repayments.reduce((s, r) => s + r.amount, 0);
                    if (totalPaid >= debt.amount) {
                        debt.status = "paid";
                    } else {
                        debt.status = "active";
                    }
                }
            } else if (category === "Đầu tư / Tiết kiệm") {
                const goal = appState.goals.find(g => g.id === linkId);
                if (goal) {
                    if (!goal.savings) goal.savings = [];
                    goal.savings.push({
                        id: "save-" + Date.now(),
                        amount: amount,
                        date: date
                    });
                    goal.currentAmount = goal.savings.reduce((s, x) => s + x.amount, 0);
                }
            }
        }
    }
    
    saveStateToLocalStorage();
    triggerAutoSync(); // Đồng bộ tự động ngầm nếu có cài đặt Sheets
    
    // Reset Form & làm mới danh sách hiển thị
    document.getElementById("transaction-form").reset();
    document.getElementById("trans-id").value = "";
    document.getElementById("ocr-preview-container").classList.add("hidden");
    document.getElementById("ocr-file-input").value = "";
    
    updateCategoryDropdown("trans-type", "trans-category");
    handleTransactionCategoryChange();
    renderAllViews();
    alert("Lưu giao dịch thành công!");
}

// Xóa giao dịch
function handleDeleteTransaction(id) {
    if (confirm("Bạn có chắc chắn muốn xóa giao dịch này không?")) {
        appState.transactions = appState.transactions.filter(t => t.id !== id);
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

// Sửa giao dịch (Nạp dữ liệu lên Form để chỉnh sửa)
function handleEditTransaction(id) {
    const trans = appState.transactions.find(t => t.id === id);
    if (!trans) return;
    
    document.getElementById("trans-id").value = trans.id;
    document.getElementById("trans-type").value = trans.type;
    updateCategoryDropdown("trans-type", "trans-category");
    
    document.getElementById("trans-date").value = trans.date;
    document.getElementById("trans-amount").value = trans.amount;
    document.getElementById("trans-category").value = trans.category;
    document.getElementById("trans-notes").value = trans.notes;
    
    // Cuộn màn hình lên khu vực form (cho giao diện di động)
    document.getElementById("transaction-form").scrollIntoView({ behavior: 'smooth' });
}

// ==================== F. LOGIC QUẢN LÝ KHOẢN NỢ VÀ THANH TOÁN ĐỢT ====================

function handleSaveDebt(e) {
    e.preventDefault();
    
    const id = document.getElementById("debt-id").value;
    const creditor = document.getElementById("debt-creditor").value.trim();
    const type = document.getElementById("debt-type").value;
    const interestRate = parseFloat(document.getElementById("debt-interest").value) || 0;
    const installmentsCount = parseInt(document.getElementById("debt-installments-count").value) || 0;
    const installmentAmount = parseFloat(document.getElementById("debt-installment-amount").value) || 0;
    const amount = parseFloat(document.getElementById("debt-amount").value);
    const dueDate = document.getElementById("debt-due-date").value;
    const status = document.getElementById("debt-status").value;
    
    const oldDebt = appState.debts.find(d => d.id === id);
    const repayments = oldDebt ? oldDebt.repayments : [];
    
    const newDebt = {
        id: id || "debt-" + Date.now(),
        creditor,
        amount,
        type,
        interestRate,
        dueDate,
        status,
        repayments,
        installmentsCount,
        installmentAmount
    };
    
    if (id) {
        const idx = appState.debts.findIndex(d => d.id === id);
        if (idx !== -1) appState.debts[idx] = newDebt;
    } else {
        appState.debts.push(newDebt);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    closeModal("modal-debt");
    renderAllViews();
}

function handleDeleteDebt(id) {
    if (confirm("Xóa khoản nợ này sẽ xóa toàn bộ nhật ký thanh toán đợt kèm theo. Bạn có chắc không?")) {
        appState.debts = appState.debts.filter(d => d.id !== id);
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

// Mở form nhập Repayment đợt trả nợ
function openRepaymentModal(debtId) {
    const debt = appState.debts.find(d => d.id === debtId);
    if (!debt) return;
    
    document.getElementById("repayment-debt-id").value = debt.id;
    
    // Tính tổng đã trả trước đó để hiển thị
    const totalPaid = debt.repayments ? debt.repayments.reduce((sum, r) => sum + r.amount, 0) : 0;
    const remaining = debt.amount - totalPaid;
    
    document.getElementById("repayment-debt-summary").innerHTML = `
        <strong>Chủ nợ:</strong> ${debt.creditor}<br>
        <strong>Dư nợ gốc:</strong> ${debt.amount.toLocaleString('vi-VN')} ₫<br>
        <strong>Đã trả:</strong> ${totalPaid.toLocaleString('vi-VN')} ₫<br>
        <strong>Còn lại:</strong> <span style="color: var(--color-coral); font-weight: bold;">${remaining.toLocaleString('vi-VN')} ₫</span>
    `;
    
    document.getElementById("repayment-amount").value = remaining;
    document.getElementById("repayment-date").value = new Date().toISOString().split('T')[0];
    
    // Hiển thị danh sách lịch sử trả nợ chia nhỏ từng đợt
    const historyList = document.getElementById("repayment-history-list");
    if (historyList) {
        historyList.innerHTML = "";
        const reps = debt.repayments || [];
        
        if (reps.length === 0) {
            historyList.innerHTML = `<p class="empty-text" style="font-size: 11px; margin: 0;">Chưa có đợt thanh toán nào.</p>`;
        } else {
            reps.forEach((r, idx) => {
                const item = document.createElement("div");
                item.className = "file-item"; // Tái sử dụng class CSS file-item cực đẹp sẵn có
                item.style.padding = "6px 10px";
                item.style.display = "flex";
                item.style.justifyContent = "space-between";
                item.style.alignItems = "center";
                item.style.background = "rgba(255,255,255,0.02)";
                item.style.borderRadius = "6px";
                item.style.border = "1px solid rgba(255,255,255,0.04)";
                
                item.innerHTML = `
                    <div style="text-align: left;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">Đợt ${idx + 1}: +${r.amount.toLocaleString('vi-VN')} ₫</span>
                        <p style="margin: 0; font-size: 10px; color: var(--text-muted);">Ngày: ${r.date}</p>
                    </div>
                    <button type="button" class="btn-action-small btn-delete" onclick="deleteRepayment('${debt.id}', '${r.id}')" title="Xóa đợt thanh toán này"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
                `;
                historyList.appendChild(item);
            });
        }
    }
    
    openModal("modal-repayment");
}

// Ghi nhận đợt thanh toán nợ
function handleSaveRepayment(e) {
    e.preventDefault();
    
    const debtId = document.getElementById("repayment-debt-id").value;
    const amount = parseFloat(document.getElementById("repayment-amount").value);
    const date = document.getElementById("repayment-date").value;
    const autoTrans = document.getElementById("repayment-auto-transaction").checked;
    
    const debtIdx = appState.debts.findIndex(d => d.id === debtId);
    if (debtIdx === -1) return;
    
    const debt = appState.debts[debtIdx];
    const totalPaid = debt.repayments.reduce((sum, r) => sum + r.amount, 0);
    const remaining = debt.amount - totalPaid;
    
    if (amount <= 0 || amount > remaining) {
        alert(`Số tiền trả đợt này phải lớn hơn 0 và không vượt quá số nợ còn lại (${remaining.toLocaleString('vi-VN')} ₫).`);
        return;
    }
    
    // 1. Thêm đợt thanh toán nợ vào nhật ký
    const repObj = {
        id: "rep-" + Date.now(),
        amount,
        date
    };
    debt.repayments.push(repObj);
    
    // Cập nhật trạng thái tự động nếu đã trả hết
    const newTotalPaid = totalPaid + amount;
    if (newTotalPaid >= debt.amount) {
        debt.status = "paid";
    }
    
    // 2. Tự động ghi chép khoản chi này vào bảng Thu & Chi
    if (autoTrans) {
        const transObj = {
            id: "trans-" + Date.now(),
            type: debt.type === "owe_others" ? "expense" : "income",
            date,
            amount,
            category: "Trả khoản nợ",
            notes: `[Tự động trả nợ] Thanh toán đợt cho ${debt.creditor}`
        };
        appState.transactions.push(transObj);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    closeModal("modal-repayment");
    renderAllViews();
    alert("Cập nhật thanh toán đợt thành công!");
}

// Xóa đợt thanh toán nợ chia nhỏ từng đợt
function deleteRepayment(debtId, repaymentId) {
    if (confirm("Bạn có chắc chắn muốn xóa đợt thanh toán này?")) {
        const debtIdx = appState.debts.findIndex(d => d.id === debtId);
        if (debtIdx === -1) return;
        
        const debt = appState.debts[debtIdx];
        debt.repayments = debt.repayments.filter(r => r.id !== repaymentId);
        
        // Khôi phục trạng thái active nếu dư nợ chưa trả hết
        const totalPaid = debt.repayments.reduce((sum, r) => sum + r.amount, 0);
        if (totalPaid < debt.amount) {
            debt.status = "active";
        }
        
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
        
        // Cập nhật lại giao diện modal hiện tại
        openRepaymentModal(debtId);
    }
}

// ==================== G. LOGIC KẾ HOẠCH & MỤC TIÊU (FUTURE GOALS) ====================

function handleSaveGoal(e) {
    e.preventDefault();
    
    const id = document.getElementById("goal-id").value;
    const title = document.getElementById("goal-title").value.trim();
    const timeframe = document.getElementById("goal-timeframe").value;
    const dueDate = document.getElementById("goal-due-date").value;
    const installmentsCount = parseInt(document.getElementById("goal-installments-count").value) || 0;
    const installmentAmount = parseFloat(document.getElementById("goal-installment-amount").value) || 0;
    const targetAmount = parseFloat(document.getElementById("goal-target-amount").value) || 0;
    const currentAmount = parseFloat(document.getElementById("goal-current-amount").value) || 0;
    const milestonesStr = document.getElementById("goal-milestones-input").value.trim();
    
    // Xử lý milestones
    let milestones = [];
    if (milestonesStr) {
        milestones = milestonesStr.split(',').map(m => m.trim()).filter(m => m !== "").map((m, idx) => {
            return { id: `ms-${idx}-${Date.now()}`, title: m, completed: false };
        });
    }
    
    const oldGoal = appState.goals.find(g => g.id === id);
    if (oldGoal && oldGoal.milestones.length > 0 && !milestonesStr) {
        milestones = oldGoal.milestones;
    }
    
    // Xử lý savings để tương thích ngược và khởi tạo đợt tích góp đầu tiên
    let savings = [];
    if (id && oldGoal) {
        savings = oldGoal.savings || [];
        // Nếu thay đổi số tiền hiện có trực tiếp trong form sửa, cập nhật đợt tích góp đầu tiên hoặc tạo mới
        if (oldGoal.currentAmount !== currentAmount) {
            if (savings.length > 0) {
                // Điều chỉnh đợt đầu tiên hoặc bổ sung điều chỉnh để khớp với số tiền mới sửa đổi
                const diff = currentAmount - oldGoal.currentAmount;
                savings.push({
                    id: "save-adjust-" + Date.now(),
                    amount: diff,
                    date: new Date().toISOString().split('T')[0]
                });
            } else if (currentAmount > 0) {
                savings.push({
                    id: "save-init-" + Date.now(),
                    amount: currentAmount,
                    date: new Date().toISOString().split('T')[0]
                });
            }
        }
    } else if (currentAmount > 0) {
        savings.push({
            id: "save-init-" + Date.now(),
            amount: currentAmount,
            date: new Date().toISOString().split('T')[0]
        });
    }
    
    // Tính lại currentAmount tổng hợp từ lịch sử đợt tích góp
    const finalCurrentAmount = savings.length > 0 ? savings.reduce((sum, s) => sum + s.amount, 0) : currentAmount;
    
    const newGoal = {
        id: id || "goal-" + Date.now(),
        title,
        timeframe,
        dueDate,
        targetAmount,
        currentAmount: finalCurrentAmount,
        milestones,
        savings,
        installmentsCount,
        installmentAmount
    };
    
    if (id) {
        const idx = appState.goals.findIndex(g => g.id === id);
        if (idx !== -1) appState.goals[idx] = newGoal;
    } else {
        appState.goals.push(newGoal);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    closeModal("modal-goal");
    renderAllViews();
}

function handleDeleteGoal(id) {
    if (confirm("Bạn có muốn xóa mục tiêu kế hoạch này không?")) {
        appState.goals = appState.goals.filter(g => g.id !== id);
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

// --- 3. TÍCH GÓP MỤC TIÊU TIẾT KIỆM LOGIC ---

// Mở form nhập đợt tích góp
function openSavingsModal(goalId) {
    const goal = appState.goals.find(g => g.id === goalId);
    if (!goal) return;
    
    document.getElementById("savings-goal-id").value = goal.id;
    
    const totalSaved = goal.savings ? goal.savings.reduce((sum, s) => sum + s.amount, 0) : goal.currentAmount;
    const remaining = goal.targetAmount - totalSaved;
    
    document.getElementById("savings-goal-summary").innerHTML = `
        <strong>Mục tiêu:</strong> ${goal.title}<br>
        <strong>Mục tiêu tích lũy:</strong> ${goal.targetAmount.toLocaleString('vi-VN')} ₫<br>
        <strong>Đã tích góp:</strong> ${totalSaved.toLocaleString('vi-VN')} ₫<br>
        <strong>Còn lại:</strong> <span style="color: var(--color-primary); font-weight: bold;">${remaining > 0 ? remaining.toLocaleString('vi-VN') + ' ₫' : 'Đã đạt mục tiêu!'}</span>
    `;
    
    document.getElementById("savings-amount").value = remaining > 0 ? remaining : 0;
    document.getElementById("savings-date").value = new Date().toISOString().split('T')[0];
    
    // Hiển thị danh sách lịch sử tích góp chia nhỏ từng đợt
    const historyList = document.getElementById("savings-history-list");
    if (historyList) {
        historyList.innerHTML = "";
        const savingsList = goal.savings || [];
        
        if (savingsList.length === 0) {
            historyList.innerHTML = `<p class="empty-text" style="font-size: 11px; margin: 0;">Chưa có đợt tích góp nào.</p>`;
        } else {
            savingsList.forEach((s, idx) => {
                const item = document.createElement("div");
                item.className = "file-item"; // Tái sử dụng style file-item cực đẹp
                item.style.padding = "6px 10px";
                item.style.display = "flex";
                item.style.justifyContent = "space-between";
                item.style.alignItems = "center";
                item.style.background = "rgba(255,255,255,0.02)";
                item.style.borderRadius = "6px";
                item.style.border = "1px solid rgba(255,255,255,0.04)";
                
                item.innerHTML = `
                    <div style="text-align: left;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">Đợt ${idx + 1}: +${s.amount.toLocaleString('vi-VN')} ₫</span>
                        <p style="margin: 0; font-size: 10px; color: var(--text-muted);">Ngày: ${s.date}</p>
                    </div>
                    <button type="button" class="btn-action-small btn-delete" onclick="deleteSaving('${goal.id}', '${s.id}')" title="Xóa đợt tích góp"><i data-lucide="trash-2" style="width: 12px; height: 12px;"></i></button>
                `;
                historyList.appendChild(item);
            });
        }
    }
    
    openModal("modal-savings");
}

// Ghi nhận đợt tích góp mục tiêu
function handleSaveSavings(e) {
    e.preventDefault();
    
    const goalId = document.getElementById("savings-goal-id").value;
    const amount = parseFloat(document.getElementById("savings-amount").value);
    const date = document.getElementById("savings-date").value;
    const autoTrans = document.getElementById("savings-auto-transaction").checked;
    
    const goalIdx = appState.goals.findIndex(g => g.id === goalId);
    if (goalIdx === -1) return;
    
    const goal = appState.goals[goalIdx];
    if (!goal.savings) {
        goal.savings = [];
    }
    
    const totalSaved = goal.savings.reduce((sum, s) => sum + s.amount, 0);
    const remaining = goal.targetAmount - totalSaved;
    
    if (amount <= 0) {
        alert("Số tiền tích góp đợt này phải lớn hơn 0 ₫.");
        return;
    }
    
    // 1. Thêm đợt tích góp vào nhật ký
    const saveObj = {
        id: "save-" + Date.now(),
        amount,
        date
    };
    goal.savings.push(saveObj);
    
    // Cập nhật currentAmount tổng hợp
    goal.currentAmount = totalSaved + amount;
    
    // 2. Tự động ghi chép khoản chi này vào bảng Thu & Chi (dưới dạng chi tiêu tiết kiệm)
    if (autoTrans) {
        const transObj = {
            id: "trans-" + Date.now(),
            type: "expense",
            date,
            amount,
            category: "Đầu tư / Tiết kiệm",
            notes: `[Tự động tích góp] Đóng góp đợt cho mục tiêu "${goal.title}"`
        };
        appState.transactions.push(transObj);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    closeModal("modal-savings");
    renderAllViews();
    alert("Cập nhật tích góp mục tiêu thành công!");
}

// Xóa đợt tích góp
function deleteSaving(goalId, savingId) {
    if (confirm("Bạn có chắc chắn muốn xóa đợt tích góp này?")) {
        const goalIdx = appState.goals.findIndex(g => g.id === goalId);
        if (goalIdx === -1) return;
        
        const goal = appState.goals[goalIdx];
        goal.savings = goal.savings.filter(s => s.id !== savingId);
        
        // Cập nhật lại currentAmount tổng hợp
        goal.currentAmount = goal.savings.reduce((sum, s) => sum + s.amount, 0);
        
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
        
        // Cập nhật lại giao diện modal hiện tại
        openSavingsModal(goalId);
    }
}

// Cập nhật trạng thái hoàn thành mốc
function toggleMilestone(goalId, milestoneId) {
    const goalIdx = appState.goals.findIndex(g => g.id === goalId);
    if (goalIdx === -1) return;
    
    const goal = appState.goals[goalIdx];
    const msIdx = goal.milestones.findIndex(m => m.id === milestoneId);
    if (msIdx === -1) return;
    
    goal.milestones[msIdx].completed = !goal.milestones[msIdx].completed;
    
    saveStateToLocalStorage();
    triggerAutoSync();
    renderAllViews();
}

// ==================== H. LOGIC WORKSPACE: KANBAN BOARD + GHI CHÚ ====================

// --- 1. KANBAN LOGIC ---
function handleSaveTask(e) {
    e.preventDefault();
    
    const id = document.getElementById("task-id").value;
    const title = document.getElementById("task-title").value.trim();
    const description = document.getElementById("task-desc").value.trim();
    const status = document.getElementById("task-status").value;
    const priority = document.getElementById("task-priority").value;
    const dueDate = document.getElementById("task-due-date").value;
    
    const newTask = {
        id: id || "task-" + Date.now(),
        title,
        description,
        status,
        priority,
        dueDate
    };
    
    if (id) {
        const idx = appState.tasks.findIndex(t => t.id === id);
        if (idx !== -1) appState.tasks[idx] = newTask;
    } else {
        appState.tasks.push(newTask);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    closeModal("modal-task");
    renderAllViews();
}

function handleDeleteTask(id) {
    if (confirm("Bạn có chắc chắn muốn xóa nhiệm vụ này không?")) {
        appState.tasks = appState.tasks.filter(t => t.id !== id);
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

// Kéo thả Kanban
function allowDrop(ev) {
    ev.preventDefault();
}

function dragTask(ev, taskId) {
    ev.dataTransfer.setData("text", taskId);
}

function dropTask(ev, destStatus) {
    ev.preventDefault();
    const taskId = ev.dataTransfer.getData("text");
    
    const taskIdx = appState.tasks.findIndex(t => t.id === taskId);
    if (taskIdx !== -1) {
        appState.tasks[taskIdx].status = destStatus;
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

// Di chuyển trạng thái công việc (dành cho di động không kéo thả được)
function moveTask(taskId, direction) {
    const taskIdx = appState.tasks.findIndex(t => t.id === taskId);
    if (taskIdx === -1) return;
    
    const task = appState.tasks[taskIdx];
    const statuses = ["todo", "inprogress", "review", "done"];
    const currentIdx = statuses.indexOf(task.status);
    
    if (direction === "next" && currentIdx < statuses.length - 1) {
        task.status = statuses[currentIdx + 1];
    } else if (direction === "prev" && currentIdx > 0) {
        task.status = statuses[currentIdx - 1];
    } else {
        return;
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    renderAllViews();
}

// --- 2. GHI CHÚ LOGIC ---
function handleSaveNote(e) {
    e.preventDefault();
    
    const id = document.getElementById("note-id").value;
    const title = document.getElementById("note-title").value.trim();
    const content = document.getElementById("note-content").value.trim();
    
    const newNote = {
        id: id || "note-" + Date.now(),
        title,
        content,
        createdAt: new Date().toLocaleDateString('vi-VN') + " " + new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})
    };
    
    if (id) {
        const idx = appState.notes.findIndex(n => n.id === id);
        if (idx !== -1) appState.notes[idx] = newNote;
    } else {
        appState.notes.push(newNote);
    }
    
    saveStateToLocalStorage();
    triggerAutoSync();
    
    document.getElementById("note-form").reset();
    document.getElementById("note-id").value = "";
    document.getElementById("note-form-title").textContent = "Tạo ghi chú mới";
    
    renderAllViews();
    alert("Lưu sổ tay ghi chú thành công!");
}

function handleDeleteNote(id) {
    if (confirm("Bạn có chắc muốn xóa ghi chú này không?")) {
        appState.notes = appState.notes.filter(n => n.id !== id);
        saveStateToLocalStorage();
        triggerAutoSync();
        renderAllViews();
    }
}

function handleEditNote(id) {
    const note = appState.notes.find(n => n.id === id);
    if (!note) return;
    
    document.getElementById("note-id").value = note.id;
    document.getElementById("note-title").value = note.title;
    document.getElementById("note-content").value = note.content;
    document.getElementById("note-form-title").textContent = "Chỉnh sửa ghi chú";
}

function copyNoteForNotebookLM(id) {
    const note = appState.notes.find(n => n.id === id);
    if (!note) return;
    
    const formatted = `=== TÀI LIỆU GHI CHÚ CÁ NHÂN ===\nTiêu đề: ${note.title}\nNgày tạo: ${note.createdAt}\nNội dung chi tiết:\n${note.content}\n=================================`;
    
    navigator.clipboard.writeText(formatted).then(() => {
        alert("Đã sao chép nội dung ghi chú chuẩn cấu trúc vào Clipboard! Giờ bạn chỉ cần nhấn Ctrl+V (Dán) vào NotebookLM.");
    }).catch(err => {
        alert("Lỗi sao chép Clipboard: " + err.message);
    });
}

// --- 3. NOTEBOOKLM HUB PANEL & EXPORTER ---
function exportAllDataToNotebookLM() {
    let md = `# BÁO CÁO CƠ SỞ DỮ LIỆU CỦA PERSONAL HUB\n`;
    md += `Xuất bản lúc: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}\n\n`;
    
    // Thống kê tài sản ròng
    const incomeTotal = appState.transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
    const expenseTotal = appState.transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
    const totalDebt = appState.debts.filter(d => d.status !== "paid" && d.type === "owe_others").reduce((sum, d) => {
        const paid = d.repayments.reduce((s, r) => s + r.amount, 0);
        return sum + (d.amount - paid);
    }, 0);
    const totalReceivable = appState.debts.filter(d => d.status !== "paid" && d.type === "others_owe").reduce((sum, d) => {
        const paid = d.repayments.reduce((s, r) => s + r.amount, 0);
        return sum + (d.amount - paid);
    }, 0);
    const netWorth = incomeTotal - expenseTotal - totalDebt + totalReceivable;
    
    md += `## 1. TỔNG QUAN TÀI CHÍNH CÁ NHÂN\n`;
    md += `- Tài sản ròng (Ước tính): ${netWorth.toLocaleString('vi-VN')} VND\n`;
    md += `- Tổng thu nhập đã ghi nhận: ${incomeTotal.toLocaleString('vi-VN')} VND\n`;
    md += `- Tổng chi tiêu đã ghi nhận: ${expenseTotal.toLocaleString('vi-VN')} VND\n`;
    md += `- Tổng dư nợ phải trả (Chưa trả xong): ${totalDebt.toLocaleString('vi-VN')} VND\n`;
    md += `- Tổng khoản cho vay (Chưa thu hồi xong): ${totalReceivable.toLocaleString('vi-VN')} VND\n\n`;
    
    // Chi tiết Khoản nợ
    md += `## 2. CHI TIẾT CÁC KHOẢN NỢ\n`;
    if (appState.debts.length === 0) {
        md += `Không có khoản nợ nào được ghi nhận.\n\n`;
    } else {
        appState.debts.forEach((d, idx) => {
            const paid = d.repayments.reduce((s, r) => s + r.amount, 0);
            md += `### Khoản nợ ${idx + 1}: ${d.creditor}\n`;
            md += `- Loại: ${d.type === "owe_others" ? "Tôi nợ họ (Phải trả)" : "Họ nợ tôi (Cho vay)"}\n`;
            md += `- Số tiền gốc: ${d.amount.toLocaleString('vi-VN')} VND\n`;
            md += `- Đã thanh toán: ${paid.toLocaleString('vi-VN')} VND (${Math.round((paid / d.amount) * 100)}%)\n`;
            md += `- Còn lại: ${(d.amount - paid).toLocaleString('vi-VN')} VND\n`;
            md += `- Hạn thanh toán: ${d.dueDate}\n`;
            md += `- Trạng thái: ${d.status === "active" ? "Đang hoạt động" : d.status === "paid" ? "Đã trả xong" : "Đã trễ hạn"}\n\n`;
        });
    }
    
    // Kế hoạch tương lai
    md += `## 3. KẾ HOẠCH VÀ MỤC TIÊU TƯƠNG LAI\n`;
    if (appState.goals.length === 0) {
        md += `Chưa có kế hoạch tương lai nào được lập.\n\n`;
    } else {
        appState.goals.forEach((g, idx) => {
            let progress = 0;
            if (g.targetAmount > 0) {
                progress = Math.round((g.currentAmount / g.targetAmount) * 100);
            } else if (g.milestones.length > 0) {
                const comp = g.milestones.filter(m => m.completed).length;
                progress = Math.round((comp / g.milestones.length) * 100);
            }
            md += `### Mục tiêu ${idx + 1}: ${g.title}\n`;
            md += `- Thời hạn: ${g.timeframe === "short" ? "Ngắn hạn (<1 năm)" : g.timeframe === "medium" ? "Trung hạn (1-3 năm)" : "Dài hạn (>3 năm)"}\n`;
            md += `- Hạn đạt: ${g.dueDate}\n`;
            if (g.targetAmount > 0) {
                md += `- Ngân sách dự kiến: ${g.targetAmount.toLocaleString('vi-VN')} VND\n`;
                md += `- Đã tiết kiệm tích lũy: ${g.currentAmount.toLocaleString('vi-VN')} VND\n`;
            }
            md += `- Tiến độ hoàn thành: ${progress}%\n`;
            if (g.milestones.length > 0) {
                md += `- Các mốc quan trọng (Milestones):\n`;
                g.milestones.forEach(m => {
                    md += `  - [${m.completed ? 'x' : ' '}] ${m.title}\n`;
                });
            }
            md += `\n`;
        });
    }
    
    // Bảng Kanban Công việc
    md += `## 4. QUẢN LÝ CÔNG VIỆC (KANBAN BOARD)\n`;
    const statuses = { todo: "Cần làm", inprogress: "Đang làm", review: "Đang kiểm tra", done: "Đã xong" };
    Object.keys(statuses).forEach(stat => {
        const list = appState.tasks.filter(t => t.status === stat);
        md += `### Trạng thái: ${statuses[stat]} (${list.length} nhiệm vụ)\n`;
        if (list.length === 0) {
            md += `Không có nhiệm vụ nào.\n`;
        } else {
            list.forEach(t => {
                md += `- **${t.title}** [Ưu tiên: ${t.priority.toUpperCase()}] (Hạn chót: ${t.dueDate})\n`;
                if (t.description) md += `  *Mô tả:* ${t.description}\n`;
            });
        }
        md += `\n`;
    });
    
    // Các ghi chú trong sổ tay
    md += `## 5. SỔ TAY GHI CHÚ CÁ NHÂN & Ý TƯỞNG\n`;
    if (appState.notes.length === 0) {
        md += `Sổ tay hiện đang trống.\n\n`;
    } else {
        appState.notes.forEach((n, idx) => {
            md += `### Ghi chú ${idx + 1}: ${n.title} (Ngày viết: ${n.createdAt})\n`;
            md += `${n.content}\n\n`;
        });
    }
    
    navigator.clipboard.writeText(md).then(() => {
        alert("Đã kết xuất và sao chép toàn bộ dữ liệu Personal Hub của bạn dưới dạng văn bản cấu trúc AI AI-Markdown vào Clipboard!\n\nBây giờ bạn chỉ cần mở NotebookLM lên và dán (Ctrl+V) làm nguồn tài liệu để bắt đầu hỏi đáp trợ lý AI nhé.");
    }).catch(err => {
        alert("Lỗi kết xuất dữ liệu: " + err.message);
    });
}

// --- 4. KHO LƯU TRỮ VÀ MẸO HAY ---
// Đã loại bỏ các chức năng tải và xóa tệp tin để tối ưu hóa hiệu năng duyệt web theo yêu cầu người dùng.

function togglePinTip(tipId) {
    const tips = JSON.parse(localStorage.getItem("pmh_storage_tips")) || INITIAL_STORAGE_TIPS;
    const idx = tips.findIndex(t => t.id === tipId);
    if (idx !== -1) {
        tips[idx].pinned = !tips[idx].pinned;
        localStorage.setItem("pmh_storage_tips", JSON.stringify(tips));
        renderStorageTips();
    }
}

// ==================== I. ĐỒNG BỘ ĐÁM MÂY GOOGLE SHEETS VIA APPS SCRIPT WEB APP ====================

function handleSaveSettings() {
    const webAppUrl = document.getElementById("settings-web-app-url").value.trim();
    const syncToken = document.getElementById("settings-sync-token").value.trim();
    
    if (webAppUrl && !webAppUrl.startsWith("https://script.google.com/macros/s/")) {
        alert("Đường dẫn Google Apps Script Web App của bạn không hợp lệ. URL phải có dạng đầu: https://script.google.com/macros/s/...");
        return;
    }
    
    appState.settings.webAppUrl = webAppUrl;
    appState.settings.syncToken = syncToken;
    
    saveStateToLocalStorage();
    alert("Đã cấu hình thông số kết nối đám mây!");
    
    if (webAppUrl) {
        syncAllDataToGoogleSheets();
    }
}

function testGoogleSheetsConnection(alertSuccess = true) {
    const webAppUrl = appState.settings.webAppUrl || document.getElementById("settings-web-app-url").value.trim();
    const syncToken = appState.settings.syncToken || document.getElementById("settings-sync-token").value.trim();
    const indicator = document.getElementById("sync-indicator");
    
    if (!webAppUrl) {
        if (alertSuccess) alert("Bạn cần điền URL Apps Script Web App trước khi kiểm tra kết nối.");
        return;
    }
    
    if (indicator) {
        indicator.className = "sync-status-badge syncing";
        indicator.querySelector(".status-text").textContent = "Đang kết nối...";
    }
    
    const testUrl = `${webAppUrl}?token=${encodeURIComponent(syncToken)}`;
    
    fetch(testUrl, { method: "GET", mode: "cors" })
        .then(res => res.json())
        .then(resData => {
            if (resData.success) {
                if (indicator) {
                    indicator.className = "sync-status-badge online";
                    indicator.querySelector(".status-text").textContent = "Sheets (Đã kết nối)";
                }
                if (alertSuccess) alert("Chúc mừng! Kết nối với cơ sở dữ liệu Google Sheet của bạn hoạt động hoàn hảo.");
            } else {
                throw new Error(resData.error || "Token bảo mật không chính xác.");
            }
        })
        .catch(err => {
            if (indicator) {
                indicator.className = "sync-status-badge offline";
                indicator.querySelector(".status-text").textContent = "Lỗi kết nối";
            }
            alert(`Lỗi kết nối Google Sheets: ${err.message}\nHãy kiểm tra lại URL Web App và biến SECURITY_TOKEN đã khớp chưa.`);
        });
}

// Hàm tạo hiệu ứng lóe sáng xanh neon khi đồng bộ thành công
function triggerHeaderSyncGlow() {
    const indicator = document.getElementById("sync-indicator");
    const quickSyncBtn = document.getElementById("btn-quick-sync");
    
    if (indicator) {
        indicator.classList.remove("sync-success-glow-badge");
        void indicator.offsetWidth; // Trigger reflow để reset CSS animation
        indicator.classList.add("sync-success-glow-badge");
        setTimeout(() => indicator.classList.remove("sync-success-glow-badge"), 1500);
    }
    
    if (quickSyncBtn) {
        quickSyncBtn.classList.remove("sync-success-glow");
        void quickSyncBtn.offsetWidth; // Trigger reflow để reset CSS animation
        quickSyncBtn.classList.add("sync-success-glow");
        setTimeout(() => quickSyncBtn.classList.remove("sync-success-glow"), 1500);
    }
}

function syncAllDataToGoogleSheets(alertSuccess = false) {
    const webAppUrl = appState.settings.webAppUrl;
    const syncToken = appState.settings.syncToken;
    const indicator = document.getElementById("sync-indicator");
    
    if (!webAppUrl) {
        console.warn("⚠️ Bỏ qua đồng bộ: webAppUrl đang trống hoặc chưa được cấu hình!");
        return;
    }

    if (isPushing || isPulling) {
        console.log("⏳ Hệ thống đang bận đồng bộ dữ liệu khác. Đợi lượt tiếp theo...");
        return;
    }
    
    isPushing = true;
    console.log("⚡ Bắt đầu gửi đồng bộ lên Google Sheets...");
    console.log("- URL Web App nhận được:", webAppUrl);
    console.log("- Token sử dụng:", syncToken);
    console.log("- Số lượng giao dịch gửi đi:", appState.transactions.length);
    console.log("- Số lượng khoản nợ gửi đi:", appState.debts.length);
    console.log("- Số lượng ghi chú gửi đi:", appState.notes.length);
    
    if (indicator) {
        indicator.className = "sync-status-badge syncing";
        indicator.querySelector(".status-text").textContent = "Đang đồng bộ...";
    }
    
    const payload = {
        token: syncToken,
        data: {
            "Thu_Nhap": appState.transactions.map(t => {
                return { "ID": t.id, "Amount": t.amount, "Category": t.category, "Date": t.date, "Notes": t.notes, "Type": t.type };
            }),
            "Khoan_No": appState.debts.map(d => {
                return { 
                    "ID": d.id, "Creditor": d.creditor, "Amount": d.amount, "Type": d.type, 
                    "InterestRate": d.interestRate, "DueDate": d.dueDate, "Status": d.status,
                    "Repayments": JSON.stringify(d.repayments),
                    "InstallmentsCount": d.installmentsCount || 0,
                    "InstallmentAmount": d.installmentAmount || 0
                };
            }),
            "Ke_Hoach": appState.goals.map(g => {
                return { 
                    "ID": g.id, "Title": g.title, "TargetAmount": g.targetAmount, "CurrentAmount": g.currentAmount, 
                    "DueDate": g.dueDate, "Timeframe": g.timeframe, 
                    "Milestones": JSON.stringify(g.milestones),
                    "Savings": JSON.stringify(g.savings || []),
                    "InstallmentsCount": g.installmentsCount || 0,
                    "InstallmentAmount": g.installmentAmount || 0
                };
            }),
            "Cong_Viec": appState.tasks.map(t => {
                return { "ID": t.id, "Title": t.title, "Description": t.description, "Status": t.status, "DueDate": t.dueDate, "Priority": t.priority };
            }),
            "Ghi_Chu": appState.notes.map(n => {
                return { "ID": n.id, "Title": n.title, "Content": n.content, "CreatedAt": n.createdAt };
            }),
            "Tep_Tin": appState.storageFiles.map(f => {
                return { "ID": f.id, "Name": f.name, "Type": f.type, "Size": f.size, "UploadedAt": f.uploadedAt };
            })
        }
    };
    
    fetch(webAppUrl, {
        method: "POST",
        mode: "cors", // Dùng 'cors' kết hợp Content-Type: 'text/plain' để tránh preflight OPTIONS mà vẫn đọc được phản hồi từ Google!
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(resData => {
        isPushing = false;
        if (resData.success) {
            appState.isDirty = false;
            saveStateToLocalStorage(false); // Lưu trạng thái sạch sẽ
            
            if (indicator) {
                indicator.className = "sync-status-badge online";
                indicator.querySelector(".status-text").textContent = "Đã đồng bộ";
            }
            console.log("Đồng bộ Google Sheets thành công!");
            console.log("👉 CHI TIẾT CƠ SỞ DỮ LIỆU ĐÃ GHI:");
            console.log("- Tên trang tính:", resData.spreadsheetName);
            console.log("- ID bảng tính:", resData.spreadsheetId);
            console.log("- URL bảng tính:", resData.spreadsheetUrl);
            console.log("-----------------------------------------");
            
            // Lóe sáng xanh neon cực đẹp báo hiệu đồng bộ thành công
            triggerHeaderSyncGlow();
            
            if (alertSuccess) {
                alert("Đã đồng bộ và đẩy toàn bộ dữ liệu mới nhất lên Google Sheets thành công!");
            }
        } else {
            throw new Error(resData.error || "Lỗi đồng bộ phía máy chủ Google.");
        }
    })
    .catch(err => {
        isPushing = false;
        if (indicator) {
            indicator.className = "sync-status-badge offline";
            indicator.querySelector(".status-text").textContent = "Đồng bộ lỗi";
        }
        console.error("Đồng bộ Google Sheets thất bại:", err);
        alert("Lỗi đồng bộ đám mây: " + err.message);
    });
}

function pullAllDataFromGoogleSheets(alertSuccess = true) {
    const webAppUrl = appState.settings.webAppUrl;
    const syncToken = appState.settings.syncToken;
    const indicator = document.getElementById("sync-indicator");
    
    if (!webAppUrl) return;

    // PHÒNG NGỪA TRANH CHẤP ĐỒNG BỘ (CƠ CHẾ RETRY ĐẨY DỮ LIỆU BẨN)
    // Nếu dữ liệu cục bộ chưa được ghi xuống Sheets thành công, ta tiến hành
    // đẩy dữ liệu lên thay vì kéo dữ liệu về để tránh ghi đè làm mất công việc của người dùng!
    if (appState.isDirty) {
        console.log("🔄 [Đồng bộ] Phát hiện dữ liệu thay đổi cục bộ chưa lưu lên Sheets. Tiến hành đẩy dữ liệu trước...");
        syncAllDataToGoogleSheets(alertSuccess);
        return;
    }

    if (isPulling || isPushing) {
        console.log("⏳ [Tải về] Đồng bộ đang bận hoặc chạy ngầm, vui lòng đợi...");
        return;
    }
    
    isPulling = true;
    if (indicator) {
        indicator.className = "sync-status-badge syncing";
        indicator.querySelector(".status-text").textContent = "Đang tải...";
    }
    
    const requestUrl = `${webAppUrl}?token=${encodeURIComponent(syncToken)}`;
    
    fetch(requestUrl, { method: "GET", mode: "cors" })
    .then(res => res.json())
    .then(resData => {
        isPulling = false;
        if (resData.success && resData.data) {
            const sheetsData = resData.data;
            
            // Map dữ liệu tạm thời để so sánh chênh lệch
            let pulledTransactions = [];
            if (sheetsData.Thu_Nhap) {
                pulledTransactions = sheetsData.Thu_Nhap.map(t => {
                    return { id: t.id, amount: parseFloat(t.amount) || 0, category: t.category, date: t.date, notes: t.notes, type: t.type };
                });
            }
            
            let pulledDebts = [];
            if (sheetsData.Khoan_No) {
                pulledDebts = sheetsData.Khoan_No.map(d => {
                    let reps = [];
                    try { if (d.repayments) reps = JSON.parse(d.repayments); } catch(e){}
                    return { 
                        id: d.id, creditor: d.creditor, amount: parseFloat(d.amount) || 0, type: d.type, 
                        interestRate: parseFloat(d.interestrate) || 0, dueDate: d.duedate, status: d.status,
                        repayments: reps,
                        installmentsCount: parseInt(d.installmentscount) || 0,
                        installmentAmount: parseFloat(d.installmentamount) || 0
                    };
                });
            }
            
            let pulledGoals = [];
            if (sheetsData.Ke_Hoach) {
                pulledGoals = sheetsData.Ke_Hoach.map(g => {
                    let ms = [];
                    try { if (g.milestones) ms = JSON.parse(g.milestones); } catch(e){}
                    let svs = [];
                    try { if (g.savings) svs = JSON.parse(g.savings); } catch(e){}
                    return {
                        id: g.id, title: g.title, targetAmount: parseFloat(g.targetamount) || 0, currentAmount: parseFloat(g.currentamount) || 0,
                        dueDate: g.duedate, timeframe: g.timeframe, milestones: ms, savings: svs,
                        installmentsCount: parseInt(g.installmentscount) || 0,
                        installmentAmount: parseFloat(g.installmentamount) || 0
                    };
                });
            }
            
            let pulledTasks = [];
            if (sheetsData.Cong_Viec) {
                pulledTasks = sheetsData.Cong_Viec.map(t => {
                    return { id: t.id, title: t.title, description: t.description, status: t.status, dueDate: t.duedate, priority: t.priority };
                });
            }
            
            let pulledNotes = [];
            if (sheetsData.Ghi_Chu) {
                pulledNotes = sheetsData.Ghi_Chu.map(n => {
                    return { id: n.id, title: n.title, content: n.content, createdAt: n.createdat };
                });
            }
            
            let pulledFiles = [];
            if (sheetsData.Tep_Tin) {
                pulledFiles = sheetsData.Tep_Tin.map(f => {
                    return { id: f.id, name: f.name, type: f.type, size: f.size, uploadedAt: f.uploadedat };
                });
            }
            
            // --- THUẬT TOÁN SO SÁNH CHÊNH LỆCH DỮ LIỆU (UI DIFFING) ---
            const currentCoreState = {
                transactions: appState.transactions,
                debts: appState.debts,
                goals: appState.goals,
                tasks: appState.tasks,
                notes: appState.notes,
                storageFiles: appState.storageFiles
            };
            const pulledCoreState = {
                transactions: pulledTransactions,
                debts: pulledDebts,
                goals: pulledGoals,
                tasks: pulledTasks,
                notes: pulledNotes,
                storageFiles: pulledFiles
            };
            
            const currentStr = JSON.stringify(currentCoreState);
            const pulledStr = JSON.stringify(pulledCoreState);
            
            if (indicator) {
                indicator.className = "sync-status-badge online";
                indicator.querySelector(".status-text").textContent = "Google Sheets";
            }
            
            if (currentStr === pulledStr) {
                console.log("✅ [Đồng bộ] Dữ liệu trên Sheets và Cục bộ trùng khớp hoàn toàn. Bỏ qua re-render UI.");
                if (alertSuccess) {
                    alert("Dữ liệu của bạn đã được cập nhật mới nhất từ trước!");
                }
                return;
            }
            
            console.log("🔄 [Đồng bộ] Phát hiện dữ liệu thay đổi từ thiết bị khác. Cập nhật và vẽ lại giao diện...");
            
            // Chỉ cập nhật state và vẽ lại khi thực sự có chênh lệch
            appState.transactions = pulledTransactions;
            appState.debts = pulledDebts;
            appState.goals = pulledGoals;
            appState.tasks = pulledTasks;
            appState.notes = pulledNotes;
            appState.storageFiles = pulledFiles;
            
            saveStateToLocalStorage(false); // Lưu trạng thái sạch sẽ sau khi kéo Sheets thành công
            renderAllViews();
            
            // Hiệu ứng phát sáng chỉ báo đồng bộ thành công
            triggerHeaderSyncGlow();
            
            if (alertSuccess) {
                alert("Đã tải và cập nhật toàn bộ dữ liệu mới nhất từ Google Sheets thành công!");
            }
        } else {
            throw new Error(resData.error || "Không lấy được dữ liệu.");
        }
    })
    .catch(err => {
        isPulling = false;
        if (indicator) {
            indicator.className = "sync-status-badge offline";
            indicator.querySelector(".status-text").textContent = "Lỗi tải về";
        }
        if (alertSuccess) {
            alert("Lỗi đồng bộ tải dữ liệu từ Sheets: " + err.message);
        } else {
            console.warn("Lỗi đồng bộ ngầm tải dữ liệu từ Sheets:", err.message);
        }
    });
}

function triggerAutoSync() {
    if (appState.settings && appState.settings.webAppUrl) {
        syncAllDataToGoogleSheets();
    }
}

// ==================== J. KẾT XUẤT SAO LƯU & XÓA CỤC BỘ DỮ LIỆU CÀI ĐẶT ====================
function exportLocalDataBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 4));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `personal_hub_backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
}

function clearAllHubData() {
    if (confirm("CẢNH BÁO CỰC KỲ NGUY HIỂM!\n\nHành động này sẽ xóa toàn bộ mật khẩu, dữ liệu tài chính, công việc lưu cục bộ trên trình duyệt của bạn.\n\nBạn có thực sự chắc chắn không?")) {
        localStorage.removeItem("pmh_encrypted_key_test");
        localStorage.removeItem("pmh_encrypted_state_data");
        localStorage.removeItem("pmh_storage_tips");
        alert("Đã xóa sạch dữ liệu! Trang web sẽ tự động khóa và tải lại để bạn khởi tạo mật khẩu mới.");
        window.location.reload();
    }
}

function handlePasswordChange() {
    const newPass = document.getElementById("settings-change-password").value.trim();
    if (!newPass || newPass.length < 4) {
        alert("Mật khẩu mới phải có tối thiểu 4 ký tự.");
        return;
    }
    
    try {
        derivedKey = CryptoJS.SHA256(newPass).toString();
        const testPayload = "encryption-authorized-key";
        const encryptededTest = CryptoJS.AES.encrypt(testPayload, derivedKey).toString();
        
        localStorage.setItem("pmh_encrypted_key_test", encryptededTest);
        saveStateToLocalStorage(false); // Đổi mật khẩu chỉ re-encrypt, không làm bẩn dữ liệu state
        
        document.getElementById("settings-change-password").value = "";
        alert("Thay đổi Mật khẩu chủ của Hub thành công!");
    } catch(e) {
        alert("Lỗi đổi mật khẩu: " + e.message);
    }
}

// ==================== K. BỘ PHẦN TRỰC QUAN HÓA: DỰ DỰNG BIỂU ĐỒ CHART.JS ====================
let mainLineChart = null;
let mainPieChart = null;

function renderDashboardCharts() {
    const lineCtx = document.getElementById("chart-income-expense");
    const pieCtx = document.getElementById("chart-expense-categories");
    
    if (!lineCtx || !pieCtx || !appState) return;
    
    // Đảm bảo thư viện Chart.js đã được load
    if (typeof Chart === 'undefined') {
        console.warn("Thư viện Chart.js chưa được tải. Không thể vẽ biểu đồ.");
        return;
    }
    
    if (mainLineChart) mainLineChart.destroy();
    if (mainPieChart) mainPieChart.destroy();
    
    // --- 1. DỮ LIỆU BIỂU ĐỒ ĐƯỜNG THU CHI ---
    const monthlyData = {};
    const months = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"];
    months.forEach((m, idx) => {
        monthlyData[idx + 1] = { income: 0, expense: 0 };
    });
    
    appState.transactions.forEach(t => {
        if (!t.date) return;
        const monthNum = parseInt(t.date.split('-')[1], 10);
        if (monthNum >= 1 && monthNum <= 12) {
            if (t.type === "income") {
                monthlyData[monthNum].income += t.amount;
            } else {
                monthlyData[monthNum].expense += t.amount;
            }
        }
    });
    
    const incomes = Object.values(monthlyData).map(d => d.income);
    const expenses = Object.values(monthlyData).map(d => d.expense);
    
    mainLineChart = new Chart(lineCtx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Thu nhập',
                    data: incomes,
                    backgroundColor: 'rgba(0, 230, 115, 0.45)',
                    borderColor: 'hsl(145, 80%, 42%)',
                    borderWidth: 2,
                    borderRadius: 4
                },
                {
                    label: 'Chi tiêu',
                    data: expenses,
                    backgroundColor: 'rgba(255, 77, 77, 0.45)',
                    borderColor: 'hsl(355, 85%, 60%)',
                    borderWidth: 2,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f3f4f6', font: { family: 'Plus Jakarta Sans' } } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } }
            }
        }
    });
    
    // --- 2. DỮ LIỆU BIỂU ĐỒ TRÒN PHÂN BỔ CHI TIÊU ---
    const expCategories = CATEGORIES.expense;
    const catMap = {};
    expCategories.forEach(c => catMap[c] = 0);
    
    appState.transactions.filter(t => t.type === "expense").forEach(t => {
        if (catMap[t.category] !== undefined) {
            catMap[t.category] += t.amount;
        } else {
            catMap["Chi tiêu Khác"] = (catMap["Chi tiêu Khác"] || 0) + t.amount;
        }
    });
    
    const labels = Object.keys(catMap).filter(k => catMap[k] > 0);
    const values = labels.map(k => catMap[k]);
    
    const displayLabels = labels.length > 0 ? labels : ["Chưa có dữ liệu chi tiêu"];
    const displayValues = values.length > 0 ? values : [1];
    const colors = [
        '#ff4d4d', '#ff944d', '#ffdb4d', '#4dff88', 
        '#4dffff', '#4d94ff', '#944dff', '#ff4d94'
    ];
    
    mainPieChart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: displayLabels,
            datasets: [{
                data: displayValues,
                backgroundColor: labels.length > 0 ? colors.slice(0, labels.length) : ['rgba(255,255,255,0.05)'],
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { color: '#f3f4f6', boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 10 } } 
                }
            }
        }
    });
}

// ==================== L. BỘ RENDER HTML ĐỘNG (DYNAMIC RENDERING VIEWS) ====================

function renderAllViews() {
    renderDashboardView();
    renderTransactionsView();
    renderDebtsView();
    renderGoalsView();
    renderWorkspaceTasksView();
    renderWorkspaceNotesView();
    // Đã loại bỏ tải tệp tin theo yêu cầu người dùng
    renderStorageTips();
}

function renderDashboardView() {
    const incomeTotal = appState.transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
    const expenseTotal = appState.transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
    
    const unpaidDebtTotal = appState.debts.filter(d => d.status !== "paid" && d.type === "owe_others").reduce((sum, d) => {
        const paid = d.repayments.reduce((s, r) => s + r.amount, 0);
        return sum + (d.amount - paid);
    }, 0);
    
    const receivableTotal = appState.debts.filter(d => d.status !== "paid" && d.type === "others_owe").reduce((sum, d) => {
        const paid = d.repayments.reduce((s, r) => s + r.amount, 0);
        return sum + (d.amount - paid);
    }, 0);
    
    const netWorth = incomeTotal - expenseTotal - unpaidDebtTotal + receivableTotal;
    
    const currentMonthStr = new Date().toISOString().split('-').slice(0, 2).join('-');
    const currentMonthIncome = appState.transactions
        .filter(t => t.type === "income" && t.date && t.date.startsWith(currentMonthStr))
        .reduce((sum, t) => sum + t.amount, 0);
        
    const currentMonthExpense = appState.transactions
        .filter(t => t.type === "expense" && t.date && t.date.startsWith(currentMonthStr))
        .reduce((sum, t) => sum + t.amount, 0);
        
    document.getElementById("stat-networth").textContent = `${netWorth >= 0 ? '+' : ''}${netWorth.toLocaleString('vi-VN')} ₫`;
    document.getElementById("stat-networth").className = `value ${netWorth >= 0 ? 'positive' : 'negative'}`;
    
    document.getElementById("stat-month-income").textContent = `+${currentMonthIncome.toLocaleString('vi-VN')} ₫`;
    document.getElementById("stat-month-expense").textContent = `-${currentMonthExpense.toLocaleString('vi-VN')} ₫`;
    document.getElementById("stat-total-debt").textContent = `${unpaidDebtTotal.toLocaleString('vi-VN')} ₫`;
    
    const debtAlerts = document.getElementById("dashboard-debt-reminders");
    if (debtAlerts) {
        debtAlerts.innerHTML = "";
        const activeDebts = appState.debts.filter(d => d.status !== "paid");
        if (activeDebts.length === 0) {
            debtAlerts.innerHTML = `<p class="empty-text">Không có khoản nợ nào cần xử lý!</p>`;
        } else {
            activeDebts.sort((a,b) => new Date(a.dueDate) - new Date(b.dueDate));
            activeDebts.slice(0, 5).forEach(d => {
                const paid = d.repayments.reduce((s,r) => s + r.amount, 0);
                const remaining = d.amount - paid;
                const item = document.createElement("div");
                item.className = "alert-item";
                item.innerHTML = `
                    <div class="alert-item-details">
                        <h4>${d.creditor} (${d.type === 'owe_others' ? 'Cần trả' : 'Cần đòi'})</h4>
                        <p>Hạn trả: ${d.dueDate} | Trạng thái: ${d.status === 'overdue' ? 'Trễ hạn' : 'Đang mở'}</p>
                    </div>
                    <div class="alert-item-value ${d.type === 'owe_others' ? 'negative' : 'positive'}">
                        ${remaining.toLocaleString('vi-VN')} ₫
                    </div>
                `;
                debtAlerts.appendChild(item);
            });
        }
    }
    
    const priorityTasks = document.getElementById("dashboard-priority-tasks");
    if (priorityTasks) {
        priorityTasks.innerHTML = "";
        const activeTasks = appState.tasks.filter(t => t.status !== "done");
        if (activeTasks.length === 0) {
            priorityTasks.innerHTML = `<p class="empty-text">Chúc mừng! Bạn đã giải quyết xong toàn bộ công việc.</p>`;
        } else {
            activeTasks.sort((a,b) => {
                const prioMap = { high: 3, medium: 2, low: 1 };
                return prioMap[b.priority] - prioMap[a.priority];
            });
            activeTasks.slice(0, 5).forEach(t => {
                const item = document.createElement("div");
                item.className = "alert-item";
                item.innerHTML = `
                    <div class="alert-item-details">
                        <h4>${t.title}</h4>
                        <p>Độ ưu tiên: ${t.priority.toUpperCase()} | Hạn chót: ${t.dueDate}</p>
                    </div>
                    <div class="alert-item-value" style="color: var(--color-primary)">
                        ${t.status.toUpperCase()}
                    </div>
                `;
                priorityTasks.appendChild(item);
            });
        }
    }
}

function renderTransactionsView() {
    const tbody = document.getElementById("transaction-table-body");
    const filterType = document.getElementById("filter-trans-type").value;
    const filterCat = document.getElementById("filter-trans-category").value;
    const searchVal = document.getElementById("search-trans").value.trim().toLowerCase();
    
    if (!tbody) return;
    tbody.innerHTML = "";
    
    let list = [...appState.transactions];
    if (filterType !== "all") list = list.filter(t => t.type === filterType);
    if (filterCat !== "all") list = list.filter(t => t.category === filterCat);
    if (searchVal) {
        list = list.filter(t => t.notes.toLowerCase().includes(searchVal) || t.category.toLowerCase().includes(searchVal));
    }
    
    list.sort((a,b) => new Date(b.date) - new Date(a.date));
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-text" style="text-align:center;">Không tìm thấy giao dịch nào phù hợp!</td></tr>`;
        return;
    }
    
    list.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${t.date}</td>
            <td><span class="trans-tag ${t.type === 'income' ? 'income-tag' : 'expense-tag'}">${t.type === 'income' ? 'Thu nhập' : 'Chi tiêu'}</span></td>
            <td><strong>${t.category}</strong></td>
            <td style="font-family: var(--font-heading); font-weight:700;" class="${t.type === 'income' ? 'positive' : 'negative'}">
                ${t.type === 'income' ? '+' : '-'}${t.amount.toLocaleString('vi-VN')} ₫
            </td>
            <td><span style="color:var(--text-muted); font-size:12px;">${t.notes || ''}</span></td>
            <td class="text-right">
                <div class="debt-card-actions">
                    <button class="btn-action-small" onclick="handleEditTransaction('${t.id}')" title="Sửa giao dịch"><i data-lucide="edit-2"></i></button>
                    <button class="btn-action-small btn-delete" onclick="handleDeleteTransaction('${t.id}')" title="Xóa giao dịch"><i data-lucide="trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    safeCreateIcons();
}

function renderDebtsView() {
    const listContainer = document.getElementById("debt-cards-list");
    const activeSubTabBtn = document.querySelector("#tab-debts .sub-tab-btn.active");
    const activeSubTab = activeSubTabBtn ? activeSubTabBtn.getAttribute("data-debt-filter") : "all";
    
    if (!listContainer) return;
    listContainer.innerHTML = "";
    
    let list = [...appState.debts];
    if (activeSubTab !== "all") {
        list = list.filter(d => d.type === activeSubTab);
    }
    
    if (list.length === 0) {
        listContainer.innerHTML = `<p class="empty-text col-span-2">Không có khoản nợ nào thuộc danh mục này!</p>`;
        return;
    }
    
    list.forEach(d => {
        const totalPaid = d.repayments ? d.repayments.reduce((sum, r) => sum + r.amount, 0) : 0;
        const remaining = d.amount - totalPaid;
        const progressPct = d.amount > 0 ? Math.round((totalPaid / d.amount) * 100) : 100;
        
        let installmentsHTML = "";
        if (d.installmentsCount > 0 && d.installmentAmount > 0) {
            const paidReps = d.repayments ? d.repayments.length : 0;
            installmentsHTML = `
                <div class="debt-installments-badge" style="font-size:11px; color:var(--color-primary); background:rgba(124,58,237,0.1); padding:4px 8px; border-radius:4px; margin-top:4px; display:inline-block;">
                    <i data-lucide="calendar-days" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></i>
                    Kế hoạch: ${paidReps}/${d.installmentsCount} đợt (mỗi đợt ${d.installmentAmount.toLocaleString('vi-VN')} ₫)
                </div>
            `;
        }
        
        const card = document.createElement("div");
        card.className = `glass-card debt-card ${d.type === 'owe_others' ? 'debt-payable' : 'debt-receivable'}`;
        card.innerHTML = `
            <div class="debt-card-header">
                <div class="debt-creditor-info">
                    <h3>${d.creditor}</h3>
                    <span class="debt-type-badge ${d.type === 'owe_others' ? 'payable' : 'receivable'}">
                        ${d.type === 'owe_others' ? 'Tôi nợ' : 'Cho vay'}
                    </span>
                </div>
                <div class="debt-card-actions">
                    <button class="btn-action-small" onclick="openRepaymentModal('${d.id}')" title="Thanh toán đợt" ${d.status === 'paid' ? 'disabled' : ''}><i data-lucide="hand-coins"></i></button>
                    <button class="btn-action-small" onclick="handleEditDebt('${d.id}')" title="Chỉnh sửa"><i data-lucide="edit-2"></i></button>
                    <button class="btn-action-small btn-delete" onclick="handleDeleteDebt('${d.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            
            <div class="debt-amount-row">
                <p style="font-size:11px; color:var(--text-muted);">Số nợ ban đầu: ${d.amount.toLocaleString('vi-VN')} ₫</p>
                <h2>${remaining.toLocaleString('vi-VN')} ₫</h2>
                ${installmentsHTML}
            </div>
            
            <div class="debt-progress-section" style="display:flex; flex-direction:column; gap:6px;">
                <div class="debt-progress-label">
                    <span>Đã trả: ${totalPaid.toLocaleString('vi-VN')} ₫</span>
                    <span>${progressPct}%</span>
                </div>
                <div class="debt-progress-bar-container">
                    <div class="debt-progress-bar-fill" style="width: ${progressPct}%"></div>
                </div>
            </div>
            
            <div class="debt-card-footer">
                <span class="debt-status-dot status-${d.status}">
                    ${d.status === 'active' ? 'Đang chạy' : d.status === 'paid' ? 'Đã thanh toán' : 'Trễ hạn'}
                </span>
                <span>Hạn chót: ${d.dueDate}</span>
            </div>
        `;
        listContainer.appendChild(card);
    });
    safeCreateIcons();
}

function renderGoalsView() {
    const listContainer = document.getElementById("goals-cards-list");
    const activeSubTabBtn = document.querySelector("#tab-goals .sub-tab-btn.active");
    const activeSubTab = activeSubTabBtn ? activeSubTabBtn.getAttribute("data-goal-filter") : "all";
    
    if (!listContainer) return;
    listContainer.innerHTML = "";
    
    let list = [...appState.goals];
    if (activeSubTab !== "all") {
        list = list.filter(g => g.timeframe === activeSubTab);
    }
    
    if (list.length === 0) {
        listContainer.innerHTML = `<p class="empty-text col-span-2">Không tìm thấy mục tiêu nào!</p>`;
        return;
    }
    
    list.forEach(g => {
        const totalSaved = g.savings ? g.savings.reduce((sum, s) => sum + s.amount, 0) : g.currentAmount;
        let progressPct = 0;
        let progressText = "";
        
        if (g.targetAmount > 0) {
            progressPct = Math.min(100, Math.round((totalSaved / g.targetAmount) * 100));
            progressText = `Đã tích lũy: ${totalSaved.toLocaleString('vi-VN')} / ${g.targetAmount.toLocaleString('vi-VN')} ₫`;
        } else if (g.milestones && g.milestones.length > 0) {
            const comp = g.milestones.filter(m => m.completed).length;
            progressPct = Math.round((comp / g.milestones.length) * 100);
            progressText = `Mốc đã xong: ${comp} / ${g.milestones.length}`;
        } else {
            progressPct = 0;
            progressText = "Tiến độ: 0%";
        }
        
        let goalInstallmentsHTML = "";
        if (g.installmentsCount > 0 && g.installmentAmount > 0) {
            const savedInstallments = g.savings ? g.savings.length : 0;
            goalInstallmentsHTML = `
                <div class="goal-installments-badge" style="font-size:11px; color:var(--color-success); background:rgba(16,185,129,0.1); padding:4px 8px; border-radius:4px; margin-top:6px; display:inline-block;">
                    <i data-lucide="piggy-bank" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></i>
                    Kế hoạch: ${savedInstallments}/${g.installmentsCount} đợt (mỗi đợt ${g.installmentAmount.toLocaleString('vi-VN')} ₫)
                </div>
            `;
        }
        
        const card = document.createElement("div");
        card.className = "glass-card goal-card";
        
        let milestonesHTML = "";
        if (g.milestones && g.milestones.length > 0) {
            milestonesHTML = `<div class="goal-milestones-checklist">`;
            g.milestones.forEach(m => {
                milestonesHTML += `
                    <div class="goal-milestone-item ${m.completed ? 'checked' : ''}" onclick="toggleMilestone('${g.id}', '${m.id}')">
                        <input type="checkbox" ${m.completed ? 'checked' : ''} onclick="event.stopPropagation(); toggleMilestone('${g.id}', '${m.id}')">
                        <span>${m.title}</span>
                    </div>
                `;
            });
            milestonesHTML += `</div>`;
        }
        
        card.innerHTML = `
            <div class="goal-card-header">
                <div class="goal-title-info">
                    <h3>${g.title}</h3>
                    <span class="goal-timeframe-tag">
                        ${g.timeframe === 'short' ? 'Ngắn hạn' : g.timeframe === 'medium' ? 'Trung hạn' : 'Dài hạn'}
                    </span>
                </div>
                <div class="debt-card-actions">
                    <button class="btn-action-small" onclick="openSavingsModal('${g.id}')" title="Tích góp thêm" ${progressPct >= 100 && g.targetAmount > 0 ? 'disabled style="opacity:0.25; pointer-events:none;"' : ''}><i data-lucide="piggy-bank"></i></button>
                    <button class="btn-action-small" onclick="handleEditGoal('${g.id}')" title="Sửa mục tiêu"><i data-lucide="edit-2"></i></button>
                    <button class="btn-action-small btn-delete" onclick="handleDeleteGoal('${g.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            
            <div class="goal-progress-section">
                <div class="debt-progress-label">
                    <span style="font-size:11px;">${progressText}</span>
                    <span style="font-family:var(--font-heading); font-weight:700;">${progressPct}%</span>
                </div>
                <div class="debt-progress-bar-container">
                    <div class="debt-progress-bar-fill goal-progress-bar-fill" style="width: ${progressPct}%"></div>
                </div>
                ${goalInstallmentsHTML}
            </div>
            
            ${milestonesHTML}
            
            <div class="debt-card-footer" style="margin-top:auto; font-size:11px;">
                <span>Hạn đạt: ${g.dueDate}</span>
            </div>
        `;
        listContainer.appendChild(card);
    });
    safeCreateIcons();
}

function handleEditDebt(id) {
    const debt = appState.debts.find(d => d.id === id);
    if (!debt) return;
    
    document.getElementById("debt-id").value = debt.id;
    document.getElementById("debt-creditor").value = debt.creditor;
    document.getElementById("debt-type").value = debt.type;
    document.getElementById("debt-interest").value = debt.interestRate;
    document.getElementById("debt-installments-count").value = debt.installmentsCount || "";
    document.getElementById("debt-installment-amount").value = debt.installmentAmount || "";
    document.getElementById("debt-amount").value = debt.amount;
    document.getElementById("debt-due-date").value = debt.dueDate;
    document.getElementById("debt-status").value = debt.status;
    
    document.getElementById("debt-modal-title").textContent = "Chỉnh sửa khoản nợ";
    openModal("modal-debt");
}

function handleEditGoal(id) {
    const goal = appState.goals.find(g => g.id === id);
    if (!goal) return;
    
    document.getElementById("goal-id").value = goal.id;
    document.getElementById("goal-title").value = goal.title;
    document.getElementById("goal-timeframe").value = goal.timeframe;
    document.getElementById("goal-due-date").value = goal.dueDate;
    document.getElementById("goal-installments-count").value = goal.installmentsCount || "";
    document.getElementById("goal-installment-amount").value = goal.installmentAmount || "";
    document.getElementById("goal-target-amount").value = goal.targetAmount;
    document.getElementById("goal-current-amount").value = goal.currentAmount;
    
    const milesStr = goal.milestones ? goal.milestones.map(m => m.title).join(', ') : "";
    document.getElementById("goal-milestones-input").value = milesStr;
    
    document.getElementById("goal-modal-title").textContent = "Chỉnh sửa kế hoạch";
    openModal("modal-goal");
}

function renderWorkspaceTasksView() {
    const counts = { todo: 0, inprogress: 0, review: 0, done: 0 };
    const containers = {
        todo: document.getElementById("tasks-todo"),
        inprogress: document.getElementById("tasks-inprogress"),
        review: document.getElementById("tasks-review"),
        done: document.getElementById("tasks-done")
    };
    
    Object.keys(containers).forEach(k => {
        if (containers[k]) containers[k].innerHTML = "";
    });
    
    appState.tasks.forEach(t => {
        counts[t.status]++;
        
        const card = document.createElement("div");
        card.className = "task-card";
        card.setAttribute("draggable", "true");
        card.setAttribute("ondragstart", `dragTask(event, '${t.id}')`);
        
        card.innerHTML = `
            <div class="task-card-header">
                <h4>${t.title}</h4>
                <span class="task-priority-tag priority-${t.priority}">${t.priority === 'low' ? 'Thấp' : t.priority === 'medium' ? 'Vừa' : 'Cao'}</span>
            </div>
            ${t.description ? `<div class="task-card-body"><p>${t.description}</p></div>` : ''}
            <div class="task-card-footer">
                <div class="task-due-date">
                    <i data-lucide="clock"></i>
                    <span>${t.dueDate}</span>
                </div>
                <div class="debt-card-actions">
                    <button class="btn-action-small" onclick="moveTask('${t.id}', 'prev')" title="Chuyển về cột trước" ${t.status === 'todo' ? 'disabled style="opacity:0.25; pointer-events:none;"' : ''}><i data-lucide="arrow-left"></i></button>
                    <button class="btn-action-small" onclick="moveTask('${t.id}', 'next')" title="Chuyển sang cột sau" ${t.status === 'done' ? 'disabled style="opacity:0.25; pointer-events:none;"' : ''}><i data-lucide="arrow-right"></i></button>
                    <span style="border-left: 1px solid rgba(255,255,255,0.08); margin: 0 4px; height: 14px; display: inline-block; vertical-align: middle;"></span>
                    <button class="btn-action-small" onclick="handleEditTask('${t.id}')" title="Sửa công việc"><i data-lucide="edit-2"></i></button>
                    <button class="btn-action-small btn-delete" onclick="handleDeleteTask('${t.id}')" title="Xóa công việc"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        `;
        
        if (containers[t.status]) {
            containers[t.status].appendChild(card);
        }
    });
    
    Object.keys(counts).forEach(k => {
        const badge = document.getElementById(`count-${k}`);
        if (badge) badge.textContent = counts[k];
    });
    
    safeCreateIcons();
}

function handleEditTask(id) {
    const task = appState.tasks.find(t => t.id === id);
    if (!task) return;
    
    document.getElementById("task-id").value = task.id;
    document.getElementById("task-title").value = task.title;
    document.getElementById("task-desc").value = task.description;
    document.getElementById("task-status").value = task.status;
    document.getElementById("task-priority").value = task.priority;
    document.getElementById("task-due-date").value = task.dueDate;
    
    document.getElementById("task-modal-title").textContent = "Chỉnh sửa công việc";
    openModal("modal-task");
}

function renderWorkspaceNotesView() {
    const grid = document.getElementById("notes-list-grid");
    if (!grid) return;
    
    grid.innerHTML = "";
    
    if (appState.notes.length === 0) {
        grid.innerHTML = `<p class="empty-text">Sổ tay ghi chú của bạn chưa có trang nào. Hãy tạo ghi chú đầu tiên bên trái!</p>`;
        return;
    }
    
    const list = [...appState.notes].reverse();
    
    list.forEach(n => {
        const card = document.createElement("div");
        card.className = "glass-card note-card";
        card.innerHTML = `
            <h3>${n.title}</h3>
            <p>${n.content.replace(/\n/g, '<br>')}</p>
            <div class="note-card-footer">
                <span><i data-lucide="calendar" style="width:11px;height:11px;display:inline-block;vertical-align:middle;margin-right:4px;"></i> ${n.createdAt}</span>
                <div class="debt-card-actions">
                    <button class="btn-action-small" onclick="copyNoteForNotebookLM('${n.id}')" title="Sao chép cho NotebookLM"><i data-lucide="brain-circuit"></i></button>
                    <button class="btn-action-small" onclick="handleEditNote('${n.id}')" title="Chỉnh sửa"><i data-lucide="edit-2"></i></button>
                    <button class="btn-action-small btn-delete" onclick="handleDeleteNote('${n.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
    
    safeCreateIcons();
}

// Đã loại bỏ renderStorageFilesView theo yêu cầu người dùng

function renderStorageTips() {
    const container = document.getElementById("tips-container-list");
    if (!container) return;
    
    container.innerHTML = "";
    
    const tips = JSON.parse(localStorage.getItem("pmh_storage_tips")) || INITIAL_STORAGE_TIPS;
    const sortedTips = [...tips].sort((a,b) => b.pinned - a.pinned);
    
    sortedTips.forEach(tip => {
        const item = document.createElement("div");
        item.className = `tip-item ${tip.pinned ? 'pinned' : ''}`;
        item.innerHTML = `
            <i data-lucide="lightbulb" class="tip-icon"></i>
            <div class="tip-content">
                <h4>${tip.title}</h4>
                <p>${tip.content}</p>
            </div>
            <button class="btn-pin-tip" onclick="togglePinTip('${tip.id}')" title="${tip.pinned ? 'Gỡ ghim' : 'Ghim lên đầu'}">
                <i data-lucide="pin" style="width:14px; height:14px;"></i>
            </button>
        `;
        container.appendChild(item);
    });
    safeCreateIcons();
}

// ==================== M. KHỞI TẠO BỘ LẮNG NGHE SỰ KIỆN HÀNH ĐỘNG VÀ ĐÓNG POPUP ====================

function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove("hidden");
    safeCreateIcons();
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add("hidden");
}

function initAppComponents() {
    // 1. Tab Công việc Workspace (Kanban / Sổ tay / Lưu trữ)
    const wTabs = document.querySelectorAll(".w-sub-tab");
    const wPanels = document.querySelectorAll(".workspace-panel");
    wTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            wTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            const targetSection = tab.getAttribute("data-workspace-section");
            wPanels.forEach(p => {
                if (p.id === `w-panel-${targetSection}`) {
                    p.classList.add("active");
                } else {
                    p.classList.remove("active");
                }
            });
        });
    });

    // 2. Chuyển sub-tab trong Khoản nợ (Tất cả / Tôi nợ / Cho vay)
    const debtSubTabs = document.querySelectorAll("#tab-debts .sub-tab-btn");
    debtSubTabs.forEach(btn => {
        btn.addEventListener("click", () => {
            debtSubTabs.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderDebtsView();
        });
    });

    // 3. Chuyển sub-tab trong Kế hoạch tương lai (Ngắn / Trung / Dài hạn)
    const goalSubTabs = document.querySelectorAll("#tab-goals .sub-tab-btn");
    goalSubTabs.forEach(btn => {
        btn.addEventListener("click", () => {
            goalSubTabs.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderGoalsView();
        });
    });

    // 4. Lắng nghe sự kiện Thay đổi loại thu chi và tự nhận diện Categories
    const transTypeInput = document.getElementById("trans-type");
    const transCatInput = document.getElementById("trans-category");
    if (transTypeInput && transCatInput) {
        transTypeInput.addEventListener("change", () => {
            updateCategoryDropdown("trans-type", "trans-category");
            handleTransactionCategoryChange();
        });
        transCatInput.addEventListener("change", () => {
            handleTransactionCategoryChange();
        });
        updateCategoryDropdown("trans-type", "trans-category");
        handleTransactionCategoryChange();
    }

    // 5. Đăng ký sự kiện nộp Form Giao dịch
    const transForm = document.getElementById("transaction-form");
    if (transForm) {
        transForm.addEventListener("submit", handleSaveTransaction);
    }
    const resetTransBtn = document.getElementById("btn-reset-trans");
    if (resetTransBtn) {
        resetTransBtn.addEventListener("click", () => {
            document.getElementById("transaction-form").reset();
            document.getElementById("trans-id").value = "";
            document.getElementById("ocr-preview-container").classList.add("hidden");
            document.getElementById("ocr-file-input").value = "";
            updateCategoryDropdown("trans-type", "trans-category");
            handleTransactionCategoryChange();
        });
    }

    // 6. Đăng ký sự kiện nộp Form Sổ tay Ghi chú
    const noteForm = document.getElementById("note-form");
    if (noteForm) {
        noteForm.addEventListener("submit", handleSaveNote);
    }
    const resetNoteBtn = document.getElementById("btn-reset-note");
    if (resetNoteBtn) {
        resetNoteBtn.addEventListener("click", () => {
            document.getElementById("note-form").reset();
            document.getElementById("note-id").value = "";
            document.getElementById("note-form-title").textContent = "Tạo ghi chú mới";
        });
    }

    // 7. Modals trigger buttons
    const addDebtBtn = document.getElementById("btn-add-debt-modal");
    if (addDebtBtn) {
        addDebtBtn.addEventListener("click", () => {
            document.getElementById("debt-form").reset();
            document.getElementById("debt-id").value = "";
            document.getElementById("debt-installments-count").value = "";
            document.getElementById("debt-installment-amount").value = "";
            document.getElementById("debt-modal-title").textContent = "Ghi nhận khoản nợ mới";
            openModal("modal-debt");
        });
    }
    const debtForm = document.getElementById("debt-form");
    if (debtForm) debtForm.addEventListener("submit", handleSaveDebt);

    // Bộ tính toán tự động thông minh cho Khoản nợ (Smart Debt Calculations)
    const debtInstallmentsCount = document.getElementById("debt-installments-count");
    const debtInstallmentAmount = document.getElementById("debt-installment-amount");
    const debtAmount = document.getElementById("debt-amount");

    if (debtInstallmentsCount && debtInstallmentAmount && debtAmount) {
        const calcDebtAmountFromInstallments = () => {
            const count = parseInt(debtInstallmentsCount.value) || 0;
            const instAmount = parseFloat(debtInstallmentAmount.value) || 0;
            if (count > 0 && instAmount > 0) {
                debtAmount.value = count * instAmount;
            }
        };

        const calcDebtInstallmentsFromAmount = () => {
            const amount = parseFloat(debtAmount.value) || 0;
            const count = parseInt(debtInstallmentsCount.value) || 0;
            const instAmount = parseFloat(debtInstallmentAmount.value) || 0;
            if (amount > 0) {
                if (count > 0) {
                    debtInstallmentAmount.value = Math.round(amount / count);
                } else if (instAmount > 0) {
                    debtInstallmentsCount.value = Math.ceil(amount / instAmount);
                }
            }
        };

        debtInstallmentsCount.addEventListener("input", calcDebtAmountFromInstallments);
        debtInstallmentAmount.addEventListener("input", calcDebtAmountFromInstallments);
        debtAmount.addEventListener("input", calcDebtInstallmentsFromAmount);
    }

    const addGoalBtn = document.getElementById("btn-add-goal-modal");
    if (addGoalBtn) {
        addGoalBtn.addEventListener("click", () => {
            document.getElementById("goal-form").reset();
            document.getElementById("goal-id").value = "";
            document.getElementById("goal-installments-count").value = "";
            document.getElementById("goal-installment-amount").value = "";
            document.getElementById("goal-modal-title").textContent = "Thêm kế hoạch mới";
            openModal("modal-goal");
        });
    }
    const goalForm = document.getElementById("goal-form");
    if (goalForm) goalForm.addEventListener("submit", handleSaveGoal);

    // Bộ tính toán tự động thông minh cho Kế hoạch (Smart Goal Calculations)
    const goalInstallmentsCount = document.getElementById("goal-installments-count");
    const goalInstallmentAmount = document.getElementById("goal-installment-amount");
    const goalTargetAmount = document.getElementById("goal-target-amount");

    if (goalInstallmentsCount && goalInstallmentAmount && goalTargetAmount) {
        const calcGoalAmountFromInstallments = () => {
            const count = parseInt(goalInstallmentsCount.value) || 0;
            const instAmount = parseFloat(goalInstallmentAmount.value) || 0;
            if (count > 0 && instAmount > 0) {
                goalTargetAmount.value = count * instAmount;
            }
        };

        const calcGoalInstallmentsFromAmount = () => {
            const amount = parseFloat(goalTargetAmount.value) || 0;
            const count = parseInt(goalInstallmentsCount.value) || 0;
            const instAmount = parseFloat(goalInstallmentAmount.value) || 0;
            if (amount > 0) {
                if (count > 0) {
                    goalInstallmentAmount.value = Math.round(amount / count);
                } else if (instAmount > 0) {
                    goalInstallmentsCount.value = Math.ceil(amount / instAmount);
                }
            }
        };

        goalInstallmentsCount.addEventListener("input", calcGoalAmountFromInstallments);
        goalInstallmentAmount.addEventListener("input", calcGoalAmountFromInstallments);
        goalTargetAmount.addEventListener("input", calcGoalInstallmentsFromAmount);
    }

    const addTaskBtn = document.getElementById("btn-add-task-modal");
    if (addTaskBtn) {
        addTaskBtn.addEventListener("click", () => {
            document.getElementById("task-form").reset();
            document.getElementById("task-id").value = "";
            document.getElementById("task-modal-title").textContent = "Tạo nhiệm vụ mới";
            document.getElementById("task-due-date").value = new Date().toISOString().split('T')[0];
            openModal("modal-task");
        });
    }
    const taskForm = document.getElementById("task-form");
    if (taskForm) taskForm.addEventListener("submit", handleSaveTask);

    const repaymentForm = document.getElementById("repayment-form");
    if (repaymentForm) repaymentForm.addEventListener("submit", handleSaveRepayment);

    const savingsForm = document.getElementById("savings-form");
    if (savingsForm) savingsForm.addEventListener("submit", handleSaveSavings);

    // 8. OCR scanner initialization
    initOCRScanner();

    // 9. Đã loại bỏ khởi tạo lưu trữ tệp tin

    // 10. NotebookLM export integration button
    const expNlmBtn = document.getElementById("btn-export-notebooklm");
    if (expNlmBtn) expNlmBtn.addEventListener("click", exportAllDataToNotebookLM);

    // 11. Settings logic
    const saveSetBtn = document.getElementById("btn-save-settings");
    if (saveSetBtn) saveSetBtn.addEventListener("click", handleSaveSettings);
    
    const testConnBtn = document.getElementById("btn-test-connection");
    if (testConnBtn) testConnBtn.addEventListener("click", () => testGoogleSheetsConnection(true));
    
    const changePassBtn = document.getElementById("btn-change-password");
    if (changePassBtn) changePassBtn.addEventListener("click", handlePasswordChange);
    
    const clearDataBtn = document.getElementById("btn-clear-local-data");
    if (clearDataBtn) clearDataBtn.addEventListener("click", clearAllHubData);
    
    const backupDataBtn = document.getElementById("btn-backup-local-data");
    if (backupDataBtn) backupDataBtn.addEventListener("click", exportLocalDataBackup);
    
    // Nạp link ban đầu từ state
    const setSheetUrlInput = document.getElementById("settings-sheet-url");
    if (setSheetUrlInput) setSheetUrlInput.value = appState.settings.sheetUrl || "";
    
    const setWebAppInput = document.getElementById("settings-web-app-url");
    if (setWebAppInput) setWebAppInput.value = appState.settings.webAppUrl || "";
    
    const setTokenInput = document.getElementById("settings-sync-token");
    if (setTokenInput) setTokenInput.value = appState.settings.syncToken || "PersonalManagerHub2026";
    
    // Tạo block code hiển thị copy Apps Script
    renderAppsScriptCode();
    
    const copyScriptBtn = document.getElementById("btn-copy-apps-script");
    if (copyScriptBtn) {
        copyScriptBtn.addEventListener("click", () => {
            const code = document.getElementById("apps-script-code-display").textContent;
            navigator.clipboard.writeText(code).then(() => {
                alert("Đã sao chép mã nguồn Google Apps Script vào Clipboard của bạn!");
            });
        });
    }

    // 12. Manual lock
    const manualLockBtn = document.getElementById("btn-manual-lock");
    if (manualLockBtn) {
        manualLockBtn.addEventListener("click", () => {
            if (confirm("Bạn muốn khóa ứng dụng Hub ngay bây giờ?")) {
                lockApp();
            }
        });
    }

    // 13. Lắng nghe sự kiện lọc dữ liệu Thu chi
    const filterTypeSelect = document.getElementById("filter-trans-type");
    if (filterTypeSelect) filterTypeSelect.addEventListener("change", renderTransactionsView);
    
    const filterCatSelect = document.getElementById("filter-trans-category");
    if (filterCatSelect) filterCatSelect.addEventListener("change", renderTransactionsView);
    
    const searchTransInput = document.getElementById("search-trans");
    if (searchTransInput) searchTransInput.addEventListener("input", renderTransactionsView);
    
    // Tự động thay đổi danh mục lọc động dựa trên loại thu/chi được lọc
    if (filterTypeSelect) {
        filterTypeSelect.addEventListener("change", (e) => {
            const catSelect = document.getElementById("filter-trans-category");
            if (!catSelect) return;
            catSelect.innerHTML = `<option value="all">Tất cả danh mục</option>`;
            
            const type = e.target.value;
            if (type === "all") {
                [...CATEGORIES.income, ...CATEGORIES.expense].forEach(cat => {
                    const opt = document.createElement("option");
                    opt.value = cat;
                    opt.textContent = cat;
                    catSelect.appendChild(opt);
                });
            } else {
                CATEGORIES[type].forEach(cat => {
                    const opt = document.createElement("option");
                    opt.value = cat;
                    opt.textContent = cat;
                    catSelect.appendChild(opt);
                });
            }
        });
    }
    
    // Kích hoạt ban đầu danh mục lọc
    const initialCatSelect = document.getElementById("filter-trans-category");
    if (initialCatSelect) {
        [...CATEGORIES.income, ...CATEGORIES.expense].forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            initialCatSelect.appendChild(opt);
        });
    }

    // 14. Bộ cập nhật Đồng hồ số và Lời chào thời gian thực
    updateHeaderClockAndGreetings();
    setInterval(updateHeaderClockAndGreetings, 1000);
    
    // Đăng ký nút Đồng bộ nhanh trong Header
    const quickSyncBtn = document.getElementById("btn-quick-sync");
    if (quickSyncBtn) {
        if (appState.settings && appState.settings.webAppUrl) {
            quickSyncBtn.classList.remove("hidden");
        }
        quickSyncBtn.addEventListener("click", () => {
            pullAllDataFromGoogleSheets();
        });
    }
}

// Trực quan hóa Đồng hồ số và Ngày tháng + Lời chào thông minh
function updateHeaderClockAndGreetings() {
    const clock = document.getElementById("digital-clock");
    const greeting = document.getElementById("greeting-text");
    const dateText = document.getElementById("header-date");
    
    if (!clock || !greeting || !dateText) return;
    
    const now = new Date();
    clock.textContent = now.toTimeString().split(' ')[0];
    
    const hour = now.getHours();
    let greet = "Chào ngày mới!";
    if (hour >= 5 && hour < 11) {
        greet = "Chào buổi sáng tốt lành! 🌅";
    } else if (hour >= 11 && hour < 14) {
        greet = "Chúc bạn buổi trưa ngon miệng! ☀️";
    } else if (hour >= 14 && hour < 18) {
        greet = "Chúc bạn buổi chiều năng động! ☕";
    } else if (hour >= 18 && hour < 22) {
        greet = "Chúc bạn buổi tối ấm áp! 🌙";
    } else {
        greet = "Đã muộn rồi, chúc bạn ngủ ngon! 💤";
    }
    greeting.textContent = greet;
    
    const weekdays = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
    const dayName = weekdays[now.getDay()];
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    
    dateText.textContent = `${dayName}, ngày ${day} tháng ${month}, năm ${year}`;
}

// ==================== BINDING CÁC HÀM TOÀN CỤC CHO INLINE HTML HANDLERS ====================
window.openModal = openModal;
window.closeModal = closeModal;
window.allowDrop = allowDrop;
window.dragTask = dragTask;
window.dropTask = dropTask;
window.handleEditTask = handleEditTask;
window.handleDeleteTask = handleDeleteTask;
window.handleEditTransaction = handleEditTransaction;
window.handleDeleteTransaction = handleDeleteTransaction;
window.handleEditDebt = handleEditDebt;
window.handleDeleteDebt = handleDeleteDebt;
window.openRepaymentModal = openRepaymentModal;
window.deleteRepayment = deleteRepayment;
window.openSavingsModal = openSavingsModal;
window.deleteSaving = deleteSaving;
window.moveTask = moveTask;
window.handleEditGoal = handleEditGoal;
window.handleDeleteGoal = handleDeleteGoal;
window.toggleMilestone = toggleMilestone;
window.copyNoteForNotebookLM = copyNoteForNotebookLM;
window.handleEditNote = handleEditNote;
window.handleDeleteNote = handleDeleteNote;
window.togglePinTip = togglePinTip;
window.handleDeleteStorageFile = handleDeleteStorageFile;


const CACHE_NAME = 'personal-hub-cache-v4';

// Các tài nguyên cốt lõi cần tải trước (Pre-cache) để hoạt động offline-first
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon.svg',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://unpkg.com/lucide@latest'
];

// Sự kiện cài đặt Service Worker: Lưu trữ cache ban đầu
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Đang nạp tài nguyên cốt lõi vào Cache Storage...');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .catch(err => {
        console.error('[Service Worker] Lỗi nạp cache ban đầu:', err);
      })
  );
});

// Sự kiện kích hoạt Service Worker: Dọn dẹp cache cũ nếu có nâng cấp phiên bản
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Xóa bộ nhớ đệm cache cũ:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Sự kiện Fetch: Đánh chặn và phục vụ tài nguyên thông minh
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // 1. LUÔN BỎ QUA CACHE VỚI API GOOGLE APPS SCRIPT ĐỂ ĐẢM BẢO DỮ LIỆU LUÔN MỚI NHẤT
  if (requestUrl.hostname === 'script.google.com' || requestUrl.pathname.includes('/macros/')) {
    event.respondWith(
      fetch(event.request)
        .catch(err => {
          console.warn('[Service Worker] Không thể truy cập API Google Sheets ngầm (Mất mạng):', err);
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'Không thể kết nối Internet để đồng bộ đám mây. Dữ liệu tạm thời lưu cục bộ an toàn.' 
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 2. Chỉ xử lý các yêu cầu HTTP/HTTPS thông thường (Bỏ qua chrome-extension, v.v.)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // 3. CHIẾN LƯỢC: CACHE-FIRST CHO TÀI NGUYÊN TĨNH VÀ CDNs
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || (networkResponse.status !== 200 && networkResponse.status !== 0)) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      })
      .catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html') || caches.match('/');
        }
      })
  );
});

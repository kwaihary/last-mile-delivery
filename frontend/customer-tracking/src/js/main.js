/**
 * Customer Tracking — Main Application
 * Trang theo dõi giao hàng cho khách hàng cuối
 * Nhận token từ URL, gọi API, hiển thị map + trạng thái real-time
 */

'use strict';

const STATUS_ORDER = ['pending', 'pickup', 'delivering', 'completed'];

const STATUS_LABELS = {
  pending:    'Chờ xác nhận',
  pickup:     'Đang lấy hàng',
  delivering: 'Đang giao hàng',
  completed:  'Giao thành công',
  failed:     'Giao thất bại',
  canceled:   'Đã hủy',
};

const OSRM_BASE = 'https://router.project-osrm.org';

// State
let token = null;
let orderData = null;
let currentStatus = null;
let driverLat = null;
let driverLng = null;
let destLat = null;
let destLng = null;
let mapInitialized = false;
let routePolyline = null;
let routeGlow = null;
let driverMarker = null;
let destinationMarker = null;
let traveledDistanceKm = 0;
let routePoints = []; // Store all route points for full path display

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
let isRetrying = false;
let retryCount = 0;

// ── Utilities ──────────────────────────────────────────────────────────────
function setText(el, value) {
  if (!el) return;
  el.textContent = value ?? '--';
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = v => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateTraveledDistance() {
  if (routePoints.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < routePoints.length; i++) {
    total += haversineMeters(
      routePoints[i-1].lat, routePoints[i-1].lng,
      routePoints[i].lat, routePoints[i].lng
    );
  }
  return total / 1000; // Convert to km
}

async function fetchOsrmEta(lat1, lng1, lat2, lng2) {
  try {
    const url = `${OSRM_BASE}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false&steps=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return {
      durationSeconds: data.routes[0].duration,
      distanceMeters: data.routes[0].distance,
    };
  } catch {
    return null;
  }
}

// ── Map ────────────────────────────────────────────────────────────────────
// Map là full-screen nên fitBounds cần padding riêng cho trên/dưới để marker
// không bị che dưới ETA card (trên) và bottom card (dưới).
function getMapFitOptions() {
  const etaCard = document.querySelector('.eta-card');
  const bottomCard = document.querySelector('.bottom-card');
  const topPad = (etaCard?.offsetHeight || 90) + 70;
  const bottomPad = (bottomCard?.offsetHeight || 150) + 30;
  return {
    paddingTopLeft: [40, topPad],
    paddingBottomRight: [40, bottomPad],
  };
}

function initMap() {
  if (mapInitialized) return;

  const map = L.map('map', { zoomControl: false }).setView(
    [10.762622, 106.660172], 14
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Driver marker — icon xe máy 🛵
  driverMarker = L.marker([10.762622, 106.660172], {
    icon: L.divIcon({
      className: 'driver-marker',
      html: `<div class="driver-marker-inner"><span>🛵</span></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    }),
  }).addTo(map);

  // Route glow (halo mờ phía dưới) + route chính
  // Đồng bộ màu với Dashboard/LiveMap (frontend/manager): #3b82f6
  routeGlow = L.polyline([], {
    color: '#3b82f6',
    weight: 12,
    opacity: 0.15,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  routePolyline = L.polyline([], {
    color: '#3b82f6',
    weight: 6,
    opacity: 0.75,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  // Destination marker — icon vị trí 📍
  destinationMarker = L.marker([10.762622, 106.660172], {
    icon: L.divIcon({
      className: 'dest-marker',
      html: `<div class="dest-marker-inner"><span>📍</span></div>`,
      iconSize: [40, 44],
      iconAnchor: [20, 40],
    }),
  }).addTo(map);

  window._ctMap = map;
  mapInitialized = true;
}

function updateDriverPosition(lat, lng, addToRoute = true) {
  if (!mapInitialized || !driverMarker) return;
  driverLat = lat;
  driverLng = lng;
  driverMarker.setLatLng([lat, lng]);

  if (addToRoute && routePolyline) {
    const latlngs = routePolyline.getLatLngs();
    const last = latlngs[latlngs.length - 1];
    if (!last || last.lat !== lat || last.lng !== lng) {
      latlngs.push([lat, lng]);
      // Keep only last 200 points to avoid memory issues but show full path
      const trimmed = latlngs.slice(-200);
      routePolyline.setLatLngs(trimmed);
      routeGlow?.setLatLngs(trimmed);
      
      // Track route points for distance calculation
      routePoints.push({ lat, lng });
      
      // Update traveled distance display
      traveledDistanceKm = calculateTraveledDistance();
      updateTraveledDistanceDisplay();
    }
  }

  window._ctMap?.setView([lat, lng], Math.max(window._ctMap.getZoom(), 14), { animate: true });
}

function setDestination(lat, lng) {
  if (!mapInitialized || !destinationMarker) return;
  destLat = lat;
  destLng = lng;
  destinationMarker.setLatLng([lat, lng]);

  if (routePolyline && driverLat !== null) {
    // Draw straight line as fallback (OSRM route will replace this)
    const straight = [[driverLat, driverLng], [lat, lng]];
    routePolyline.setLatLngs(straight);
    routeGlow?.setLatLngs(straight);
  }

  window._ctMap?.fitBounds(
    L.latLngBounds([[lat, lng], [driverLat || lat, driverLng || lng]]),
    getMapFitOptions()
  );
}

async function loadOsrmRoute() {
  if (!mapInitialized || driverLat == null || destLat == null) return;

  try {
    const url = `${OSRM_BASE}/route/v1/driving/${driverLng},${driverLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return;

    const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    routePolyline?.setLatLngs(coords);
    routeGlow?.setLatLngs(coords);

    window._ctMap?.fitBounds(routePolyline?.getBounds(), getMapFitOptions());

    // Update ETA
    updateEta(data.routes[0].duration, data.routes[0].distance);
  } catch (err) {
    console.warn('[OSRM] Route load failed:', err);
  }
}

function updateEta(durationSeconds, distanceMeters) {
  const minutes = Math.round((durationSeconds || 0) / 60);
  const km = ((distanceMeters || 0) / 1000).toFixed(1);

  const minEl = document.getElementById('eta-minutes');
  const barEl = document.getElementById('eta-bar');
  const loadingEl = document.getElementById('eta-loading');
  const contentEl = document.getElementById('eta-content');

  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';
  if (minEl) minEl.textContent = minutes;

  // Tiến độ dựa trên tỉ lệ quãng đường đã đi / tổng quãng đường
  if (barEl) {
    const remainingKm = Number(km) || 0;
    const total = traveledDistanceKm + remainingKm;
    const progress = total > 0 ? Math.min(96, Math.max(4, (traveledDistanceKm / total) * 100)) : 5;
    barEl.style.width = `${progress}%`;
  }
}

function updateTraveledDistanceDisplay() {
  // Quãng đường đã đi không còn hiển thị riêng trong giao diện tối giản,
  // nhưng vẫn được dùng để tính tiến độ progress bar trong updateEta().
}

// ── Order loading with retry ────────────────────────────────────────────────
async function loadOrder() {
  const apiBase = window.__API_BASE_URL__ || `${location.protocol}//${location.hostname}${
    location.port && location.port !== '80' && location.port !== '443' ? ':' + location.port : ''
  }/api`;

  let lastError = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Try to load from cache first on retry
      if (attempt > 0 && localStorage.getItem('ct_order_cache_' + token)) {
        try {
          const cached = JSON.parse(localStorage.getItem('ct_order_cache_' + token));
          if (cached && Date.now() - cached.timestamp < 60000) { // Cache valid for 1 minute
            console.log('[Tracking] Using cached order data');
            return cached.data;
          }
        } catch {}
      }
      
      const res = await fetch(`${apiBase}/orders/track/${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(10000)
      });
      
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Không tìm thấy đơn hàng (${res.status})`);
      }

      const payload = await res.json();
      if (!payload?.success || !payload?.data) {
        throw new Error('Dữ liệu đơn hàng không hợp lệ');
      }
      
      // Cache the successful response
      try {
        localStorage.setItem('ct_order_cache_' + token, JSON.stringify({
          data: payload.data,
          timestamp: Date.now()
        }));
      } catch {}

      return payload.data;
    } catch (err) {
      lastError = err;
      console.warn(`[Tracking] Load attempt ${attempt + 1} failed:`, err.message);
      
      if (attempt < MAX_RETRIES) {
        window.CustomerTrackingSocket?.updateConnectionStatus?.('connecting');
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  
  throw lastError || new Error('Không thể tải đơn hàng sau nhiều lần thử');
}

function renderOrder(order) {
  orderData = order;
  currentStatus = order.status;

  // Order badge
  setText(document.getElementById('order-id'), '#ORD-' + order.id);

  // Driver info
  const driverName = order.driver?.full_name || 'Đang cập nhật...';
  setText(document.getElementById('driver-name'), driverName);

  const vehicleInfo = [
    order.driver?.driver_profile?.vehicle_type,
    order.driver?.driver_profile?.license_plate,
  ].filter(Boolean).join(' • ') || null;
  setText(document.getElementById('driver-vehicle'), vehicleInfo);

  if (order.driver?.full_name) {
    const avatarEl = document.getElementById('driver-avatar');
    if (avatarEl) {
      avatarEl.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(order.driver.full_name)}`;
    }
  }

  // Khởi tạo map trước để marker có thể được đặt vị trí
  if (!mapInitialized) {
    initMap();
  }

  // 1. Xác định vị trí hiện tại của tài xế TRƯỚC: ưu tiên current_lat/current_lng
  // từ backend, fallback về điểm cuối của route history (route có thể chỉ là
  // GPS dao động tại chỗ khi tài xế chưa di chuyển nhiều).
  if (order.current_lat != null && order.current_lng != null) {
    updateDriverPosition(Number(order.current_lat), Number(order.current_lng), false);
  } else if (Array.isArray(order.route) && order.route.length > 0) {
    const last = order.route[order.route.length - 1];
    if (last.lat && last.lng) {
      updateDriverPosition(Number(last.lat), Number(last.lng), false);
    }
  }

  // 2. Đặt điểm giao hàng SAU khi đã có vị trí tài xế, để đường thẳng fallback
  // được vẽ đúng ngay lập tức (không bị dồn về 1 điểm do driverLat còn null).
  if (Number.isFinite(Number(order.latitude)) && Number.isFinite(Number(order.longitude))) {
    destLat = Number(order.latitude);
    destLng = Number(order.longitude);
    setDestination(destLat, destLng);
  }

  // 3. Vẽ lộ trình thực tế theo đường đi (OSRM) từ tài xế đến điểm giao hàng,
  // thay thế đường thẳng fallback, và cập nhật ETA theo lộ trình thật.
  if (driverLat != null && destLat != null) {
    loadOsrmRoute().catch(() => {});
    fetchOsrmEta(driverLat, driverLng, destLat, destLng).then(result => {
      if (result) {
        updateEta(result.durationSeconds, result.distanceMeters);
      } else {
        // Fallback to Haversine nếu OSRM không phản hồi
        const meters = haversineMeters(driverLat, driverLng, destLat, destLng);
        const minutes = Math.round((meters / 1000) / 25 * 60);
        updateEta(minutes * 60, meters);
      }
    });
  }

  // Status badge
  const statusBadge = document.getElementById('order-status-badge');
  if (statusBadge) {
    statusBadge.textContent = STATUS_LABELS[order.status] || order.status;
    statusBadge.className = `order-status-badge status-${order.status}`;
  }

  handleTerminalStatus(order.status);
}

function handleTerminalStatus(status) {
  // Handle completed/failed globally
  if (status === 'completed' || status === 'failed') {
    const loadingEl = document.getElementById('eta-loading');
    const contentEl = document.getElementById('eta-content');
    const minEl = document.getElementById('eta-minutes');
    const labelEl = document.getElementById('eta-label');
    const barEl = document.getElementById('eta-bar');

    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    if (minEl) minEl.textContent = '0';
    if (labelEl) labelEl.textContent = status === 'completed' ? '✓ Giao hàng thành công!' : '✗ Giao thất bại';
    if (barEl) barEl.style.width = status === 'completed' ? '100%' : '0%';
  }
}

// ── Socket message handler ──────────────────────────────────────────────────
function onSocketMessage(type, data) {
  if (type === 'location') {
    if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
      updateDriverPosition(data.lat, data.lng, true);

      // Vẽ lại lộ trình thực tế (OSRM) từ vị trí mới của tài xế đến điểm giao hàng
      if (destLat != null && destLng != null) {
        loadOsrmRoute().catch(() => {});
      }
    }
  }

  if (type === 'status') {
    currentStatus = data.status;
    const statusBadge = document.getElementById('order-status-badge');
    if (statusBadge) {
      statusBadge.textContent = STATUS_LABELS[data.status] || data.status;
      statusBadge.className = `order-status-badge status-${data.status}`;
    }
    handleTerminalStatus(data.status);

    if (data.status === 'completed') {
      const map = window._ctMap;
      if (map && destLat != null && destLng != null) {
        map.setView([destLat, destLng], 16, { animate: true });
      }
    }
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function init() {
  // Ưu tiên đọc token từ URL path (/track/:token — format link SMS gửi cho khách)
  // Fallback sang query string (?token=...) để tương thích ngược
  const pathMatch = location.pathname.match(/\/track\/([^/]+)\/?$/);
  const params = new URLSearchParams(location.search);
  token = pathMatch?.[1] || params.get('token');

  if (!token) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;background:#f8fafc;">
        <div style="text-align:center;padding:32px;">
          <div style="font-size:56px;margin-bottom:16px;">🔍</div>
          <h1 style="font-size:18px;font-weight:800;margin-bottom:8px;color:#0f172a;">Liên kết không hợp lệ</h1>
          <p style="font-size:13px;color:#64748b;">Không tìm thấy mã theo dõi. Vui lòng kiểm tra lại đường dẫn.</p>
        </div>
      </div>`;
    return;
  }

  try {
    const order = await loadOrder();
    renderOrder(order);
    window.CustomerTrackingSocket.connectTrackingSocket(token, onSocketMessage);
  } catch (err) {
    console.error('[Tracking] Init error:', err);
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;background:#f8fafc;">
        <div style="text-align:center;padding:32px;">
          <div style="font-size:56px;margin-bottom:16px;">⚠️</div>
          <h1 style="font-size:18px;font-weight:800;margin-bottom:8px;color:#0f172a;">Không thể tải đơn hàng</h1>
          <p style="font-size:13px;color:#64748b;">${err.message}</p>
          <button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;background:#4f46e5;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
            Thử lại
          </button>
        </div>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);

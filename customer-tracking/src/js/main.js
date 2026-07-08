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
function initMap() {
  if (mapInitialized) return;

  const map = L.map('map', { zoomControl: false }).setView(
    [10.762622, 106.660172], 14
  );

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Driver marker
  driverMarker = L.marker([10.762622, 106.660172], {
    icon: L.divIcon({
      className: 'driver-marker',
      html: `<div class="driver-marker-inner">
        <svg viewBox="0 0 24 24" width="26" height="26"><path fill="#4f46e5" d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    }),
  }).addTo(map);

  // Route polyline
  routePolyline = L.polyline([], {
    color: '#4f46e5',
    weight: 5,
    opacity: 0.7,
  }).addTo(map);

  // Destination marker
  destinationMarker = L.marker([10.762622, 106.660172], {
    icon: L.divIcon({
      className: 'dest-marker',
      html: `<div class="dest-marker-inner">
        <svg viewBox="0 0 24 24" width="28" height="28"><path fill="#f43f5e" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
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
      routePolyline.setLatLngs(latlngs.slice(-200));
      
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
    routePolyline.setLatLngs([[driverLat, driverLng], [lat, lng]]);
  }

  window._ctMap?.fitBounds(
    L.latLngBounds([[lat, lng], [driverLat || lat, driverLng || lng]]),
    { padding: [40, 40] }
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

    window._ctMap?.fitBounds(routePolyline?.getBounds(), { padding: [50, 50] });

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
  const labelEl = document.getElementById('eta-label');
  const loadingEl = document.getElementById('eta-loading');
  const contentEl = document.getElementById('eta-content');

  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';
  if (minEl) minEl.textContent = minutes;
  if (labelEl) labelEl.textContent = `Dự kiến: ${km} km • ~${minutes} phút`;

  // Animate progress bar
  if (barEl) {
    const progress = Math.min(95, Math.max(5, 80));
    barEl.style.width = `${progress}%`;
  }
}

function updateTraveledDistanceDisplay() {
  const traveledEl = document.getElementById('traveled-distance');
  if (traveledEl) {
    traveledEl.textContent = traveledDistanceKm.toFixed(1) + ' km';
  }
}

// ── Order loading with retry ────────────────────────────────────────────────
async function loadOrder() {
  const apiBase = `${location.protocol}//${location.hostname}${
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
        updateConnectionStatus('connecting');
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

  // Store destination
  if (Number.isFinite(Number(order.latitude)) && Number.isFinite(Number(order.longitude))) {
    destLat = Number(order.latitude);
    destLng = Number(order.longitude);
    if (mapInitialized) {
      setDestination(destLat, destLng);
    }
  }

  // Initialize map once
  if (!mapInitialized) {
    initMap();
  }

  if (destLat != null && destLng != null) {
    setDestination(destLat, destLng);
  }

  // Draw route history from initial data (FULL route from backend)
  if (Array.isArray(order.route) && order.route.length > 0) {
    routePoints = []; // Reset route points
    order.route.forEach((p, i) => {
      if (p.lat && p.lng) {
        routePoints.push({ lat: Number(p.lat), lng: Number(p.lng) });
        updateDriverPosition(Number(p.lat), Number(p.lng), i < order.route.length - 1);
      }
    });
    
    // Recalculate traveled distance
    traveledDistanceKm = calculateTraveledDistance();
    updateTraveledDistanceDisplay();
    
    // Draw full polyline from route history
    if (routePolyline && routePoints.length > 0) {
      routePolyline.setLatLngs(routePoints.map(p => [p.lat, p.lng]));
    }
  }
  
  // Update current driver position if available
  if (order.current_lat != null && order.current_lng != null) {
    updateDriverPosition(Number(order.current_lat), Number(order.current_lng), false);
  }

  // Update ETA from initial position
  if (order.latitude && order.longitude && driverLat != null) {
    fetchOsrmEta(driverLat, driverLng, destLat, destLng).then(result => {
      if (result) {
        updateEta(result.durationSeconds, result.distanceMeters);
      } else {
        // Fallback to Haversine
        const meters = haversineMeters(driverLat, driverLng, destLat, destLng);
        const minutes = Math.round((meters / 1000) / 25 * 60);
        updateEta(minutes * 60, meters);
      }
    });
  }

  // Status badge in header
  const statusBadge = document.getElementById('order-status-badge');
  if (statusBadge) {
    statusBadge.textContent = STATUS_LABELS[order.status] || order.status;
    statusBadge.className = `order-status-badge status-${order.status}`;
  }

  updateStatusSteps(order.status);
}

function updateStatusSteps(status) {
  const steps = document.querySelectorAll('.step-item');
  const currentIdx = STATUS_ORDER.indexOf(status);

  steps.forEach((step, idx) => {
    const stepStatus = step.dataset.status;

    step.classList.remove('completed', 'active', 'failed');

    if (['failed', 'canceled'].includes(status) && stepStatus === status) {
      step.classList.add('failed');
    } else if (currentIdx >= 0) {
      if (idx < currentIdx) step.classList.add('completed');
      else if (idx === currentIdx) step.classList.add('active');
    }
  });

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

      // Fetch updated OSRM route
      if (destLat != null && destLng != null) {
        fetchOsrmEta(data.lat, data.lng, destLat, destLng).then(result => {
          if (result) updateEta(result.durationSeconds, result.distanceMeters);
        });
      }
    }
  }

  if (type === 'status') {
    currentStatus = data.status;
    updateStatusSteps(data.status);

    if (data.status === 'completed') {
      const map = window._ctMap;
      if (map && destLat != null && destLng != null) {
        map.fitBounds(L.latLngBounds([[destLat, destLng]]), { padding: [50, 50] });
      }
    }
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  token = params.get('token');

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

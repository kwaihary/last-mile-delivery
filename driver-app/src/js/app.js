/**
 * DRIVER APP - APPLICATION LOGIC
 * Ứng dụng tài xế cho hệ thống Giao hàng Chặng cuối (Last-Mile Delivery)
 * Vanilla JS + PWA + Leaflet (OSRM)
 *
 * Tác giả: Nguyễn Huỳnh Minh Lộc & Nguyễn Hiền Phúc
 */

import L from 'leaflet';
import api from '../services/api.js';
import * as socketService from '../services/socket.js';

// =============================================================================
// STATE
// =============================================================================
const AppState = {
  user: null,
  isOnline: false,
  // Cờ đánh dấu người dùng đã chủ động OFF trực tuyến trong phiên này
  // Tránh việc hệ thống tự bật lại khi tải lại danh sách đơn
  manualOffline: false,
  orders: [],
  trackingOrder: null,   // Đơn đang theo dõi trên bản đồ
  map: null,
  driverMarker: null,
  // Lưu các layer dạng mảng để có thể cleanup triệt để
  destMarkers: [],       // marker đích (theo từng đơn)
  routeLayers: [],       // polyline lộ trình (theo từng đơn)
  pickupMarkers: [],     // marker kho (nếu có)
  watchId: null,
  mapInitialised: false,
  // Lưu vị trí tài xế mới nhất để FAB "định vị lại" có thể dùng ngay
  lastDriverLatLng: null
};

const ORDER_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  PICKUP: 'pickup',
  DELIVERING: 'delivering',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled'
};

const STATUS_LABELS = {
  [ORDER_STATUS.PENDING]: 'Chờ tiếp nhận',
  [ORDER_STATUS.ASSIGNED]: 'Đã giao cho bạn',
  [ORDER_STATUS.PICKUP]: 'Đang lấy hàng',
  [ORDER_STATUS.DELIVERING]: 'Đang giao hàng',
  [ORDER_STATUS.COMPLETED]: 'Hoàn thành',
  [ORDER_STATUS.FAILED]: 'Thất bại',
  [ORDER_STATUS.CANCELED]: 'Đã hủy'
};

// =============================================================================
// DOM HELPERS
// =============================================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $$('.screen').forEach((s) => {
    if (s.id === id) s.classList.remove('hidden');
    else s.classList.add('hidden');
  });
}

function switchTab(tab) {
  $$('.nav-item').forEach((n) => {
    if (n.dataset.tab === tab) n.classList.add('active');
    else n.classList.remove('active');
  });

  $$('.tab-panel').forEach((p) => p.classList.remove('active'));
  $(`tab-${tab}`)?.classList.add('active');

  AppState.activeTab = tab;

  // Khi chuyển sang tab map thì render map
  if (tab === 'map') {
    requestAnimationFrame(() => {
      ensureMap();
      resizeMap();
      // Khi có đơn đang tracking thì render route
      if (AppState.trackingOrder) {
        renderRouteForOrder(AppState.trackingOrder);
      } else {
        // Nếu chưa có đơn thì thử lấy vị trí hiện tại để bản đồ có ý nghĩa
        locateDriverOnMap(true);
      }
    });
  }
}

// =============================================================================
// TOAST
// =============================================================================
function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// =============================================================================
// MODAL HELPERS
// =============================================================================
function showConfirmModal({ title, message, okText = 'Xác nhận', cancelText = 'Hủy', variant = 'warning' }) {
  return new Promise((resolve) => {
    const overlay = $('modal-confirm');
    const titleEl = $('modal-confirm-title');
    const msgEl = $('modal-confirm-message');
    const okBtn = $('modal-confirm-ok');
    const cancelBtn = $('modal-confirm-cancel');
    const iconWrap = overlay?.querySelector('.modal-icon-wrap');
    const box = overlay?.querySelector('.modal-box');
    if (!overlay || !okBtn || !cancelBtn) return resolve(false);

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    okBtn.classList.remove('btn-primary', 'btn-danger-solid', 'btn-success');
    if (variant === 'danger') okBtn.classList.add('btn-danger-solid');
    else if (variant === 'success') okBtn.classList.add('btn-success');
    else okBtn.classList.add('btn-primary');

    iconWrap?.classList.remove('modal-icon-wrap--warning', 'modal-icon-wrap--danger', 'modal-icon-wrap--success');
    if (variant === 'danger') iconWrap?.classList.add('modal-icon-wrap--danger');
    else iconWrap?.classList.add('modal-icon-wrap--warning');

    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleBg);
    };
    const handleOk = () => { cleanup(); resolve(true); };
    const handleCancel = () => { cleanup(); resolve(false); };
    const handleBg = (e) => { if (e.target === overlay) handleCancel(); };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleBg);
  });
}

// =============================================================================
// AUTH
// =============================================================================
async function handleLogin(email, password) {
  const submitBtn = $('login-submit-btn');
  const errorEl = $('login-error');

  if (!email || !password) {
    const emailInput = document.querySelector('#login-form input[type="email"]');
    const passwordInput = document.querySelector('#login-form input[type="password"]');
    email = emailInput?.value?.trim() || '';
    password = passwordInput?.value || '';
  }

  if (!email || !password) {
    if (errorEl) {
      errorEl.textContent = 'Vui lòng nhập đầy đủ email và mật khẩu';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  if (errorEl) errorEl.classList.add('hidden');
  if (submitBtn) {
    submitBtn.disabled = true;
    const bt = submitBtn.querySelector('.btn-text');
    const bl = submitBtn.querySelector('.btn-loader');
    if (bt) bt.textContent = 'Đang đăng nhập...';
    if (bl) bl.classList.remove('hidden');
  }

  try {
    const response = await api.post('/users/login', { email, password });
    const responseData = response?.data?.data || response?.data;
    const token = responseData?.token;
    const user = responseData?.user;

    if (!token || !user) throw new Error('Phản hồi từ server không hợp lệ');

    localStorage.setItem('token', token);
    localStorage.setItem('driverUser', JSON.stringify(user));
    AppState.user = user;

    showToast('Đăng nhập thành công!', 'success');

    initializeSocket();
    initializeHome();
    showScreen('screen-home');
    loadOrders();
  } catch (error) {
    console.error('Login error:', error);
    if (errorEl) {
      errorEl.textContent = error.message || 'Đăng nhập thất bại!';
      errorEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      const bt = submitBtn.querySelector('.btn-text');
      const bl = submitBtn.querySelector('.btn-loader');
      if (bt) bt.textContent = 'Đăng Nhập Ngay';
      if (bl) bl.classList.add('hidden');
    }
  }
}

function openLogoutModal() {
  const overlay = $('modal-logout');
  if (!overlay) return;
  overlay.classList.remove('hidden');
}

function performLogout() {
  // Tắt trực tuyến + ngắt socket
  if (AppState.isOnline) {
    api.patch('/drivers/status', { isOnline: false, is_online: false }).catch(() => {});
  }
  socketService.stopLocationSharing();
  socketService.disconnectDriverSocket();

  localStorage.removeItem('token');
  localStorage.removeItem('driverUser');
  AppState.user = null;
  AppState.orders = [];
  AppState.trackingOrder = null;
  AppState.manualOffline = false;
  destroyMap();

  const tg = $('online-toggle');
  if (tg) tg.checked = false;
  AppState.isOnline = false;
  updateOnlineUI(false);

  showScreen('screen-login');
  showToast('Đã đăng xuất thành công!', 'info');
}

function checkAuth() {
  const token = localStorage.getItem('token');
  const userJson = localStorage.getItem('driverUser');
  if (token && userJson) {
    try {
      AppState.user = JSON.parse(userJson);
      initializeSocket();
      initializeHome();
      loadOrders();
      return true;
    } catch (e) {
      console.error('Parse user error:', e);
      return false;
    }
  }
  return false;
}

// =============================================================================
// UI INIT
// =============================================================================
function initializeHome() {
  if (!AppState.user) return;

  const driverNameEl = $('driver-name');
  if (driverNameEl) {
    driverNameEl.textContent = AppState.user.full_name || AppState.user.email?.split('@')[0] || 'Tài xế';
  }

  const avatar = $('driver-avatar');
  if (avatar && AppState.user.id) {
    avatar.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${AppState.user.id}`;
  }

  updateOnlineUI(AppState.isOnline);
}

function initializeSocket() {
  if (!AppState.user) return;
  const token = localStorage.getItem('token');
  socketService.connectDriverSocket(token, AppState.user.id, {
    onOrderAssigned: (data) => {
      console.log('[Socket] New order:', data);
      const order = data.order || data;
      if (order && order.id) showNewOrderModal(order);
    },
    onOrderCancelled: (data) => {
      if (AppState.trackingOrder && AppState.trackingOrder.id === data.orderId) {
        showToast(`Đơn hàng #${data.orderId} đã bị hủy!`, 'warning');
        AppState.trackingOrder = null;
        renderTrackingCard();
        loadOrders();
      }
    }
  });
}

// =============================================================================
// ONLINE STATUS
// =============================================================================
async function toggleOnlineStatus() {
  const onlineToggle = $('online-toggle');
  if (!onlineToggle) return;

  const targetStatus = onlineToggle.checked;

  if (AppState.isOnline === targetStatus) return;

  onlineToggle.disabled = true;
  updateOnlineUI(targetStatus, true);

  try {
    // Backend dùng field is_online (snake_case) - thử cả 2 trường hợp
    await api.patch('/drivers/status', { isOnline: targetStatus, is_online: targetStatus });
    AppState.isOnline = targetStatus;
    updateOnlineUI(targetStatus);

    if (targetStatus) {
      // Nếu người dùng vừa bật lại thì reset cờ manualOffline
      AppState.manualOffline = false;
      showToast('Đã bật chế độ trực tuyến', 'success');
      // Nếu đang theo dõi đơn thì bắt đầu gửi vị trí
      if (AppState.trackingOrder) {
        socketService.startLocationSharing(AppState.trackingOrder.id);
      }
    } else {
      // User chủ động OFF -> đánh dấu để không bị tự động bật lại
      AppState.manualOffline = true;
      showToast('Đã tắt chế độ trực tuyến', 'info');
      socketService.stopLocationSharing();
    }
  } catch (error) {
    console.error('Toggle online error:', error);
    showToast('Không thể cập nhật trạng thái - ' + (error.message || ''), 'error');
    onlineToggle.checked = AppState.isOnline;
    updateOnlineUI(AppState.isOnline);
  } finally {
    onlineToggle.disabled = false;
  }
}

function updateOnlineUI(isOnline, isPending = false) {
  const driverStatusEl = $('driver-status');
  if (driverStatusEl) {
    if (isPending) {
      driverStatusEl.textContent = 'Đang cập nhật...';
    } else {
      driverStatusEl.textContent = isOnline ? 'Đang trực tuyến' : 'Đang ngoại tuyến';
      driverStatusEl.classList.toggle('online', !!isOnline);
    }
  }
}

// =============================================================================
// ORDERS LIST
// =============================================================================
async function loadOrders(opts = {}) {
  const { silent = false, autoTrack = true } = opts;
  const orderList = $('orders-list');
  if (!orderList) return;

  if (!silent) {
    orderList.innerHTML = `
      <div class="empty-state">
        <div class="spinner" style="margin: 0 auto 12px;"></div>
        <h4>Đang tải đơn hàng...</h4>
      </div>`;
  }

  try {
    const res = await api.get('/drivers/orders');
    const list = res?.data?.data || res?.data || [];
    // Sắp xếp giảm dần theo id (mới nhất lên đầu)
    AppState.orders = [...list].sort((a, b) => Number(b.id) - Number(a.id));

    renderOrders();

    if (!autoTrack) return;

    // Xác định đơn đang active (pickup/delivering) - lấy đơn mới nhất
    const active = AppState.orders.find(
      (o) => o.status === ORDER_STATUS.PICKUP || o.status === ORDER_STATUS.DELIVERING
    );

    if (active) {
      // Nếu đơn đang theo dõi khác với đơn active mới -> cập nhật
      const cur = AppState.trackingOrder;
      if (!cur || Number(cur.id) !== Number(active.id)) {
        AppState.trackingOrder = active;
        renderTrackingCard();
        // Nếu đang ở tab map thì vẽ lại route cho đơn mới
        if (AppState.activeTab === 'map') {
          renderRouteForOrder(active);
        }
      }
    } else if (AppState.trackingOrder) {
      AppState.trackingOrder = null;
      renderTrackingCard();
      clearOrderLayers();
    }

    // Chỉ auto-bật trực tuyến khi:
    // 1. Có đơn active (pickup/delivering)
    // 2. Tài xế chưa online
    // 3. Tài xế KHÔNG chủ động OFF trong phiên này
    if (active && !AppState.isOnline && !AppState.manualOffline) {
      const tg = $('online-toggle');
      if (tg && !tg.checked) tg.checked = true;
      // Đánh dấu pending để tránh vòng lặp
      AppState.isOnline = true;
      updateOnlineUI(true);
      toggleOnlineStatus().catch(() => {});
    }
  } catch (err) {
    console.error('Load orders error:', err);
    orderList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h4>Không thể tải đơn hàng</h4>
        <p>${err.message || ''}</p>
      </div>`;
  }
}

function renderOrders() {
  const orderList = $('orders-list');
  if (!orderList) return;

  if (AppState.orders.length === 0) {
    orderList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h4>Chưa có đơn hàng nào</h4>
        <p>Đơn hàng được điều phối sẽ xuất hiện tại đây</p>
      </div>`;
    return;
  }

  orderList.innerHTML = '';
  AppState.orders.forEach((order) => {
    orderList.appendChild(buildOrderCard(order));
  });
}

function buildOrderCard(order) {
  const card = document.createElement('div');
  card.className = `order-card status-${order.status}`;
  card.dataset.id = order.id;

  const id = order.id;
  const receiverName = order.customer_name || '—';
  const phone = order.customer_phone || '';
  const address = order.address || '—';
  const cod = Number(order.ship_cod || 0);
  const codFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cod);
  const statusLabel = STATUS_LABELS[order.status] || order.status;
  const notes = order.order_notes || '';

  card.innerHTML = `
    <div class="order-card-head">
      <div class="order-card-id"><span class="id-prefix">#ORD</span>${id}</div>
      <span class="badge badge--${order.status}">${statusLabel}</span>
    </div>

    <div class="order-card-body">
      <div class="order-line">
        <span class="order-line-icon">👤</span>
        <div class="order-line-content">
          <span class="order-line-key">Khách hàng</span>
          <span class="order-line-val name">${escapeHtml(receiverName)}${
            phone ? `<a class="order-line-val phone" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : ''
          }</span>
        </div>
      </div>

      <div class="order-line">
        <span class="order-line-icon">📍</span>
        <div class="order-line-content">
          <span class="order-line-key">Địa chỉ giao</span>
          <span class="order-line-val address-text">${escapeHtml(address)}</span>
        </div>
      </div>

      ${notes ? `
      <div class="order-line">
        <span class="order-line-icon">📝</span>
        <div class="order-line-content">
          <span class="order-line-key">Ghi chú</span>
          <span class="order-line-val">${escapeHtml(notes)}</span>
        </div>
      </div>` : ''}
    </div>

    <div class="order-card-foot">
      <div>
        <div class="cod-label">Tiền thu hộ (COD)</div>
        <div class="cod-amount">${codFormatted}</div>
      </div>
      <span class="card-hint">
        Xem lộ trình
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </span>
    </div>
  `;

  card.addEventListener('click', () => onOrderCardClick(order));
  return card;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function onOrderCardClick(order) {
  // Nếu click lại chính đơn đang tracking thì chỉ chuyển tab
  if (AppState.trackingOrder && Number(AppState.trackingOrder.id) === Number(order.id)) {
    switchTab('map');
    return;
  }

  AppState.trackingOrder = order;
  renderTrackingCard();
  switchTab('map');

  // Sau khi bản đồ đã render thì vẽ route (trong switchTab đã gọi renderRouteForOrder rồi)
  showToast(`Đã mở lộ trình cho đơn #ORD-${order.id}`, 'info');
}

// =============================================================================
// TRACKING CARD (trên tab bản đồ)
// =============================================================================
function renderTrackingCard() {
  const card = $('tracking-info-card');
  const empty = $('tab-map-empty');
  const fab = $('btn-locate-driver');
  const order = AppState.trackingOrder;

  if (!order || !['pickup', 'delivering', 'assigned'].includes(order.status)) {
    card?.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    fab?.classList.remove('has-tracking');
    return;
  }

  empty?.classList.add('hidden');
  card?.classList.remove('hidden');
  fab?.classList.add('has-tracking');

  $('tracking-order-id').textContent = `#ORD-${order.id}`;
  $('tracking-customer').textContent = order.customer_name || '—';
  $('tracking-address').textContent = order.address || '—';

  const cod = Number(order.ship_cod || 0);
  $('tracking-cod').textContent = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cod);

  const statusBadge = $('tracking-status');
  if (statusBadge) {
    statusBadge.className = `badge badge--${order.status}`;
    statusBadge.textContent = STATUS_LABELS[order.status] || order.status;
  }

  renderTrackingActions(order);
}

function renderTrackingActions(order) {
  const wrap = $('tracking-actions');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (order.status === ORDER_STATUS.ASSIGNED) {
    // Tiếp nhận đơn
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.innerHTML = '✓ Tiếp nhận đơn';
    btn.onclick = () => confirmStatusChange(order.id, ORDER_STATUS.PICKUP, {
      title: 'Tiếp nhận đơn hàng?',
      message: 'Bạn sẽ chuyển sang trạng thái "Đang lấy hàng". Hệ thống sẽ bắt đầu ghi nhận vị trí của bạn.',
      okText: 'Tiếp nhận',
      variant: 'success'
    });
    wrap.appendChild(btn);
  } else if (order.status === ORDER_STATUS.PICKUP) {
    // Đã lấy hàng
    const btn = document.createElement('button');
    btn.className = 'btn btn-success';
    btn.innerHTML = '📦 Lấy hàng thành công';
    btn.onclick = () => confirmStatusChange(order.id, ORDER_STATUS.DELIVERING, {
      title: 'Xác nhận lấy hàng thành công?',
      message: `Bạn đã nhận được hàng cho đơn #${order.id} và sẵn sàng giao đến khách hàng.`,
      okText: 'Xác nhận',
      variant: 'success'
    });
    wrap.appendChild(btn);
  } else if (order.status === ORDER_STATUS.DELIVERING) {
    // Hoàn thành đơn (bước 1) - Sau đó hiện thêm Hủy/Xác nhận
    if (!wrap.dataset.step) wrap.dataset.step = 'main';

    if (wrap.dataset.step === 'main') {
      const btnComplete = document.createElement('button');
      btnComplete.className = 'btn btn-success';
      btnComplete.innerHTML = '✓ Hoàn thành đơn hàng';
      btnComplete.onclick = () => {
        wrap.dataset.step = 'confirm';
        renderTrackingActions(order);
      };
      wrap.appendChild(btnComplete);
    } else {
      const row = document.createElement('div');
      row.className = 'btn-row';

      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn btn-ghost';
      btnCancel.textContent = 'Chưa';
      btnCancel.onclick = () => {
        wrap.dataset.step = 'main';
        renderTrackingActions(order);
      };

      const btnOk = document.createElement('button');
      btnOk.className = 'btn btn-success';
      btnOk.innerHTML = 'Xác nhận';
      btnOk.onclick = () => openProofScreen(order);

      row.appendChild(btnCancel);
      row.appendChild(btnOk);
      wrap.appendChild(row);
    }
  }
}

async function confirmStatusChange(orderId, nextStatus, confirmOpts) {
  const ok = await showConfirmModal({
    title: confirmOpts.title,
    message: confirmOpts.message,
    okText: confirmOpts.okText || 'Xác nhận',
    cancelText: 'Hủy',
    variant: confirmOpts.variant || 'warning'
  });
  if (!ok) return;

  try {
    await api.patch(`/orders/${orderId}/status`, { status: nextStatus });
    showToast('Cập nhật trạng thái thành công!', 'success');

    // Khi chuyển sang pickup/delivering thì join room + tracking
    if (nextStatus === ORDER_STATUS.PICKUP || nextStatus === ORDER_STATUS.DELIVERING) {
      socketService.joinOrderRoom(orderId);
      // Bật trực tuyến nếu chưa (và user chưa chủ động OFF)
      if (!AppState.isOnline && !AppState.manualOffline) {
        const tg = $('online-toggle');
        if (tg && !tg.checked) tg.checked = true;
        AppState.isOnline = true;
        updateOnlineUI(true);
        // Best-effort, không block flow
        toggleOnlineStatus().catch(() => {});
      }
      socketService.startLocationSharing(orderId);
    }

    // Cập nhật lại local state thay vì reload toàn bộ (silent)
    await loadOrders({ silent: true, autoTrack: true });

    // Đồng bộ trackingOrder
    const updated = AppState.orders.find((o) => Number(o.id) === Number(orderId));
    if (updated) {
      AppState.trackingOrder = updated;
      renderTrackingCard();
      // Nếu đang ở tab map thì vẽ lại route
      if (AppState.activeTab === 'map') {
        renderRouteForOrder(updated);
      }
    }
  } catch (error) {
    showToast(error.message || 'Lỗi cập nhật trạng thái', 'error');
  }
}

// =============================================================================
// PROOF SCREEN
// =============================================================================
let selectedImageFile = null;

function openProofScreen(order) {
  selectedImageFile = null;
  const orderIdText = $('proof-order-id-text');
  if (orderIdText) orderIdText.textContent = `Đơn hàng #ORD-${order.id}`;

  const notesEl = $('proof-notes');
  if (notesEl) notesEl.value = '';

  const previewEl = $('proof-preview');
  if (previewEl) {
    previewEl.classList.add('hidden');
    previewEl.src = '';
  }
  const placeholder = $('capture-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');

  // Lưu orderId đang xử lý
  $('screen-proof').dataset.orderId = order.id;

  showScreen('screen-proof');
}

async function submitProof(success = true) {
  const screen = $('screen-proof');
  const orderId = screen?.dataset?.orderId;
  if (!orderId) return;
  const notes = $('proof-notes')?.value?.trim() || '';

  if (success) {
    if (!selectedImageFile) {
      showToast('Vui lòng chụp ảnh hoặc chọn ảnh minh chứng!', 'warning');
      return;
    }

    const ok = await showConfirmModal({
      title: 'Xác nhận hoàn thành đơn?',
      message: `Sau khi xác nhận, trạng thái đơn #${orderId} sẽ chuyển sang "Hoàn thành" và không thể chỉnh sửa.`,
      okText: 'Hoàn thành',
      variant: 'success'
    });
    if (!ok) return;

    const submitBtn = $('btn-submit-proof');
    if (submitBtn) {
      submitBtn.disabled = true;
      const bt = submitBtn.querySelector('.btn-text');
      const bl = submitBtn.querySelector('.btn-loader');
      if (bt) bt.textContent = 'Đang tải...';
      if (bl) bl.classList.remove('hidden');
    }

    try {
      // Upload qua POST /:id/complete (multipart) - API backend đã chuyển route sang POST
      const formData = new FormData();
      formData.append('image_url', selectedImageFile);
      formData.append('driver_notes', notes);
      // Backend mong đợi image_url, driver_notes trong body
      await api.postForm(`/orders/${orderId}/complete`, formData);

      // Dọn tracking
      socketService.stopLocationSharing();
      socketService.leaveOrderRoom(Number(orderId));
      AppState.trackingOrder = null;

      showToast('🎉 Hoàn thành đơn hàng!', 'success');
      await loadOrders();
      renderTrackingCard();
      showScreen('screen-home');
      switchTab('orders');
    } catch (err) {
      console.error(err);
      showToast('Lỗi khi tải minh chứng: ' + (err.message || ''), 'error');
    } finally {
      const submitBtn = $('btn-submit-proof');
      if (submitBtn) {
        submitBtn.disabled = false;
        const bt = submitBtn.querySelector('.btn-text');
        const bl = submitBtn.querySelector('.btn-loader');
        if (bt) bt.textContent = '✓ Hoàn Thành & Đóng Đơn';
        if (bl) bl.classList.add('hidden');
      }
    }
  } else {
    // Báo thất bại
    const reason = prompt('Nhập lý do thất bại (ví dụ: Khách không liên lạc được, hẹn hôm sau...):');
    if (reason === null) return;
    if (!reason.trim()) {
      showToast('Vui lòng nhập lý do!', 'warning');
      return;
    }
    try {
      await api.patch(`/orders/${orderId}/status`, { status: ORDER_STATUS.FAILED, reason: reason.trim() });
      socketService.stopLocationSharing();
      socketService.leaveOrderRoom(Number(orderId));
      AppState.trackingOrder = null;
      showToast('Đã báo cáo giao thất bại', 'info');
      await loadOrders();
      renderTrackingCard();
      showScreen('screen-home');
      switchTab('orders');
    } catch (err) {
      showToast('Lỗi cập nhật: ' + (err.message || ''), 'error');
    }
  }
}

// =============================================================================
// MAP (Leaflet + OSRM)
// =============================================================================
const DEFAULT_CENTER = [10.762622, 106.660172];

function ensureMap() {
  const container = $('tab-map-container');
  if (!container) return null;
  if (AppState.map && AppState.mapInitialised) return AppState.map;

  if (AppState.map) {
    AppState.map.remove();
    AppState.map = null;
  }

  AppState.map = L.map(container, {
    center: DEFAULT_CENTER,
    zoom: 14,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(AppState.map);

  AppState.mapInitialised = true;
  return AppState.map;
}

function resizeMap() {
  if (AppState.map) setTimeout(() => AppState.map.invalidateSize(), 200);
}

function destroyMap() {
  if (AppState.watchId !== null) {
    navigator.geolocation?.clearWatch(AppState.watchId);
    AppState.watchId = null;
  }
  clearOrderLayers();
  if (AppState.driverMarker && AppState.map) {
    AppState.map.removeLayer(AppState.driverMarker);
  }
  AppState.driverMarker = null;

  if (AppState.map) {
    AppState.map.remove();
    AppState.map = null;
    AppState.mapInitialised = false;
  }
}

/**
 * Xóa sạch tất cả marker đích, polyline lộ trình, marker kho.
 * Gọi trước khi vẽ lộ trình cho một đơn hàng khác để tránh cộng dồn.
 */
function clearOrderLayers() {
  if (!AppState.map) return;
  AppState.destMarkers.forEach((m) => {
    try { AppState.map.removeLayer(m); } catch {}
  });
  AppState.routeLayers.forEach((l) => {
    try { AppState.map.removeLayer(l); } catch {}
  });
  AppState.pickupMarkers.forEach((m) => {
    try { AppState.map.removeLayer(m); } catch {}
  });
  AppState.destMarkers = [];
  AppState.routeLayers = [];
  AppState.pickupMarkers = [];
}

function makeDriverIcon() {
  return L.divIcon({
    className: 'custom-marker driver-marker',
    html: `<div class="driver-marker-wrapper">🛵</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

function makePickupIcon() {
  return L.divIcon({
    className: 'custom-marker pickup-marker',
    html: `<div class="custom-marker-pickup">🏪</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function makeDestIcon() {
  return L.divIcon({
    className: 'custom-marker dest-marker',
    html: `<div class="custom-marker-dest">📍</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function setDriverMarker(latlng) {
  if (!AppState.map) return;
  if (AppState.driverMarker) {
    AppState.driverMarker.setLatLng(latlng);
  } else {
    AppState.driverMarker = L.marker(latlng, { icon: makeDriverIcon(), zIndexOffset: 1000 })
      .addTo(AppState.map)
      .bindPopup('<b>Vị trí hiện tại của bạn</b>');
  }
  AppState.lastDriverLatLng = latlng;
}

function addDestMarker(latlng, label = 'Điểm giao') {
  if (!AppState.map) return null;
  const marker = L.marker(latlng, { icon: makeDestIcon() })
    .addTo(AppState.map)
    .bindPopup(`<b>${label}</b>`);
  marker.openPopup();
  AppState.destMarkers.push(marker);
  return marker;
}

function addPickupMarker(latlng, label = 'Kho hàng') {
  if (!AppState.map) return null;
  const marker = L.marker(latlng, { icon: makePickupIcon() })
    .addTo(AppState.map)
    .bindPopup(`<b>${label}</b>`);
  AppState.pickupMarkers.push(marker);
  return marker;
}

async function drawRoute(fromLatLng, toLatLng) {
  if (!AppState.map) return null;

  const url = `https://router.project-osrm.org/route/v1/driving/${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);

    const polyline = L.polyline(coords, {
      color: '#10b981',
      weight: 6,
      opacity: .85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(AppState.map);

    AppState.routeLayers.push(polyline);

    AppState.map.fitBounds(polyline.getBounds(), { padding: [60, 60] });

    return {
      distanceKm: (route.distance / 1000).toFixed(1),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      bounds: polyline.getBounds()
    };
  } catch (e) {
    console.error('OSRM error:', e);
    return null;
  }
}

async function renderRouteForOrder(order) {
  if (!order) return;
  const map = ensureMap();
  if (!map) return;

  // Vị trí khách (đích)
  const custLat = Number(order.latitude);
  const custLng = Number(order.longitude);
  if (!Number.isFinite(custLat) || !Number.isFinite(custLng)) {
    showToast('Đơn hàng chưa có tọa độ khách hàng', 'warning');
    return;
  }
  const customerLatLng = [custLat, custLng];

  // QUAN TRỌNG: Cleanup mọi marker/polyline của đơn cũ trước khi vẽ đơn mới
  // để tránh hiển thị cộng dồn giữa nhiều đơn.
  clearOrderLayers();

  // Đặt marker đích = khách hàng (đơn hiện tại)
  addDestMarker(customerLatLng, `<b>Khách:</b> ${escapeHtml(order.customer_name || '')}<br/><small>#ORD-${order.id}</small>`);

  // Lấy vị trí tài xế hiện tại
  if (!navigator.geolocation) {
    showToast('Thiết bị không hỗ trợ định vị GPS', 'error');
    map.setView(customerLatLng, 14);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const driverLatLng = [pos.coords.latitude, pos.coords.longitude];
      setDriverMarker(driverLatLng);

      const eta = await drawRoute(driverLatLng, customerLatLng);
      if (eta) {
        $('eta-distance').textContent = `${eta.distanceKm} km`;
        $('eta-duration').textContent = `${eta.durationMin} phút`;
      } else {
        $('eta-distance').textContent = '--';
        $('eta-duration').textContent = '--';
      }

      // Bắt đầu theo dõi vị trí liên tục
      startWatchDriver();
    },
    (err) => {
      console.warn('Geolocation error:', err);
      // Fallback: chỉ đặt marker khách và zoom vào đó
      map.setView(customerLatLng, 13);
      showToast('Không lấy được vị trí - ' + (err.message || ''), 'warning');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function startWatchDriver() {
  if (AppState.watchId !== null) return;
  if (!navigator.geolocation) return;

  AppState.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      setDriverMarker(ll);
      // Realtime send location
      if (AppState.trackingOrder && (AppState.trackingOrder.status === 'pickup' || AppState.trackingOrder.status === 'delivering')) {
        api.post(`/orders/${AppState.trackingOrder.id}/locations`, { lat: ll[0], lng: ll[1] }).catch(() => {});
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

/**
 * Định vị lại vị trí hiện tại của tài xế trên bản đồ.
 * @param {boolean} onlyIfNoMarker - Nếu true, chỉ chạy khi chưa có marker tài xế
 */
function locateDriverOnMap(onlyIfNoMarker = false) {
  const map = ensureMap();
  if (!map || !navigator.geolocation) return;

  if (onlyIfNoMarker && AppState.driverMarker) {
    // Có marker rồi thì panTo đến đó luôn
    map.flyTo(AppState.driverMarker.getLatLng(), 16, { animate: true, duration: 0.6 });
    return;
  }

  const fab = $('btn-locate-driver');
  if (fab) fab.classList.add('is-loading');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      setDriverMarker(ll);
      map.flyTo(ll, 16, { animate: true, duration: 0.6 });
      if (fab) fab.classList.remove('is-loading');
    },
    (err) => {
      if (fab) fab.classList.remove('is-loading');
      showToast('Không lấy được vị trí: ' + (err.message || ''), 'warning');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// =============================================================================
// NEW ORDER MODAL
// =============================================================================
function showNewOrderModal(order) {
  const overlay = $('modal-new-order');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  const okBtn = $('modal-new-order-ok');
  const cancelBtn = $('modal-new-order-cancel');

  const cleanup = () => {
    overlay.classList.add('hidden');
    okBtn?.removeEventListener('click', handleOk);
    cancelBtn?.removeEventListener('click', handleCancel);
    overlay.removeEventListener('click', handleBg);
  };
  const handleOk = async () => {
    cleanup();
    try {
      await api.patch(`/orders/${order.id}/status`, { status: ORDER_STATUS.PICKUP });
      showToast('Đã tiếp nhận đơn hàng!', 'success');
      socketService.joinOrderRoom(order.id);
      // Tự bật online nếu user chưa chủ động OFF
      if (!AppState.isOnline && !AppState.manualOffline) {
        const tg = $('online-toggle');
        if (tg && !tg.checked) tg.checked = true;
        AppState.isOnline = true;
        updateOnlineUI(true);
        toggleOnlineStatus().catch(() => {});
      }
      socketService.startLocationSharing(order.id);
      // Tải lại danh sách silent để cập nhật order
      await loadOrders({ silent: true, autoTrack: true });
      const found = AppState.orders.find((o) => Number(o.id) === Number(order.id));
      if (found) {
        AppState.trackingOrder = found;
        renderTrackingCard();
        // Chuyển sang tab map để tài xế thấy lộ trình luôn
        switchTab('map');
      }
    } catch (e) {
      showToast('Lỗi tiếp nhận đơn: ' + (e.message || ''), 'error');
    }
  };
  const handleCancel = () => cleanup();
  const handleBg = (e) => { if (e.target === overlay) handleCancel(); };

  okBtn?.addEventListener('click', handleOk);
  cancelBtn?.addEventListener('click', handleCancel);
  overlay.addEventListener('click', handleBg);
}

async function fetchOrderById(id) {
  const found = AppState.orders.find((o) => Number(o.id) === Number(id));
  return found || null;
}

// =============================================================================
// IMAGE UPLOAD HANDLERS
// =============================================================================
function initializeProofUploader() {
  const cameraBox = $('camera-box');
  const fileInput = $('proof-image-input');
  const placeholder = $('capture-placeholder');
  const preview = $('proof-preview');

  if (cameraBox && fileInput) {
    cameraBox.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) {
        selectedImageFile = f;
        if (preview) {
          preview.src = URL.createObjectURL(f);
          preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
      }
    });

    // Drag and drop
    cameraBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      cameraBox.classList.add('drag-over');
    });
    cameraBox.addEventListener('dragleave', () => cameraBox.classList.remove('drag-over'));
    cameraBox.addEventListener('drop', (e) => {
      e.preventDefault();
      cameraBox.classList.remove('drag-over');
      const f = e.dataTransfer.files?.[0];
      if (f) {
        selectedImageFile = f;
        if (preview) {
          preview.src = URL.createObjectURL(f);
          preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
      }
    });
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================
function initializeEventListeners() {
  // ============= Login form
  const loginForm = $('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    });
    loginForm.setAttribute('onsubmit', 'return false;');
  }

  $('login-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const emailInput = document.querySelector('#login-form input[type="email"]');
    const passwordInput = document.querySelector('#login-form input[type="password"]');
    handleLogin(emailInput?.value?.trim() || '', passwordInput?.value || '');
  });

  const emailInput = document.querySelector('#login-form input[type="email"]');
  const passwordInput = document.querySelector('#login-form input[type="password"]');
  emailInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      passwordInput?.focus();
    }
  });
  passwordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogin(emailInput?.value?.trim() || '', passwordInput?.value || '');
    }
  });

  // ============= Online toggle
  $('online-toggle')?.addEventListener('change', toggleOnlineStatus);

  // ============= Refresh orders
  $('refresh-orders')?.addEventListener('click', () => {
    loadOrders();
    showToast('Đang làm mới...', 'info');
  });

  // ============= Bottom nav
  $$('.bottom-nav .nav-item').forEach((item) => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // ============= FAB: Định vị lại vị trí tài xế
  $('btn-locate-driver')?.addEventListener('click', () => {
    ensureMap();
    locateDriverOnMap(false);
  });

  // ============= Logout button
  $('btn-logout')?.addEventListener('click', openLogoutModal);

  // Logout modal
  const logoutOverlay = $('modal-logout');
  $('modal-logout-cancel')?.addEventListener('click', () => logoutOverlay.classList.add('hidden'));
  $('modal-logout-ok')?.addEventListener('click', () => {
    logoutOverlay.classList.add('hidden');
    performLogout();
  });
  logoutOverlay?.addEventListener('click', (e) => {
    if (e.target === logoutOverlay) logoutOverlay.classList.add('hidden');
  });

  // ============= Proof screen
  initializeProofUploader();
  $('btn-back-proof')?.addEventListener('click', () => {
    showScreen('screen-home');
    switchTab('map');
  });
  $('btn-submit-proof')?.addEventListener('click', () => submitProof(true));
  $('btn-fail-proof')?.addEventListener('click', () => submitProof(false));
}

// =============================================================================
// PWA
// =============================================================================
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('✅ [PWA] Service Worker registered');
    } catch (e) {
      console.warn('⚠️ [PWA] SW failed:', e);
    }
  }
}

// =============================================================================
// FORMATTERS
// =============================================================================
function formatCurrency(amount) {
  const n = Number(amount || 0);
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

// =============================================================================
// INIT
// =============================================================================
async function init() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🚀 DRIVER APP - Khởi động...');
  console.log('═══════════════════════════════════════════════════════');

  initializeEventListeners();

  await registerServiceWorker();

  if (checkAuth()) {
    showScreen('screen-home');
  } else {
    showScreen('screen-login');
  }

  console.log('✅ Driver App sẵn sàng hoạt động.');
}

window.addEventListener('DOMContentLoaded', init);

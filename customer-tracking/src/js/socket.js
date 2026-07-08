/**
 * Customer Tracking — Socket.IO Connection
 * Kết nối WebSocket để nhận cập nhật vị trí tài xế real-time
 * Xác thực qua trackingToken (không cần JWT)
 * Hỗ trợ tự động reconnect khi mất kết nối
 */

let socket = null;
let trackingToken = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;

function buildSocketUrl() {
  const protocol = location.protocol === 'https:' ? 'https://' : 'http://';
  // Backend runs on :5000 (or same port as the serving app)
  const port = location.port === '5173' || location.port === '4173'
    ? ':5000'
    : (location.port === '80' || location.port === '443' ? '' : ':' + location.port);
  return protocol + location.hostname + port;
}

function connectTrackingSocket(token, onMessage) {
  if (socket?.connected) return;

  trackingToken = token;
  const socketUrl = buildSocketUrl();

  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    auth: { trackingToken: token },
    reconnection: true,
    reconnectionDelay: BASE_RECONNECT_DELAY,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
  });

  socket.on('connect', () => {
    console.log('[TrackingSocket] Connected:', socket.id);
    reconnectAttempts = 0;
    updateConnectionStatus('online');
    socket.emit('tracking:join', { trackingToken: token });
  });

  socket.on('LOCATION_UPDATE', (data) => {
    console.log('[TrackingSocket] LOCATION_UPDATE:', data);
    onMessage('location', data);
  });

  socket.on('ORDER_STATUS_CHANGED', (data) => {
    console.log('[TrackingSocket] ORDER_STATUS_CHANGED:', data);
    onMessage('status', data);
  });

  socket.on('connect_error', (err) => {
    console.error('[TrackingSocket] Connection error:', err.message);
    reconnectAttempts++;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      updateConnectionStatus('error');
    } else {
      updateConnectionStatus('connecting');
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('[TrackingSocket] Disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server disconnected, attempt manual reconnect
      socket.connect();
    } else {
      updateConnectionStatus('offline');
    }
  });

  socket.on('reconnect_attempt', () => {
    updateConnectionStatus('connecting');
  });

  socket.on('reconnect', () => {
    console.log('[TrackingSocket] Reconnected successfully');
    reconnectAttempts = 0;
    updateConnectionStatus('online');
    socket.emit('tracking:join', { trackingToken: token });
  });

  socket.on('reconnect_failed', () => {
    console.error('[TrackingSocket] Reconnection failed after max attempts');
    updateConnectionStatus('error');
  });
}

function disconnectTrackingSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

function updateConnectionStatus(status) {
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  if (!dot || !text) return;

  const states = {
    online:     { cls: 'online',     label: 'Đã kết nối' },
    offline:    { cls: 'offline',    label: 'Mất kết nối' },
    connecting: { cls: 'connecting', label: 'Đang kết nối...' },
    error:      { cls: 'error',      label: 'Lỗi kết nối' },
  };

  const s = states[status] || states.offline;
  dot.className = `connection-dot ${s.cls}`;
  text.textContent = s.label;
}

window.CustomerTrackingSocket = {
  connectTrackingSocket,
  disconnectTrackingSocket,
};

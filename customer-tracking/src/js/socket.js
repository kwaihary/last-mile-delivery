/**
 * Customer Tracking — Socket.IO Connection
 * Kết nối WebSocket để nhận cập nhật vị trí tài xế real-time
 * Xác thực qua trackingToken (không cần JWT)
 */

let socket = null;
let trackingToken = null;

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
  });

  socket.on('connect', () => {
    console.log('[TrackingSocket] Connected:', socket.id);
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
    updateConnectionStatus('error');
  });

  socket.on('disconnect', (reason) => {
    console.warn('[TrackingSocket] Disconnected:', reason);
    updateConnectionStatus('offline');
  });

  socket.on('reconnect_attempt', () => {
    updateConnectionStatus('connecting');
  });

  socket.on('reconnect', () => {
    updateConnectionStatus('online');
    socket.emit('tracking:join', { trackingToken: token });
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

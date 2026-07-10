/**
 * SOCKET SERVICE
 * Service giao tiếp real-time với Backend qua Socket.IO
 * Hỗ trợ: Chia sẻ vị trí GPS, nhận đơn hàng mới, cập nhật trạng thái
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.PROD ? 'https://last-mile-delivery-vy8z.onrender.com' : 'http://localhost:5000');

// =============================================================================
// STATE
// =============================================================================
let socket = null;
let currentOrderId = null;
let locationWatchId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const LOCATION_UPDATE_INTERVAL = 10000; // 10 seconds
let locationIntervalId = null;
let latestPosition = null;
let hasSentInitialLocation = false;

function sendLatestLocation() {
  if (!latestPosition) return;
  const { latitude: lat, longitude: lng, accuracy, speed, heading } = latestPosition.coords;
  sendLocationUpdate(lat, lng, {
    orderId: currentOrderId,
    accuracy,
    speed,
    heading
  });
}

// =============================================================================
// SOCKET CONNECTION
// =============================================================================
/**
 * Kết nối Socket với callback handlers
 */
export function connectDriverSocket(token, driverId, callbacks = {}) {
  // Return existing socket if connected
  if (socket?.connected) {
    console.log('[Socket] Already connected:', socket.id);
    return socket;
  }

  console.log('[Socket] Connecting to:', SOCKET_URL);

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    auth: { token },
    query: { driverId: String(driverId), type: 'driver' },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    timeout: 20000
  });

  // ── Connection Events ──
  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
    reconnectAttempts = 0;
    callbacks.onConnect?.();
    
    // Re-join order room if we were in one
    if (currentOrderId) {
      joinOrderRoom(currentOrderId);
    }
    
    // Re-start location sharing if online
    if (localStorage.getItem('isOnline') === 'true') {
      startLocationSharing(currentOrderId);
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
    callbacks.onDisconnect?.(reason);
    
    // Check if should reconnect
    if (reason === 'io server disconnect') {
      // Server disconnected, attempt reconnect
      socket.connect();
    }
  });

  socket.on('connect_error', (error) => {
    reconnectAttempts++;
    console.error('[Socket] Connection error:', error.message);
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      callbacks.onError?.(new Error('Không thể kết nối server'));
    } else {
      console.log(`[Socket] Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    }
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
    callbacks.onReconnect?.(attemptNumber);
  });

  socket.on('reconnect_error', (error) => {
    console.error('[Socket] Reconnect error:', error.message);
  });

  // ── Order Events ──
  socket.on('ORDER_ASSIGNED', (data) => {
    console.log('[Socket] New order assigned:', data);
    callbacks.onOrderAssigned?.(data);
  });

  socket.on('ORDER_STATUS_CHANGED', (data) => {
    console.log('[Socket] Order status changed:', data);
    callbacks.onOrderStatusChanged?.(data);
  });

  socket.on('ORDER_CANCELLED', (data) => {
    console.log('[Socket] Order cancelled:', data);
    callbacks.onOrderCancelled?.(data);
  });

  // ── Location Events ──
  socket.on('LOCATION_ACK', (data) => {
    // Server acknowledged location update
    console.debug('[Socket] Location ACK:', data);
  });

  // ── Notification Events ──
  socket.on('NOTIFICATION', (data) => {
    console.log('[Socket] Notification:', data);
    callbacks.onNotification?.(data);
    
    // Show browser notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(data.title || 'Thông báo', {
        body: data.message,
        icon: '/icon-192.svg',
        tag: data.id
      });
    }
  });

  return socket;
}

/**
 * Ngắt kết nối Socket
 */
export function disconnectDriverSocket() {
  stopLocationSharing();
  
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('[Socket] Disconnected');
  }
  
  currentOrderId = null;
  reconnectAttempts = 0;
}

/**
 * Kiểm tra trạng thái kết nối
 */
export function isConnected() {
  return socket?.connected || false;
}

/**
 * Lấy socket instance
 */
export function getSocket() {
  return socket;
}

// =============================================================================
// ORDER ROOMS
// =============================================================================
/**
 * Tham gia room của đơn hàng
 */
export function joinOrderRoom(orderId) {
  if (!socket?.connected) {
    console.warn('[Socket] Cannot join room - not connected');
    return;
  }
  
  // Leave current room if any
  if (currentOrderId && currentOrderId !== orderId) {
    leaveOrderRoom(currentOrderId);
  }
  
  currentOrderId = orderId;
  socket.emit('driver:join-order', { orderId });
  console.log('[Socket] Joined order room:', orderId);
}

/**
 * Rời khỏi room của đơn hàng
 */
export function leaveOrderRoom(orderId) {
  if (!socket?.connected) return;
  
  const targetOrderId = orderId || currentOrderId;
  if (!targetOrderId) return;
  
  socket.emit('driver:leave-order', { orderId: targetOrderId });
  console.log('[Socket] Left order room:', targetOrderId);
  
  if (orderId === currentOrderId) {
    currentOrderId = null;
  }
}

// =============================================================================
// LOCATION SHARING
// =============================================================================
/**
 * Bắt đầu chia sẻ vị trí GPS
 */
export function startLocationSharing(orderId) {
  if (orderId) {
    currentOrderId = orderId;
    localStorage.setItem('currentOrderId', String(orderId));
  }

  if (locationWatchId !== null) {
    console.log('[Location] Already watching, updated order:', currentOrderId || 'none');
    sendLatestLocation();
    return;
  }

  if (!navigator.geolocation) {
    console.error('[Location] Geolocation not supported');
    return;
  }

  console.log('[Location] Starting 10s location loop...');

  // High accuracy for delivery tracking
  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 3000, // Accept cached position up to 3 seconds
    timeout: 10000
  };

  navigator.geolocation.getCurrentPosition(
    (position) => {
      latestPosition = position;
      hasSentInitialLocation = true;
      sendLatestLocation();
    },
    (error) => {
      handleGeolocationError(error);
    },
    geoOptions
  );

  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      latestPosition = position;
      if (!hasSentInitialLocation) {
        hasSentInitialLocation = true;
      }
      sendLatestLocation();
    },
    (error) => {
      handleGeolocationError(error);
    },
    geoOptions
  );

  locationIntervalId = setInterval(sendLatestLocation, LOCATION_UPDATE_INTERVAL);
}

/**
 * Dừng chia sẻ vị trí
 */
export function stopLocationSharing() {
  if (locationWatchId !== null) {
    if (typeof locationWatchId === 'number') {
      navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
    console.log('[Location] Stopped location loop');
  }
  
  if (locationIntervalId !== null) {
    clearInterval(locationIntervalId);
    locationIntervalId = null;
    console.log('[Location] Stopped interval');
  }
  
  latestPosition = null;
  hasSentInitialLocation = false;
  localStorage.removeItem('currentOrderId');
}

/**
 * Gửi cập nhật vị trí lên server
 */
export function sendLocationUpdate(lat, lng, options = {}) {
  if (!socket?.connected) {
    console.warn('[Socket] Cannot send location - not connected');
    return;
  }
  
  const payload = {
    lat,
    lng,
    orderId: options.orderId || currentOrderId,
    accuracy: options.accuracy,
    speed: options.speed,
    heading: options.heading,
    timestamp: Date.now()
  };
  
  socket.emit('driver:share-location', payload);
  console.debug('[Socket] Location sent:', lat.toFixed(5), lng.toFixed(5));
}

/**
 * Gửi vị trí một lần
 */
export function sendSingleLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error('Geolocation not supported'));
  
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        sendLocationUpdate(lat, lng, { orderId: currentOrderId });
        resolve({ lat, lng });
      },
      reject,
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// =============================================================================
// HELPERS
// =============================================================================
function handleGeolocationError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      console.error('[Location] Permission denied');
      break;
    case error.POSITION_UNAVAILABLE:
      console.error('[Location] Position unavailable');
      break;
    case error.TIMEOUT:
      console.error('[Location] Timeout');
      break;
    default:
      console.error('[Location] Unknown error');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================
export default {
  connect: connectDriverSocket,
  disconnect: disconnectDriverSocket,
  isConnected,
  getSocket,
  
  joinOrderRoom,
  leaveOrderRoom,
  
  startLocationSharing,
  stopLocationSharing,
  sendLocationUpdate,
  sendSingleLocation
};

import jwt from 'jsonwebtoken';

export interface SocketAuthPayload {
  userId?: number;
  role?: string;
  trackingToken?: string;
}

export const socketAuthMiddleware = (socket: any, next: any) => {
  // ── Customer tracking: dùng trackingToken (không phải JWT) ──
  const trackingToken =
    socket.handshake.auth?.trackingToken ||
    socket.handshake.query?.trackingToken;

  if (trackingToken) {
    // Khách hàng: xác thực qua trackingToken thay vì JWT
    socket.data.trackingToken = trackingToken;
    return next();
  }

  // ── Dashboard / Tài xế: dùng JWT bình thường ──
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    (socket.handshake.headers?.authorization
      ? socket.handshake.headers.authorization.split(' ')[1]
      : undefined);

  if (!token) {
    return next(new Error('Unauthorized: Missing token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as SocketAuthPayload;
    socket.data.user = decoded;
    next();
  } catch (error) {
    next(new Error('Unauthorized: Invalid token'));
  }
};

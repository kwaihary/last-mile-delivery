import { Server } from 'socket.io';
import redisClient from '../config/redis';

export const initSockets = (io: Server) => {

    io.on('connection', (socket) => {
        const userId = socket.data.user?.id ?? socket.data.user?.userId;
        console.log(`📡 Thiết bị kết nối Gateway thành công: ${socket.id} (user: ${userId || 'anonymous'})`);

        // ── Tài xế gửi vị trí GPS realtime ──
        socket.on('driver:share-location', async (data: { orderId?: number, driverId?: number, lat: number, lng: number, trackingToken?: string }) => {
            const { orderId, lat, lng, trackingToken } = data;
            if (!lat || !lng) return;

            try {
                const currentTimestamp = String(Math.floor(Date.now() / 1000));

                // Lưu vị trí tài xế vào Redis GEO
                const resolvedDriverId = userId;
                if (!resolvedDriverId) return;

                await redisClient.geoadd('drivers:locations', lng, lat, String(resolvedDriverId));

                const activeOrderId = orderId ? String(orderId) : '';
                const currentStatus = orderId ? 'delivering' : 'idle';

                // Lưu trạng thái tài xế
                if (resolvedDriverId) {
                    await redisClient.hset(
                        `driver:status:${resolvedDriverId}`,
                        'current_status', currentStatus,
                        'active_order_id', activeOrderId,
                        'last_ping', currentTimestamp
                    );
                }

                // Lưu lịch sử chuyến đi
                if (orderId) {
                    const locationPayload = JSON.stringify({ lat, lng, t: Number(currentTimestamp) });
                    await redisClient.rpush(`order:route:${orderId}`, locationPayload);
                }

                // Broadcast LOCATION_UPDATE cho tất cả dashboard đang theo dõi
                io.emit('LOCATION_UPDATE', {
                    driverId: resolvedDriverId,
                    lat,
                    lng,
                    status: currentStatus,
                    active_order_id: orderId || null,
                    timestamp: Number(currentTimestamp) * 1000
                });

                // Gửi riêng đến customer đang theo dõi order này (qua room)
                if (trackingToken) {
                    socket.to(`track:${trackingToken}`).emit('LOCATION_UPDATE', {
                        driverId: resolvedDriverId,
                        lat,
                        lng,
                        status: currentStatus,
                        active_order_id: orderId || null,
                        timestamp: Number(currentTimestamp) * 1000
                    });
                }

                // Gửi đến room của order
                if (orderId) {
                    socket.to(`order:${orderId}`).emit('LOCATION_UPDATE', {
                        driverId: resolvedDriverId,
                        lat,
                        lng,
                        status: currentStatus,
                        timestamp: Number(currentTimestamp) * 1000
                    });
                }

            } catch (error) {
                console.error('Lỗi khi ghi dữ liệu vào Redis:', error);
            }
        });

        // ── Tài xế tham gia room của đơn hàng ──
        socket.on('driver:join-order', ({ orderId }) => {
            if (!orderId) return;
            socket.join(`order:${orderId}`);
            console.log(`Tài xế ${userId} tham gia room order:${orderId}`);
        });

        // ── Tài xế rời khỏi room ──
        socket.on('driver:leave-order', ({ orderId }) => {
            if (!orderId) return;
            socket.leave(`order:${orderId}`);
            console.log(`Tài xế ${userId} rời room order:${orderId}`);
        });

        // ── Customer tham gia room theo dõi đơn ──
        socket.on('tracking:join', ({ trackingToken, orderId }) => {
            if (trackingToken) {
                socket.join(`track:${trackingToken}`);
                console.log(`Khách hàng tham gia theo dõi: track:${trackingToken}`);
            }
            if (orderId) {
                socket.join(`order:${orderId}`);
            }
        });

        socket.on('disconnect', () => {
            console.log(`Thiết bị ngắt kết nối: ${socket.id}`);
        });
    });
};

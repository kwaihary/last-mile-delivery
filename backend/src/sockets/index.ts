import { Server } from 'socket.io'
import redisClient from '../config/redis';
export const initSockets = (io: Server) => {
    
    io.on('connection', (socket) => {
        console.log(`📡 Thiết bị kết nối Gateway thành công: ${socket.id}`);

        socket.on('driver:share-location', async (data: { orderId: number, driverId: number, lat: number, lng: number }) => {
            const { orderId, driverId, lat, lng } = data;
            if (!lat || !lng || !driverId) return;

            try {
                const currentTimestamp = String(Math.floor(Date.now() / 1000));

                // Lưu vị trí của tài xế
                await redisClient.geoadd('drivers:locations', lng, lat, String(driverId));

                // Lưu trạng thái của tài xế
                await redisClient.hset(
                    `driver:status:${driverId}`,
                    'current_status', 'delivering',
                    'active_order_id', String(orderId || ''),
                    'last_ping', currentTimestamp
                );

                // Lưu lịch sử chuyến đi
                if (orderId) {
                    const locationPayload = JSON.stringify({ lat, lng, t: Number(currentTimestamp) });
                    await redisClient.rpush(`order:route:${orderId}`, locationPayload);
                }

                console.log(`Tài xế [${driverId}] -> Đơn [${orderId}]: Đã đồng bộ dữ liệu.`);
            } catch (error) {
                console.error('Lỗi khi ghi dữ liệu vào Redis:', error);
            }
        });

        socket.on('disconnect', () => console.log(`Thiết bị ngắt kết nối: ${socket.id}`));
    });
}

// backend/src/controllers/OrderController.ts
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Order } from '../models/Order';
import { DeliveryProof } from '../models/DeliveryProof';
import { RouteHistory } from '../models/RouteHistory';
import redisClient from '../config/redis';
import { sendResponse } from '../utils/responseHelper';
import crypto from 'crypto';

const orderRepo = AppDataSource.getRepository(Order);
const proofRepo = AppDataSource.getRepository(DeliveryProof);
const routeRepo = AppDataSource.getRepository(RouteHistory);

// Hàm tính khoảng cách giữa 2 tọa độ theo công thức Haversine (Đơn vị: km)
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Bán kính Trái Đất tính bằng km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Hàm tính tổng quãng đường của một mảng tọa độ thu thập từ Redis
function calculateTotalRouteDistance(routes: Array<{ lat: number, lng: number, t: number }>): number {
    if (!routes || routes.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 0; i < routes.length - 1; i++) {
        const currentPoint = routes[i];
        const nextPoint = routes[i + 1];

        if (currentPoint && nextPoint) {
            totalDistance += calculateHaversineDistance(
                currentPoint.lat, currentPoint.lng,
                nextPoint.lat, nextPoint.lng
            );
        }
    }

    // Trả về số km
    return parseFloat(totalDistance.toFixed(2));
}


export class OrderController {
    // Dùng POST /api/orders (Tạo đơn hàng)
    static async createOrder(req: any, res: Response) {
        try {
            const manager_id = req.user.id;
            const { customer_name, customer_phone, address, latitude, longitude, ship_cod, order_notes } = req.body;

            const newOrder = orderRepo.create({
                manager_id,
                customer_name,
                customer_phone,
                address,
                latitude,
                longitude,
                ship_cod,
                order_notes,
                status: 'pending',
                tracking_token: crypto.randomBytes(16).toString('hex')
            });

            const savedOrder = await orderRepo.save(newOrder);
            return sendResponse(res, 201, { id: savedOrder.id }, "Tạo đơn hàng thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders (Xem tất cả đơn hàng)
    static async getAllOrders(req: Request, res: Response) {
        try {
            const orders = await orderRepo.find({ relations: { 'manager': true, 'driver': true } });
            return sendResponse(res, 200, orders);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng PATCH /api/orders/:id/assign (Điều phối viên gán đơn)
    static async assignOrder(req: Request, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const { driver_id } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404, null, '', "Không tìm thấy đơn hàng");

            order.driver_id = driver_id;
            order.status = 'pickup';
            order.assigned_at = new Date();
            await orderRepo.save(order);

            // Lưu trạng thái tài xế vào Redis
            await redisClient.hset(`driver:status:${driver_id}`,
                'current_status', 'delivering',
                'active_order_id', String(orderId)
            );

            return sendResponse(res, 200, order, "Gán đơn thành công. Trạng thái: pickup");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng PATCH /api/orders/:id/status (Tài xế cập nhật trạng thái)
    static async updateOrderStatus(req: any, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const { status } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404);

            order.status = status;

            if (status === 'delivering') {
                order.started_at = new Date();
            }

            await orderRepo.save(order);
            return sendResponse(res, 200, order, `Cập nhật trạng thái thành ${status}`);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng POST /api/orders/:id/complete
    static async completeOrder(req: any, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const driverId = req.user.id;
            const { image_url, driver_notes, status } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404);

            // Lưu Minh chứng giao hàng vào Postgres
            const newProof = proofRepo.create({ order_id: orderId, image_url, driver_notes });
            await proofRepo.save(newProof);

            // Chuyển Lộ trình từ Redis sang PostgreSQL
            const routesFromRedis = await redisClient.lrange(`order:route:${orderId}`, 0, -1);
            if (routesFromRedis.length > 0) {
                const parsedRoutes = routesFromRedis.map(r => JSON.parse(r));

                const actualDistance = calculateTotalRouteDistance(parsedRoutes);

                const newRoute = routeRepo.create({
                    order_id: orderId,
                    driver_id: driverId,
                    coordinates_path: parsedRoutes,
                    total_distance: actualDistance
                });
                await routeRepo.save(newRoute);

                // Dọn RAM Redis 
                await redisClient.del(`order:route:${orderId}`);
            }

            // Giải phóng trạng thái tài xế về idle (Rảnh) trong Redis HASH
            await redisClient.hset(`driver:status:${driverId}`,
                'current_status', 'idle',
                'active_order_id', ''
            );

            // Xóa tài xế khỏi danh sách định vị GEO nếu đơn hàng kết thúc
            await redisClient.zrem('drivers:locations', String(driverId));

            // Cập nhật thời điểm hoàn thành đơn hàng 
            order.status = status;
            order.complete_at = new Date();
            await orderRepo.save(order);

            return sendResponse(res, 200, null, "Hoàn tất luồng đơn hàng chặng cuối thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng POST /api/orders/:id/locations
    static async updateLocation(req: any, res: Response) {
        try {
            const orderId = req.params.id;
            const driverId = req.user.id;
            const { lat, lng } = req.body;

            // Lưu vào mảng LIST để vẽ lộ trình 
            const locationData = JSON.stringify({ lat, lng, t: Math.floor(Date.now() / 1000) });
            await redisClient.rpush(`order:route:${orderId}`, locationData);

            // Lưu vào GEO để tra cứu vị trí tức thời trên Live Map 
            await redisClient.geoadd('drivers:locations', lng, lat, driverId.toString());

            await redisClient.hset(`driver:status:${driverId}`,
                'current_status', 'busy',
                'last_ping', String(Math.floor(Date.now() / 1000))
            );

            return sendResponse(res, 200, null, "Đã cập nhật tọa độ GPS vào Redis");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders/:id/route ( Khách hàng tra cứu lộ trình )
    static async getRouteTracking(req: Request, res: Response) {
        try {
            const orderId = req.params.id;

            // Lấy toàn bộ danh sách tọa độ của đơn hàng đang chạy trong Redis
            const routes = await redisClient.lrange(`order:route:${orderId}`, 0, -1);

            // Giải mã chuỗi JSON thành mảng Object tọa độ thực tế
            const parsedRoutes = routes.map(route => JSON.parse(route));

            return sendResponse(res, 200, parsedRoutes);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}

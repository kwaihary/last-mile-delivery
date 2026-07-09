// backend/src/controllers/OrderController.ts
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Order } from '../models/Order';
import { DeliveryProof } from '../models/DeliveryProof';
import { RouteHistory } from '../models/RouteHistory';
import redisClient from '../config/redis';
import { sendResponse } from '../utils/responseHelper';
import { sendTrackingSms } from '../services/twilio';
import crypto from 'crypto';

const orderRepo = AppDataSource.getRepository(Order);
const proofRepo = AppDataSource.getRepository(DeliveryProof);
const routeRepo = AppDataSource.getRepository(RouteHistory);

// Hàm tính khoảng cách giữa 2 tọa độ theo công thức Haversine ( Đơn vị: km )
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
    // Dùng POST /api/orders ( Tạo đơn hàng )
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
            return sendResponse(res, 201, { id: savedOrder.id, tracking_token: savedOrder.tracking_token }, "Tạo đơn hàng thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders ( Xem tất cả đơn hàng - Manager only )
    static async getAllOrders(req: Request, res: Response) {
        try {
            const orders = await orderRepo.find({ relations: { 'manager': true, 'driver': true } });
            return sendResponse(res, 200, orders);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/drivers/orders ( Tài xế xem đơn của mình )
    static async getMyOrders(req: any, res: Response) {
        try {
            const driverId = Number(req.user.id);
            const orders = await orderRepo.find({
                where: { driver_id: driverId },
                relations: { 'manager': true, 'driver': true },
                order: { created_at: 'DESC' }
            });
            return sendResponse(res, 200, orders);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng PATCH /api/orders/:id/assign ( Điều phối viên gán đơn )
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

            // Thông báo realtime cho tài xế qua Socket
            try {
                const io = (global as any).io;
                if (io) {
                    io.emit('ORDER_ASSIGNED', {
                        orderId: order.id,
                        status: 'pickup',
                        address: order.address,
                        customer_name: order.customer_name,
                        customer_phone: order.customer_phone,
                        ship_cod: order.ship_cod
                    });
                }
            } catch {}

            return sendResponse(res, 200, order, "Gán đơn thành công. Trạng thái: pickup");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng PATCH /api/orders/:id/status ( Tài xế cập nhật trạng thái )
    static async updateOrderStatus(req: any, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const driverId = req.user.id;
            const { status } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404, null, '', "Không tìm thấy đơn hàng");

            // Kiểm tra tài xế có phải người nhận đơn không
            if (order.driver_id !== driverId) {
                return sendResponse(res, 403, null, '', "Bạn không có quyền thao tác đơn hàng này");
            }

            // Validate trạng thái hợp lệ
            if (order.status === 'pickup' && !['delivering', 'failed'].includes(status)) {
                return sendResponse(res, 400, null, '', `Không thể chuyển từ "${order.status}" sang "${status}"`);
            }
            if (order.status === 'delivering' && !['completed', 'failed'].includes(status)) {
                return sendResponse(res, 400, null, '', `Không thể chuyển từ "${order.status}" sang "${status}"`);
            }
            if (!['pickup', 'delivering'].includes(order.status)) {
                return sendResponse(res, 400, null, '', `Không thể cập nhật trạng thái từ "${order.status}"`);
            }

            const previousStatus = order.status;
            order.status = status;

            if (status === 'delivering') {
                order.started_at = new Date();
            }

            const savedOrder = await orderRepo.save(order);

            // Gửi SMS khi bắt đầu giao hàng (pickup → delivering)
            if (status === 'delivering' && previousStatus === 'pickup') {
                const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
                const trackingUrl = `${publicBaseUrl}/track/${order.tracking_token}`;

                console.log(`[SMS] Gửi tracking URL đến khách hàng cho đơn #${order.id}:`);
                console.log(`  → SĐT: ${order.customer_phone}`);
                console.log(`  → URL: ${trackingUrl}`);

                if (!order.customer_phone) {
                    console.warn(`[SMS] Bỏ qua — đơn #${order.id} không có số điện thoại khách hàng`);
                } else if (!order.tracking_token) {
                    console.warn(`[SMS] Bỏ qua — đơn #${order.id} không có tracking_token`);
                } else {
                    sendTrackingSms(order.customer_phone, trackingUrl, order.id).catch((smsError) => {
                        console.error(`[SMS] Gửi SMS thất bại cho đơn #${order.id}:`, smsError.message);
                    });
                }
            }

            // Thông báo realtime cho khách hàng đang theo dõi
            try {
                const io = (global as any).io;
                if (io) {
                    io.emit('ORDER_STATUS_CHANGED', {
                        orderId: order.id,
                        trackingToken: order.tracking_token,
                        status: order.status,
                        previousStatus
                    });
                }
            } catch {}

            return sendResponse(res, 200, savedOrder, `Cập nhật trạng thái thành ${status}`);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng POST /api/orders/:id/complete
    static async completeOrder(req: any, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const driverId = req.user.id;
            const { image_url, driver_notes } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404, null, '', "Không tìm thấy đơn hàng");

            // Kiểm tra tài xế có phải người nhận đơn này không
            if (order.driver_id !== driverId) {
                return sendResponse(res, 403, null, '', "Bạn không có quyền thao tác đơn hàng này");
            }

            // Chỉ cho phép hoàn thành khi đang ở trạng thái 'delivering'
            if (!['delivering'].includes(order.status)) {
                return sendResponse(res, 400, null, '', `Không thể hoàn thành đơn ở trạng thái "${order.status}"`);
            }

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

            // Trạng thái tài xế về idle (Rảnh) trong Redis
            await redisClient.hset(`driver:status:${driverId}`,
                'current_status', 'idle',
                'active_order_id', ''
            );

            // Xóa tài xế khỏi danh sách định vị GEO
            await redisClient.zrem('drivers:locations', String(driverId));

            // Cập nhật trạng thái đơn hàng — luôn là 'completed'
            order.status = 'completed';
            order.complete_at = new Date();
            await orderRepo.save(order);

            // Thông báo realtime cho khách hàng
            try {
                const io = (global as any).io;
                if (io) {
                    io.emit('ORDER_STATUS_CHANGED', {
                        orderId: order.id,
                        trackingToken: order.tracking_token,
                        status: order.status,
                        previousStatus: 'delivering'
                    });
                }
            } catch {}

            return sendResponse(res, 200, null, "Hoàn tất luồng đơn hàng chặng cuối thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng POST /api/orders/:id/locations
    static async updateLocation(req: any, res: Response) {
        try {
            const orderId = req.params.id;
            const driverId = req.user.id; // Đã xác thực qua verifyToken middleware
            const { lat, lng } = req.body;

            // Lưu vào mảng LIST để vẽ lộ trình 
            const locationData = JSON.stringify({ lat, lng, t: Math.floor(Date.now() / 1000) });
            await redisClient.rpush(`order:route:${orderId}`, locationData);

            // Lưu vào GEO để tra cứu vị trí tức thời trên Live Map 
            await redisClient.geoadd('drivers:locations', lng, lat, driverId.toString());

            await redisClient.hset(`driver:status:${driverId}`,
                'current_status', 'delivering',
                'last_ping', String(Math.floor(Date.now() / 1000))
            );

            return sendResponse(res, 200, null, "Đã cập nhật tọa độ GPS vào Redis");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders/track/:token ( Khách hàng cuối theo dõi đơn )
    static async trackOrderByToken(req: Request, res: Response) {
        try {
            const token = req.params.token as string;

            const order = await orderRepo.findOne({ where: { tracking_token: token }, relations: { manager: true, driver: true } });
            if (!order) {
                return sendResponse(res, 404, null, '', 'Không tìm thấy đơn hàng');
            }

            const latestLocation = order.id ? await redisClient.geopos('drivers:locations', String(order.driver_id || '')).then((pos) => pos?.[0]) : null;

            const routeRaw = order.id ? await redisClient.lrange(`order:route:${order.id}`, -5, -1) : [];
            const route = routeRaw.map((item) => JSON.parse(item));

            const data = {
                id: order.id,
                status: order.status,
                customer_name: order.customer_name,
                address: order.address,
                driver: order.driver
                    ? {
                        id: order.driver.id,
                        full_name: order.driver.full_name,
                        driver_profile: order.driver.driver_profile
                            ? {
                                vehicle_type: (order.driver.driver_profile as any).vehicle_type,
                                license_plate: (order.driver.driver_profile as any).license_plate
                            }
                            : null
                    }
                    : null,
                route,
                latitude: latestLocation ? Number(latestLocation[1]) : Number(order.latitude),
                longitude: latestLocation ? Number(latestLocation[0]) : Number(order.longitude),
                remaining_distance_meters: order.status === 'delivering' && route.length > 1 ? Number((route[route.length - 1]?.remaining_distance_meters ?? 0) || 0) : null,
                started_at: order.started_at,
                created_at: order.created_at
            };

            return sendResponse(res, 200, data);
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

            // Giải mã chuỗi JSON thành mảng Object tọa độ
            const parsedRoutes = routes.map(route => JSON.parse(route));

            return sendResponse(res, 200, parsedRoutes);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}

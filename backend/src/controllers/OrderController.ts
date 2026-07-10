// backend/src/controllers/OrderController.ts
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Order } from '../models/Order';
import { DeliveryProof } from '../models/DeliveryProof';
import { RouteHistory } from '../models/RouteHistory';
import { User } from '../models/User';
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
                        id: order.id,
                        driver_id,
                        status: 'pickup',
                        address: order.address,
                        latitude: order.latitude,
                        longitude: order.longitude,
                        customer_name: order.customer_name,
                        customer_phone: order.customer_phone,
                        ship_cod: order.ship_cod,
                        order_notes: order.order_notes
                    });
                }
            } catch { }

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
            const { status, reason, driver_notes, image_url } = req.body;

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

            if (status === 'failed') {
                const failureReason = String(reason || driver_notes || '').trim();
                if (!failureReason) {
                    return sendResponse(res, 400, null, '', "Vui lòng nhập lý do giao thất bại");
                }
                order.complete_at = new Date();

                const existingProof = await proofRepo.findOneBy({ order_id: orderId });
                if (!existingProof) {
                    const failureProof = proofRepo.create({
                        order_id: orderId,
                        driver_id: driverId,
                        image_url: image_url || 'FAILED_DELIVERY_NO_IMAGE',
                        driver_notes: failureReason
                    });
                    await proofRepo.save(failureProof);
                }
            }

            const savedOrder = await orderRepo.save(order);

            if (status === 'failed') {
                await redisClient.hset(`driver:status:${driverId}`,
                    'current_status', 'idle',
                    'active_order_id', ''
                );
            }

            // Gửi SMS khi bắt đầu giao hàng (pickup → delivering)
            if (status === 'delivering' && previousStatus === 'pickup') {
                const publicBaseUrl = process.env.PUBLIC_CUSTOMER_TRACKING;
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
            } catch { }

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
            // Nhận image_url dạng base64 string hoặc URL từ req.body (JSON)
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

            if (!image_url) {
                return sendResponse(res, 400, null, '', "Vui lòng cung cấp ảnh minh chứng");
            }

            // Lưu Minh chứng giao hàng vào Postgres (bao gồm driver_id)
            const newProof = proofRepo.create({ order_id: orderId, driver_id: driverId, image_url, driver_notes: driver_notes || '' });
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
            } catch { }

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

            const order = await orderRepo.findOne({ where: { tracking_token: token }, relations: { manager: true, driver: { driver_profile: true } } });
            if (!order) {
                return sendResponse(res, 404, null, '', 'Không tìm thấy đơn hàng');
            }

            const latestLocation = order.id && order.driver_id
                ? await redisClient.geopos('drivers:locations', String(order.driver_id)).then((pos) => pos?.[0])
                : null;

            // Lấy FULL lộ trình từ Redis (tất cả các tọa độ)
            const routeRaw = order.id ? await redisClient.lrange(`order:route:${order.id}`, 0, -1) : [];
            const route = routeRaw.map((item) => JSON.parse(item));

            // Nếu đơn đã hoàn thành, lấy lộ trình từ route_histories
            let finalRoute = route;
            if (order.status === 'completed' || order.status === 'failed') {
                const routeHistory = await routeRepo.find({ where: { order_id: order.id } });
                const firstHistory = routeHistory[0];
                if (firstHistory && firstHistory.coordinates_path) {
                    finalRoute = firstHistory.coordinates_path;
                }
            }

            // Tính quãng đường đã đi
            const traveledDistance = calculateTotalRouteDistance(route);

            const data = {
                id: order.id,
                status: order.status,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                address: order.address,
                latitude: order.latitude,
                longitude: order.longitude,
                driver: order.driver
                    ? {
                        id: order.driver.id,
                        full_name: order.driver.full_name,
                        phone: order.driver.phone,
                        driver_profile: order.driver.driver_profile
                            ? {
                                vehicle_type: (order.driver.driver_profile as any).vehicle_type,
                                license_plate: (order.driver.driver_profile as any).license_plate
                            }
                            : null
                    }
                    : null,
                route: finalRoute,
                current_lat: latestLocation ? Number(latestLocation[1]) : null,
                current_lng: latestLocation ? Number(latestLocation[0]) : null,
                traveled_distance_km: traveledDistance,
                created_at: order.created_at,
                assigned_at: order.assigned_at,
                started_at: order.started_at,
                complete_at: order.complete_at
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

    // Dùng PATCH /api/orders/:id/cancel ( Manager hủy đơn hàng )
    static async cancelOrder(req: any, res: Response) {
        try {
            const orderId = Number(req.params.id);
            const managerId = req.user.id;
            const { cancel_reason } = req.body;

            let order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404, null, '', "Không tìm thấy đơn hàng");

            // Chỉ manager mới được hủy đơn
            if (order.manager_id !== managerId) {
                return sendResponse(res, 403, null, '', "Bạn không có quyền hủy đơn hàng này");
            }

            // Chỉ hủy được đơn ở trạng thái pending, pickup, hoặc delivering
            if (!['pending', 'pickup', 'delivering'].includes(order.status)) {
                return sendResponse(res, 400, null, '', `Không thể hủy đơn ở trạng thái "${order.status}"`);
            }

            const previousStatus = order.status;
            order.status = 'canceled';
            order.order_notes = order.order_notes
                ? `${order.order_notes}\n[LÝ DO HỦY]: ${cancel_reason || 'Không có lý do'}`
                : `[LÝ DO HỦY]: ${cancel_reason || 'Không có lý do'}`;
            order.complete_at = new Date();

            // Nếu đơn đã được gán cho tài xế, cập nhật lại trạng thái tài xế trong Redis
            if (order.driver_id) {
                await redisClient.hset(`driver:status:${order.driver_id}`,
                    'current_status', 'idle',
                    'active_order_id', ''
                );
                await redisClient.zrem('drivers:locations', String(order.driver_id));
            }

            await orderRepo.save(order);

            // Thông báo realtime cho tài xế nếu có
            try {
                const io = (global as any).io;
                if (io && order.driver_id) {
                    io.emit('ORDER_CANCELED', {
                        orderId: order.id,
                        trackingToken: order.tracking_token,
                        previousStatus,
                        reason: cancel_reason
                    });
                }
                io.emit('ORDER_STATUS_CHANGED', {
                    orderId: order.id,
                    trackingToken: order.tracking_token,
                    status: 'canceled',
                    previousStatus
                });
            } catch { }

            return sendResponse(res, 200, order, "Đơn hàng đã được hủy thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders/:id/route-history ( Lấy lịch sử lộ trình đã hoàn thành )
    static async getRouteHistory(req: Request, res: Response) {
        try {
            const orderId = Number(req.params.id);

            const order = await orderRepo.findOneBy({ id: orderId });
            if (!order) return sendResponse(res, 404, null, '', "Không tìm thấy đơn hàng");

            // Lấy từ route_histories table
            const routeHistory = await routeRepo.find({
                where: { order_id: orderId },
                relations: { driver: true }
            });

            return sendResponse(res, 200, routeHistory);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders/stats ( Thống kê đơn hàng cho Manager )
    static async getOrderStats(req: any, res: Response) {
        try {
            const { start_date, end_date } = req.query;

            let queryBuilder = orderRepo.createQueryBuilder('order');

            // Filter theo ngày nếu có
            if (start_date) {
                queryBuilder = queryBuilder.andWhere('order.created_at >= :startDate', {
                    startDate: new Date(start_date as string)
                });
            }
            if (end_date) {
                queryBuilder = queryBuilder.andWhere('order.created_at <= :endDate', {
                    endDate: new Date(end_date as string)
                });
            }

            const orders = await queryBuilder.getMany();

            // Tính toán thống kê
            const totalOrders = orders.length;
            const completedOrders = orders.filter(o => o.status === 'completed').length;
            const failedOrders = orders.filter(o => o.status === 'failed').length;
            const canceledOrders = orders.filter(o => o.status === 'canceled').length;
            const pendingOrders = orders.filter(o => o.status === 'pending').length;
            const pickupOrders = orders.filter(o => o.status === 'pickup').length;
            const deliveringOrders = orders.filter(o => o.status === 'delivering').length;

            // Tính tổng COD
            const totalCOD = orders
                .filter(o => o.status === 'completed')
                .reduce((sum, o) => sum + Number(o.ship_cod), 0);

            const successRate = totalOrders > 0
                ? parseFloat(((completedOrders / totalOrders) * 100).toFixed(2))
                : 0;

            // Thống kê theo ngày (7 ngày gần nhất)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const dailyStats: { [key: string]: { total: number, completed: number, revenue: number } } = {};

            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateKey: string = date.toISOString().split('T')[0] ?? '';
                dailyStats[dateKey] = { total: 0, completed: 0, revenue: 0 };
            }

            orders.forEach(order => {
                const dateKey: string = new Date(order.created_at).toISOString().split('T')[0] ?? '';
                const dayStat = dailyStats[dateKey];
                if (dayStat) {
                    dayStat.total++;
                    if (order.status === 'completed') {
                        dayStat.completed++;
                        dayStat.revenue += Number(order.ship_cod);
                    }
                }
            });

            return sendResponse(res, 200, {
                total: totalOrders,
                completed: completedOrders,
                failed: failedOrders,
                canceled: canceledOrders,
                pending: pendingOrders,
                pickup: pickupOrders,
                delivering: deliveringOrders,
                totalCOD,
                successRate,
                dailyStats
            });
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/drivers/stats ( Thống kê tài xế cho Manager )
    static async getDriverStats(req: any, res: Response) {
        try {
            const drivers = await routeRepo
                .createQueryBuilder('route')
                .select('route.driver_id', 'driver_id')
                .addSelect('COUNT(*)', 'totalDeliveries')
                .addSelect('SUM(route.total_distance)', 'totalDistance')
                .groupBy('route.driver_id')
                .getRawMany();

            // Lấy thông tin chi tiết của tài xế
            const driverStats = await Promise.all(
                drivers.map(async (stat) => {
                    const driverRepo = AppDataSource.getRepository(User);
                    const driver = await driverRepo.findOne({
                        where: { id: Number(stat.driver_id) },
                        relations: { driver_profile: true }
                    });

                    return {
                        driver_id: Number(stat.driver_id),
                        driver_name: driver?.full_name || 'Không xác định',
                        vehicle_type: (driver as any)?.driver_profile?.vehicle_type || 'N/A',
                        license_plate: (driver as any)?.driver_profile?.license_plate || 'N/A',
                        total_deliveries: parseInt(stat.totalDeliveries) || 0,
                        total_distance_km: parseFloat(stat.totalDistance || '0').toFixed(2)
                    };
                })
            );

            return sendResponse(res, 200, driverStats);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Dùng GET /api/orders ( có filter - Manager only )
    static async getAllOrdersFiltered(req: any, res: Response) {
        try {
            const { status, search, start_date, end_date, page = 1, limit = 50 } = req.query;

            let queryBuilder = orderRepo
                .createQueryBuilder('order')
                .leftJoinAndSelect('order.manager', 'manager')
                .leftJoinAndSelect('order.driver', 'driver')
                .orderBy('order.created_at', 'DESC');

            // Filter theo trạng thái
            if (status && status !== 'all') {
                queryBuilder = queryBuilder.andWhere('order.status = :status', { status });
            }

            // Filter theo ngày
            if (start_date) {
                queryBuilder = queryBuilder.andWhere('order.created_at >= :startDate', {
                    startDate: new Date(start_date as string)
                });
            }
            if (end_date) {
                queryBuilder = queryBuilder.andWhere('order.created_at <= :endDate', {
                    endDate: new Date(end_date as string)
                });
            }

            // Search theo SĐT hoặc tên khách
            if (search) {
                queryBuilder = queryBuilder.andWhere(
                    '(order.customer_phone LIKE :search OR order.customer_name LIKE :search OR CAST(order.id AS TEXT) LIKE :search)',
                    { search: `%${search}%` }
                );
            }

            // Pagination
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            const [orders, total] = await queryBuilder
                .skip(skip)
                .take(limitNum)
                .getManyAndCount();

            return sendResponse(res, 200, {
                orders,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            });
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}

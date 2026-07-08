import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DriverProfile } from '../models/DriverProfile';
import { RouteHistory } from '../models/RouteHistory';
import { Order } from '../models/Order';
import redisClient from '../config/redis';
import { sendResponse } from '../utils/responseHelper';

const profileRepo = AppDataSource.getRepository(DriverProfile);
const routeRepo = AppDataSource.getRepository(RouteHistory);
const orderRepo = AppDataSource.getRepository(Order);

export class DriverController {
    // PATCH /api/drivers/status
    static async toggleOnlineStatus(req: any, res: Response) {
        try {
            const driverId = req.user.id;
            const { is_online } = req.body;

            let profile = await profileRepo.findOneBy({ driver_id: driverId });
            if (!profile) return sendResponse(res, 404, null, '', "Không tìm thấy hồ sơ tài xế");

            // Cập nhật vào PostgreSQL 
            profile.is_online = is_online;
            await profileRepo.save(profile);

            // Cập nhật trạng thái vào Redis HASH để điều phối viên thấy ngay lập tức 
            if (is_online) {
                await redisClient.hset(`driver:status:${driverId}`, {
                    current_status: 'idle',
                    last_ping: Date.now()
                });
            } else {
                // Xóa khỏi Redis nếu offline để dọn dẹp
                await redisClient.del(`driver:status:${driverId}`);
                await redisClient.zrem('drivers:locations', driverId.toString()); // Xóa tọa độ khỏi Map
            }

            try {
                const io = (global as any).io;
                if (io) {
                    io.emit('DRIVER_STATUS_UPDATE', {
                        driverId,
                        status: is_online ? 'idle' : 'offline',
                        is_online,
                        active_order_id: null
                    });
                }
            } catch (error) {
                console.error('Lỗi khi phát tín hiệu trạng thái tài xế:', error);
            }

            return sendResponse(res, 200, { is_online }, "Đã thay đổi trạng thái hoạt động");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // GET /api/drivers/stats (thống kê của tài xế hiện tại)
    static async getMyStats(req: any, res: Response) {
        try {
            const driverId = req.user.id;

            // Lấy tổng số đơn đã giao thành công
            const completedOrders = await orderRepo.count({
                where: { driver_id: driverId, status: 'completed' }
            });

            // Lấy tổng số đơn thất bại
            const failedOrders = await orderRepo.count({
                where: { driver_id: driverId, status: 'failed' }
            });

            // Lấy tổng quãng đường đã chạy
            const routeStats = await routeRepo
                .createQueryBuilder('route')
                .select('SUM(route.total_distance)', 'totalDistance')
                .addSelect('COUNT(*)', 'totalRoutes')
                .where('route.driver_id = :driverId', { driverId })
                .getRawOne();

            return sendResponse(res, 200, {
                completed_orders: completedOrders,
                failed_orders: failedOrders,
                total_distance_km: parseFloat(routeStats?.totalDistance || '0').toFixed(2),
                total_deliveries: parseInt(routeStats?.totalRoutes || '0')
            });
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // GET /api/drivers/history (lịch sử giao hàng của tài xế hiện tại)
    static async getMyHistory(req: any, res: Response) {
        try {
            const driverId = req.user.id;
            const { page = 1, limit = 20 } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            const [orders, total] = await orderRepo.findAndCount({
                where: { driver_id: driverId, status: 'completed' },
                relations: { route_histories: true },
                order: { complete_at: 'DESC' },
                skip,
                take: limitNum
            });

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

    // GET /api/users/drivers/stats (thống kê tất cả tài xế - cho manager)
    static async getAllDriversStats(req: any, res: Response) {
        try {
            // Lấy tất cả driver profiles kèm user info
            // DriverProfile.user (không phải .driver) vì JoinColumn là 'driver_id' → User
            const allDrivers = await profileRepo
                .createQueryBuilder('profile')
                .leftJoinAndSelect('profile.user', 'user')
                .getMany();

            const statsPromises = allDrivers.map(async (profile) => {
                const driverId = profile.driver_id;

                // Lấy tổng số đơn đã giao thành công
                const completedOrders = await orderRepo.count({
                    where: { driver_id: driverId, status: 'completed' }
                });

                // Lấy tổng quãng đường
                const routeStats = await routeRepo
                    .createQueryBuilder('route')
                    .select('SUM(route.total_distance)', 'totalDistance')
                    .where('route.driver_id = :driverId', { driverId })
                    .getRawOne();

                return {
                    driver_id: driverId,
                    driver_name: profile.user?.full_name || `Tài xế #${driverId}`,
                    vehicle_type: profile.vehicle_type || 'Không xác định',
                    license_plate: profile.license_plate || 'N/A',
                    total_deliveries: completedOrders,
                    total_distance_km: parseFloat(routeStats?.totalDistance || '0').toFixed(2)
                };
            });

            const stats = await Promise.all(statsPromises);

            // Sắp xếp theo số đơn giảm dần
            stats.sort((a, b) => b.total_deliveries - a.total_deliveries);

            return sendResponse(res, 200, stats);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}
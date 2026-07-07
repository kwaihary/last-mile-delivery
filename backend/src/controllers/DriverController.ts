import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DriverProfile } from '../models/DriverProfile';
import redisClient from '../config/redis';
import { sendResponse } from '../utils/responseHelper';

const profileRepo = AppDataSource.getRepository(DriverProfile);

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
}
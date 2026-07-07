import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { DriverProfile } from '../models/DriverProfile';
import { sendResponse } from '../utils/responseHelper';
import redisClient from '../config/redis';

const userRepo = AppDataSource.getRepository(User);
const driverProfileRepo = AppDataSource.getRepository(DriverProfile);

export class UserController {
    // ĐĂNG KÝ TÀI KHOẢN
    static async register(req: Request, res: Response) {
        try {
            const { email, password, full_name, phone, role, vehicle_type, license_plate } = req.body;

            // Kiểm tra dữ liệu đầu vào
            if (!email || !password || !full_name || !phone || !role) {
                return sendResponse(res, 400, null, '', "Thiếu thông tin bắt buộc (email, password, full_name, phone, role)");
            }

            // Kiểm tra email trùng 
            const existingUser = await userRepo.findOneBy({ email });
            if (existingUser) {
                return sendResponse(res, 400, null, '', "Email này đã được sử dụng");
            }

            // 1. Tạo User mới
            const newUser = userRepo.create({
                email,
                password,
                full_name,
                phone,
                role,
                status: 'active'
            });
            const savedUser = await userRepo.save(newUser);

            // 2. Nếu Role là Tài xế, bắt buộc phải tạo thêm vào bảng Drive_Profile
            if (role === 'driver') {
                if (!vehicle_type || !license_plate) {
                    return sendResponse(res, 400, null, '', "Tài xế bắt buộc phải có loại xe (vehicle_type) và biển số (license_plate)");
                }

                const newProfile = driverProfileRepo.create({
                    driver_id: savedUser.id, // Lấy ID vừa sinh ra nối vào
                    vehicle_type,
                    license_plate,
                    is_online: false
                });
                await driverProfileRepo.save(newProfile);
            }

            return sendResponse(res, 201, { id: savedUser.id, role: savedUser.role }, "Đăng ký tài khoản thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    static async getDrivers(req: Request, res: Response) {
        try {
            // Lấy tất cả user có role là 'driver', kèm theo bảng driver_profile
            const drivers = await userRepo.find({
                where: { role: 'driver', status: 'active' },
                relations: {'driver_profile': true},
                select: { 'id': true, 'email': true, 'full_name': true, 'phone': true, 'role': true, 'status': true }
            });

            return sendResponse(res, 200, drivers, "Lấy danh sách tài xế thành công");
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    /**
     * Lấy danh sách tài xế đang trực tuyến (dựa trên DriverProfile.is_online = true trong PostgreSQL).
     * Kèm vị trí GPS mới nhất lấy từ Redis GEO `drivers:locations` để hiển thị lên LiveMap ngay khi vào Dashboard.
     * Endpoint này giúp Dashboard đếm + render driver online mà không cần đợi socket emit.
     */
    static async getOnlineDrivers(req: Request, res: Response) {
        try {
            // 1. Lấy tất cả driver có is_online = true trong PostgreSQL
            const onlineDrivers = await userRepo.find({
                where: { role: 'driver', status: 'active' },
                relations: { driver_profile: true },
                select: {
                    id: true, email: true, full_name: true, phone: true, role: true, status: true
                }
            });

            const filtered = onlineDrivers.filter(
                (u) => u.driver_profile && u.driver_profile.is_online === true
            );

            // 2. Enrich với vị trí GPS từ Redis GEO
            const driverIds = filtered.map((d) => String(d.id));
            const geoPositions = driverIds.length > 0
                ? await redisClient.geopos('drivers:locations', ...driverIds)
                : [];

            // 3. Lấy active_order_id từ Redis hash `driver:status:<id>`
            const result: any[] = [];
            for (let i = 0; i < filtered.length; i++) {
                const driver: any = filtered[i];
                if (!driver) continue;
                const pos = geoPositions[i];

                // Lấy active_order_id từ Redis hash
                const activeOrderId = await redisClient.hget(`driver:status:${driver.id}`, 'active_order_id');
                const currentStatus = await redisClient.hget(`driver:status:${driver.id}`, 'current_status');

                result.push({
                    id: driver.id,
                    full_name: driver.full_name,
                    phone: driver.phone,
                    email: driver.email,
                    vehicle_type: driver.driver_profile?.vehicle_type || null,
                    license_plate: driver.driver_profile?.license_plate || null,
                    // Vị trí mặt định TP.HCM nếu chưa có trong Redis GEO
                    lat: pos ? Number(pos[1]) : 10.762622,
                    lng: pos ? Number(pos[0]) : 106.660172,
                    has_gps: !!pos,
                    active_order_id: activeOrderId ? Number(activeOrderId) : null,
                    status: currentStatus || 'idle'
                });
            }

            return sendResponse(res, 200, result, `Có ${result.length} tài xế đang trực tuyến`);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { DriverProfile } from '../models/DriverProfile';
import { sendResponse } from '../utils/responseHelper';

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
}
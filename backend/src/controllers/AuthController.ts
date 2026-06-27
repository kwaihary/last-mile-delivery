import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { sendResponse } from '../utils/responseHelper';

const userRepository = AppDataSource.getRepository(User);

export class AuthController {
    // Auth Đăng nhập
    static async login(req: Request, res: Response) {
        try {
            const { email, password } = req.body;
            if (!email || !password) return sendResponse(res, 400, null, '', "Thiếu email hoặc password");

            const user = await userRepository.findOne({ where: { email }, relations: { driver_profile: true } });
            if (!user) return sendResponse(res, 404, null, '', "Tài khoản không tồn tại");

            // So sánh mật khẩu
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return sendResponse(res, 400, null, '', "Mật khẩu không chính xác");

            // Tạo JWT Token
            const token = jwt.sign(
                { id: user.id, role: user.role },
                process.env.JWT_SECRET as string,
                { expiresIn: '7d' } // Token sống 7 ngày
            );

            // Xóa field password trước khi trả về client
            const { password: _, ...userWithoutPassword } = user;

            return sendResponse(res, 200, { user: userWithoutPassword, token });
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }

    // Lấy thông tin tài khoản đang đăng nhập
    static async getMe(req: any, res: Response) {
        try {
            const userId = req.user.id;
            const user = await userRepository.findOne({ where: { id: userId }, relations: { driver_profile: true } });

            if (!user) return sendResponse(res, 404, null, '', "Không tìm thấy user");

            const { password: _, ...userWithoutPassword } = user;
            return sendResponse(res, 200, userWithoutPassword);
        } catch (error: any) {
            return sendResponse(res, 500, null, '', error.message);
        }
    }
}
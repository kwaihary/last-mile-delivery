import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { sendResponse } from '../utils/responseHelper'

export interface AuthRequest extends Request {
    user?: any;
}

export const verifyToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendResponse(res, 401, null, '', "Unauthorized: Không tìm thấy Token xác thực");
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return sendResponse(res, 401, null, '', "Unauthorized: Mã token không hợp lệ");
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
        req.user = decoded; // Lưu payload vào req.user (gồm id, role)
        next(); // Vào Controller
    } catch (error) {
        return sendResponse(res, 401, null, '', "Unauthorized: Token không hợp lệ hoặc đã hết hạn");
    }
};

// Middleware kiểm tra quyền Manager
export const isManager = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user && req.user.role === 'manager') {
        next();
    } else {
        return sendResponse(res, 403, null, '', "Forbidden: Yêu cầu quyền Điều phối viên");
    }
};
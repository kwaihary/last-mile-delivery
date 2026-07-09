import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { AuthController } from '../controllers/AuthController';
import { DriverController } from '../controllers/DriverController';
import { verifyToken, isManager } from '../middlewares/authMiddleware'; 

const router = Router();

router.post('/register', UserController.register); // Đăng ký
router.post('/login', AuthController.login);       // Đăng nhập

// Lấy thông tin chính mình 
router.get('/me', verifyToken, AuthController.getMe);

// Manager lấy danh sách tài xế để chọn gán đơn
router.get('/drivers', verifyToken, isManager, UserController.getDrivers);

// Manager lấy danh sách tài xế đang trực tuyến (kèm vị trí GPS từ Redis)
router.get('/drivers/online', verifyToken, isManager, UserController.getOnlineDrivers);

// Manager lấy thống kê tất cả tài xế
router.get('/drivers/stats', verifyToken, isManager, DriverController.getAllDriversStats);

export default router;
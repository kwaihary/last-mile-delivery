import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { AuthController } from '../controllers/AuthController';
import { verifyToken, isManager } from '../middlewares/authMiddleware'; 

const router = Router();

router.post('/register', UserController.register); // Đăng ký
router.post('/login', AuthController.login);       // Đăng nhập

// Lấy thông tin chính mình 
router.get('/me', verifyToken, AuthController.getMe);

// Manager lấy danh sách tài xế để chọn gán đơn
router.get('/drivers', verifyToken, isManager, UserController.getDrivers);

export default router;
import { Router } from 'express';
import { DriverController } from '../controllers/DriverController';
import { OrderController } from '../controllers/OrderController';
import { verifyToken } from '../middlewares/authMiddleware';

const router = Router();

router.patch('/status', verifyToken, DriverController.toggleOnlineStatus);
router.get('/orders', verifyToken, OrderController.getMyOrders);
router.get('/stats', verifyToken, DriverController.getMyStats);
router.get('/history', verifyToken, DriverController.getMyHistory);

export default router;
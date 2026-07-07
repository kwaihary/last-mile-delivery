import { Router } from 'express';
import { OrderController } from '../controllers/OrderController';
import { verifyToken, isManager } from '../middlewares/authMiddleware';

const router = Router();

// Điều phối viên
router.post('/', verifyToken, isManager, OrderController.createOrder);
router.get('/', verifyToken, isManager, OrderController.getAllOrders);
router.patch('/:id/assign', verifyToken, isManager, OrderController.assignOrder);

// Tài xế
router.patch('/:id/status', verifyToken, OrderController.updateOrderStatus);
router.post('/:id/complete', verifyToken, OrderController.completeOrder);
router.post('/:id/locations', verifyToken, OrderController.updateLocation);

// Khách hàng cuối
router.get('/track/:token', OrderController.trackOrderByToken);
router.get('/:id/route', OrderController.getRouteTracking);

export default router;
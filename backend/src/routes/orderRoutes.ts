import { Router } from 'express';
import { OrderController } from '../controllers/OrderController';
import { verifyToken, isManager } from '../middlewares/authMiddleware';

const router = Router();

// Điều phối viên
router.post('/', verifyToken, isManager, OrderController.createOrder);
// GET /api/orders (có filter)
router.get('/', verifyToken, isManager, OrderController.getAllOrdersFiltered);
// Stats endpoints
router.get('/stats', verifyToken, isManager, OrderController.getOrderStats);
router.get('/:id/route-history', verifyToken, isManager, OrderController.getRouteHistory);
// Cancel order (Manager only)
router.patch('/:id/cancel', verifyToken, isManager, OrderController.cancelOrder);
// Assign order
router.patch('/:id/assign', verifyToken, isManager, OrderController.assignOrder);

// Tài xế
router.patch('/:id/status', verifyToken, OrderController.updateOrderStatus);
router.post('/:id/complete', verifyToken, OrderController.completeOrder);
router.post('/:id/locations', verifyToken, OrderController.updateLocation);

// Khách hàng cuối
router.get('/track/:token', OrderController.trackOrderByToken);
router.get('/:id/route', OrderController.getRouteTracking);

export default router;
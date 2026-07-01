import { Router } from 'express';
import { DriverController } from '../controllers/DriverController';
import { verifyToken } from '../middlewares/authMiddleware';

const router = Router();

router.patch('/status', verifyToken, DriverController.toggleOnlineStatus);

export default router;
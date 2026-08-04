import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authLimiter } from '../../middlewares/rateLimit.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { authController } from './auth.controller.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from './auth.validation.js';

const router: Router = Router();

router.post(
  '/register',
  authLimiter,
  validateRequest({ body: registerSchema }),
  authController.register,
);

router.post('/login', authLimiter, validateRequest({ body: loginSchema }), authController.login);

router.post('/refresh', authLimiter, authController.refresh);

router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);

router.patch(
  '/change-password',
  authenticate,
  authLimiter,
  validateRequest({ body: changePasswordSchema }),
  authController.changePassword,
);

export const authRoutes: Router = router;

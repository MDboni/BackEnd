import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { inviteLimiter } from '../middlewares/rateLimit.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { authRoutes } from '../modules/auth/auth.route.js';
import { membershipController } from '../modules/membership/membership.controller.js';
import {
  inviteCodeParamSchema,
  joinMessSchema,
} from '../modules/membership/membership.validation.js';
import { messController } from '../modules/mess/mess.controller.js';
import { createMessSchema, messIdParamSchema } from '../modules/mess/mess.validation.js';
import { messScopedRoutes } from './mess.routes.js';

const router: Router = Router();

router.use('/auth', authRoutes);

/* ------------------------------- Invitations ------------------------------ */

router.get(
  '/invitations/:code',
  inviteLimiter,
  validateRequest({ params: inviteCodeParamSchema }),
  membershipController.previewInvitation,
);

router.post(
  '/invitations/:code/join',
  authenticate,
  inviteLimiter,
  validateRequest({ params: inviteCodeParamSchema, body: joinMessSchema }),
  membershipController.join,
);

/* ---------------------------------- Messes -------------------------------- */

router.post(
  '/messes',
  authenticate,
  validateRequest({ body: createMessSchema }),
  messController.create,
);

router.get('/messes/my', authenticate, messController.listMine);

/** Everything below is tenant-scoped; `messScopedRoutes` applies membershipScope. */
router.use(
  '/messes/:messId',
  authenticate,
  validateRequest({ params: messIdParamSchema }),
  messScopedRoutes,
);

export const apiRoutes: Router = router;

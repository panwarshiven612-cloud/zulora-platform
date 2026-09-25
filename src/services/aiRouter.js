/**
 * aiRouter.js — Client-side router compatibility entry point.
 * Provider credentials are resolved by apiRouter.js from import.meta.env only.
 */
import { apiRouter, MODEL_TIERS } from './apiRouter';

export { apiRouter as aiRouter, apiRouter, MODEL_TIERS };
export default apiRouter;

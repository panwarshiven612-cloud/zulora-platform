/**
 * aiRouter.js — Re-exports the client-side apiRouter for backward compatibility.
 * All generation logic has moved to apiRouter.js (client-side waterfall).
 */
import { apiRouter, MODEL_TIERS } from './apiRouter';

export { apiRouter as aiRouter, apiRouter, MODEL_TIERS };
export default apiRouter;

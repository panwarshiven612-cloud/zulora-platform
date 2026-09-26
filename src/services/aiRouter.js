/**
 * aiRouter.js — Compatibility exports for the unified AI and video routers.
 * The public aiRouter delegates video requests to videoService.js.
 */
import { apiRouter, MODEL_TIERS, GROQ_MODELS } from './apiRouter';
import { requestLimits } from './generationApi';

export { apiRouter as aiRouter, apiRouter, MODEL_TIERS, GROQ_MODELS };
export const getRateLimitStatus = requestLimits;
export { generateVideo } from './videoService';
export default apiRouter;

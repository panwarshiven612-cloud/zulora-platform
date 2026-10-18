import videoRenderHandler from '../server/handlers/video-render.js';

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  return videoRenderHandler(req, res);
}


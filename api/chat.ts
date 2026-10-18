import aiHandler from '../server/handlers/ai.js';

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  req.query = { ...req.query, route: 'chat' };
  return aiHandler(req, res);
}


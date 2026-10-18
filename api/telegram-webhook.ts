import telegramHandler from '../server/handlers/telegram.js';

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  req.query = { ...req.query, route: 'telegram-webhook' };
  return telegramHandler(req, res);
}


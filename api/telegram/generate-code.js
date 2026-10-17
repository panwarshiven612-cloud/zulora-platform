import telegramHandler from '../../server/handlers/telegram.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Ensure route metadata is populated for telegramHandler
  req.query = { ...req.query, route: 'telegram/generate-code' };
  return telegramHandler(req, res);
}

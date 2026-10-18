/**
 * TelegramConnector.tsx — Official Telegram Bot Connector for Zulora AI
 * Links user profiles via Firebase Firestore and connects with @Zulora_bot.
 */

import React from 'react';
import TelegramConnectCard from '../TelegramConnectCard';

export const TELEGRAM_BOT_USERNAME = 'Zulora_bot';
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

/**
 * Builds the verified redirect URL for one-click account linkage
 * @param verificationCode 6-character linking code (e.g. ZUL-123456)
 */
export function getTelegramConnectUrl(verificationCode?: string): string {
  if (!verificationCode) return TELEGRAM_BOT_URL;
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(verificationCode)}`;
}

export interface TelegramConnectorProps {
  currentUser: any;
  onLinked?: (data: { chatId: string | number; username?: string }) => void;
}

export default function TelegramConnector({ currentUser, onLinked }: TelegramConnectorProps) {
  return <TelegramConnectCard currentUser={currentUser} onLinked={onLinked} />;
}


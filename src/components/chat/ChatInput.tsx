import React from 'react';
// @ts-ignore
import RawChatInput, { MAX_FILE_SIZE as RAW_MAX_FILE_SIZE } from './ChatInput.jsx';

export const MAX_FILE_SIZE: number = RAW_MAX_FILE_SIZE || 50 * 1024 * 1024;
const ChatInput: React.FC<any> = RawChatInput;

export default ChatInput;

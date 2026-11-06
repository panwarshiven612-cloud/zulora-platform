import React from 'react';
import { VoiceAssistantModal } from '../VoiceAgentModal';
import { LiveVoiceStream } from '../../services/liveVoiceStream';

export interface LiveVoiceChatProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: any;
  onNewTurn?: (turn: { role: string; text: string }) => void;
}

export const LiveVoiceChat: React.FC<LiveVoiceChatProps> = ({
  isOpen,
  onClose,
  currentUser,
  onNewTurn
}) => {
  return (
    <VoiceAssistantModal
      isOpen={isOpen}
      onClose={onClose}
      currentUser={currentUser}
      onNewTurn={onNewTurn}
    />
  );
};

export { LiveVoiceStream };
export default LiveVoiceChat;


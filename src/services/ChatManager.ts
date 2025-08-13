// Placeholder for ChatManager class - will be implemented in later tasks
import type { TChatManager, TParsedMessage, TChat } from '../types/index.js';

export class ChatManager implements TChatManager {
  async saveMessage(_chatId: number, _message: TParsedMessage): Promise<void> {
    // Implementation will be added in task 5.2
    throw new Error('Not implemented yet');
  }

  async getChatData(_chatId: number): Promise<TChat | null> {
    // Implementation will be added in task 5.2
    throw new Error('Not implemented yet');
  }

  async updateActiveUsers(_chatId: number, _userId: number): Promise<void> {
    // Implementation will be added in task 5.2
    throw new Error('Not implemented yet');
  }
}

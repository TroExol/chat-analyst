// Placeholder for UserManager class - will be implemented in later tasks
import type { TUserManager, TUser } from '../types/index.js';

export class UserManager implements TUserManager {
  async getUserInfo(_userId: number): Promise<TUser> {
    // Implementation will be added in task 4.1
    throw new Error('Not implemented yet');
  }

  async batchGetUsers(_userIds: number[]): Promise<Map<number, TUser>> {
    // Implementation will be added in task 4.1
    throw new Error('Not implemented yet');
  }

  clearCache(): void {
    // Implementation will be added in task 4.1
    throw new Error('Not implemented yet');
  }
}

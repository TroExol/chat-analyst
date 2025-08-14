import type { TUserManager, TUser, TCachedUser } from '../types';
import type { VKApi } from './VKApi';
import { validateUser } from '../models';
import { UserCacheManager, type TUserCacheManagerConfig } from '../storage/UserCacheManager';

/**
 * Configuration for UserManager cache
 */
export interface TUserManagerConfig {
  cacheTimeToLive: number; // TTL in milliseconds (unused - cache never expires)
  batchSize: number; // Maximum users to fetch in one API call
}

/**
 * Default configuration for UserManager
 */
export const DEFAULT_USER_MANAGER_CONFIG: TUserManagerConfig = {
  cacheTimeToLive: 0, // Unused - cache never expires
  batchSize: 100, // VK API limit for users.get
};

export class UserManager implements TUserManager {
  private userCache = new Map<number, TCachedUser>();
  private pendingRequests = new Map<number, Promise<TUser>>();
  private vkApi: VKApi;
  private config: TUserManagerConfig;
  private cacheManager: UserCacheManager;
  private isInitialized = false;

  constructor(
    vkApi: VKApi,
    config: Partial<TUserManagerConfig> = {},
    cacheConfig: Partial<TUserCacheManagerConfig> = {},
  ) {
    this.vkApi = vkApi;
    this.config = { ...DEFAULT_USER_MANAGER_CONFIG, ...config };
    this.cacheManager = new UserCacheManager(cacheConfig);
  }

  /**
   * Initializes UserManager with cache warming from persistent storage
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('UserManager: Already initialized');
      return;
    }

    console.log('UserManager: Initializing with cache warming...');

    try {
      // Load cache from persistent storage
      const persistedCache = await this.cacheManager.loadCache();

      // Warm up in-memory cache (never expire - load all cached users!)
      let validEntries = 0;

      for (const [userId, cachedUser] of persistedCache) {
        this.userCache.set(userId, cachedUser);
        validEntries++;
      }

      console.log(`UserManager: Cache warmed with ${validEntries} users (cache never expires)`);

      // Start auto-save (but no cleanup timer - cache never expires!)
      this.cacheManager.startAutoSave(this.userCache);

      this.isInitialized = true;
      console.log('UserManager: Initialization complete');
    } catch (error) {
      console.error('UserManager: Failed to initialize:', error);
      this.isInitialized = true; // Continue without cache
    }
  }

  /**
   * Gets user information by ID with caching
   * @param userId - VK user ID
   * @returns Promise with user data
   */
  async getUserInfo(userId: number): Promise<TUser> {
    // Check cache first (cache never expires!)
    const cached = this.userCache.get(userId);
    if (cached) {
      return {
        id: cached.id,
        name: cached.name,
        lastActivity: cached.lastActivity,
      };
    }

    // Check if request is already pending
    const pendingRequest = this.pendingRequests.get(userId);
    if (pendingRequest) {
      return pendingRequest;
    }

    // Create new request
    const userPromise = this.fetchSingleUser(userId);
    this.pendingRequests.set(userId, userPromise);

    try {
      const user = await userPromise;
      this.cacheUser(user);
      return user;
    } finally {
      this.pendingRequests.delete(userId);
    }
  }

  /**
   * Gets multiple users information with batch optimization
   * @param userIds - Array of VK user IDs
   * @returns Promise with Map of user ID to user data
   */
  async batchGetUsers(userIds: number[]): Promise<Map<number, TUser>> {
    const result = new Map<number, TUser>();
    const uncachedUserIds: number[] = [];

    // Check cache for existing users (cache never expires!)
    for (const userId of userIds) {
      const cached = this.userCache.get(userId);
      if (cached) {
        result.set(userId, {
          id: cached.id,
          name: cached.name,
          lastActivity: cached.lastActivity,
        });
      } else {
        uncachedUserIds.push(userId);
      }
    }

    // Fetch uncached users in batches
    if (uncachedUserIds.length > 0) {
      const fetchedUsers = await this.fetchUsersInBatches(uncachedUserIds);

      // Add fetched users to result and cache
      for (const user of fetchedUsers) {
        result.set(user.id, user);
        this.cacheUser(user);
      }
    }

    return result;
  }

  /**
   * Cache is never cleared - users persist indefinitely
   */
  clearCache(): void {
    // Only clear pending requests and stats, but keep user cache intact!
    this.pendingRequests.clear();
    this.cacheManager.clearStats();
    console.log('UserManager: Cache is persistent - only cleared pending requests and stats');
  }

  /**
   * Manually saves cache to persistent storage
   */
  async saveCache(): Promise<void> {
    try {
      await this.cacheManager.saveCache(this.userCache);
    } catch (error) {
      console.error('UserManager: Failed to save cache:', error);
    }
  }

  /**
   * Gets comprehensive cache and persistence statistics
   */
  getDetailedStats() {
    const cacheStats = this.getCacheStats();
    const persistenceStats = this.cacheManager.getStats();

    return {
      cache: cacheStats,
      persistence: persistenceStats,
      initialized: this.isInitialized,
      config: this.config,
    };
  }

  /**
   * Gets cache statistics
   * @returns Cache statistics object
   */
  getCacheStats(): { size: number; hitRate: number; pendingRequests: number } {
    return {
      size: this.userCache.size,
      hitRate: this.calculateHitRate(),
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Manually adds user to cache
   * @param user - User data to cache
   */
  cacheUser(user: TUser): void {
    if (!validateUser(user)) {
      console.warn(`UserManager: Invalid user data for caching: ${JSON.stringify(user)}`);
      return;
    }

    const cachedUser: TCachedUser = {
      ...user,
      cachedAt: new Date(),
      ttl: this.config.cacheTimeToLive,
    };

    this.userCache.set(user.id, cachedUser);

    // Cache grows indefinitely - no size limits!
  }

  /**
   * Saves final cache state on destroy (no cleanup timer to stop)
   */
  async destroy(): Promise<void> {
    console.log('UserManager: Destroying...');

    // Stop auto-save
    this.cacheManager.stopAutoSave();

    // Final cache save
    try {
      await this.cacheManager.saveCache(this.userCache);
      console.log('UserManager: Final cache save completed');
    } catch (error) {
      console.error('UserManager: Failed final cache save:', error);
    }

    console.log('UserManager: Destroyed');
  }

  private async fetchSingleUser(userId: number): Promise<TUser> {
    try {
      const response = await this.vkApi.getUsers([userId], ['last_seen']);

      if (!response || !Array.isArray(response) || response.length === 0) {
        throw new Error(`User ${userId} not found in VK API response`);
      }

      const vkUser = response[0];
      return this.mapVKUserToTUser(vkUser as unknown as Record<string, unknown>);
    } catch (error) {
      console.error(`Failed to fetch user ${userId}:`, error);

      // Return placeholder user for failed requests
      return {
        id: userId,
        name: `User ${userId}`,
        lastActivity: undefined,
      };
    }
  }

  private async fetchUsersInBatches(userIds: number[]): Promise<TUser[]> {
    const users: TUser[] = [];
    const { batchSize } = this.config;

    // Split into batches
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      try {
        const response = await this.vkApi.getUsers(batch, ['last_seen']);

        if (response && Array.isArray(response)) {
          for (const vkUser of response) {
            const user = this.mapVKUserToTUser(vkUser as Record<string, unknown>);
            users.push(user);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch user batch ${batch}:`, error);

        // Add placeholder users for failed batch
        for (const userId of batch) {
          users.push({
            id: userId,
            name: `User ${userId}`,
            lastActivity: undefined,
          });
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return users;
  }

  private mapVKUserToTUser(vkUser: Record<string, unknown>): TUser {
    const firstName = (vkUser.first_name as string) || '';
    const lastName = (vkUser.last_name as string) || '';
    const name = `${firstName} ${lastName}`.trim() || `User ${vkUser.id}`;

    // Parse last activity
    let lastActivity: Date | undefined;
    const lastSeen = vkUser.last_seen;
    if (lastSeen && typeof lastSeen === 'object' && lastSeen !== null) {
      const time = (lastSeen as Record<string, unknown>).time;
      if (typeof time === 'number') {
        lastActivity = new Date(time * 1000);
      }
    }

    const userId = vkUser.id;
    if (typeof userId !== 'number') {
      throw new Error(`Invalid user ID: ${userId}`);
    }

    return {
      id: userId,
      name,
      lastActivity,
    };
  }

  // Cache cleanup methods removed - cache never expires!

  private calculateHitRate(): number {
    // Simple hit rate calculation - would need more sophisticated tracking in production
    return this.userCache.size > 0 ? 0.8 : 0; // Placeholder
  }
}

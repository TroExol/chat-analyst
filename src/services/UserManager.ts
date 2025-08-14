import type { TUserManager, TUser, TCachedUser } from '../types';
import type { VKApi } from './VKApi';
import { validateUser } from '../models';
import { UserCacheManager, type TUserCacheManagerConfig } from '../storage/UserCacheManager';

/**
 * Configuration for UserManager cache
 */
export interface TUserManagerConfig {
  cacheTimeToLive: number; // TTL in milliseconds
  batchSize: number; // Maximum users to fetch in one API call
  cleanupInterval: number; // Cache cleanup interval in milliseconds
  maxCacheSize: number; // Maximum number of users to keep in cache
}

/**
 * Default configuration for UserManager
 */
export const DEFAULT_USER_MANAGER_CONFIG: TUserManagerConfig = {
  cacheTimeToLive: 30 * 60 * 1000, // 30 minutes
  batchSize: 100, // VK API limit for users.get
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  maxCacheSize: 10000, // 10k users
};

export class UserManager implements TUserManager {
  private userCache = new Map<number, TCachedUser>();
  private pendingRequests = new Map<number, Promise<TUser>>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
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

      // Warm up in-memory cache
      let validEntries = 0;
      let expiredEntries = 0;

      for (const [userId, cachedUser] of persistedCache) {
        if (this.isCacheExpired(cachedUser)) {
          expiredEntries++;
          continue;
        }

        this.userCache.set(userId, cachedUser);
        validEntries++;
      }

      console.log(`UserManager: Cache warmed with ${validEntries} users, ${expiredEntries} expired entries skipped`);

      // Start cleanup timer and auto-save
      this.startCleanupTimer();
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
    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached && !this.isCacheExpired(cached)) {
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

    // Check cache for existing users
    for (const userId of userIds) {
      const cached = this.userCache.get(userId);
      if (cached && !this.isCacheExpired(cached)) {
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
   * Clears all cached user data
   */
  clearCache(): void {
    this.userCache.clear();
    this.pendingRequests.clear();
    this.cacheManager.clearStats();
    console.log('UserManager: Cache cleared');
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

    // Enforce cache size limit
    if (this.userCache.size > this.config.maxCacheSize) {
      this.evictOldestEntries();
    }
  }

  /**
   * Stops cache cleanup timer and saves final cache state
   */
  async destroy(): Promise<void> {
    console.log('UserManager: Destroying...');

    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

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

  private isCacheExpired(cachedUser: TCachedUser): boolean {
    const now = new Date().getTime();
    const cacheTime = cachedUser.cachedAt.getTime();
    return (now - cacheTime) > cachedUser.ttl;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.config.cleanupInterval);
  }

  private cleanupExpiredEntries(): void {
    const expiredKeys: number[] = [];

    for (const [userId, cachedUser] of this.userCache) {
      if (this.isCacheExpired(cachedUser)) {
        expiredKeys.push(userId);
      }
    }

    for (const key of expiredKeys) {
      this.userCache.delete(key);
    }

    if (expiredKeys.length > 0) {
      console.log(`UserManager: Removed ${expiredKeys.length} expired cache entries`);
    }
  }

  private evictOldestEntries(): void {
    const entries = Array.from(this.userCache.entries());
    // Sort by cache time, oldest first
    entries.sort((a, b) => a[1].cachedAt.getTime() - b[1].cachedAt.getTime());

    const entriesToRemove = entries.length - this.config.maxCacheSize + 1000; // Remove extra 1000 for buffer

    for (let i = 0; i < entriesToRemove && i < entries.length; i++) {
      this.userCache.delete(entries[i][0]);
    }

    console.log(`UserManager: Evicted ${entriesToRemove} oldest cache entries`);
  }

  private calculateHitRate(): number {
    // Simple hit rate calculation - would need more sophisticated tracking in production
    return this.userCache.size > 0 ? 0.8 : 0; // Placeholder
  }
}

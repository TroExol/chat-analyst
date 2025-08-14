import { promises as fs } from 'fs';
import { join } from 'path';
import type { TCachedUser, TUser } from '../types';
import { validateUser } from '../models';
import { ensureDirectoryExists } from '../utils';

/**
 * Configuration for UserCacheManager
 */
export interface TUserCacheManagerConfig {
  cacheFilePath: string;
  saveInterval: number; // Auto-save interval in milliseconds
  backupRetention: number; // Number of backup files to keep
}

/**
 * Default configuration for UserCacheManager
 */
export const DEFAULT_CACHE_CONFIG: TUserCacheManagerConfig = {
  cacheFilePath: './data/cache/user-cache.json',
  saveInterval: 60 * 1000, // 1 minute
  backupRetention: 5,
};

/**
 * Manages persistence of user cache data to/from JSON files
 */
export class UserCacheManager {
  private config: TUserCacheManagerConfig;
  private saveTimer?: ReturnType<typeof setInterval>;
  private stats = {
    totalLoads: 0,
    totalSaves: 0,
    lastSaveTime: null as Date | null,
    lastLoadTime: null as Date | null,
    errors: 0,
  };

  constructor(config: Partial<TUserCacheManagerConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Loads user cache from JSON file
   * @returns Map of user ID to cached user data
   */
  async loadCache(): Promise<Map<number, TCachedUser>> {
    try {
      this.stats.totalLoads++;
      this.stats.lastLoadTime = new Date();

      const filePath = this.config.cacheFilePath;

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        console.log('UserCacheManager: Cache file does not exist, starting with empty cache');
        return new Map();
      }

      const fileContent = await fs.readFile(filePath, 'utf-8');

      if (!fileContent.trim()) {
        console.log('UserCacheManager: Cache file is empty');
        return new Map();
      }

      const cacheData = JSON.parse(fileContent);

      if (!cacheData || typeof cacheData !== 'object') {
        console.warn('UserCacheManager: Invalid cache file format');
        return new Map();
      }

      const userMap = new Map<number, TCachedUser>();
      let validEntries = 0;
      let invalidEntries = 0;

      for (const [userIdStr, userData] of Object.entries(cacheData)) {
        const userId = parseInt(userIdStr, 10);

        if (isNaN(userId) || !this.validateCachedUser(userData)) {
          invalidEntries++;
          continue;
        }

        // Convert date strings back to Date objects
        const cachedUser = userData as TCachedUser;
        cachedUser.cachedAt = new Date(cachedUser.cachedAt);
        if (cachedUser.lastActivity) {
          cachedUser.lastActivity = new Date(cachedUser.lastActivity);
        }

        userMap.set(userId, cachedUser);
        validEntries++;
      }

      console.log(`UserCacheManager: Loaded ${validEntries} users from cache, ${invalidEntries} invalid entries skipped`);
      return userMap;
    } catch (error) {
      this.stats.errors++;
      console.error('UserCacheManager: Failed to load cache:', error);
      return new Map();
    }
  }

  /**
   * Saves user cache to JSON file
   * @param userCache - Map of user cache data to save
   */
  async saveCache(userCache: Map<number, TCachedUser>): Promise<void> {
    try {
      this.stats.totalSaves++;
      this.stats.lastSaveTime = new Date();

      const filePath = this.config.cacheFilePath;
      await ensureDirectoryExists(join(filePath, '..'));

      // Create backup before saving new data
      await this.createBackup();

      // Convert Map to plain object for JSON serialization
      const cacheData: Record<string, TCachedUser> = {};

      for (const [userId, cachedUser] of userCache) {
        if (this.validateCachedUser(cachedUser)) {
          cacheData[userId.toString()] = cachedUser;
        }
      }

      const jsonContent = JSON.stringify(cacheData, null, 2);
      await fs.writeFile(filePath, jsonContent, 'utf-8');

      console.log(`UserCacheManager: Saved ${userCache.size} users to cache file`);
    } catch (error) {
      this.stats.errors++;
      console.error('UserCacheManager: Failed to save cache:', error);
      throw error;
    }
  }

  /**
   * Starts auto-save timer for periodic cache persistence
   * @param userCache - User cache to auto-save
   */
  startAutoSave(userCache: Map<number, TCachedUser>): void {
    if (this.saveTimer) {
      this.stopAutoSave();
    }

    this.saveTimer = setInterval(async () => {
      try {
        await this.saveCache(userCache);
      } catch (error) {
        console.error('UserCacheManager: Auto-save failed:', error);
      }
    }, this.config.saveInterval);

    console.log(`UserCacheManager: Auto-save started (interval: ${this.config.saveInterval}ms)`);
  }

  /**
   * Stops auto-save timer
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
      console.log('UserCacheManager: Auto-save stopped');
    }
  }

  /**
   * Gets cache statistics
   * @returns Cache management statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Clears all cache statistics
   */
  clearStats(): void {
    this.stats = {
      totalLoads: 0,
      totalSaves: 0,
      lastSaveTime: null,
      lastLoadTime: null,
      errors: 0,
    };
  }

  /**
   * Creates backup of current cache file
   */
  private async createBackup(): Promise<void> {
    try {
      const filePath = this.config.cacheFilePath;

      // Check if original file exists
      try {
        await fs.access(filePath);
      } catch {
        return; // No file to backup
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.backup.${timestamp}`;

      await fs.copyFile(filePath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups();
    } catch (error) {
      console.warn('UserCacheManager: Failed to create backup:', error);
    }
  }

  /**
   * Removes old backup files to limit storage usage
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const dir = join(this.config.cacheFilePath, '..');
      const files = await fs.readdir(dir);

      const backupFiles = files
        .filter(file => file.includes('.backup.'))
        .map(file => ({
          name: file,
          path: join(dir, file),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .reverse(); // Most recent first

      // Remove excess backups
      const filesToRemove = backupFiles.slice(this.config.backupRetention);

      for (const file of filesToRemove) {
        await fs.unlink(file.path);
      }

      if (filesToRemove.length > 0) {
        console.log(`UserCacheManager: Removed ${filesToRemove.length} old backup files`);
      }
    } catch (error) {
      console.warn('UserCacheManager: Failed to cleanup old backups:', error);
    }
  }

  /**
   * Validates cached user data structure
   */
  private validateCachedUser(userData: unknown): userData is TCachedUser {
    if (!userData || typeof userData !== 'object') {
      return false;
    }

    const user = userData as Record<string, unknown>;

    return validateUser(user) &&
           user.cachedAt instanceof Date &&
           typeof user.ttl === 'number';
  }
}

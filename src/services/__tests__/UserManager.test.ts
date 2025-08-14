import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { UserManager, DEFAULT_USER_MANAGER_CONFIG, type TUserManagerConfig } from '../UserManager';
import { UserCacheManager, type TUserCacheManagerConfig } from '../../storage/UserCacheManager';
import type { VKApi } from '../VKApi';
import type { TUser, TCachedUser } from '../../types';

// Mock dependencies
jest.mock('../VKApi');
jest.mock('../../storage/UserCacheManager');

// Mock console methods to keep tests clean
const mockConsole = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

global.console = mockConsole as any;

describe('UserManager', () => {
  let userManager: UserManager;
  let mockVkApi: jest.Mocked<VKApi>;
  let mockCacheManager: jest.Mocked<UserCacheManager>;

  const testUsers: TUser[] = [
    { id: 123, name: 'Тестовый Пользователь 1', lastActivity: new Date('2024-01-01T10:00:00Z') },
    { id: 456, name: 'Тестовый Пользователь 2', lastActivity: new Date('2024-01-02T15:30:00Z') },
    { id: 789, name: 'Тестовый Пользователь 3' },
  ];

  const mockVkApiUsers = [
    { id: 123, first_name: 'Тестовый', last_name: 'Пользователь 1', last_seen: { time: 1704106800 } },
    { id: 456, first_name: 'Тестовый', last_name: 'Пользователь 2', last_seen: { time: 1704206200 } },
    { id: 789, first_name: 'Тестовый', last_name: 'Пользователь 3' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Setup VKApi mock
    mockVkApi = {
      getUsers: jest.fn(),
      setAccessToken: jest.fn(),
      getAccessToken: jest.fn(),
    } as any;

    // Setup UserCacheManager mock
    mockCacheManager = {
      loadCache: jest.fn(),
      saveCache: jest.fn(),
      startAutoSave: jest.fn(),
      stopAutoSave: jest.fn(),
      clearStats: jest.fn(),
      getStats: jest.fn(),
    } as any;

    (UserCacheManager as jest.MockedClass<typeof UserCacheManager>).mockImplementation(() => mockCacheManager);

    userManager = new UserManager(mockVkApi);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create UserManager with default configuration', () => {
      const manager = new UserManager(mockVkApi);

      expect(manager).toBeInstanceOf(UserManager);
      expect(UserCacheManager).toHaveBeenCalledWith({});
    });

    it('should create UserManager with custom configuration', () => {
      const customConfig: Partial<TUserManagerConfig> = {
        cacheTimeToLive: 60000,
        batchSize: 50,
        maxCacheSize: 5000,
      };

      const customCacheConfig: Partial<TUserCacheManagerConfig> = {
        cacheFilePath: 'custom-cache.json',
        saveInterval: 30000,
      };

      const manager = new UserManager(mockVkApi, customConfig, customCacheConfig);

      expect(manager).toBeInstanceOf(UserManager);
      expect(UserCacheManager).toHaveBeenCalledWith(customCacheConfig);
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully with cache warming', async () => {
      const cachedUsers = new Map<number, TCachedUser>();
      cachedUsers.set(123, {
        ...testUsers[0],
        cachedAt: new Date(),
        ttl: DEFAULT_USER_MANAGER_CONFIG.cacheTimeToLive,
      });

      mockCacheManager.loadCache.mockResolvedValue(cachedUsers);

      await userManager.initialize();

      expect(mockCacheManager.loadCache).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.startAutoSave).toHaveBeenCalledTimes(1);
      expect(mockConsole.log).toHaveBeenCalledWith('UserManager: Initialization complete');
    });

    it('should skip expired entries during cache warming', async () => {
      const cachedUsers = new Map<number, TCachedUser>();
      const expiredDate = new Date(Date.now() - DEFAULT_USER_MANAGER_CONFIG.cacheTimeToLive - 1000);

      cachedUsers.set(123, {
        ...testUsers[0],
        cachedAt: expiredDate,
        ttl: DEFAULT_USER_MANAGER_CONFIG.cacheTimeToLive,
      });

      mockCacheManager.loadCache.mockResolvedValue(cachedUsers);

      await userManager.initialize();

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Cache warmed with 0 users, 1 expired entries skipped'),
      );
    });

    it('should handle initialization errors gracefully', async () => {
      mockCacheManager.loadCache.mockRejectedValue(new Error('Cache load failed'));

      await userManager.initialize();

      expect(mockConsole.error).toHaveBeenCalledWith(
        'UserManager: Failed to initialize:',
        expect.any(Error),
      );
    });

    it('should not initialize twice', async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());

      await userManager.initialize();
      await userManager.initialize();

      expect(mockConsole.warn).toHaveBeenCalledWith('UserManager: Already initialized');
      expect(mockCacheManager.loadCache).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUserInfo', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should return cached user if available and not expired', async () => {
      userManager.cacheUser(testUsers[0]);

      const result = await userManager.getUserInfo(123);

      expect(result).toEqual(testUsers[0]);
      expect(mockVkApi.getUsers).not.toHaveBeenCalled();
    });

    it('should fetch user from API if not cached', async () => {
      mockVkApi.getUsers.mockResolvedValue([mockVkApiUsers[0]] as any);

      const result = await userManager.getUserInfo(123);

      expect(mockVkApi.getUsers).toHaveBeenCalledWith([123], ['last_seen']);
      expect(result.id).toBe(123);
      expect(result.name).toBe('Тестовый Пользователь 1');
    });

    it('should return same promise for concurrent requests', async () => {
      // eslint-disable-next-line no-unused-vars
      let resolvePromise: (value: unknown) => void;
      const userPromise = new Promise<any>(resolve => { resolvePromise = resolve; });

      mockVkApi.getUsers.mockImplementation(() => userPromise);

      const promise1 = userManager.getUserInfo(123);
      const promise2 = userManager.getUserInfo(123);

      // Check that both promises reference the same pending request
      expect(mockVkApi.getUsers).toHaveBeenCalledTimes(1);

      // Resolve the promise
      resolvePromise!([mockVkApiUsers[0]] as any);

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toEqual(result2);
      expect(result1.id).toBe(123);
    });

    it('should handle API errors and return placeholder user', async () => {
      mockVkApi.getUsers.mockRejectedValue(new Error('API Error'));

      const result = await userManager.getUserInfo(999);

      expect(result).toEqual({
        id: 999,
        name: 'User 999',
        lastActivity: undefined,
      });
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch user 999:',
        expect.any(Error),
      );
    });

    it('should handle empty API response', async () => {
      mockVkApi.getUsers.mockResolvedValue([] as any);

      const result = await userManager.getUserInfo(999);

      expect(result.name).toBe('User 999');
    });

    it('should cache fetched user', async () => {
      mockVkApi.getUsers.mockResolvedValue([mockVkApiUsers[0]] as any);

      await userManager.getUserInfo(123);

      // Second call should use cache
      await userManager.getUserInfo(123);

      expect(mockVkApi.getUsers).toHaveBeenCalledTimes(1);
    });
  });

  describe('batchGetUsers', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should return cached users when available', async () => {
      userManager.cacheUser(testUsers[0]);
      userManager.cacheUser(testUsers[1]);

      const result = await userManager.batchGetUsers([123, 456]);

      expect(result.size).toBe(2);
      expect(result.get(123)).toEqual(testUsers[0]);
      expect(result.get(456)).toEqual(testUsers[1]);
      expect(mockVkApi.getUsers).not.toHaveBeenCalled();
    });

    it('should fetch only uncached users', async () => {
      userManager.cacheUser(testUsers[0]); // Cache user 123
      mockVkApi.getUsers.mockResolvedValue([mockVkApiUsers[1]] as any); // API returns user 456

      const result = await userManager.batchGetUsers([123, 456]);

      expect(mockVkApi.getUsers).toHaveBeenCalledWith([456], ['last_seen']);
      expect(result.size).toBe(2);
      expect(result.get(123)).toEqual(testUsers[0]);
      expect(result.get(456)?.id).toBe(456);
    });

    it('should handle batch size limits', async () => {
      const userManager = new UserManager(mockVkApi, { batchSize: 2 });
      await userManager.initialize();

      const userIds = [123, 456, 789, 101];
      mockVkApi.getUsers
        .mockResolvedValueOnce([mockVkApiUsers[0], mockVkApiUsers[1]] as any)
        .mockResolvedValueOnce([mockVkApiUsers[2], { id: 101, first_name: 'User', last_name: '101' }] as any);

      const result = await userManager.batchGetUsers(userIds);

      expect(mockVkApi.getUsers).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(4);
    });

    it('should add delay between batches', async () => {
      jest.useFakeTimers();

      const userManager = new UserManager(mockVkApi, { batchSize: 1 });
      await userManager.initialize();

      mockVkApi.getUsers
        .mockResolvedValueOnce([mockVkApiUsers[0]] as any)
        .mockResolvedValueOnce([mockVkApiUsers[1]] as any);

      // Start the batch request (this should not await)
      const promise = userManager.batchGetUsers([123, 456]);

      // Fast-forward time to trigger the delay between batches
      await jest.advanceTimersByTimeAsync(150);

      // Wait for the promise to complete
      await promise;

      expect(mockVkApi.getUsers).toHaveBeenCalledTimes(2);
    }, 10000); // Increase timeout

    it('should handle batch API errors gracefully', async () => {
      mockVkApi.getUsers.mockRejectedValue(new Error('Batch API Error'));

      const result = await userManager.batchGetUsers([999, 888]);

      expect(result.size).toBe(2);
      expect(result.get(999)?.name).toBe('User 999');
      expect(result.get(888)?.name).toBe('User 888');
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should cache user correctly', () => {
      userManager.cacheUser(testUsers[0]);

      const stats = userManager.getCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should not cache invalid user data', () => {
      const invalidUser = { id: 0, name: '' } as TUser;

      userManager.cacheUser(invalidUser);

      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid user data for caching'),
      );
    });

    it('should evict oldest entries when cache size limit is reached', () => {
      const userManager = new UserManager(mockVkApi, { maxCacheSize: 2 });

      // Add users to exceed cache limit
      userManager.cacheUser(testUsers[0]);
      userManager.cacheUser(testUsers[1]);
      userManager.cacheUser(testUsers[2]); // This should trigger eviction

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Evicted'),
      );
    });

    it('should clear cache and pending requests', () => {
      userManager.cacheUser(testUsers[0]);

      userManager.clearCache();

      const stats = userManager.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.pendingRequests).toBe(0);
      expect(mockCacheManager.clearStats).toHaveBeenCalled();
    });

    it('should cleanup expired entries periodically', async () => {
      jest.useFakeTimers();

      // Initialize with cache manager mock first
      const userManager = new UserManager(mockVkApi, {
        cacheTimeToLive: 1000,
        cleanupInterval: 5000,
      });

      await userManager.initialize();

      // Add expired user
      const expiredUser = {
        ...testUsers[0],
        cachedAt: new Date(Date.now() - 2000),
        ttl: 1000,
      };

      (userManager as any).userCache.set(123, expiredUser);

      // Clear previous console calls
      mockConsole.log.mockClear();

      // Fast forward time to trigger cleanup
      jest.advanceTimersByTime(6000);

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Removed 1 expired cache entries'),
      );
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should return cache statistics', () => {
      userManager.cacheUser(testUsers[0]);

      const stats = userManager.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.pendingRequests).toBe(0);
    });

    it('should return detailed statistics with persistence info', () => {
      mockCacheManager.getStats.mockReturnValue({
        totalLoads: 1,
        totalSaves: 5,
        lastSaveTime: new Date(),
        lastLoadTime: new Date(),
        errors: 0,
      });

      const detailedStats = userManager.getDetailedStats();

      expect(detailedStats.cache).toBeDefined();
      expect(detailedStats.persistence).toBeDefined();
      expect(detailedStats.initialized).toBe(true);
      expect(detailedStats.config).toBeDefined();
    });
  });

  describe('Persistence Integration', () => {
    it('should save cache to persistent storage', async () => {
      userManager.cacheUser(testUsers[0]);

      await userManager.saveCache();

      expect(mockCacheManager.saveCache).toHaveBeenCalledWith(
        expect.any(Map),
      );
    });

    it('should handle save cache errors', async () => {
      mockCacheManager.saveCache.mockRejectedValue(new Error('Save failed'));

      await userManager.saveCache();

      expect(mockConsole.error).toHaveBeenCalledWith(
        'UserManager: Failed to save cache:',
        expect.any(Error),
      );
    });
  });

  describe('Destruction and Cleanup', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should destroy manager properly', async () => {
      await userManager.destroy();

      expect(mockCacheManager.stopAutoSave).toHaveBeenCalled();
      expect(mockCacheManager.saveCache).toHaveBeenCalled();
      expect(mockConsole.log).toHaveBeenCalledWith('UserManager: Destroyed');
    });

    it('should handle destroy errors gracefully', async () => {
      mockCacheManager.saveCache.mockRejectedValue(new Error('Final save failed'));

      await userManager.destroy();

      expect(mockConsole.error).toHaveBeenCalledWith(
        'UserManager: Failed final cache save:',
        expect.any(Error),
      );
    });
  });

  describe('VK API Integration', () => {
    beforeEach(async () => {
      mockCacheManager.loadCache.mockResolvedValue(new Map());
      await userManager.initialize();
    });

    it('should map VK user data correctly', async () => {
      const vkUserWithoutLastSeen = {
        id: 789,
        first_name: 'Без',
        last_name: 'Активности',
      };

      mockVkApi.getUsers.mockResolvedValue([vkUserWithoutLastSeen] as any);

      const result = await userManager.getUserInfo(789);

      expect(result.id).toBe(789);
      expect(result.name).toBe('Без Активности');
      expect(result.lastActivity).toBeUndefined();
    });

    it('should handle malformed VK user data', async () => {
      const malformedUser = {
        id: 'invalid',
        first_name: '',
        last_name: '',
      };

      mockVkApi.getUsers.mockResolvedValue([malformedUser] as any);

      const result = await userManager.getUserInfo(999);

      expect(result.name).toBe('User 999'); // Falls back to placeholder
    });

    it('should handle users with only first name', async () => {
      const userFirstNameOnly = {
        id: 456,
        first_name: 'Только',
        last_name: '',
      };

      mockVkApi.getUsers.mockResolvedValue([userFirstNameOnly] as any);

      const result = await userManager.getUserInfo(456);

      expect(result.name).toBe('Только');
    });

    it('should parse last_seen timestamp correctly', async () => {
      const userWithLastSeen = {
        id: 123,
        first_name: 'Test',
        last_name: 'User',
        last_seen: { time: 1640995200 }, // 2022-01-01 00:00:00
      };

      mockVkApi.getUsers.mockResolvedValue([userWithLastSeen] as any);

      const result = await userManager.getUserInfo(123);

      expect(result.lastActivity).toEqual(new Date(1640995200 * 1000));
    });
  });
});

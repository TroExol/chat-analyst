import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { FileStorage, DEFAULT_FILE_STORAGE_CONFIG, type TFileStorageConfig } from '../FileStorage';
import * as utils from '../../utils';

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn(),
    access: jest.fn(),
    stat: jest.fn(),
    copyFile: jest.fn(),
  },
}));

jest.spyOn(utils, 'ensureDirectoryExists').mockResolvedValue(undefined);

const mockFs = fs as jest.Mocked<typeof fs>;
const mockConsole = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

global.console = mockConsole as any;

describe('FileStorage', () => {
  let fileStorage: FileStorage;

  beforeEach(() => {
    jest.clearAllMocks();

    fileStorage = new FileStorage();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create FileStorage with default configuration', () => {
      const storage = new FileStorage();

      expect(storage.getConfig()).toEqual(DEFAULT_FILE_STORAGE_CONFIG);
    });

    it('should create FileStorage with custom configuration', () => {
      const customConfig: Partial<TFileStorageConfig> = {
        baseDataPath: './custom-data',
        maxRetries: 5,
        retryBaseDelay: 2000,
      };

      const storage = new FileStorage(customConfig);
      const config = storage.getConfig();

      expect(config.baseDataPath).toBe('./custom-data');
      expect(config.maxRetries).toBe(5);
      expect(config.retryBaseDelay).toBe(2000);
      expect(config.chatsPath).toBe(DEFAULT_FILE_STORAGE_CONFIG.chatsPath); // Should keep defaults for unspecified
    });
  });

  describe('Initialization', () => {
    it('should initialize directory structure successfully', async () => {
      await fileStorage.initialize();

      expect(mockConsole.log).toHaveBeenCalledWith('FileStorage: Directory structure initialized');
    });

    it('should handle directory creation errors', async () => {
      const ensureDirectoryExistsSpy = jest.spyOn(utils, 'ensureDirectoryExists');
      ensureDirectoryExistsSpy.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(fileStorage.initialize()).rejects.toThrow('Failed to initialize FileStorage directories');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'FileStorage: Failed to initialize directories:',
        expect.any(Error),
      );
    });
  });

  describe('JSON File Operations', () => {
    const testData = { id: 123, name: 'Test Chat', messages: [] };

    it('should read JSON file successfully', async () => {
      const jsonContent = JSON.stringify(testData);
      mockFs.readFile.mockResolvedValue(jsonContent);

      const result = await fileStorage.readJSONFile('/test/path.json');

      expect(result).toEqual(testData);
      expect(mockFs.readFile).toHaveBeenCalledWith('/test/path.json', 'utf-8');
    });

    it('should return null for non-existent file', async () => {
      const error = new Error('File not found') as any;
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const result = await fileStorage.readJSONFile('/non-existent.json');

      expect(result).toBeNull();
    });

    it('should throw error for file read failures', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(fileStorage.readJSONFile('/test/path.json')).rejects.toThrow('Failed to read JSON file');
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read file'),
        expect.any(Error),
      );
    });

    it('should write JSON file with pretty formatting', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await fileStorage.writeJSONFile('/test/path.json', testData);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/test/path.json',
        JSON.stringify(testData, null, 2),
        'utf-8',
      );
    });

    it('should retry writes on failure', async () => {
      mockFs.writeFile
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockRejectedValueOnce(new Error('Write failed again'))
        .mockResolvedValueOnce(undefined);

      await fileStorage.writeJSONFile('/test/path.json', testData);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully wrote /test/path.json on attempt 3'),
      );
    });

    it('should fail after max retries', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Persistent write error'));

      await expect(fileStorage.writeJSONFile('/test/path.json', testData)).rejects.toThrow(
        'Failed to write file after 3 attempts',
      );

      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write /test/path.json after 3 attempts'),
      );
    });
  });

  describe('File Path Generation', () => {
    it('should generate safe chat file path with sanitized name', () => {
      const filePath = fileStorage.generateChatFilePath(123, 'Тест/Чат\\Name');

      expect(filePath).toBe(join('./data/chats', 'chat-123-ТестЧатName.json'));
    });

    it('should generate chat file path without name', () => {
      const filePath = fileStorage.generateChatFilePath(456);

      expect(filePath).toBe(join('./data/chats', 'chat-456-unknown.json'));
    });

    it('should generate safe cache file path', () => {
      const filePath = fileStorage.generateCacheFilePath('user-cache.json');

      expect(filePath).toBe(join('./data/cache', 'user-cache.json'));
    });

    it('should generate safe log file path', () => {
      const filePath = fileStorage.generateLogFilePath('app.log');

      expect(filePath).toBe(join('./data/logs', 'app.log'));
    });
  });

  describe('File System Utilities', () => {
    it('should check if file exists', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const exists = await fileStorage.fileExists('/test/file.json');

      expect(exists).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith('/test/file.json');
    });

    it('should return false for non-existent file', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const exists = await fileStorage.fileExists('/non-existent.json');

      expect(exists).toBe(false);
    });

    it('should get file statistics', async () => {
      const mockStats = {
        size: 1024,
        mtime: new Date('2024-01-01T10:00:00Z'),
        ctime: new Date('2024-01-01T09:00:00Z'),
      };
      mockFs.stat.mockResolvedValue(mockStats as any);

      const stats = await fileStorage.getFileStats('/test/file.json');

      expect(stats).toEqual({
        size: 1024,
        mtime: mockStats.mtime,
        ctime: mockStats.ctime,
      });
    });

    it('should return null for non-existent file stats', async () => {
      const error = new Error('File not found') as any;
      error.code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const stats = await fileStorage.getFileStats('/non-existent.json');

      expect(stats).toBeNull();
    });

    it('should list chat files', async () => {
      mockFs.readdir.mockResolvedValue([
        'chat-123-test.json',
        'chat-456-another.json',
        'not-a-chat.txt',
        'cache-file.json',
      ] as any);

      const chatFiles = await fileStorage.listChatFiles();

      expect(chatFiles).toEqual([
        join('./data/chats', 'chat-123-test.json'),
        join('./data/chats', 'chat-456-another.json'),
      ]);
    });

    it('should return empty array when chats directory does not exist', async () => {
      const error = new Error('Directory not found') as any;
      error.code = 'ENOENT';
      mockFs.readdir.mockRejectedValue(error);

      const chatFiles = await fileStorage.listChatFiles();

      expect(chatFiles).toEqual([]);
    });
  });

  describe('Backup Operations', () => {
    it('should create backup successfully', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);

      const backupPath = await fileStorage.createBackup('/test/original.json');

      expect(backupPath).toMatch(/\/test\/original\.json\.backup\.\d+/);
      expect(mockFs.copyFile).toHaveBeenCalledWith(
        '/test/original.json',
        expect.stringMatching(/\/test\/original\.json\.backup\.\d+/),
      );
    });

    it('should return null for non-existent file backup', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const backupPath = await fileStorage.createBackup('/non-existent.json');

      expect(backupPath).toBeNull();
      expect(mockFs.copyFile).not.toHaveBeenCalled();
    });

    it('should handle backup creation errors gracefully', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.copyFile.mockRejectedValue(new Error('Backup failed'));

      const backupPath = await fileStorage.createBackup('/test/file.json');

      expect(backupPath).toBeNull();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create backup'),
        expect.any(Error),
      );
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should use exponential backoff between retries', async () => {
      jest.useFakeTimers();

      const calculateBackoffDelaySpy = jest.spyOn(utils, 'calculateBackoffDelay');
      calculateBackoffDelaySpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

      mockFs.writeFile
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'))
        .mockResolvedValueOnce(undefined);

      const writePromise = fileStorage.writeJSONFile('/test/file.json', { test: 'data' });

      // Advance timers to complete retries
      await jest.advanceTimersByTimeAsync(3000);
      await writePromise;

      expect(utils.calculateBackoffDelay).toHaveBeenCalledWith(0, 1000);
      expect(utils.calculateBackoffDelay).toHaveBeenCalledWith(1, 1000);
    });

    it('should log warnings for each failed attempt', async () => {
      mockFs.writeFile
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce(undefined);

      await fileStorage.writeJSONFile('/test/file.json', { test: 'data' });

      expect(mockConsole.warn).toHaveBeenCalledWith(
        'FileStorage: Write attempt 1 failed for /test/file.json:',
        expect.any(Error),
      );
    });
  });
});

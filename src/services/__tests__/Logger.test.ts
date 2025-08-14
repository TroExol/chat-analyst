import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { Logger, DEFAULT_LOGGER_CONFIG, type TLoggerConfig } from '../Logger';
import { FileStorage } from '../../storage/FileStorage';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    appendFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('../../storage/FileStorage');

// Spy on console methods but don't suppress output in tests
const consoleSpy = {
  log: jest.spyOn(console, 'log').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
};

describe('Logger', () => {
  let logger: Logger;
  let mockFileStorage: jest.Mocked<FileStorage>;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear console spy calls from previous tests
    consoleSpy.log.mockClear();
    consoleSpy.warn.mockClear();
    consoleSpy.error.mockClear();
    consoleSpy.debug.mockClear();

    // Setup FileStorage mock
    mockFileStorage = {
      initialize: jest.fn(),
      generateLogFilePath: jest.fn(),
      getFileStats: jest.fn(),
    } as any;

    mockFileStorage.initialize.mockResolvedValue(undefined);
    mockFileStorage.generateLogFilePath.mockReturnValue('./data/logs/app.log');
    mockFileStorage.getFileStats.mockResolvedValue(null);

    (FileStorage as jest.MockedClass<typeof FileStorage>).mockImplementation(() => mockFileStorage);

    logger = new Logger();
  });

  afterEach(async () => {
    if (logger) {
      await logger.destroy();
    }
  });

  describe('Constructor and Configuration', () => {
    it('should create Logger with default configuration', () => {
      const testLogger = new Logger();

      expect(testLogger.getConfig()).toEqual(DEFAULT_LOGGER_CONFIG);
    });

    it('should create Logger with custom configuration', () => {
      const customConfig: Partial<TLoggerConfig> = {
        logLevel: 'debug',
        enableConsoleOutput: false,
        enableFileOutput: true,
        maxFileSize: 5 * 1024 * 1024,
      };

      const testLogger = new Logger(customConfig);
      const config = testLogger.getConfig();

      expect(config.logLevel).toBe('debug');
      expect(config.enableConsoleOutput).toBe(false);
      expect(config.enableFileOutput).toBe(true);
      expect(config.maxFileSize).toBe(5 * 1024 * 1024);
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully with file output enabled', async () => {
      const testLogger = new Logger({ enableFileOutput: true });

      await testLogger.initialize();

      expect(mockFileStorage.initialize).toHaveBeenCalledTimes(1);
      expect(testLogger.getStats().isInitialized).toBe(true);

      await testLogger.destroy();
    });

    it('should initialize successfully with file output disabled', async () => {
      const testLogger = new Logger({ enableFileOutput: false });

      await testLogger.initialize();

      expect(testLogger.getStats().isInitialized).toBe(true);

      await testLogger.destroy();
    });

    it('should handle file storage initialization errors', async () => {
      mockFileStorage.initialize.mockRejectedValue(new Error('Init failed'));
      const testLogger = new Logger({ enableFileOutput: true });

      await testLogger.initialize();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Logger: Failed to initialize file logging:',
        expect.any(Error),
      );
      expect(testLogger.getStats().isInitialized).toBe(true);

      await testLogger.destroy();
    });
  });

  describe('Logging Methods', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should log info messages', () => {
      logger.info('TestComponent', 'Test info message', { key: 'value' });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('INFO'),
        { key: 'value' },
      );
    });

    it('should log warning messages', () => {
      logger.warn('TestComponent', 'Test warning message', { key: 'value' });

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('WARN'),
        { key: 'value' },
      );
    });

    it('should log error messages with Error object', () => {
      const testError = new Error('Test error');

      logger.error('TestComponent', 'Test error message', testError);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('ERROR'),
        expect.objectContaining({
          errorName: 'Error',
          errorMessage: 'Test error',
          errorStack: expect.any(String),
        }),
      );
    });

    it('should log debug messages when level allows', () => {
      const testLogger = new Logger({ logLevel: 'debug' });
      testLogger.debug('TestComponent', 'Test debug message', { debug: true });

      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG'),
        { debug: true },
      );
    });

    it('should respect log level filtering', () => {
      const warnLogger = new Logger({ logLevel: 'warn' });

      // Count initial calls
      const initialLogCalls = consoleSpy.log.mock.calls.length;
      const initialWarnCalls = consoleSpy.warn.mock.calls.length;

      warnLogger.info('TestComponent', 'This should be filtered');
      warnLogger.warn('TestComponent', 'This should pass');

      // Info should be filtered (no new log calls)
      expect(consoleSpy.log).toHaveBeenCalledTimes(initialLogCalls);
      // Warn should pass (one new warn call)
      expect(consoleSpy.warn).toHaveBeenCalledTimes(initialWarnCalls + 1);
      expect(consoleSpy.warn).toHaveBeenLastCalledWith(
        expect.stringContaining('WARN'),
        '',
      );
    });

    it('should disable console output when configured', async () => {
      // Clear mocks to have clean state
      jest.clearAllMocks();

      const noConsoleLogger = new Logger({ enableConsoleOutput: false });
      await noConsoleLogger.initialize();

      noConsoleLogger.info('TestComponent', 'Test message');

      expect(consoleSpy.log).not.toHaveBeenCalled();

      await noConsoleLogger.destroy();
    });
  });

  describe('File Output', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should write log entries to file when enabled', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      fileLogger.info('TestComponent', 'Test message');

      // Wait for async file write
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        './data/logs/app.log',
        expect.stringContaining('TestComponent'),
        'utf8',
      );

      await fileLogger.destroy();
    });

    it('should handle file write errors gracefully', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      mockFs.appendFile.mockRejectedValue(new Error('Write failed'));

      fileLogger.error('TestComponent', 'Test error');

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Logger: Failed to write to log file:',
        expect.any(Error),
      );

      await fileLogger.destroy();
    });
  });

  describe('Log Level Management', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should filter messages after log level change', () => {
      logger.setLogLevel('error');

      // Clear previous calls
      jest.clearAllMocks();

      logger.info('TestComponent', 'This should be filtered');
      logger.error('TestComponent', 'This should pass');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should return accurate statistics', () => {
      const stats = logger.getStats();

      expect(stats).toEqual({
        queueSize: expect.any(Number),
        isWriting: expect.any(Boolean),
        isInitialized: true,
        currentLogLevel: expect.any(String),
      });
    });

    it('should track write queue size', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      // Make file writes slow to build up queue
      mockFs.appendFile.mockImplementation(() =>
        new Promise<void>(resolve => setTimeout(resolve, 10)),
      );

      fileLogger.info('TestComponent', 'Message 1');
      fileLogger.info('TestComponent', 'Message 2');

      const stats = fileLogger.getStats();
      expect(stats.queueSize).toBeGreaterThanOrEqual(0);

      await fileLogger.destroy();
    });
  });

  describe('Structured Logging', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should format structured log entries for file output', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      const metadata = { userId: 123, action: 'login' };
      fileLogger.info('AuthService', 'User login successful', metadata);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"component":"AuthService"'),
        'utf8',
      );

      await fileLogger.destroy();
    });

    it('should handle metadata with nested objects', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      const complexMetadata = {
        user: { id: 123, name: 'Test User' },
        request: { method: 'POST', path: '/api/test' },
      };

      fileLogger.info('APIService', 'Request processed', complexMetadata);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"metadata"'),
        'utf8',
      );

      await fileLogger.destroy();
    });
  });

  describe('Color Coding', () => {
    beforeEach(async () => {
      await logger.initialize();
    });

    it('should reset colors after each log', () => {
      logger.info('TestComponent', 'Test message');

      const logCall = (consoleSpy.log as jest.Mock).mock.calls[0][0];
      expect(logCall).toContain('\x1b[0m'); // Reset code
    });
  });

  describe('Destruction and Cleanup', () => {
    it('should flush remaining logs on destroy', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      fileLogger.info('TestComponent', 'Final message');

      await fileLogger.destroy();

      // Should have processed the final message
      expect(mockFs.appendFile).toHaveBeenCalled();
    });

    it('should handle destroy errors gracefully', async () => {
      const fileLogger = new Logger({ enableFileOutput: true });
      await fileLogger.initialize();

      mockFs.appendFile.mockRejectedValue(new Error('Write failed'));

      await expect(fileLogger.destroy()).resolves.not.toThrow();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ErrorHandler, ErrorType, DEFAULT_ERROR_HANDLER_CONFIG, type TErrorHandlerConfig } from '../ErrorHandler';
import { Logger } from '../Logger';
import * as utils from '../../utils';

// Mock Logger
jest.mock('../Logger');

// Mock utils
const mockCalculateBackoffDelay = jest.fn((attempt: number, base: number = 1000) => base * Math.pow(2, attempt));

jest.spyOn(utils, 'calculateBackoffDelay').mockImplementation(mockCalculateBackoffDelay);

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: jest.Mocked<Logger>;

  const createTestError = (message: string, code?: string): Error => {
    const error = new Error(message);
    if (code) {
      (error as any).code = code;
    }
    return error;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Reset mock implementation
    mockCalculateBackoffDelay.mockImplementation(
      (attempt: number, base: number = 1000) => base * Math.pow(2, attempt),
    );

    // Setup Logger mock
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);

    errorHandler = new ErrorHandler(mockLogger);
  });

  afterEach(async () => {
    if (errorHandler) {
      await errorHandler.destroy();
    }
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create ErrorHandler with default configuration', () => {
      const handler = new ErrorHandler(mockLogger);
      const stats = handler.getErrorStats();

      expect(stats.config.maxRetries).toBe(DEFAULT_ERROR_HANDLER_CONFIG.maxRetries);
    });

    it('should create ErrorHandler with custom configuration', () => {
      const customConfig: Partial<TErrorHandlerConfig> = {
        maxRetries: 10,
        baseDelay: 2000,
        enableBuffering: false,
        bufferSize: 500,
      };

      const handler = new ErrorHandler(mockLogger, customConfig);
      const stats = handler.getErrorStats();

      expect(stats.config.maxRetries).toBe(10);
      expect(stats.config.baseDelay).toBe(2000);
      expect(stats.config.enableBuffering).toBe(false);
      expect(stats.config.bufferSize).toBe(500);

      handler.destroy();
    });
  });

  describe('Error Classification', () => {
    it('should classify unknown errors correctly', async () => {
      const unknownError = createTestError('Some unknown error');
      const operation = jest.fn<() => Promise<string>>().mockRejectedValue(unknownError);

      try {
        await errorHandler.handleError(unknownError, operation, 'test');
      } catch {
        // Expected to throw
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Error in test'),
        expect.objectContaining({
          errorType: ErrorType.UNKNOWN,
        }),
      );
    });
  });

  describe('Retry Logic', () => {
    it('should not retry validation errors', async () => {
      const validationError = createTestError('Invalid input data');
      const operation = jest.fn<() => Promise<string>>().mockRejectedValue(validationError);

      // Mock classification to return VALIDATION
      jest.spyOn(errorHandler as any, 'classifyError').mockReturnValue(ErrorType.VALIDATION);

      await expect(errorHandler.handleError(validationError, operation, 'test')).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(0); // No retries for validation errors
    });

    it('should stop retrying after max attempts', async () => {
      const networkError = createTestError('Persistent network error', 'ECONNREFUSED');
      const operation = jest.fn<() => Promise<string>>().mockRejectedValue(networkError);

      const handler = new ErrorHandler(mockLogger, { maxRetries: 2 });

      await expect(handler.handleError(networkError, operation, 'test-operation')).rejects.toThrow();

      // Should have tried initial call + 2 retries = 3 total
      expect(operation).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('All retry attempts exhausted'),
        expect.any(Object),
      );

      await handler.destroy();
    });
  });

  describe('Connection Error Handling', () => {
    it('should handle connection errors with specific retry logic', async () => {
      const connectionError = createTestError('Connection lost', 'ECONNRESET');
      const reconnectOperation = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(connectionError)
        .mockResolvedValueOnce('reconnected');

      const result = await errorHandler.handleConnectionError(connectionError, reconnectOperation, 'long-poll');

      expect(result).toBe('reconnected');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Connection error in long-poll'),
        expect.any(Object),
      );
    });
  });

  describe('Operation Buffering', () => {
    it('should buffer operations when enabled and error is bufferable', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: true });

      const networkError = createTestError('Network unavailable', 'ECONNREFUSED');
      const operation = jest.fn<() => Promise<string>>().mockRejectedValue(networkError);

      // Mock shouldRetry to return false so it goes to buffering
      jest.spyOn(handler as any, 'shouldRetry').mockReturnValue(false);

      await expect(handler.handleError(networkError, operation, 'test-operation')).rejects.toThrow();

      const bufferStats = handler.getBufferStats();
      expect(bufferStats.bufferSize).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Operation buffered for retry'),
        expect.any(Object),
      );

      await handler.destroy();
    });

    it('should not buffer when buffering is disabled', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: false });

      const networkError = createTestError('Network unavailable', 'ECONNREFUSED');
      const operation = jest.fn<() => Promise<string>>().mockRejectedValue(networkError);

      jest.spyOn(handler as any, 'shouldRetry').mockReturnValue(false);

      await expect(handler.handleError(networkError, operation, 'test-operation')).rejects.toThrow();

      const bufferStats = handler.getBufferStats();
      expect(bufferStats.bufferSize).toBe(0);

      await handler.destroy();
    });

    it('should process buffered operations successfully', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: true });

      const operation = jest.fn<() => Promise<string>>().mockResolvedValue('success');

      await handler.bufferOperation(operation, 'test-context', new Error('Initial error'));

      await handler.processBuffer();

      const bufferStats = handler.getBufferStats();
      expect(bufferStats.bufferSize).toBe(0); // Should be empty after successful processing
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Buffered operation succeeded'),
        expect.any(Object),
      );

      await handler.destroy();
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track successful recoveries', async () => {
      const networkError = createTestError('Temporary network error', 'ECONNREFUSED');
      const operation = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const result = await errorHandler.handleError(networkError, operation, 'test-operation');

      expect(result).toBe('success');
      const stats = errorHandler.getErrorStats();
      expect(stats.successfulRecoveries).toBe(1);
    });
  });

  describe('Buffer Management', () => {
    it('should clear buffer when requested', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: true });

      await handler.bufferOperation(jest.fn<() => Promise<string>>().mockResolvedValue('success'), 'test', new Error('error'));

      expect(handler.getBufferStats().bufferSize).toBe(1);

      handler.clearBuffer();

      expect(handler.getBufferStats().bufferSize).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Buffer cleared'),
        expect.objectContaining({ clearedOperations: 1 }),
      );

      await handler.destroy();
    });

    it('should provide buffer statistics', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: true });

      await handler.bufferOperation(jest.fn<() => Promise<string>>().mockResolvedValue('high-priority'), 'test-1', new Error('error'), 'high');
      await handler.bufferOperation(jest.fn<() => Promise<string>>().mockResolvedValue('normal-priority'), 'test-2', new Error('error'), 'normal');

      const bufferStats = handler.getBufferStats();

      expect(bufferStats).toEqual({
        bufferSize: 2,
        isProcessing: false,
        operationsByPriority: { high: 1, normal: 1, low: 0 },
        oldestOperationAge: expect.any(Number),
      });

      await handler.destroy();
    });
  });

  describe('Destruction and Cleanup', () => {
    it('should process remaining buffer on destroy', async () => {
      const handler = new ErrorHandler(mockLogger, { enableBuffering: true });

      const operation = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      await handler.bufferOperation(operation, 'final-test', new Error('error'));

      await handler.destroy();

      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('Processing 1 remaining buffered operations'),
      );
    });

    it('should log final statistics on destroy', async () => {
      const handler = new ErrorHandler(mockLogger);

      await handler.destroy();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'ErrorHandler',
        expect.stringContaining('ErrorHandler shutdown complete'),
        expect.objectContaining({
          finalStats: expect.any(Object),
          remainingBufferSize: expect.any(Number),
        }),
      );
    });
  });
});

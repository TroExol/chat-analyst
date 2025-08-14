import type { TErrorRecoveryConfig } from '../types';
import { calculateBackoffDelay } from '../utils';
import { Logger } from './Logger';

/**
 * Error types for classification
 */
export enum ErrorType {
  NETWORK = 'network',
  API = 'api',
  FILE_SYSTEM = 'filesystem',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  UNKNOWN = 'unknown',
}

/**
 * Extended error recovery configuration
 */
export interface TErrorHandlerConfig extends TErrorRecoveryConfig {
  enableBuffering: boolean;
  bufferFlushInterval: number; // Interval to flush buffer in ms
  errorClassificationRules: Map<string, ErrorType>;
}

/**
 * Default ErrorHandler configuration
 */
export const DEFAULT_ERROR_HANDLER_CONFIG: TErrorHandlerConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
  bufferSize: 1000,
  stateSaveInterval: 30000,
  enableBuffering: true,
  bufferFlushInterval: 5000,
  errorClassificationRules: new Map([
    ['ENOTFOUND', ErrorType.NETWORK],
    ['ECONNREFUSED', ErrorType.NETWORK],
    ['ETIMEDOUT', ErrorType.TIMEOUT],
    ['ECONNRESET', ErrorType.NETWORK],
    ['fetch failed', ErrorType.NETWORK],
    ['Invalid access token', ErrorType.API],
    ['Too many requests', ErrorType.RATE_LIMIT],
    ['ENOENT', ErrorType.FILE_SYSTEM],
    ['EACCES', ErrorType.FILE_SYSTEM],
    ['EMFILE', ErrorType.FILE_SYSTEM],
  ]),
};

/**
 * Buffered operation for retry processing
 */
interface TBufferedOperation<T = any> {
  id: string;
  operation: () => Promise<T>;
  context: string;
  timestamp: Date;
  retryCount: number;
  lastError?: Error;
  priority: 'high' | 'normal' | 'low';
}

/**
 * Error statistics for monitoring
 */
interface TErrorStats {
  totalErrors: number;
  errorsByType: Map<ErrorType, number>;
  retriesByType: Map<ErrorType, number>;
  successfulRecoveries: number;
  bufferOverflows: number;
  lastErrorTimestamp?: Date;
}

/**
 * ErrorHandler with exponential backoff, error classification, and message buffering
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export class ErrorHandler {
  private config: TErrorHandlerConfig;
  private logger: Logger;
  private buffer = new Map<string, TBufferedOperation>();
  private isProcessingBuffer = false;
  private bufferFlushTimer?: ReturnType<typeof setInterval>;
  private stats: TErrorStats;

  constructor(logger: Logger, config: Partial<TErrorHandlerConfig> = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_ERROR_HANDLER_CONFIG, ...config };

    this.stats = {
      totalErrors: 0,
      errorsByType: new Map(),
      retriesByType: new Map(),
      successfulRecoveries: 0,
      bufferOverflows: 0,
    };

    // Start buffer flush timer if buffering is enabled
    if (this.config.enableBuffering) {
      this.startBufferFlushTimer();
    }
  }

  /**
   * Handle error with automatic retry logic and exponential backoff
   * @param error - Error to handle
   * @param operation - Operation to retry
   * @param context - Context information for logging
   * @param maxRetries - Override max retries for this specific operation
   */
  async handleError<T>(
    error: Error,
    operation: () => Promise<T>,
    context: string,
    maxRetries?: number,
  ): Promise<T> {
    const errorType = this.classifyError(error);
    const retriesLimit = maxRetries ?? this.config.maxRetries;

    this.updateStats(error, errorType);

    this.logger.error('ErrorHandler', `Error in ${context}: ${error.message}`, {
      errorType,
      context,
      errorStack: error.stack,
    });

    // Try immediate retry for retryable errors
    if (this.shouldRetry(error, errorType, 0)) {
      return this.retryWithBackoff(operation, context, error, errorType, retriesLimit);
    }

    // Buffer operation for later retry if buffering is enabled
    if (this.config.enableBuffering && this.shouldBuffer(errorType)) {
      await this.bufferOperation(operation, context, error);
      throw error; // Still throw the error for immediate handling
    }

    throw error;
  }

  /**
   * Handle connection errors specifically (requirement 4.1)
   * @param error - Connection error
   * @param reconnectOperation - Function to attempt reconnection
   * @param context - Context information
   */
  async handleConnectionError<T>(
    error: Error,
    reconnectOperation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    const errorType = this.classifyError(error);

    this.logger.warn('ErrorHandler', `Connection error in ${context}, attempting recovery`, {
      errorType,
      context,
      errorMessage: error.message,
    });

    // Use specific retry logic for connection errors
    return this.handleError(error, reconnectOperation, `${context} (reconnection)`, this.config.maxRetries);
  }

  /**
   * Handle file system errors specifically (requirement 4.2)
   * @param error - File system error
   * @param operation - File operation to retry
   * @param context - Context information
   */
  async handleFileSystemError<T>(
    error: Error,
    operation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    const errorType = this.classifyError(error);

    this.logger.warn('ErrorHandler', `File system error in ${context}`, {
      errorType,
      context,
      errorMessage: error.message,
      errorCode: (error as any).code,
    });

    // Use reduced retry count for file system errors
    const fileSystemRetries = Math.min(3, this.config.maxRetries);
    return this.handleError(error, operation, `${context} (file operation)`, fileSystemRetries);
  }

  /**
   * Buffer operation for later retry (requirement 4.3, 4.4)
   * @param operation - Operation to buffer
   * @param context - Context information
   * @param error - Last error encountered
   * @param priority - Operation priority
   */
  async bufferOperation<T>(
    operation: () => Promise<T>,
    context: string,
    error: Error,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ): Promise<void> {
    if (!this.config.enableBuffering) {
      return;
    }

    // Check buffer capacity
    if (this.buffer.size >= this.config.bufferSize) {
      this.handleBufferOverflow();
      return;
    }

    const operationId = `${context}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const bufferedOp: TBufferedOperation<T> = {
      id: operationId,
      operation,
      context,
      timestamp: new Date(),
      retryCount: 0,
      lastError: error,
      priority,
    };

    this.buffer.set(operationId, bufferedOp);

    this.logger.info('ErrorHandler', `Operation buffered for retry: ${context}`, {
      operationId,
      bufferSize: this.buffer.size,
      priority,
    });
  }

  /**
   * Process buffered operations (requirement 4.4)
   */
  async processBuffer(): Promise<void> {
    if (this.isProcessingBuffer || this.buffer.size === 0) {
      return;
    }

    this.isProcessingBuffer = true;
    this.logger.info('ErrorHandler', `Processing buffer with ${this.buffer.size} operations`);

    // Sort operations by priority and age
    const operations = Array.from(this.buffer.values()).sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // If same priority, process older operations first
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    let successCount = 0;
    let failureCount = 0;

    for (const op of operations) {
      try {
        await op.operation();
        this.buffer.delete(op.id);
        successCount++;
        this.stats.successfulRecoveries++;

        this.logger.debug('ErrorHandler', `Buffered operation succeeded: ${op.context}`, {
          operationId: op.id,
          retryCount: op.retryCount,
        });
      } catch (error) {
        op.retryCount++;
        op.lastError = error as Error;

        if (op.retryCount >= this.config.maxRetries) {
          this.buffer.delete(op.id);
          failureCount++;

          this.logger.error('ErrorHandler', `Buffered operation failed permanently: ${op.context}`, {
            operationId: op.id,
            retryCount: op.retryCount,
            finalError: (error as Error).message,
          });
        } else {
          this.logger.warn('ErrorHandler', `Buffered operation retry failed: ${op.context}`, {
            operationId: op.id,
            retryCount: op.retryCount,
            error: (error as Error).message,
          });
        }
      }
    }

    this.logger.info('ErrorHandler', 'Buffer processing completed', {
      successCount,
      failureCount,
      remainingOperations: this.buffer.size,
    });

    this.isProcessingBuffer = false;
  }

  /**
   * Get current buffer status and statistics
   */
  getBufferStats(): {
    bufferSize: number;
    isProcessing: boolean;
    operationsByPriority: { high: number; normal: number; low: number };
    oldestOperationAge?: number;
    } {
    const operationsByPriority = { high: 0, normal: 0, low: 0 };
    let oldestTimestamp: number | undefined;

    for (const op of this.buffer.values()) {
      operationsByPriority[op.priority]++;

      if (!oldestTimestamp || op.timestamp.getTime() < oldestTimestamp) {
        oldestTimestamp = op.timestamp.getTime();
      }
    }

    return {
      bufferSize: this.buffer.size,
      isProcessing: this.isProcessingBuffer,
      operationsByPriority,
      oldestOperationAge: oldestTimestamp ? Date.now() - oldestTimestamp : undefined,
    };
  }

  /**
   * Get comprehensive error statistics
   */
  getErrorStats(): TErrorStats & {
    config: TErrorHandlerConfig;
    bufferStats: ReturnType<ErrorHandler['getBufferStats']>;
    } {
    return {
      ...this.stats,
      config: this.config,
      bufferStats: this.getBufferStats(),
    };
  }

  /**
   * Clear buffer (useful for testing or manual intervention)
   */
  clearBuffer(): void {
    const clearedCount = this.buffer.size;
    this.buffer.clear();

    this.logger.info('ErrorHandler', 'Buffer cleared', { clearedOperations: clearedCount });
  }

  /**
   * Shutdown error handler and process remaining buffer
   */
  async destroy(): Promise<void> {
    this.logger.info('ErrorHandler', 'Shutting down ErrorHandler...');

    // Stop buffer flush timer
    if (this.bufferFlushTimer) {
      clearInterval(this.bufferFlushTimer);
      this.bufferFlushTimer = undefined;
    }

    // Process remaining buffered operations
    if (this.buffer.size > 0) {
      this.logger.info('ErrorHandler', `Processing ${this.buffer.size} remaining buffered operations`);
      await this.processBuffer();
    }

    this.logger.info('ErrorHandler', 'ErrorHandler shutdown complete', {
      finalStats: this.stats,
      remainingBufferSize: this.buffer.size,
    });
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    context: string,
    originalError: Error,
    errorType: ErrorType,
    maxRetries: number,
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delay = calculateBackoffDelay(attempt - 1, this.config.baseDelay, this.config.maxDelay, this.config.backoffMultiplier);

      this.logger.info('ErrorHandler', `Retrying operation: ${context} (attempt ${attempt}/${maxRetries})`, {
        delay,
        errorType,
        context,
      });

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        const result = await operation();

        this.stats.successfulRecoveries++;
        this.updateRetryStats(errorType);

        this.logger.info('ErrorHandler', `Operation succeeded after ${attempt} retries: ${context}`, {
          attempt,
          context,
          errorType,
        });

        return result;
      } catch (error) {
        const retryError = error as Error;
        const retryErrorType = this.classifyError(retryError);

        this.logger.warn('ErrorHandler', `Retry attempt ${attempt} failed: ${context}`, {
          attempt,
          maxRetries,
          errorType: retryErrorType,
          errorMessage: retryError.message,
        });

        // If this was the last attempt, throw the error
        if (attempt === maxRetries) {
          this.logger.error('ErrorHandler', `All retry attempts exhausted for: ${context}`, {
            totalAttempts: attempt,
            originalError: originalError.message,
            finalError: retryError.message,
          });
          throw retryError;
        }

        // Check if we should continue retrying based on the new error
        if (!this.shouldRetry(retryError, retryErrorType, attempt)) {
          this.logger.warn('ErrorHandler', `Stopping retries due to non-retryable error: ${context}`, {
            errorType: retryErrorType,
            errorMessage: retryError.message,
          });
          throw retryError;
        }
      }
    }

    // This should never be reached, but TypeScript requires it
    throw originalError;
  }

  private classifyError(error: Error): ErrorType {
    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code;

    // Check error code first
    if (errorCode && this.config.errorClassificationRules.has(errorCode)) {
      return this.config.errorClassificationRules.get(errorCode)!;
    }

    // Check error message patterns
    for (const [pattern, type] of this.config.errorClassificationRules.entries()) {
      if (errorMessage.includes(pattern.toLowerCase())) {
        return type;
      }
    }

    // Additional pattern matching
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return ErrorType.TIMEOUT;
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return ErrorType.RATE_LIMIT;
    }

    if (errorMessage.includes('invalid') || errorMessage.includes('validation')) {
      return ErrorType.VALIDATION;
    }

    return ErrorType.UNKNOWN;
  }

  private shouldRetry(error: Error, errorType: ErrorType, attempt: number): boolean {
    // Don't retry validation errors
    if (errorType === ErrorType.VALIDATION) {
      return false;
    }

    // Don't retry if we've exceeded max attempts
    if (attempt >= this.config.maxRetries) {
      return false;
    }

    // Retry network, API, timeout, and file system errors
    return [ErrorType.NETWORK, ErrorType.API, ErrorType.TIMEOUT, ErrorType.FILE_SYSTEM, ErrorType.RATE_LIMIT].includes(errorType);
  }

  private shouldBuffer(errorType: ErrorType): boolean {
    // Buffer operations that might succeed later
    return [ErrorType.NETWORK, ErrorType.FILE_SYSTEM, ErrorType.TIMEOUT, ErrorType.RATE_LIMIT].includes(errorType);
  }

  private updateStats(error: Error, errorType: ErrorType): void {
    this.stats.totalErrors++;
    this.stats.lastErrorTimestamp = new Date();

    const currentCount = this.stats.errorsByType.get(errorType) || 0;
    this.stats.errorsByType.set(errorType, currentCount + 1);
  }

  private updateRetryStats(errorType: ErrorType): void {
    const currentCount = this.stats.retriesByType.get(errorType) || 0;
    this.stats.retriesByType.set(errorType, currentCount + 1);
  }

  private handleBufferOverflow(): void {
    this.stats.bufferOverflows++;

    // Remove oldest low priority operations
    const lowPriorityOps = Array.from(this.buffer.entries())
      .filter(([, op]) => op.priority === 'low')
      .sort(([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime());

    const toRemove = Math.max(1, Math.floor(this.config.bufferSize * 0.1));

    for (let i = 0; i < Math.min(toRemove, lowPriorityOps.length); i++) {
      const [operationId] = lowPriorityOps[i];
      this.buffer.delete(operationId);
    }

    this.logger.warn('ErrorHandler', `Buffer overflow handled, removed ${toRemove} old operations`, {
      bufferSize: this.buffer.size,
      removedOperations: toRemove,
    });
  }

  private startBufferFlushTimer(): void {
    this.bufferFlushTimer = setInterval(() => {
      if (this.buffer.size > 0) {
        this.processBuffer().catch(error => {
          this.logger.error('ErrorHandler', 'Failed to process buffer during scheduled flush', error);
        });
      }
    }, this.config.bufferFlushInterval);
  }
}

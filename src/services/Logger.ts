import { promises as fs } from 'fs';
import type { TLogEntry } from '../types';
import { FileStorage } from '../storage/FileStorage';

/**
 * Configuration for Logger
 */
export interface TLoggerConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
  logDirectory: string;
  logFileName: string;
  maxFileSize: number; // in bytes
  maxFiles: number; // number of rotated files to keep
  dateFormat: string;
}

/**
 * Default Logger configuration
 */
export const DEFAULT_LOGGER_CONFIG: TLoggerConfig = {
  logLevel: 'info',
  enableConsoleOutput: true,
  enableFileOutput: true,
  logDirectory: './data/logs',
  logFileName: 'app.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  dateFormat: 'YYYY-MM-DD HH:mm:ss',
};

/**
 * Log levels with numeric priority for filtering
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/**
 * Logger class with structured logging, file rotation, and multiple output streams
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export class Logger {
  private config: TLoggerConfig;
  private fileStorage?: FileStorage;
  private isInitialized = false;
  private writeQueue: TLogEntry[] = [];
  private isWriting = false;

  constructor(config: Partial<TLoggerConfig> = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };

    if (this.config.enableFileOutput) {
      this.fileStorage = new FileStorage({
        logsPath: this.config.logDirectory,
      });
    }
  }

  /**
   * Initialize logger and ensure log directory exists
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.config.enableFileOutput && this.fileStorage) {
      try {
        await this.fileStorage.initialize();
        this.isInitialized = true;

        // Log initialization
        this.info('Logger', 'Logger initialized successfully', {
          config: {
            logLevel: this.config.logLevel,
            enableConsoleOutput: this.config.enableConsoleOutput,
            enableFileOutput: this.config.enableFileOutput,
            logDirectory: this.config.logDirectory,
          },
        });
      } catch (error) {
        console.error('Logger: Failed to initialize file logging:', error);
        // Continue with console-only logging
        this.config.enableFileOutput = false;
        this.isInitialized = true;
      }
    } else {
      this.isInitialized = true;
    }
  }

  /**
   * Log info level message
   * @param component - Component name that generated the log
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  info(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('info', component, message, metadata);
  }

  /**
   * Log warning level message
   * @param component - Component name that generated the log
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  warn(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', component, message, metadata);
  }

  /**
   * Log error level message
   * @param component - Component name that generated the log
   * @param message - Log message
   * @param error - Error object or additional metadata
   */
  error(component: string, message: string, error?: Error | Record<string, unknown>): void {
    let metadata: Record<string, unknown> = {};

    if (error instanceof Error) {
      metadata = {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
      };
    } else if (error) {
      metadata = error as Record<string, unknown>;
    }

    this.log('error', component, message, metadata);
  }

  /**
   * Log debug level message
   * @param component - Component name that generated the log
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  debug(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', component, message, metadata);
  }

  /**
   * Core logging method
   * @param level - Log level
   * @param component - Component name
   * @param message - Log message
   * @param metadata - Additional metadata
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', component: string, message: string, metadata?: Record<string, unknown>): void {
    // Check if log level meets threshold
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.logLevel]) {
      return;
    }

    const logEntry: TLogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      metadata,
    };

    // Console output
    if (this.config.enableConsoleOutput) {
      this.outputToConsole(logEntry);
    }

    // File output
    if (this.config.enableFileOutput && this.isInitialized) {
      this.queueForFileWrite(logEntry);
    }
  }

  /**
   * Output log entry to console with color coding
   */
  private outputToConsole(entry: TLogEntry): void {
    const timestamp = this.formatTimestamp(entry.timestamp);
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const componentStr = `[${entry.component}]`.padEnd(20);

    let colorCode = '';
    const resetCode = '\x1b[0m';

    // Color coding for different log levels
    switch (entry.level) {
    case 'debug':
      colorCode = '\x1b[36m'; // Cyan
      break;
    case 'info':
      colorCode = '\x1b[32m'; // Green
      break;
    case 'warn':
      colorCode = '\x1b[33m'; // Yellow
      break;
    case 'error':
      colorCode = '\x1b[31m'; // Red
      break;
    }

    const logLine = `${colorCode}${timestamp} ${levelStr}${resetCode} ${componentStr} ${entry.message}`;

    // Use appropriate console method
    switch (entry.level) {
    case 'debug':
      console.debug(logLine, entry.metadata || '');
      break;
    case 'info':
      console.log(logLine, entry.metadata || '');
      break;
    case 'warn':
      console.warn(logLine, entry.metadata || '');
      break;
    case 'error':
      console.error(logLine, entry.metadata || '');
      break;
    }
  }

  /**
   * Queue log entry for asynchronous file writing
   */
  private queueForFileWrite(entry: TLogEntry): void {
    this.writeQueue.push(entry);

    // Process queue if not already writing
    if (!this.isWriting) {
      this.processWriteQueue().catch(error => {
        console.error('Logger: Failed to process write queue:', error);
      });
    }
  }

  /**
   * Process the write queue asynchronously
   */
  private async processWriteQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;

    try {
      while (this.writeQueue.length > 0) {
        const entry = this.writeQueue.shift()!;
        await this.writeToFile(entry);
      }
    } catch (error) {
      console.error('Logger: Failed to write to file:', error);
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Write log entry to file with rotation check
   */
  private async writeToFile(entry: TLogEntry): Promise<void> {
    if (!this.fileStorage) {
      return;
    }

    try {
      // Check if log rotation is needed
      await this.checkAndRotateIfNeeded();

      const logFilePath = this.fileStorage.generateLogFilePath(this.config.logFileName);
      const logLine = this.formatLogEntryForFile(entry);

      // Append to log file
      await fs.appendFile(logFilePath, logLine + '\n', 'utf8');
    } catch (error) {
      console.error('Logger: Failed to write to log file:', error);
    }
  }

  /**
   * Format log entry for file output (JSON structured)
   */
  private formatLogEntryForFile(entry: TLogEntry): string {
    const fileEntry: Record<string, unknown> = {
      timestamp: entry.timestamp.toISOString(),
      level: entry.level,
      component: entry.component,
      message: entry.message,
      ...(entry.metadata && { metadata: entry.metadata }),
    };

    return JSON.stringify(fileEntry);
  }

  /**
   * Format timestamp for console output
   */
  private formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  /**
   * Check if log file needs rotation and perform rotation
   */
  private async checkAndRotateIfNeeded(): Promise<void> {
    if (!this.fileStorage) {
      return;
    }

    const logFilePath = this.fileStorage.generateLogFilePath(this.config.logFileName);

    try {
      const stats = await this.fileStorage.getFileStats(logFilePath);

      if (stats && stats.size >= this.config.maxFileSize) {
        await this.rotateLogFiles();
      }
    } catch (error) {
      // File doesn't exist yet, no rotation needed
      if ((error as any)?.code !== 'ENOENT') {
        console.error('Logger: Failed to check file stats for rotation:', error);
      }
    }
  }

  /**
   * Rotate log files (app.log -> app.log.1 -> app.log.2 -> ... -> deleted)
   */
  private async rotateLogFiles(): Promise<void> {
    if (!this.fileStorage) {
      return;
    }

    try {
      const basePath = this.fileStorage.generateLogFilePath(this.config.logFileName);

      // Remove oldest log file if it exists
      const oldestLogPath = `${basePath}.${this.config.maxFiles}`;
      try {
        await fs.unlink(oldestLogPath);
      } catch {
        // File doesn't exist, that's fine
      }

      // Rotate existing log files
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const oldPath = i === 1 ? basePath : `${basePath}.${i}`;
        const newPath = `${basePath}.${i + 1}`;

        try {
          await fs.rename(oldPath, newPath);
        } catch {
          // File doesn't exist, continue
        }
      }

      // Create new main log file
      await fs.writeFile(basePath, '', 'utf8');

      this.info('Logger', 'Log files rotated successfully', {
        rotatedFile: basePath,
        maxFiles: this.config.maxFiles,
      });
    } catch (error) {
      console.error('Logger: Failed to rotate log files:', error);
    }
  }

  /**
   * Flush any remaining log entries and cleanup
   */
  async destroy(): Promise<void> {
    this.info('Logger', 'Logger shutting down...');

    // Process any remaining entries in the queue
    await this.processWriteQueue();

    this.info('Logger', 'Logger shutdown complete');
  }

  /**
   * Get current logger configuration
   */
  getConfig(): TLoggerConfig {
    return { ...this.config };
  }

  /**
   * Get logger statistics
   */
  getStats(): {
    queueSize: number;
    isWriting: boolean;
    isInitialized: boolean;
    currentLogLevel: string;
    } {
    return {
      queueSize: this.writeQueue.length,
      isWriting: this.isWriting,
      isInitialized: this.isInitialized,
      currentLogLevel: this.config.logLevel,
    };
  }

  /**
   * Change log level at runtime
   */
  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.config.logLevel = level;
    this.info('Logger', `Log level changed to: ${level}`);
  }
}

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { ensureDirectoryExists, sanitizeFileName, calculateBackoffDelay } from '../utils';

/**
 * Configuration for FileStorage operations
 */
export interface TFileStorageConfig {
  baseDataPath: string;
  chatsPath: string;
  cachePath: string;
  logsPath: string;
  maxRetries: number;
  retryBaseDelay: number;
}

/**
 * Default configuration for FileStorage
 */
export const DEFAULT_FILE_STORAGE_CONFIG: TFileStorageConfig = {
  baseDataPath: './data',
  chatsPath: './data/chats',
  cachePath: './data/cache',
  logsPath: './data/logs',
  maxRetries: 3,
  retryBaseDelay: 1000,
};

/**
 * Utility class for safe file operations with error handling and retry logic
 */
export class FileStorage {
  private config: TFileStorageConfig;

  constructor(config: Partial<TFileStorageConfig> = {}) {
    this.config = { ...DEFAULT_FILE_STORAGE_CONFIG, ...config };
  }

  /**
   * Initializes directory structure for the application
   */
  async initialize(): Promise<void> {
    try {
      await ensureDirectoryExists(this.config.baseDataPath);
      await ensureDirectoryExists(this.config.chatsPath);
      await ensureDirectoryExists(this.config.cachePath);
      await ensureDirectoryExists(this.config.logsPath);

      console.log('FileStorage: Directory structure initialized');
    } catch (error) {
      console.error('FileStorage: Failed to initialize directories:', error);
      throw new Error(`Failed to initialize FileStorage directories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Safely reads a JSON file with error handling
   * @param filePath - Path to file to read
   * @returns Promise with parsed JSON data
   */
  async readJSONFile<T = any>(filePath: string): Promise<T | null> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(fileContent) as T;
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        // File doesn't exist - this is expected for new chats
        return null;
      }

      console.error(`FileStorage: Failed to read file ${filePath}:`, error);
      throw new Error(`Failed to read JSON file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Safely writes data to JSON file with retry logic and pretty formatting
   * @param filePath - Path to file to write
   * @param data - Data to write to file
   */
  async writeJSONFile(filePath: string, data: any): Promise<void> {
    // Ensure directory exists
    await ensureDirectoryExists(dirname(filePath));

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Write with pretty formatting for readability (requirement 5.5)
        const jsonContent = JSON.stringify(data, null, 2);
        await fs.writeFile(filePath, jsonContent, 'utf-8');

        if (attempt > 0) {
          console.log(`FileStorage: Successfully wrote ${filePath} on attempt ${attempt + 1}`);
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown write error');
        console.warn(`FileStorage: Write attempt ${attempt + 1} failed for ${filePath}:`, error);

        // If not the last attempt, wait before retrying
        if (attempt < this.config.maxRetries - 1) {
          const delay = calculateBackoffDelay(attempt, this.config.retryBaseDelay);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - requirement 4.2
    console.error(`FileStorage: Failed to write ${filePath} after ${this.config.maxRetries} attempts`);
    throw new Error(`Failed to write file after ${this.config.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Generates safe file path for chat data based on chat ID and name
   * @param chatId - Chat ID from VK
   * @param chatName - Chat name (will be sanitized)
   * @returns Safe file path for chat data
   */
  generateChatFilePath(chatId: number, chatName?: string): string {
    const sanitizedName = chatName ? sanitizeFileName(chatName) : 'unknown';
    const fileName = `chat-${chatId}-${sanitizedName}.json`;
    return join(this.config.chatsPath, fileName);
  }

  /**
   * Generates file path for cache files
   * @param fileName - Name of cache file
   * @returns Safe file path for cache data
   */
  generateCacheFilePath(fileName: string): string {
    const sanitizedName = sanitizeFileName(fileName);
    return join(this.config.cachePath, sanitizedName);
  }

  /**
   * Generates file path for log files
   * @param fileName - Name of log file
   * @returns Safe file path for log data
   */
  generateLogFilePath(fileName: string): string {
    const sanitizedName = sanitizeFileName(fileName);
    return join(this.config.logsPath, sanitizedName);
  }

  /**
   * Checks if file exists
   * @param filePath - Path to check
   * @returns Promise with boolean result
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets file statistics (size, modification time, etc.)
   * @param filePath - Path to file
   * @returns Promise with file stats or null if file doesn't exist
   */
  async getFileStats(filePath: string): Promise<{ size: number; mtime: Date; ctime: Date } | null> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
        ctime: stats.ctime,
      };
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Lists all chat files in the chats directory
   * @returns Promise with array of chat file paths
   */
  async listChatFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.config.chatsPath);
      return files
        .filter(file => file.startsWith('chat-') && file.endsWith('.json'))
        .map(file => join(this.config.chatsPath, file));
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        // Directory doesn't exist yet
        return [];
      }
      throw error;
    }
  }

  /**
   * Creates backup of a file before modification
   * @param filePath - Original file path
   * @returns Promise with backup file path
   */
  async createBackup(filePath: string): Promise<string | null> {
    try {
      if (!(await this.fileExists(filePath))) {
        return null;
      }

      const backupPath = `${filePath}.backup.${Date.now()}`;
      await fs.copyFile(filePath, backupPath);
      return backupPath;
    } catch (error) {
      console.warn(`FileStorage: Failed to create backup for ${filePath}:`, error);
      return null; // Don't fail the main operation due to backup failure
    }
  }

  /**
   * Gets configuration object
   */
  getConfig(): TFileStorageConfig {
    return { ...this.config };
  }
}

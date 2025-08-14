import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { Logger } from './Logger';
import { DataValidator, type TValidationResult } from './DataValidator';
import type { FileStorage } from '../storage/FileStorage';

/**
 * Configuration for file integrity checking
 */
export interface TFileIntegrityConfig {
  enableChecksumValidation: boolean;
  enableBackupCreation: boolean;
  maxCorruptionRecoveryAttempts: number;
  checksumAlgorithm: 'md5' | 'sha1' | 'sha256';
  backupRetentionCount: number;
}

/**
 * Default configuration
 */
export const DEFAULT_FILE_INTEGRITY_CONFIG: TFileIntegrityConfig = {
  enableChecksumValidation: true,
  enableBackupCreation: true,
  maxCorruptionRecoveryAttempts: 3,
  checksumAlgorithm: 'sha256',
  backupRetentionCount: 5,
};

/**
 * File integrity check result
 */
export interface TIntegrityCheckResult {
  filePath: string;
  isValid: boolean;
  isCorrupted: boolean;
  hasBackup: boolean;
  canRecover: boolean;
  issues: string[];
  recoveryActions: string[];
  checksum?: string;
  backupPaths?: string[];
}

/**
 * FileIntegrityChecker validates file integrity and provides recovery mechanisms
 * Requirements: 5.3, 5.5
 */
export class FileIntegrityChecker {
  private logger: Logger;
  private validator: DataValidator;
  private fileStorage: FileStorage;
  private config: TFileIntegrityConfig;
  private checksumCache = new Map<string, string>();

  constructor(
    logger: Logger,
    validator: DataValidator,
    fileStorage: FileStorage,
    config: Partial<TFileIntegrityConfig> = {},
  ) {
    this.logger = logger;
    this.validator = validator;
    this.fileStorage = fileStorage;
    this.config = { ...DEFAULT_FILE_INTEGRITY_CONFIG, ...config };

    this.logger.info('FileIntegrityChecker', 'Initialized', {
      checksumAlgorithm: this.config.checksumAlgorithm,
      enableBackupCreation: this.config.enableBackupCreation,
    });
  }

  /**
   * Perform comprehensive integrity check on startup
   */
  async performStartupIntegrityCheck(directories: string[]): Promise<TIntegrityCheckResult[]> {
    this.logger.info('FileIntegrityChecker', 'Starting comprehensive integrity check');

    const results: TIntegrityCheckResult[] = [];
    let totalFiles = 0;
    let corruptedFiles = 0;
    let recoveredFiles = 0;

    try {
      for (const directory of directories) {
        const directoryResults = await this.checkDirectoryIntegrity(directory);
        results.push(...directoryResults);

        for (const result of directoryResults) {
          totalFiles++;
          if (result.isCorrupted) {
            corruptedFiles++;

            // Attempt recovery
            if (result.canRecover) {
              const recovered = await this.attemptFileRecovery(result);
              if (recovered) {
                recoveredFiles++;
              }
            }
          }
        }
      }

      this.logger.info('FileIntegrityChecker', 'Startup integrity check completed', {
        totalFiles,
        corruptedFiles,
        recoveredFiles,
        healthyFiles: totalFiles - corruptedFiles,
        recoveryRate: corruptedFiles > 0 ? (recoveredFiles / corruptedFiles * 100).toFixed(1) + '%' : '100%',
      });

    } catch (error) {
      this.logger.error('FileIntegrityChecker', 'Startup integrity check failed', {
        error: (error as Error).message,
      });
    }

    return results;
  }

  /**
   * Check integrity of all files in a directory
   */
  async checkDirectoryIntegrity(directory: string): Promise<TIntegrityCheckResult[]> {
    const results: TIntegrityCheckResult[] = [];

    try {
      const files = await fs.readdir(directory);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      this.logger.debug('FileIntegrityChecker', `Checking ${jsonFiles.length} JSON files in ${directory}`);

      for (const file of jsonFiles) {
        const filePath = join(directory, file);
        try {
          const result = await this.checkSingleFile(filePath);
          results.push(result);
        } catch (error) {
          this.logger.error('FileIntegrityChecker', `Failed to check file ${filePath}`, {
            error: (error as Error).message,
          });

          results.push({
            filePath,
            isValid: false,
            isCorrupted: true,
            hasBackup: false,
            canRecover: false,
            issues: [`Check failed: ${(error as Error).message}`],
            recoveryActions: [],
          });
        }
      }

    } catch (error) {
      this.logger.error('FileIntegrityChecker', `Failed to read directory ${directory}`, {
        error: (error as Error).message,
      });
    }

    return results;
  }

  /**
   * Check integrity of a single file
   */
  async checkSingleFile(filePath: string): Promise<TIntegrityCheckResult> {
    const result: TIntegrityCheckResult = {
      filePath,
      isValid: true,
      isCorrupted: false,
      hasBackup: false,
      canRecover: false,
      issues: [],
      recoveryActions: [],
    };

    try {
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        result.isValid = false;
        result.issues.push('File does not exist');
        return result;
      }

      // Read file content
      const content = await fs.readFile(filePath, 'utf8');

      // Calculate and verify checksum if enabled
      if (this.config.enableChecksumValidation) {
        const currentChecksum = this.calculateChecksum(content);
        result.checksum = currentChecksum;

        const expectedChecksum = this.checksumCache.get(filePath);
        if (expectedChecksum && expectedChecksum !== currentChecksum) {
          result.isCorrupted = true;
          result.issues.push('Checksum mismatch - file modified or corrupted');
        }

        // Update checksum cache
        this.checksumCache.set(filePath, currentChecksum);
      }

      // Validate file content structure
      const fileType = this.determineFileType(filePath);
      const validationResult = this.validator.validateJSONFileIntegrity(content, fileType);

      if (!validationResult.isValid) {
        result.isValid = false;
        result.isCorrupted = true;
        result.issues.push(...validationResult.errors);
      }

      if (validationResult.warnings.length > 0) {
        result.issues.push(...validationResult.warnings);
      }

      // Check for backup files
      const backupPaths = await this.findBackupFiles(filePath);
      result.hasBackup = backupPaths.length > 0;
      result.backupPaths = backupPaths;

      // Determine if recovery is possible
      if (result.isCorrupted) {
        result.canRecover = result.hasBackup || this.canAttemptContentRecovery(content);

        if (result.canRecover) {
          result.recoveryActions = this.generateRecoveryActions(result);
        }
      }

    } catch (error) {
      result.isValid = false;
      result.isCorrupted = true;
      result.issues.push(`File check error: ${(error as Error).message}`);
    }

    this.logIntegrityResult(result);
    return result;
  }

  /**
   * Attempt to recover a corrupted file
   */
  async attemptFileRecovery(result: TIntegrityCheckResult): Promise<boolean> {
    this.logger.info('FileIntegrityChecker', `Attempting recovery for ${result.filePath}`);

    try {
      // Try backup restoration first
      if (result.hasBackup && result.backupPaths && result.backupPaths.length > 0) {
        for (const backupPath of result.backupPaths) {
          try {
            const recovered = await this.restoreFromBackup(result.filePath, backupPath);
            if (recovered) {
              this.logger.info('FileIntegrityChecker', `Successfully recovered ${result.filePath} from backup`);
              return true;
            }
          } catch (error) {
            this.logger.warn('FileIntegrityChecker', `Backup restoration failed for ${backupPath}`, {
              error: (error as Error).message,
            });
          }
        }
      }

      // Try content-based recovery
      const contentRecovered = await this.attemptContentRecovery(result.filePath);
      if (contentRecovered) {
        this.logger.info('FileIntegrityChecker', `Successfully recovered ${result.filePath} using content repair`);
        return true;
      }

      // Try recreation from cache/memory if available
      const cacheRecovered = await this.attemptCacheRecovery(result.filePath);
      if (cacheRecovered) {
        this.logger.info('FileIntegrityChecker', `Successfully recovered ${result.filePath} from cache`);
        return true;
      }

    } catch (error) {
      this.logger.error('FileIntegrityChecker', `Recovery failed for ${result.filePath}`, {
        error: (error as Error).message,
      });
    }

    this.logger.error('FileIntegrityChecker', `All recovery attempts failed for ${result.filePath}`);
    return false;
  }

  /**
   * Create backup of a file before modification
   */
  async createBackup(filePath: string): Promise<string | null> {
    if (!this.config.enableBackupCreation) {
      return null;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.backup.${timestamp}`;

      await fs.copyFile(filePath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups(filePath);

      this.logger.debug('FileIntegrityChecker', `Created backup: ${backupPath}`);
      return backupPath;

    } catch (error) {
      this.logger.error('FileIntegrityChecker', `Failed to create backup for ${filePath}`, {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Verify data consistency between cached data and file
   */
  async verifyDataConsistency(filePath: string, cachedData: any): Promise<boolean> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const fileData = JSON.parse(fileContent);

      // Deep comparison (simplified - could be more sophisticated)
      const fileHash = this.calculateChecksum(JSON.stringify(fileData));
      const cacheHash = this.calculateChecksum(JSON.stringify(cachedData));

      const isConsistent = fileHash === cacheHash;

      if (!isConsistent) {
        this.logger.warn('FileIntegrityChecker', `Data inconsistency detected in ${filePath}`, {
          fileHash: fileHash.substring(0, 8),
          cacheHash: cacheHash.substring(0, 8),
        });
      }

      return isConsistent;

    } catch (error) {
      this.logger.error('FileIntegrityChecker', `Consistency check failed for ${filePath}`, {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Calculate file checksum
   */
  private calculateChecksum(content: string): string {
    return createHash(this.config.checksumAlgorithm)
      .update(content)
      .digest('hex');
  }

  /**
   * Determine file type based on path
   */
  private determineFileType(filePath: string): 'chat' | 'cache' {
    if (filePath.includes('chat') || filePath.includes('conversation')) {
      return 'chat';
    }
    return 'cache';
  }

  /**
   * Find backup files for a given file
   */
  private async findBackupFiles(filePath: string): Promise<string[]> {
    const backupPaths: string[] = [];

    try {
      const directory = join(filePath, '..');
      const fileName = basename(filePath);
      const files = await fs.readdir(directory);

      for (const file of files) {
        if (file.startsWith(`${fileName}.backup.`)) {
          backupPaths.push(join(directory, file));
        }
      }

      // Sort by creation time (newest first)
      backupPaths.sort((a, b) => b.localeCompare(a));

    } catch {
      this.logger.debug('FileIntegrityChecker', `Could not find backups for ${filePath}`);
    }

    return backupPaths;
  }

  /**
   * Check if content-based recovery is possible
   */
  private canAttemptContentRecovery(content: string): boolean {
    // Basic checks for partial JSON recovery
    return content.includes('{') && content.includes('}');
  }

  /**
   * Generate recovery actions for a corrupted file
   */
  private generateRecoveryActions(result: TIntegrityCheckResult): string[] {
    const actions: string[] = [];

    if (result.hasBackup) {
      actions.push('Restore from backup');
    }

    if (this.canAttemptContentRecovery('')) {
      actions.push('Attempt content repair');
    }

    actions.push('Recreate from cache if available');
    actions.push('Mark as corrupted and continue');

    return actions;
  }

  /**
   * Restore file from backup
   */
  private async restoreFromBackup(filePath: string, backupPath: string): Promise<boolean> {
    try {
      // Validate backup first
      const backupContent = await fs.readFile(backupPath, 'utf8');
      const fileType = this.determineFileType(filePath);
      const validationResult = this.validator.validateJSONFileIntegrity(backupContent, fileType);

      if (!validationResult.isValid) {
        this.logger.warn('FileIntegrityChecker', `Backup ${backupPath} is also corrupted`);
        return false;
      }

      // Create backup of current corrupted file
      await fs.copyFile(filePath, `${filePath}.corrupted.${Date.now()}`);

      // Restore from backup
      await fs.copyFile(backupPath, filePath);

      return true;
    } catch (error) {
      this.logger.error('FileIntegrityChecker', 'Backup restoration failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Attempt to repair file content
   */
  private async attemptContentRecovery(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8');

      // Try basic JSON repair techniques
      let repairedContent = content;

      // Remove trailing commas
      repairedContent = repairedContent.replace(/,(\s*[}\]])/g, '$1');

      // Try to complete truncated JSON
      if (!repairedContent.trim().endsWith('}')) {
        repairedContent += '}';
      }

      // Validate repaired content
      try {
        JSON.parse(repairedContent);

        // Create backup before repair
        await fs.copyFile(filePath, `${filePath}.pre-repair.${Date.now()}`);

        // Write repaired content
        await fs.writeFile(filePath, repairedContent);

        return true;
      } catch {
        return false;
      }

    } catch (error) {
      this.logger.error('FileIntegrityChecker', 'Content recovery failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Attempt recovery from in-memory cache
   */
  private async attemptCacheRecovery(filePath: string): Promise<boolean> {
    // This would need to be implemented based on the specific cache system
    // For now, return false as cache recovery requires integration with ChatFileManager
    this.logger.debug('FileIntegrityChecker', 'Cache recovery not yet implemented');
    return false;
  }

  /**
   * Clean up old backup files
   */
  private async cleanupOldBackups(filePath: string): Promise<void> {
    try {
      const backupPaths = await this.findBackupFiles(filePath);

      if (backupPaths.length > this.config.backupRetentionCount) {
        const oldBackups = backupPaths.slice(this.config.backupRetentionCount);

        for (const oldBackup of oldBackups) {
          await fs.unlink(oldBackup);
          this.logger.debug('FileIntegrityChecker', `Cleaned up old backup: ${oldBackup}`);
        }
      }
    } catch (error) {
      this.logger.warn('FileIntegrityChecker', 'Backup cleanup failed', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Log integrity check result
   */
  private logIntegrityResult(result: TIntegrityCheckResult): void {
    if (result.isCorrupted) {
      this.logger.error('FileIntegrityChecker', `File integrity check failed: ${result.filePath}`, {
        issues: result.issues,
        hasBackup: result.hasBackup,
        canRecover: result.canRecover,
      });
    } else if (result.issues.length > 0) {
      this.logger.warn('FileIntegrityChecker', `File integrity warnings: ${result.filePath}`, {
        issues: result.issues,
      });
    } else {
      this.logger.debug('FileIntegrityChecker', `File integrity check passed: ${result.filePath}`);
    }
  }
}

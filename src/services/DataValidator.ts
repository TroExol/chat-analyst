import type { TParsedMessage, TChat, TMessage, TUser } from '../types';
import { Logger } from './Logger';

/**
 * Configuration for data validation
 */
export interface TDataValidatorConfig {
  strictMode: boolean; // Throw errors on validation failures vs warnings
  enableMessageContentValidation: boolean;
  enableFileSizeValidation: boolean;
  maxMessageLength: number;
  maxChatNameLength: number;
  maxUserNameLength: number;
  maxFileSize: number; // in bytes
}

/**
 * Default validator configuration
 */
export const DEFAULT_VALIDATOR_CONFIG: TDataValidatorConfig = {
  strictMode: false,
  enableMessageContentValidation: true,
  enableFileSizeValidation: true,
  maxMessageLength: 4096, // VK message limit
  maxChatNameLength: 100,
  maxUserNameLength: 100,
  maxFileSize: 50 * 1024 * 1024, // 50MB
};

/**
 * Validation result interface
 */
export interface TValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  correctedData?: any;
}

/**
 * DataValidator provides validation and integrity checks for all data structures
 * Requirements: 5.3, 5.5
 */
export class DataValidator {
  private logger: Logger;
  private config: TDataValidatorConfig;

  constructor(logger: Logger, config: Partial<TDataValidatorConfig> = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };

    this.logger.info('DataValidator', 'Initialized', {
      strictMode: this.config.strictMode,
      maxMessageLength: this.config.maxMessageLength,
    });
  }

  /**
   * Validate parsed message before saving
   */
  validateParsedMessage(message: TParsedMessage): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Required field validation
      if (!message.messageId || typeof message.messageId !== 'number') {
        result.errors.push('Invalid or missing messageId');
        result.isValid = false;
      }

      if (!message.peerId || typeof message.peerId !== 'number') {
        result.errors.push('Invalid or missing peerId');
        result.isValid = false;
      }

      if (!message.fromId || typeof message.fromId !== 'number') {
        result.errors.push('Invalid or missing fromId');
        result.isValid = false;
      }

      if (typeof message.timestamp !== 'number' || message.timestamp <= 0) {
        result.errors.push('Invalid timestamp');
        result.isValid = false;
      }

      if (typeof message.text !== 'string') {
        result.errors.push('Invalid message text type');
        result.isValid = false;
      }

      // Content validation
      if (this.config.enableMessageContentValidation) {
        if (message.text.length > this.config.maxMessageLength) {
          result.warnings.push(`Message text exceeds maximum length (${this.config.maxMessageLength})`);
          if (this.config.strictMode) {
            result.errors.push('Message text too long');
            result.isValid = false;
          }
        }

        // Check for potentially corrupted text
        if (this.containsSuspiciousCharacters(message.text)) {
          result.warnings.push('Message contains suspicious characters');
        }
      }

      // Attachments validation
      if (!Array.isArray(message.attachments)) {
        result.errors.push('Attachments must be an array');
        result.isValid = false;
      } else {
        for (let i = 0; i < message.attachments.length; i++) {
          const attachmentResult = this.validateAttachment(message.attachments[i]);
          if (!attachmentResult.isValid) {
            result.errors.push(`Attachment ${i}: ${attachmentResult.errors.join(', ')}`);
            result.isValid = false;
          }
          result.warnings.push(...attachmentResult.warnings);
        }
      }

      // Flags validation
      if (typeof message.flags !== 'number' || message.flags < 0) {
        result.warnings.push('Invalid or missing message flags');
      }

    } catch (error) {
      result.errors.push(`Validation error: ${(error as Error).message}`);
      result.isValid = false;
    }

    this.logValidationResult('ParsedMessage', result, message.messageId?.toString());
    return result;
  }

  /**
   * Validate chat data structure
   */
  validateChat(chat: TChat): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Required fields
      if (!chat.id || typeof chat.id !== 'number') {
        result.errors.push('Invalid or missing chat id');
        result.isValid = false;
      }

      if (!chat.name || typeof chat.name !== 'string') {
        result.errors.push('Invalid or missing chat name');
        result.isValid = false;
      } else if (chat.name.length > this.config.maxChatNameLength) {
        result.warnings.push(`Chat name exceeds maximum length (${this.config.maxChatNameLength})`);
        if (this.config.strictMode) {
          result.errors.push('Chat name too long');
          result.isValid = false;
        }
      }

      // Date validation
      if (!chat.createdAt || !(chat.createdAt instanceof Date)) {
        result.errors.push('Invalid createdAt date');
        result.isValid = false;
      }

      if (!chat.updatedAt || !(chat.updatedAt instanceof Date)) {
        result.errors.push('Invalid updatedAt date');
        result.isValid = false;
      }

      // Users array validation
      if (!Array.isArray(chat.users)) {
        result.errors.push('Users must be an array');
        result.isValid = false;
      } else {
        for (const user of chat.users) {
          const userResult = this.validateUser(user);
          if (!userResult.isValid) {
            result.warnings.push(`Invalid user in chat: ${userResult.errors.join(', ')}`);
          }
        }
      }

      // Active users validation
      if (!Array.isArray(chat.activeUsers)) {
        result.errors.push('Active users must be an array');
        result.isValid = false;
      }

      // Messages validation
      if (!Array.isArray(chat.messages)) {
        result.errors.push('Messages must be an array');
        result.isValid = false;
      } else {
        // Check for duplicate message IDs
        const messageIds = new Set<number>();
        for (const message of chat.messages) {
          const messageResult = this.validateMessage(message);
          if (!messageResult.isValid) {
            result.warnings.push(`Invalid message: ${messageResult.errors.join(', ')}`);
          }

          if (messageIds.has(message.id)) {
            result.warnings.push(`Duplicate message ID: ${message.id}`);
          } else {
            messageIds.add(message.id);
          }
        }

        // Check message chronological order
        if (!this.isMessageArraySorted(chat.messages)) {
          result.warnings.push('Messages are not in chronological order');
        }
      }

    } catch (error) {
      result.errors.push(`Chat validation error: ${(error as Error).message}`);
      result.isValid = false;
    }

    this.logValidationResult('Chat', result, chat.id?.toString());
    return result;
  }

  /**
   * Validate individual message
   */
  validateMessage(message: TMessage): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      if (!message.id || typeof message.id !== 'number') {
        result.errors.push('Invalid message ID');
        result.isValid = false;
      }

      if (!message.author) {
        result.errors.push('Missing message author');
        result.isValid = false;
      } else {
        const authorResult = this.validateUser(message.author);
        if (!authorResult.isValid) {
          result.warnings.push(`Invalid author: ${authorResult.errors.join(', ')}`);
        }
      }

      if (!message.date || typeof message.date !== 'string') {
        result.errors.push('Invalid message date');
        result.isValid = false;
      } else {
        // Validate ISO date string
        const parsedDate = new Date(message.date);
        if (isNaN(parsedDate.getTime())) {
          result.errors.push('Invalid date format');
          result.isValid = false;
        }
      }

      if (typeof message.content !== 'string') {
        result.errors.push('Invalid message content');
        result.isValid = false;
      }

      if (!Array.isArray(message.attachments)) {
        result.errors.push('Attachments must be an array');
        result.isValid = false;
      }

    } catch (error) {
      result.errors.push(`Message validation error: ${(error as Error).message}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate user data
   */
  validateUser(user: TUser): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      if (!user.id || typeof user.id !== 'number') {
        result.errors.push('Invalid user ID');
        result.isValid = false;
      }

      if (!user.name || typeof user.name !== 'string') {
        result.errors.push('Invalid or missing user name');
        result.isValid = false;
      } else if (user.name.length > this.config.maxUserNameLength) {
        result.warnings.push(`User name exceeds maximum length (${this.config.maxUserNameLength})`);
      }

      // Last activity is optional
      if (user.lastActivity && !(user.lastActivity instanceof Date)) {
        result.warnings.push('Invalid lastActivity date');
      }

    } catch (error) {
      result.errors.push(`User validation error: ${(error as Error).message}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate file integrity by checking JSON structure
   */
  validateJSONFileIntegrity(content: string, expectedType: 'chat' | 'cache'): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      if (!content || content.trim().length === 0) {
        result.errors.push('File content is empty');
        result.isValid = false;
        return result;
      }

      // Check for basic JSON validity
      let parsedData;
      try {
        parsedData = JSON.parse(content);
      } catch (error) {
        result.errors.push(`Invalid JSON: ${(error as Error).message}`);
        result.isValid = false;
        return result;
      }

      // File size check
      if (this.config.enableFileSizeValidation && content.length > this.config.maxFileSize) {
        result.warnings.push(`File size exceeds maximum (${this.config.maxFileSize} bytes)`);
        if (this.config.strictMode) {
          result.errors.push('File too large');
          result.isValid = false;
        }
      }

      // Type-specific validation
      if (expectedType === 'chat') {
        const chatResult = this.validateChat(parsedData);
        result.errors.push(...chatResult.errors);
        result.warnings.push(...chatResult.warnings);
        result.isValid = result.isValid && chatResult.isValid;
      }

      // Check for data corruption indicators
      if (this.detectDataCorruption(content)) {
        result.warnings.push('Potential data corruption detected');
      }

    } catch (error) {
      result.errors.push(`File integrity validation error: ${(error as Error).message}`);
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate attachment data
   */
  private validateAttachment(attachment: any): TValidationResult {
    const result: TValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    if (!attachment || typeof attachment !== 'object') {
      result.errors.push('Invalid attachment object');
      result.isValid = false;
      return result;
    }

    if (!attachment.type || typeof attachment.type !== 'string') {
      result.errors.push('Missing attachment type');
      result.isValid = false;
    }

    // Type-specific validation could be added here
    return result;
  }

  /**
   * Check if message array is sorted chronologically
   */
  private isMessageArraySorted(messages: TMessage[]): boolean {
    for (let i = 1; i < messages.length; i++) {
      const prevDate = new Date(messages[i - 1].date);
      const currDate = new Date(messages[i].date);
      if (prevDate.getTime() > currDate.getTime()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check for suspicious characters in text
   */
  private containsSuspiciousCharacters(text: string): boolean {
    // Check for null bytes, excessive control characters, etc.
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text) ||
           text.includes('\uFFFD') || // Replacement character
           text.length !== Buffer.byteLength(text, 'utf8');
  }

  /**
   * Detect potential data corruption in file content
   */
  private detectDataCorruption(content: string): boolean {
    // Check for truncated JSON
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;

    if (openBraces !== closeBraces) return true;

    // Check for repeated patterns that might indicate corruption
    const duplicatePattern = /(.{50,})\1{3,}/;
    if (duplicatePattern.test(content)) return true;

    // Check for invalid UTF-8 sequences
    try {
      Buffer.from(content, 'utf8').toString('utf8');
    } catch {
      return true;
    }

    return false;
  }

  /**
   * Log validation result
   */
  private logValidationResult(type: string, result: TValidationResult, id?: string): void {
    if (!result.isValid) {
      this.logger.error('DataValidator', `${type} validation failed${id ? ` for ${id}` : ''}`, {
        errors: result.errors,
        warnings: result.warnings,
      });
    } else if (result.warnings.length > 0) {
      this.logger.warn('DataValidator', `${type} validation warnings${id ? ` for ${id}` : ''}`, {
        warnings: result.warnings,
      });
    } else {
      this.logger.debug('DataValidator', `${type} validation passed${id ? ` for ${id}` : ''}`);
    }
  }

  /**
   * Get validator statistics
   */
  getStats(): {
    config: TDataValidatorConfig;
    validationsRun: number;
    } {
    return {
      config: this.config,
      validationsRun: 0, // Could be tracked if needed
    };
  }
}

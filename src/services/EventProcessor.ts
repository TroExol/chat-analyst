import type {
  TEventProcessor,
  TLongPollEvent,
  TParsedMessage,
  TChatManager,
  TUserManager,
  TMessageParser,
} from '../types';
import { Logger } from './Logger';
import { ErrorHandler } from './ErrorHandler';
import { DataValidator } from './DataValidator';

/**
 * Event type constants based on VK Long Poll API
 * https://dev.vk.com/api/user-long-poll/getting-started
 */
export const VK_EVENT_TYPES = {
  MESSAGE_NEW: 4,          // Новое сообщение
  MESSAGE_FLAGS_SET: 2,    // Установка флагов сообщения
  MESSAGE_FLAGS_RESET: 3,  // Сброс флагов сообщения
  MESSAGE_READ: 7,         // Прочтение сообщений
  USER_ONLINE: 8,          // Пользователь стал онлайн
  USER_OFFLINE: 9,         // Пользователь стал офлайн
  TYPING_START: 61,        // Пользователь начал печатать
  TYPING_STOP: 62,         // Пользователь перестал печатать
} as const;

/**
 * Event handler function type
 */
// eslint-disable-next-line no-unused-vars
export type EventHandler = (event: TLongPollEvent) => Promise<void>;

/**
 * Event processor configuration
 */
export interface TEventProcessorConfig {
  enableMessageLogging: boolean;
  enableUserActivityTracking: boolean;
  enableDataValidation: boolean;
  maxConcurrentProcessing: number;
  processingTimeout: number; // milliseconds
}

/**
 * Default configuration
 */
export const DEFAULT_EVENT_PROCESSOR_CONFIG: TEventProcessorConfig = {
  enableMessageLogging: true,
  enableUserActivityTracking: true,
  enableDataValidation: true,
  maxConcurrentProcessing: 10,
  processingTimeout: 30000, // 30 seconds
};

/**
 * EventProcessor handles and routes Long Poll events
 * Requirements: 1.4, 2.1, 3.1
 */
export class EventProcessor implements TEventProcessor {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private messageParser: TMessageParser;
  private userManager: TUserManager;
  private chatManager: TChatManager;
  private dataValidator: DataValidator;
  private config: TEventProcessorConfig;

  // Event handlers registry
  private eventHandlers = new Map<number, EventHandler[]>();

  // Statistics with performance metrics
  private stats = {
    eventsProcessed: 0,
    messagesSaved: 0,
    errorsEncountered: 0,
    lastProcessedTimestamp: null as Date | null,
    processingQueue: 0,

    // Performance metrics
    averageProcessingTime: 0,
    totalProcessingTime: 0,
    longestProcessingTime: 0,
    shortestProcessingTime: Number.MAX_VALUE,

    // Message-specific stats
    messagesPerSecond: 0,
    lastPerformanceCalculation: new Date(),

    // Chat and user tracking
    uniqueChatsProcessed: new Set<number>(),
    uniqueUsersEncountered: new Set<number>(),
    messageTypes: new Map<number, number>(), // eventType -> count
  };

  // Performance tracking
  private lastHundredMessages: number = 0;
  private performanceBuffer: number[] = []; // Store last 100 processing times

  constructor(
    logger: Logger,
    errorHandler: ErrorHandler,
    messageParser: TMessageParser,
    userManager: TUserManager,
    chatManager: TChatManager,
    config: Partial<TEventProcessorConfig> = {},
  ) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.messageParser = messageParser;
    this.userManager = userManager;
    this.chatManager = chatManager;
    this.config = { ...DEFAULT_EVENT_PROCESSOR_CONFIG, ...config };

    // Initialize data validator
    this.dataValidator = new DataValidator(logger, {
      strictMode: false, // Don't fail on warnings
      enableMessageContentValidation: true,
    });

    // Register default handlers
    this.setupDefaultHandlers();
  }

  /**
   * Process a Long Poll event
   * @param event - Long Poll event array
   */
  async processEvent(event: TLongPollEvent): Promise<void> {
    if (!Array.isArray(event) || event.length === 0) {
      this.logger.warn('EventProcessor', 'Invalid event format received', { event });
      return;
    }

    const eventType = event[0] as number;

    this.logger.debug('EventProcessor', `Processing event type ${eventType}`, {
      eventType,
      eventLength: event.length,
    });

    this.stats.eventsProcessed++;
    this.stats.processingQueue++;
    this.stats.lastProcessedTimestamp = new Date();

    try {
      // Check if we have registered handlers for this event type
      const handlers = this.eventHandlers.get(eventType);

      if (handlers && handlers.length > 0) {
        // Execute all registered handlers for this event type
        const handlerPromises = handlers.map(handler => this.executeHandlerSafely(handler, event, eventType));
        await Promise.all(handlerPromises);
      } else {
        this.logger.debug('EventProcessor', `No handlers registered for event type ${eventType}`, {
          eventType,
          availableHandlers: Array.from(this.eventHandlers.keys()),
        });
      }

      // Log every 100 processed events (requirement 6.1)
      if (this.stats.eventsProcessed % 100 === 0) {
        this.logger.info('EventProcessor', `Processed ${this.stats.eventsProcessed} events`, {
          totalEvents: this.stats.eventsProcessed,
          messagesSaved: this.stats.messagesSaved,
          errorsEncountered: this.stats.errorsEncountered,
          processingQueue: this.stats.processingQueue,
        });
      }
    } catch (error) {
      this.stats.errorsEncountered++;

      await this.errorHandler.handleError(
        error as Error,
        () => this.processEvent(event),
        `event-processing-type-${eventType}`,
      );
    } finally {
      this.stats.processingQueue--;
    }
  }

  /**
   * Register an event handler for a specific event type
   * @param eventType - VK Long Poll event type
   * @param handler - Handler function to execute
   */
  registerHandler(eventType: number, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }

    this.eventHandlers.get(eventType)!.push(handler);

    this.logger.info('EventProcessor', `Registered handler for event type ${eventType}`, {
      eventType,
      totalHandlers: this.eventHandlers.get(eventType)!.length,
    });
  }

  /**
   * Get processing statistics with computed metrics
   */
  getStats() {
    return {
      eventsProcessed: this.stats.eventsProcessed,
      messagesSaved: this.stats.messagesSaved,
      errorsEncountered: this.stats.errorsEncountered,
      lastProcessedTimestamp: this.stats.lastProcessedTimestamp,
      processingQueue: this.stats.processingQueue,

      // Performance metrics
      averageProcessingTime: this.stats.averageProcessingTime,
      longestProcessingTime: this.stats.longestProcessingTime,
      shortestProcessingTime: this.stats.shortestProcessingTime === Number.MAX_VALUE ? 0 : this.stats.shortestProcessingTime,
      messagesPerSecond: this.calculateMessagesPerSecond(),

      // Unique counters
      uniqueChatsCount: this.stats.uniqueChatsProcessed.size,
      uniqueUsersCount: this.stats.uniqueUsersEncountered.size,

      // Message type distribution
      messageTypeDistribution: Object.fromEntries(this.stats.messageTypes),
    };
  }

  /**
   * Reset statistics (useful for testing and fresh starts)
   */
  resetStats(): void {
    this.stats.eventsProcessed = 0;
    this.stats.messagesSaved = 0;
    this.stats.errorsEncountered = 0;
    this.stats.lastProcessedTimestamp = null;
    this.stats.processingQueue = 0;
    this.stats.totalProcessingTime = 0;
    this.stats.averageProcessingTime = 0;
    this.stats.longestProcessingTime = 0;
    this.stats.shortestProcessingTime = Number.MAX_VALUE;
    this.stats.messagesPerSecond = 0;
    this.stats.lastPerformanceCalculation = new Date();
    this.stats.uniqueChatsProcessed.clear();
    this.stats.uniqueUsersEncountered.clear();
    this.stats.messageTypes.clear();
    this.performanceBuffer = [];
    this.lastHundredMessages = 0;

    this.logger.info('EventProcessor', 'Statistics reset');
  }

  /**
   * Get registered event types
   */
  getRegisteredEventTypes(): number[] {
    return Array.from(this.eventHandlers.keys());
  }

  /**
   * Update performance metrics with new processing time
   */
  private updatePerformanceMetrics(processingTime: number): void {
    // Update basic metrics
    this.stats.totalProcessingTime += processingTime;

    if (processingTime > this.stats.longestProcessingTime) {
      this.stats.longestProcessingTime = processingTime;
    }

    if (processingTime < this.stats.shortestProcessingTime) {
      this.stats.shortestProcessingTime = processingTime;
    }

    // Maintain rolling average using performance buffer
    this.performanceBuffer.push(processingTime);
    if (this.performanceBuffer.length > 100) {
      this.performanceBuffer.shift(); // Keep only last 100 measurements
    }

    // Calculate average from buffer
    const sum = this.performanceBuffer.reduce((acc, time) => acc + time, 0);
    this.stats.averageProcessingTime = sum / this.performanceBuffer.length;
  }

  /**
   * Calculate messages per second based on recent activity
   */
  private calculateMessagesPerSecond(): number {
    const now = new Date();
    const timeDiff = now.getTime() - this.stats.lastPerformanceCalculation.getTime();

    if (timeDiff < 1000) return this.stats.messagesPerSecond; // Don't recalculate too often

    const messagesDiff = this.stats.messagesSaved - this.lastHundredMessages;
    const seconds = timeDiff / 1000;

    this.stats.messagesPerSecond = messagesDiff / seconds;
    this.stats.lastPerformanceCalculation = now;

    return this.stats.messagesPerSecond;
  }

  /**
   * Check if we should report progress (every 100 messages)
   */
  private shouldReportProgress(): boolean {
    const messagesSinceLastReport = this.stats.messagesSaved - this.lastHundredMessages;
    return messagesSinceLastReport >= 100;
  }

  /**
   * Report progress statistics every 100 messages
   */
  private reportProgressStats(): void {
    const stats = this.getStats();

    this.logger.info('EventProcessor', '📊 Processing Milestone - 100 messages processed', {
      totalMessages: stats.messagesSaved,
      totalEvents: stats.eventsProcessed,
      uniqueChats: stats.uniqueChatsCount,
      uniqueUsers: stats.uniqueUsersCount,
      averageProcessingTime: `${stats.averageProcessingTime.toFixed(2)}ms`,
      messagesPerSecond: stats.messagesPerSecond.toFixed(2),
      longestProcessingTime: `${stats.longestProcessingTime}ms`,
      shortestProcessingTime: `${stats.shortestProcessingTime}ms`,
      messageTypeDistribution: stats.messageTypeDistribution,
      errorsEncountered: stats.errorsEncountered,
    });

    // Update the baseline for next report
    this.lastHundredMessages = this.stats.messagesSaved;
  }

  /**
   * Get detailed performance report
   */
  getPerformanceReport(): {
    processing: {
      averageTime: number;
      longestTime: number;
      shortestTime: number;
      messagesPerSecond: number;
    };
    volume: {
      totalEvents: number;
      totalMessages: number;
      uniqueChats: number;
      uniqueUsers: number;
    };
    distribution: Record<string, number>;
    errors: {
      total: number;
      rate: number;
    };
    } {
    const stats = this.getStats();

    return {
      processing: {
        averageTime: stats.averageProcessingTime,
        longestTime: stats.longestProcessingTime,
        shortestTime: stats.shortestProcessingTime,
        messagesPerSecond: stats.messagesPerSecond,
      },
      volume: {
        totalEvents: stats.eventsProcessed,
        totalMessages: stats.messagesSaved,
        uniqueChats: stats.uniqueChatsCount,
        uniqueUsers: stats.uniqueUsersCount,
      },
      distribution: stats.messageTypeDistribution,
      errors: {
        total: stats.errorsEncountered,
        rate: stats.eventsProcessed > 0 ? (stats.errorsEncountered / stats.eventsProcessed) * 100 : 0,
      },
    };
  }

  /**
   * Clear all event handlers
   */
  clearHandlers(): void {
    const clearedTypes = Array.from(this.eventHandlers.keys());
    this.eventHandlers.clear();

    this.logger.info('EventProcessor', 'All event handlers cleared', {
      clearedEventTypes: clearedTypes,
    });
  }

  /**
   * Setup default event handlers
   */
  private setupDefaultHandlers(): void {
    // Handler for new messages (type 4)
    this.registerHandler(VK_EVENT_TYPES.MESSAGE_NEW, this.handleNewMessage.bind(this));

    // Handler for message flags changes (types 2, 3)
    this.registerHandler(VK_EVENT_TYPES.MESSAGE_FLAGS_SET, this.handleMessageFlags.bind(this));
    this.registerHandler(VK_EVENT_TYPES.MESSAGE_FLAGS_RESET, this.handleMessageFlags.bind(this));

    // Handler for user activity tracking (types 8, 9)
    if (this.config.enableUserActivityTracking) {
      this.registerHandler(VK_EVENT_TYPES.USER_ONLINE, this.handleUserActivity.bind(this));
      this.registerHandler(VK_EVENT_TYPES.USER_OFFLINE, this.handleUserActivity.bind(this));
    }

    this.logger.info('EventProcessor', 'Default event handlers registered', {
      registeredTypes: this.getRegisteredEventTypes(),
      enableUserActivityTracking: this.config.enableUserActivityTracking,
    });
  }

  /**
   * Handle new message events (type 4) with tracking
   * Event format: [4, message_id, flags, peer_id, timestamp, text, {from_id, ...}, {attachments}]
   */
  private async handleNewMessage(event: TLongPollEvent): Promise<void> {
    try {
      if (!this.config.enableMessageLogging) {
        this.logger.debug('EventProcessor', 'Message logging disabled, skipping message event');
        return;
      }

      this.logger.debug('EventProcessor', 'Processing new message event', {
        eventLength: event.length,
        messageId: event[1],
        peerId: event[3],
      });

      // Parse the event into structured message data
      const parsedMessage: TParsedMessage = await this.messageParser.parseMessageEvent(event);

      // Validate message data before processing
      if (this.config.enableDataValidation) {
        const validationResult = this.dataValidator.validateParsedMessage(parsedMessage);
        if (!validationResult.isValid) {
          this.logger.error('EventProcessor', 'Message validation failed, skipping', {
            messageId: parsedMessage.messageId,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          });
          return;
        }

        if (validationResult.warnings.length > 0) {
          this.logger.warn('EventProcessor', 'Message validation warnings', {
            messageId: parsedMessage.messageId,
            warnings: validationResult.warnings,
          });
        }
      }

      // Extract chat ID from peer ID
      const chatId = parsedMessage.peerId;

      this.logger.debug('EventProcessor', 'Parsed message event', {
        messageId: parsedMessage.messageId,
        chatId,
        fromId: parsedMessage.fromId,
        textLength: parsedMessage.text.length,
        hasAttachments: parsedMessage.attachments.length > 0,
      });

      // Track unique chats and users
      this.stats.uniqueChatsProcessed.add(chatId);
      this.stats.uniqueUsersEncountered.add(parsedMessage.fromId);

      // Save message to chat file
      await this.chatManager.saveMessage(chatId, parsedMessage);

      // Update active users for the chat
      await this.chatManager.updateActiveUsers(chatId, parsedMessage.fromId);

      this.stats.messagesSaved++;

      this.logger.info('EventProcessor', 'Message processed and saved', {
        messageId: parsedMessage.messageId,
        chatId,
        authorId: parsedMessage.fromId,
        totalMessagesSaved: this.stats.messagesSaved,
      });

    } catch (error) {
      this.logger.error('EventProcessor', 'Failed to handle new message event', {
        event,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Handle message flags events (types 2, 3)
   * Event format: [type, message_id, flags, peer_id]
   */
  private async handleMessageFlags(event: TLongPollEvent): Promise<void> {
    try {
      const eventType = event[0] as number;
      const messageId = event[1] as number;
      const flags = event[2] as number;
      const peerId = event[3] as number;

      this.logger.debug('EventProcessor', `Processing message flags event (type ${eventType})`, {
        eventType,
        messageId,
        flags,
        peerId,
      });

      // For now, just log the flags change
      // In a more advanced implementation, we could update existing messages
      this.logger.info('EventProcessor', 'Message flags updated', {
        messageId,
        peerId,
        flags,
        flagsHex: `0x${flags.toString(16)}`,
      });

    } catch (error) {
      this.logger.error('EventProcessor', 'Failed to handle message flags event', {
        event,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Handle user activity events (types 8, 9)
   * Event format: [type, user_id, platform_id, timestamp]
   */
  private async handleUserActivity(event: TLongPollEvent): Promise<void> {
    try {
      const eventType = event[0] as number;
      const userId = event[1] as number;
      const timestamp = event[3] as number;

      const isOnline = eventType === VK_EVENT_TYPES.USER_ONLINE;

      this.logger.debug('EventProcessor', `User ${isOnline ? 'came online' : 'went offline'}`, {
        userId,
        isOnline,
        timestamp,
      });

      // Update user's last activity in cache (if they're cached)
      // This helps keep activity data fresh for active users
      try {
        const user = await this.userManager.getUserInfo(userId);
        if (user) {
          user.lastActivity = new Date(timestamp * 1000);
          this.logger.debug('EventProcessor', 'Updated user activity', {
            userId,
            isOnline,
            lastActivity: user.lastActivity,
          });
        }
      } catch (userError) {
        // Don't fail the entire event processing if user fetch fails
        this.logger.warn('EventProcessor', 'Failed to update user activity', {
          userId,
          error: (userError as Error).message,
        });
      }

    } catch (error) {
      this.logger.error('EventProcessor', 'Failed to handle user activity event', {
        event,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Execute event handler with error handling and timeout
   */
  private async executeHandlerSafely(
    handler: EventHandler,
    event: TLongPollEvent,
    eventType: number,
  ): Promise<void> {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Handler timeout for event type ${eventType} after ${this.config.processingTimeout}ms`));
        }, this.config.processingTimeout);
      });

      // Race between handler execution and timeout
      await Promise.race([
        handler(event),
        timeoutPromise,
      ]);

    } catch (error) {
      this.logger.error('EventProcessor', `Event handler failed for type ${eventType}`, {
        eventType,
        event,
        error: (error as Error).message,
      });

      // Use error handler for retry logic if appropriate
      await this.errorHandler.handleError(
        error as Error,
        () => handler(event),
        `event-handler-type-${eventType}`,
      );
    }
  }
}

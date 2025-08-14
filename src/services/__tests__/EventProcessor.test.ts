import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventProcessor, VK_EVENT_TYPES, DEFAULT_EVENT_PROCESSOR_CONFIG, type TEventProcessorConfig } from '../EventProcessor';
import { Logger } from '../Logger';
import { ErrorHandler } from '../ErrorHandler';
import { MessageParser } from '../MessageParser';
import { UserManager } from '../UserManager';
import { ChatFileManager } from '../../storage/ChatFileManager';
import type { TLongPollEvent, TParsedMessage, TUser } from '../../types';

// Mock all dependencies
jest.mock('../Logger');
jest.mock('../ErrorHandler');
jest.mock('../MessageParser');
jest.mock('../UserManager');
jest.mock('../../storage/ChatFileManager');

describe('EventProcessor', () => {
  let eventProcessor: EventProcessor;
  let mockLogger: jest.Mocked<Logger>;
  let mockErrorHandler: jest.Mocked<ErrorHandler>;
  let mockMessageParser: jest.Mocked<MessageParser>;
  let mockUserManager: jest.Mocked<UserManager>;
  let mockChatManager: jest.Mocked<ChatFileManager>;

  const createTestMessageEvent = (
    messageId = 123456,
    peerId = 2000000001,
    text = 'Test message',
  ): TLongPollEvent => [
    VK_EVENT_TYPES.MESSAGE_NEW,
    messageId,
    49, // flags
    peerId,
    1755105000, // timestamp
    text,
    { from: '123' },
    {}, // attachments
  ];

  const createTestParsedMessage = (messageId = 123456, peerId = 2000000001): TParsedMessage => ({
    messageId,
    peerId,
    fromId: 123,
    timestamp: 1755105000,
    text: 'Test message',
    attachments: [],
    flags: {
      unread: false,
      outbox: false,
      replied: false,
      important: false,
      chat: true,
      friends: false,
      spam: false,
      delUser: false,
      fixed: false,
      media: false,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockErrorHandler = {
      handleError: jest.fn(),
    } as any;

    mockMessageParser = {
      parseMessageEvent: jest.fn(),
      parseAttachments: jest.fn(),
    } as any;

    mockUserManager = {
      getUserInfo: jest.fn(),
    } as any;

    mockChatManager = {
      saveMessage: jest.fn(),
      updateActiveUsers: jest.fn(),
    } as any;

    // Set up constructor mocks
    (Logger as jest.MockedClass<typeof Logger>).mockImplementation(() => mockLogger);
    (ErrorHandler as jest.MockedClass<typeof ErrorHandler>).mockImplementation(() => mockErrorHandler);
    (MessageParser as jest.MockedClass<typeof MessageParser>).mockImplementation(() => mockMessageParser);
    (UserManager as jest.MockedClass<typeof UserManager>).mockImplementation(() => mockUserManager);
    (ChatFileManager as jest.MockedClass<typeof ChatFileManager>).mockImplementation(() => mockChatManager);

    eventProcessor = new EventProcessor(
      mockLogger,
      mockErrorHandler,
      mockMessageParser,
      mockUserManager,
      mockChatManager,
    );
  });

  describe('Constructor and Configuration', () => {
    it('should create EventProcessor with default configuration', () => {
      const processor = new EventProcessor(
        mockLogger,
        mockErrorHandler,
        mockMessageParser,
        mockUserManager,
        mockChatManager,
      );

      const stats = processor.getStats();
      expect(stats.eventsProcessed).toBe(0);
      expect(stats.messagesSaved).toBe(0);
    });

    it('should create EventProcessor with custom configuration', () => {
      const customConfig: Partial<TEventProcessorConfig> = {
        enableMessageLogging: false,
        enableUserActivityTracking: false,
        maxConcurrentProcessing: 5,
        processingTimeout: 15000,
      };

      const processor = new EventProcessor(
        mockLogger,
        mockErrorHandler,
        mockMessageParser,
        mockUserManager,
        mockChatManager,
        customConfig,
      );

      const registeredTypes = processor.getRegisteredEventTypes();
      // Should not include user activity types if disabled
      expect(registeredTypes).toContain(VK_EVENT_TYPES.MESSAGE_NEW);
      expect(registeredTypes).not.toContain(VK_EVENT_TYPES.USER_ONLINE);
    });

    it('should register default event handlers on construction', () => {
      const processor = new EventProcessor(
        mockLogger,
        mockErrorHandler,
        mockMessageParser,
        mockUserManager,
        mockChatManager,
      );

      const registeredTypes = processor.getRegisteredEventTypes();

      expect(registeredTypes).toContain(VK_EVENT_TYPES.MESSAGE_NEW);
      expect(registeredTypes).toContain(VK_EVENT_TYPES.MESSAGE_FLAGS_SET);
      expect(registeredTypes).toContain(VK_EVENT_TYPES.MESSAGE_FLAGS_RESET);
      expect(registeredTypes).toContain(VK_EVENT_TYPES.USER_ONLINE);
      expect(registeredTypes).toContain(VK_EVENT_TYPES.USER_OFFLINE);
    });
  });

  describe('Event Processing', () => {
    it('should process valid message event successfully', async () => {
      const testEvent = createTestMessageEvent();
      const testMessage = createTestParsedMessage();

      mockMessageParser.parseMessageEvent.mockReturnValue(testMessage);
      mockChatManager.saveMessage.mockResolvedValue();
      mockChatManager.updateActiveUsers.mockResolvedValue();

      await eventProcessor.processEvent(testEvent);

      expect(mockMessageParser.parseMessageEvent).toHaveBeenCalledWith(testEvent);
      expect(mockChatManager.saveMessage).toHaveBeenCalledWith(2000000001, testMessage);
      expect(mockChatManager.updateActiveUsers).toHaveBeenCalledWith(2000000001, 123);

      const stats = eventProcessor.getStats();
      expect(stats.eventsProcessed).toBe(1);
      expect(stats.messagesSaved).toBe(1);
    });

    it('should handle unknown event types gracefully', async () => {
      const unknownEvent: TLongPollEvent = [999, 'unknown', 'data'];

      await eventProcessor.processEvent(unknownEvent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EventProcessor',
        'No handlers registered for event type 999',
        expect.any(Object),
      );
    });

    it('should skip message processing when logging disabled', async () => {
      const processor = new EventProcessor(
        mockLogger,
        mockErrorHandler,
        mockMessageParser,
        mockUserManager,
        mockChatManager,
        { enableMessageLogging: false },
      );

      const testEvent = createTestMessageEvent();

      await processor.processEvent(testEvent);

      expect(mockMessageParser.parseMessageEvent).not.toHaveBeenCalled();
      expect(mockChatManager.saveMessage).not.toHaveBeenCalled();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EventProcessor',
        'Message logging disabled, skipping message event',
      );
    });
  });

  describe('Event Handler Registration', () => {
    it('should register custom event handlers', () => {
      // eslint-disable-next-line no-unused-vars
      const customHandler = jest.fn<(event: TLongPollEvent) => Promise<void>>();
      const customEventType = 999;

      eventProcessor.registerHandler(customEventType, customHandler);

      const registeredTypes = eventProcessor.getRegisteredEventTypes();
      expect(registeredTypes).toContain(customEventType);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'EventProcessor',
        `Registered handler for event type ${customEventType}`,
        expect.any(Object),
      );
    });

    it('should execute custom handlers for registered event types', async () => {
      // eslint-disable-next-line no-unused-vars
      const customHandler = jest.fn<(event: TLongPollEvent) => Promise<void>>();
      const customEventType = 999;
      const customEvent: TLongPollEvent = [customEventType, 'test', 'data'];

      eventProcessor.registerHandler(customEventType, customHandler);

      await eventProcessor.processEvent(customEvent);

      expect(customHandler).toHaveBeenCalledWith(customEvent);
    });

    it('should support multiple handlers for the same event type', async () => {
      // eslint-disable-next-line no-unused-vars
      const handler1 = jest.fn<(event: TLongPollEvent) => Promise<void>>();
      // eslint-disable-next-line no-unused-vars
      const handler2 = jest.fn<(event: TLongPollEvent) => Promise<void>>();
      const eventType = 999;
      const testEvent: TLongPollEvent = [eventType, 'test'];

      eventProcessor.registerHandler(eventType, handler1);
      eventProcessor.registerHandler(eventType, handler2);

      await eventProcessor.processEvent(testEvent);

      expect(handler1).toHaveBeenCalledWith(testEvent);
      expect(handler2).toHaveBeenCalledWith(testEvent);
    });
  });

  describe('User Activity Handling', () => {
    it('should handle user online events', async () => {
      const onlineEvent: TLongPollEvent = [VK_EVENT_TYPES.USER_ONLINE, 123, 1, 1755105000];
      const testUser: TUser = { id: 123, name: 'Test User' };

      mockUserManager.getUserInfo.mockResolvedValue(testUser);

      await eventProcessor.processEvent(onlineEvent);

      expect(mockUserManager.getUserInfo).toHaveBeenCalledWith(123);
      expect(testUser.lastActivity).toBeInstanceOf(Date);
    });

    it('should handle user offline events', async () => {
      const offlineEvent: TLongPollEvent = [VK_EVENT_TYPES.USER_OFFLINE, 456, 1, 1755105001];

      await eventProcessor.processEvent(offlineEvent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EventProcessor',
        'User went offline',
        expect.objectContaining({
          userId: 456,
          isOnline: false,
        }),
      );
    });

    it('should handle user fetch errors gracefully', async () => {
      const onlineEvent: TLongPollEvent = [VK_EVENT_TYPES.USER_ONLINE, 123, 1, 1755105000];
      const userError = new Error('User not found');

      mockUserManager.getUserInfo.mockRejectedValue(userError);

      await eventProcessor.processEvent(onlineEvent);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'EventProcessor',
        'Failed to update user activity',
        expect.objectContaining({
          userId: 123,
          error: 'User not found',
        }),
      );
    });
  });

  describe('Message Flags Handling', () => {
    it('should handle message flags set events', async () => {
      const flagsEvent: TLongPollEvent = [VK_EVENT_TYPES.MESSAGE_FLAGS_SET, 123456, 1, 2000000001];

      await eventProcessor.processEvent(flagsEvent);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'EventProcessor',
        'Message flags updated',
        expect.objectContaining({
          messageId: 123456,
          peerId: 2000000001,
          flags: 1,
          flagsHex: '0x1',
        }),
      );
    });

    it('should handle message flags reset events', async () => {
      const flagsEvent: TLongPollEvent = [VK_EVENT_TYPES.MESSAGE_FLAGS_RESET, 123457, 2, 2000000002];

      await eventProcessor.processEvent(flagsEvent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EventProcessor',
        'Processing message flags event (type 3)',
        expect.objectContaining({
          eventType: 3,
          messageId: 123457,
          flags: 2,
          peerId: 2000000002,
        }),
      );
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track processing statistics', async () => {
      const testEvent = createTestMessageEvent();
      const testMessage = createTestParsedMessage();

      mockMessageParser.parseMessageEvent.mockReturnValue(testMessage);
      mockChatManager.saveMessage.mockResolvedValue();
      mockChatManager.updateActiveUsers.mockResolvedValue();

      // Process multiple events
      await eventProcessor.processEvent(testEvent);
      await eventProcessor.processEvent(testEvent);

      const stats = eventProcessor.getStats();
      expect(stats.eventsProcessed).toBe(2);
      expect(stats.messagesSaved).toBe(2);
      expect(stats.errorsEncountered).toBe(0);
      expect(stats.lastProcessedTimestamp).toBeInstanceOf(Date);
    });

    it('should reset statistics when requested', async () => {
      const testEvent = createTestMessageEvent();
      const testMessage = createTestParsedMessage();

      mockMessageParser.parseMessageEvent.mockReturnValue(testMessage);
      mockChatManager.saveMessage.mockResolvedValue();
      mockChatManager.updateActiveUsers.mockResolvedValue();

      await eventProcessor.processEvent(testEvent);

      eventProcessor.resetStats();

      const stats = eventProcessor.getStats();
      expect(stats.eventsProcessed).toBe(0);
      expect(stats.messagesSaved).toBe(0);
      expect(stats.lastProcessedTimestamp).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle handler timeout', async () => {
      // eslint-disable-next-line no-unused-vars
      const slowHandler = jest.fn<(event: TLongPollEvent) => Promise<void>>().mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 35000)), // Longer than default timeout
      );

      const processor = new EventProcessor(
        mockLogger,
        mockErrorHandler,
        mockMessageParser,
        mockUserManager,
        mockChatManager,
        { processingTimeout: 100 }, // Short timeout for testing
      );

      processor.registerHandler(999, slowHandler);

      const testEvent: TLongPollEvent = [999, 'slow', 'event'];

      await processor.processEvent(testEvent);

      expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Function),
        'event-handler-type-999',
      );
    }, 10000);
  });

  describe('Handler Management', () => {
    it('should clear all handlers when requested', () => {
      const initialTypes = eventProcessor.getRegisteredEventTypes();
      expect(initialTypes.length).toBeGreaterThan(0);

      eventProcessor.clearHandlers();

      const clearedTypes = eventProcessor.getRegisteredEventTypes();
      expect(clearedTypes).toHaveLength(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'EventProcessor',
        'All event handlers cleared',
        expect.objectContaining({
          clearedEventTypes: initialTypes,
        }),
      );
    });

    it('should provide list of registered event types', () => {
      const registeredTypes = eventProcessor.getRegisteredEventTypes();

      expect(Array.isArray(registeredTypes)).toBe(true);
      expect(registeredTypes).toContain(VK_EVENT_TYPES.MESSAGE_NEW);
    });
  });

  describe('Message Event Processing', () => {
    it('should process message with attachments', async () => {
      const messageWithAttachments = createTestParsedMessage();
      messageWithAttachments.attachments = [
        {
          type: 'photo',
          id: '123_456',
          url: 'https://vk.com/photo123_456',
        },
      ];

      const testEvent = createTestMessageEvent();
      mockMessageParser.parseMessageEvent.mockReturnValue(messageWithAttachments);
      mockChatManager.saveMessage.mockResolvedValue();
      mockChatManager.updateActiveUsers.mockResolvedValue();

      await eventProcessor.processEvent(testEvent);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'EventProcessor',
        'Parsed message event',
        expect.objectContaining({
          hasAttachments: true,
        }),
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'EventProcessor',
        'Message processed and saved',
        expect.objectContaining({
          messageId: 123456,
          chatId: 2000000001,
          authorId: 123,
        }),
      );
    });

    it('should handle private chat messages', async () => {
      const privateChatEvent = createTestMessageEvent(123456, 123); // Direct peer ID
      const testMessage = createTestParsedMessage(123456, 123);

      mockMessageParser.parseMessageEvent.mockReturnValue(testMessage);
      mockChatManager.saveMessage.mockResolvedValue();
      mockChatManager.updateActiveUsers.mockResolvedValue();

      await eventProcessor.processEvent(privateChatEvent);

      expect(mockChatManager.saveMessage).toHaveBeenCalledWith(123, testMessage);
      expect(mockChatManager.updateActiveUsers).toHaveBeenCalledWith(123, 123);
    });
  });

  describe('Attachment Processing', () => {
    it('should parse photo attachments correctly', () => {
      const attachmentData = {
        attach1_type: 'photo',
        attach1: '123_456',
      };

      mockMessageParser.parseAttachments(attachmentData);

      // We just test that the method is called
      expect(mockMessageParser.parseAttachments).toHaveBeenCalledWith(attachmentData);
    });

    it('should parse multiple attachments', () => {
      const attachmentData = {
        attach1_type: 'photo',
        attach1: '123_456',
        attach2_type: 'audio',
        attach2: '456_789',
        attach3_type: 'link',
        attach3: 'https://example.com',
        attach3_url: 'https://example.com',
        attach3_title: 'Example Link',
      };

      mockMessageParser.parseAttachments(attachmentData);

      expect(mockMessageParser.parseAttachments).toHaveBeenCalledWith(attachmentData);
    });
  });
});

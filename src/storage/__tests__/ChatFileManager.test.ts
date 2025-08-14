import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ChatFileManager, DEFAULT_CHAT_MANAGER_CONFIG, type TChatFileManagerConfig } from '../ChatFileManager';
import { FileStorage } from '../FileStorage';
import { UserManager } from '../../services/UserManager';
import type { TChat, TParsedMessage, TUser, TMessageFlags, TStoredChatData } from '../../types';

// Mock dependencies
jest.mock('../FileStorage');
jest.mock('../../services/UserManager');

jest.spyOn(console, 'log');
jest.spyOn(console, 'warn');
jest.spyOn(console, 'error');

describe('ChatFileManager', () => {
  let chatFileManager: ChatFileManager;
  let mockFileStorage: jest.Mocked<FileStorage>;
  let mockUserManager: jest.Mocked<UserManager>;

  const testUser: TUser = {
    id: 123,
    name: 'Test User',
    lastActivity: new Date('2024-01-01T10:00:00Z'),
  };

  const testUser2: TUser = {
    id: 456,
    name: 'Test User 2',
    lastActivity: new Date('2024-01-01T11:00:00Z'),
  };

  const testFlags: TMessageFlags = {
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
  };

  const testParsedMessage: TParsedMessage = {
    messageId: 12345,
    peerId: 2000000001,
    fromId: 123,
    timestamp: 1704106800,
    text: 'Test message content',
    attachments: [],
    flags: testFlags,
  };

  const testChat: TChat = {
    id: 2000000001,
    name: 'Test Chat',
    users: [testUser],
    activeUsers: [testUser],
    messages: [],
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Cleanup previous instance if exists
    if (chatFileManager) {
      await chatFileManager.destroy();
    }

    // Setup FileStorage mock
    mockFileStorage = {
      initialize: jest.fn(),
      generateChatFilePath: jest.fn(),
      readJSONFile: jest.fn(),
      writeJSONFile: jest.fn(),
      createBackup: jest.fn(),
      listChatFiles: jest.fn(),
      getFileStats: jest.fn(),
    } as any;

    mockFileStorage.initialize.mockResolvedValue(undefined);
    mockFileStorage.generateChatFilePath.mockReturnValue('./data/chats/chat-2000000001-Test_Chat.json');
    mockFileStorage.readJSONFile.mockResolvedValue(null);
    mockFileStorage.writeJSONFile.mockResolvedValue(undefined);
    mockFileStorage.createBackup.mockResolvedValue('./backup/path');
    mockFileStorage.listChatFiles.mockResolvedValue([]);
    mockFileStorage.getFileStats.mockResolvedValue({
      size: 1024,
      mtime: new Date(),
      ctime: new Date('2024-01-01T08:00:00Z'),
    });

    // Setup UserManager mock
    mockUserManager = {
      getUserInfo: jest.fn(),
    } as any;

    mockUserManager.getUserInfo.mockResolvedValue(testUser);

    chatFileManager = new ChatFileManager(mockFileStorage, mockUserManager);
  });

  afterEach(async () => {
    // Proper cleanup to prevent test interference
    if (chatFileManager) {
      chatFileManager.clearCache();
      await chatFileManager.destroy();
    }

    jest.useRealTimers();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create ChatFileManager with default configuration', () => {
      const manager = new ChatFileManager(mockFileStorage, mockUserManager);

      expect(manager).toBeInstanceOf(ChatFileManager);
      expect(manager.getCacheStats().maxCacheSize).toBe(DEFAULT_CHAT_MANAGER_CONFIG.maxMemoryCacheSize);
    });

    it('should create ChatFileManager with custom configuration', () => {
      const customConfig: Partial<TChatFileManagerConfig> = {
        maxMemoryCacheSize: 50,
        autoSaveInterval: 30000,
        enableBackups: false,
      };

      const manager = new ChatFileManager(mockFileStorage, mockUserManager, customConfig);

      expect(manager).toBeInstanceOf(ChatFileManager);
      expect(manager.getCacheStats().maxCacheSize).toBe(50);
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await chatFileManager.initialize();

      expect(mockFileStorage.initialize).toHaveBeenCalledTimes(1);
      expect(mockFileStorage.listChatFiles).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('ChatFileManager: Initialized with'),
      );
    });

    it('should handle initialization errors', async () => {
      mockFileStorage.initialize.mockRejectedValue(new Error('Init failed'));

      await expect(chatFileManager.initialize()).rejects.toThrow('Failed to initialize ChatFileManager');
      expect(console.error).toHaveBeenCalledWith(
        'ChatFileManager: Failed to initialize:',
        expect.any(Error),
      );
    });

    it('should not initialize twice', async () => {
      await chatFileManager.initialize();
      await chatFileManager.initialize();

      expect(console.warn).toHaveBeenCalledWith('ChatFileManager: Already initialized');
      expect(mockFileStorage.initialize).toHaveBeenCalledTimes(1);
    });

    it('should warm up cache with existing chat files', async () => {
      mockFileStorage.listChatFiles.mockResolvedValue([
        './data/chats/chat-123-TestChat.json',
        './data/chats/chat-456-AnotherChat.json',
      ]);

      await chatFileManager.initialize();

      expect(mockFileStorage.listChatFiles).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 existing chat files'),
      );
    });
  });

  describe('saveMessage', () => {
    beforeEach(async () => {
      await chatFileManager.initialize();
    });

    it('should save message to existing chat', async () => {
      // Mock existing chat
      (chatFileManager as any).chatCache.set(2000000001, { ...testChat });

      await chatFileManager.saveMessage(2000000001, testParsedMessage);

      expect(mockUserManager.getUserInfo).toHaveBeenCalledWith(123);
      expect(mockFileStorage.writeJSONFile).toHaveBeenCalledWith(
        './data/chats/chat-2000000001-Test_Chat.json',
        expect.objectContaining({
          id: 2000000001,
          name: 'Test Chat',
          version: '1.0',
          metadata: expect.objectContaining({
            messageCount: 1,
            participantCount: 1,
          }),
        }),
      );
      expect(console.log).toHaveBeenCalledWith(
        'ChatFileManager: Message 12345 saved to chat 2000000001',
      );
    });

    it('should create new chat for first message', async () => {
      await chatFileManager.saveMessage(2000000001, testParsedMessage);

      expect(mockUserManager.getUserInfo).toHaveBeenCalledWith(123);
      expect(mockFileStorage.writeJSONFile).toHaveBeenCalledWith(
        './data/chats/chat-2000000001-Test_Chat.json',
        expect.objectContaining({
          name: 'Chat 2000000001',
          users: [testUser],
          activeUsers: expect.arrayContaining([
            expect.objectContaining({ id: 123, lastActivity: expect.any(Date) }),
          ]),
        }),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Created new chat 2000000001'),
      );
    });

    it('should avoid duplicate messages', async () => {
      const chatWithMessage = {
        ...testChat,
        messages: [{
          id: 12345,
          author: testUser,
          date: '2024-01-01T10:00:00.000Z',
          content: 'Existing message',
          attachments: [],
          flags: testFlags,
        }],
      };

      (chatFileManager as any).chatCache.set(2000000001, chatWithMessage);

      await chatFileManager.saveMessage(2000000001, testParsedMessage);

      // Should update existing message, not add duplicate
      const updatedChat = (chatFileManager as any).chatCache.get(2000000001);
      expect(updatedChat.messages).toHaveLength(1);
      expect(updatedChat.messages[0].content).toBe('Test message content');
    });

    it('should handle save errors', async () => {
      mockFileStorage.writeJSONFile.mockRejectedValue(new Error('Write failed'));

      await expect(chatFileManager.saveMessage(2000000001, testParsedMessage)).rejects.toThrow('Write failed');
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save message to chat 2000000001'),
        expect.any(Error),
      );
    });
  });

  describe('getChatData', () => {
    beforeEach(async () => {
      await chatFileManager.initialize();
    });

    it('should return cached chat if available', async () => {
      (chatFileManager as any).chatCache.set(2000000001, testChat);

      const result = await chatFileManager.getChatData(2000000001);

      expect(result).toEqual(testChat);
      expect(mockFileStorage.readJSONFile).not.toHaveBeenCalled();
    });

    it('should load chat from file if not cached', async () => {
      const storedChatData: TStoredChatData = {
        ...testChat,
        version: '1.0',
        metadata: {
          fileCreated: new Date(),
          lastMessageId: 0,
          messageCount: 0,
          participantCount: 1,
        },
      };

      mockFileStorage.listChatFiles.mockResolvedValue(['./data/chats/chat-2000000001-Test_Chat.json']);
      mockFileStorage.readJSONFile.mockResolvedValue(storedChatData);

      const result = await chatFileManager.getChatData(2000000001);

      expect(mockFileStorage.readJSONFile).toHaveBeenCalledWith('./data/chats/chat-2000000001-Test_Chat.json');
      expect(result?.id).toBe(2000000001);
      expect(result?.name).toBe('Test Chat');
    });

    it('should return null for non-existent chat', async () => {
      mockFileStorage.listChatFiles.mockResolvedValue([]);

      const result = await chatFileManager.getChatData(999999);

      expect(result).toBeNull();
    });

    it('should handle file read errors gracefully', async () => {
      mockFileStorage.listChatFiles.mockResolvedValue(['./data/chats/chat-2000000001-Test_Chat.json']);
      mockFileStorage.readJSONFile.mockRejectedValue(new Error('Read failed'));

      const result = await chatFileManager.getChatData(2000000001);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load chat 2000000001 from file:'),
        expect.any(Error),
      );
    });

    it('should enforce cache size limit', async () => {
      const smallCacheManager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { maxMemoryCacheSize: 2 },
      );

      try {
        await smallCacheManager.initialize();

        // Fill cache to limit
        (smallCacheManager as any).chatCache.set(1, { id: 1, name: 'Chat 1' });
        (smallCacheManager as any).chatCache.set(2, { id: 2, name: 'Chat 2' });

        // Add one more to trigger eviction
        const storedData: TStoredChatData = {
          ...testChat,
          id: 3,
          version: '1.0',
          metadata: { fileCreated: new Date(), lastMessageId: 0, messageCount: 0, participantCount: 1 },
        };

        mockFileStorage.listChatFiles.mockResolvedValue(['./data/chats/chat-3-Test.json']);
        mockFileStorage.readJSONFile.mockResolvedValue(storedData);

        await smallCacheManager.getChatData(3);

        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Evicted chat 1 from cache'),
        );
      } finally {
        await smallCacheManager.destroy();
      }
    });
  });

  describe('updateActiveUsers', () => {
    const setupChatForTest = async () => {
      await chatFileManager.initialize();
      // Create a fresh copy of testChat to avoid reference issues
      const freshTestChat = {
        ...testChat,
        users: [...testChat.users],
        activeUsers: [...testChat.activeUsers],
        messages: [...testChat.messages],
      };
      (chatFileManager as any).chatCache.set(2000000001, freshTestChat);
    };

    it('should add new active user', async () => {
      await setupChatForTest();
      mockUserManager.getUserInfo.mockResolvedValueOnce(testUser2);

      await chatFileManager.updateActiveUsers(2000000001, 456);

      const updatedChat = (chatFileManager as any).chatCache.get(2000000001);
      expect(updatedChat.activeUsers).toHaveLength(2);
      expect(updatedChat.activeUsers.find((u: TUser) => u.id === 456)).toBeDefined();
      expect(console.log).toHaveBeenCalledWith(
        'ChatFileManager: Updated active users for chat 2000000001, user 456',
      );
    });

    it('should update existing active user', async () => {
      await setupChatForTest();
      const updatedUser = { ...testUser, lastActivity: new Date() };
      mockUserManager.getUserInfo.mockResolvedValueOnce(updatedUser);

      await chatFileManager.updateActiveUsers(2000000001, 123);

      const updatedChat = (chatFileManager as any).chatCache.get(2000000001);
      expect(updatedChat.activeUsers).toHaveLength(1);
      expect(updatedChat.activeUsers[0].lastActivity).toEqual(updatedUser.lastActivity);
    });

    it('should handle non-existent chat', async () => {
      await chatFileManager.initialize();
      await chatFileManager.updateActiveUsers(999999, 123);

      expect(console.warn).toHaveBeenCalledWith(
        'ChatFileManager: Cannot update active users - chat 999999 not found',
      );
    });

    it('should sort active users by last activity', async () => {
      await chatFileManager.initialize();
      const chat = {
        ...testChat,
        users: [...testChat.users],
        messages: [...testChat.messages],
        activeUsers: [
          { ...testUser, lastActivity: new Date('2024-01-01T10:00:00Z') },
          { ...testUser2, lastActivity: new Date('2024-01-01T11:00:00Z') },
        ],
      };

      (chatFileManager as any).chatCache.set(2000000001, chat);

      // Update first user to have more recent activity
      const recentUser = { ...testUser, lastActivity: new Date('2024-01-01T12:00:00Z') };
      mockUserManager.getUserInfo.mockResolvedValueOnce(recentUser);

      await chatFileManager.updateActiveUsers(2000000001, 123);

      const updatedChat = (chatFileManager as any).chatCache.get(2000000001);
      expect(updatedChat.activeUsers[0].id).toBe(123); // Most recent should be first
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      await chatFileManager.initialize();
    });

    it('should return correct cache statistics', () => {
      (chatFileManager as any).chatCache.set(1, { id: 1 });
      (chatFileManager as any).chatCache.set(2, { id: 2 });

      const stats = chatFileManager.getCacheStats();

      expect(stats.cachedChats).toBe(2);
      expect(stats.maxCacheSize).toBe(DEFAULT_CHAT_MANAGER_CONFIG.maxMemoryCacheSize);
    });

    it('should clear cache', () => {
      (chatFileManager as any).chatCache.set(1, { id: 1 });
      (chatFileManager as any).chatFilePaths.set(1, './path');

      chatFileManager.clearCache();

      expect(chatFileManager.getCacheStats().cachedChats).toBe(0);
      expect(console.log).toHaveBeenCalledWith('ChatFileManager: Cache cleared');
    });
  });

  describe('Auto-save and Persistence', () => {
    it('should save all cached chats', async () => {
      await chatFileManager.initialize();

      (chatFileManager as any).chatCache.set(1, { id: 1, name: 'Chat 1', messages: [], users: [] });
      (chatFileManager as any).chatCache.set(2, { id: 2, name: 'Chat 2', messages: [], users: [] });

      await chatFileManager.saveAllChats();

      expect(mockFileStorage.writeJSONFile).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(
        'ChatFileManager: Saved 2 cached chats to files',
      );
    });

    it('should handle save errors gracefully', async () => {
      await chatFileManager.initialize();

      (chatFileManager as any).chatCache.set(1, { id: 1, name: 'Chat 1' });
      mockFileStorage.writeJSONFile.mockRejectedValue(new Error('Save failed'));

      await chatFileManager.saveAllChats();

      expect(console.error).toHaveBeenCalledWith(
        'ChatFileManager: Failed to save all chats:',
        expect.any(Error),
      );
    });

    it('should start auto-save with positive interval', async () => {
      jest.useFakeTimers();

      const autoSaveManager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { autoSaveInterval: 5000 },
      );

      try {
        await autoSaveManager.initialize();

        expect(console.log).toHaveBeenCalledWith(
          'ChatFileManager: Auto-save started (interval: 5000ms)',
        );
      } finally {
        await autoSaveManager.destroy();
        jest.useRealTimers();
      }
    });

    it('should not start auto-save with zero interval', async () => {
      const noAutoSaveManager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { autoSaveInterval: 0 },
      );

      try {
        await noAutoSaveManager.initialize();

        expect(console.log).not.toHaveBeenCalledWith(
          expect.stringContaining('Auto-save started'),
        );
      } finally {
        await noAutoSaveManager.destroy();
      }
    });
  });

  describe('Destruction and Cleanup', () => {
    it('should destroy properly and save final state', async () => {
      jest.useFakeTimers();

      const manager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { autoSaveInterval: 5000 },
      );

      try {
        await manager.initialize();
        (manager as any).chatCache.set(1, { id: 1, name: 'Chat 1', messages: [], users: [] });

        await manager.destroy();

        expect(mockFileStorage.writeJSONFile).toHaveBeenCalledTimes(1);
        expect(console.log).toHaveBeenCalledWith('ChatFileManager: Final save completed');
        expect(console.log).toHaveBeenCalledWith('ChatFileManager: Destroyed');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle final save errors', async () => {
      await chatFileManager.initialize();

      (chatFileManager as any).chatCache.set(1, { id: 1, name: 'Chat 1' });
      mockFileStorage.writeJSONFile.mockRejectedValue(new Error('Final save failed'));

      await chatFileManager.destroy();

      expect(console.error).toHaveBeenNthCalledWith(1, 'ChatFileManager: Failed to save chat 1 to file:', expect.any(Error));
      expect(console.error).toHaveBeenNthCalledWith(2, 'ChatFileManager: Failed to save all chats:', expect.any(Error));
    });
  });

  describe('File Operations', () => {
    beforeEach(async () => {
      await chatFileManager.initialize();
    });

    it('should create backup when enabled', async () => {
      const manager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { enableBackups: true },
      );

      try {
        await manager.initialize();

        // Set existing path for backup
        (manager as any).chatFilePaths.set(2000000001, './existing/path.json');
        (manager as any).chatCache.set(2000000001, testChat);

        await manager.saveMessage(2000000001, testParsedMessage);

        expect(mockFileStorage.createBackup).toHaveBeenCalledWith('./existing/path.json');
      } finally {
        await manager.destroy();
      }
    });

    it('should not create backup when disabled', async () => {
      const manager = new ChatFileManager(
        mockFileStorage,
        mockUserManager,
        { enableBackups: false },
      );

      try {
        await manager.initialize();

        await manager.saveMessage(2000000001, testParsedMessage);

        expect(mockFileStorage.createBackup).not.toHaveBeenCalled();
      } finally {
        await manager.destroy();
      }
    });

    it('should generate correct stored data format', async () => {
      await chatFileManager.saveMessage(2000000001, testParsedMessage);

      expect(mockFileStorage.writeJSONFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          version: '1.0',
          metadata: expect.objectContaining({
            fileCreated: expect.any(Date),
            lastMessageId: 12345,
            messageCount: 1,
            participantCount: 1,
          }),
        }),
      );
    });
  });
});

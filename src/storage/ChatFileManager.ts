import type { TChatManager, TChat, TParsedMessage, TUser, TStoredChatData, TMessage } from '../types';
import { FileStorage } from './FileStorage';
import { UserManager } from '../services/UserManager';
import type { VKApi } from '../services/VKApi';

/**
 * Configuration for ChatFileManager
 */
export interface TChatFileManagerConfig {
  maxMemoryCacheSize: number; // Maximum number of chats to keep in memory cache
  autoSaveInterval: number; // Auto-save interval in milliseconds
  enableBackups: boolean; // Whether to create backups before overwriting files
  membersUpdateInterval: number; // Interval for updating chat members in milliseconds
}

/**
 * Default configuration for ChatFileManager
 */
export const DEFAULT_CHAT_MANAGER_CONFIG: TChatFileManagerConfig = {
  maxMemoryCacheSize: 100, // Keep 100 chats in memory
  autoSaveInterval: 60 * 1000, // Save every minute
  enableBackups: true,
  membersUpdateInterval: 20 * 60 * 1000, // Update members every 20 minutes
};

/**
 * ChatFileManager handles file persistence for chat data with in-memory caching
 * Implements chat file naming convention: chat-{id}-{sanitized-name}.json
 */
export class ChatFileManager implements TChatManager {
  private fileStorage: FileStorage;
  private userManager: UserManager;
  private config: TChatFileManagerConfig;
  private readonly vkApi?: VKApi; // VKApi instance for fetching chat titles

  // In-memory cache for performance
  private chatCache = new Map<number, TChat>();
  private chatFilePaths = new Map<number, string>(); // chatId -> filePath mapping
  private autoSaveTimer?: ReturnType<typeof setInterval>;
  private membersUpdateTimer?: ReturnType<typeof setInterval>;
  private isInitialized = false;

  constructor(
    fileStorage: FileStorage,
    userManager: UserManager,
    config: Partial<TChatFileManagerConfig> = {},
    vkApi?: VKApi, // VKApi instance for fetching chat titles
  ) {
    this.fileStorage = fileStorage;
    this.userManager = userManager;
    this.config = { ...DEFAULT_CHAT_MANAGER_CONFIG, ...config };
    this.vkApi = vkApi;
  }

  /**
   * Initializes ChatFileManager and starts auto-save if configured
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('ChatFileManager: Already initialized');
      return;
    }

    console.log('ChatFileManager: Initializing...');

    try {
      // Initialize file storage first
      await this.fileStorage.initialize();

      // Load existing chat files for cache warming
      await this.warmUpCache();

      // Start auto-save timer if configured
      if (this.config.autoSaveInterval > 0) {
        this.startAutoSave();
      }

      // Start members update timer if VK API is available and configured
      if (this.vkApi && this.config.membersUpdateInterval > 0) {
        this.startMembersUpdate();
      }

      this.isInitialized = true;
      console.log(`ChatFileManager: Initialized with ${this.chatCache.size} cached chats`);
    } catch (error) {
      console.error('ChatFileManager: Failed to initialize:', error);
      throw new Error(`Failed to initialize ChatFileManager: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Saves a parsed message to the appropriate chat file
   * @param chatId - VK chat/peer ID
   * @param message - Parsed message from Long Poll
   */
  async saveMessage(chatId: number, message: TParsedMessage): Promise<void> {
    try {
      // Load or create chat data
      let chat = await this.getChatData(chatId);

      if (!chat) {
        // Create new chat
        chat = await this.createNewChat(chatId, message);
      }

      // Get user information for message author
      const author = await this.userManager.getUserInfo(message.fromId);

      // Convert TParsedMessage to TMessage
      const chatMessage: TMessage = {
        id: message.messageId,
        author,
        date: new Date(message.timestamp * 1000).toISOString(),
        content: message.text,
        attachments: message.attachments,
      };

      // Add message to chat (avoid duplicates)
      const existingMessageIndex = chat.messages.findIndex(msg => msg.id === chatMessage.id);
      if (existingMessageIndex === -1) {
        chat.messages.push(chatMessage);

        // Sort messages by date to maintain chronological order
        chat.messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } else {
        // Update existing message
        chat.messages[existingMessageIndex] = chatMessage;
      }

      // Update chat metadata
      chat.updatedAt = new Date();

      // Update user lists
      await this.updateChatUsers(chat, author);

      // Cache the updated chat
      this.chatCache.set(chatId, chat);

      // Save to file
      await this.saveChatToFile(chatId, chat);

      console.log(`ChatFileManager: Message ${message.messageId} saved to chat ${chatId}`);
    } catch (error) {
      console.error(`ChatFileManager: Failed to save message to chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves chat data by ID from cache or file
   * @param chatId - VK chat/peer ID
   * @returns Promise with chat data or null if not found
   */
  async getChatData(chatId: number): Promise<TChat | null> {
    try {
      // Check cache first
      const cachedChat = this.chatCache.get(chatId);
      if (cachedChat) {
        return cachedChat;
      }

      // Load from file
      const chat = await this.loadChatFromFile(chatId);
      if (chat) {
        // Cache the loaded chat
        this.chatCache.set(chatId, chat);

        // Enforce cache size limit
        if (this.chatCache.size > this.config.maxMemoryCacheSize) {
          this.evictOldestCacheEntry();
        }
      }

      return chat;
    } catch (error) {
      console.error(`ChatFileManager: Failed to get chat data for ${chatId}:`, error);
      return null;
    }
  }

  /**
   * Updates active users list for a chat when user sends a message
   * @param chatId - VK chat/peer ID
   * @param userId - VK user ID who was active
   */
  async updateActiveUsers(chatId: number, userId: number): Promise<void> {
    try {
      const chat = await this.getChatData(chatId);
      if (!chat) {
        console.warn(`ChatFileManager: Cannot update active users - chat ${chatId} not found`);
        return;
      }

      const user = await this.userManager.getUserInfo(userId);
      user.lastActivity = new Date();

      // Update active users list
      const activeUserIndex = chat.activeUsers.findIndex(u => u.id === userId);
      if (activeUserIndex >= 0) {
        // Update existing active user
        chat.activeUsers[activeUserIndex] = user;
      } else {
        // Add new active user
        chat.activeUsers.push(user);
      }

      // Sort active users by last activity (most recent first)
      chat.activeUsers.sort((a, b) => {
        const aTime = a.lastActivity?.getTime() || 0;
        const bTime = b.lastActivity?.getTime() || 0;
        return bTime - aTime;
      });

      chat.updatedAt = new Date();

      // Update cache
      this.chatCache.set(chatId, chat);

      console.log(`ChatFileManager: Updated active users for chat ${chatId}, user ${userId}`);
    } catch (error) {
      console.error(`ChatFileManager: Failed to update active users for chat ${chatId}:`, error);
    }
  }

  /**
   * Manually saves all cached chats to files
   */
  async saveAllChats(): Promise<void> {
    const savePromises: Promise<void>[] = [];

    for (const [chatId, chat] of this.chatCache) {
      savePromises.push(this.saveChatToFile(chatId, chat));
    }

    try {
      await Promise.all(savePromises);
      console.log(`ChatFileManager: Saved ${savePromises.length} cached chats to files`);
    } catch (error) {
      console.error('ChatFileManager: Failed to save all chats:', error);
    }
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { cachedChats: number; maxCacheSize: number } {
    return {
      cachedChats: this.chatCache.size,
      maxCacheSize: this.config.maxMemoryCacheSize,
    };
  }

  /**
   * Clears in-memory cache
   */
  clearCache(): void {
    this.chatCache.clear();
    this.chatFilePaths.clear();
    console.log('ChatFileManager: Cache cleared');
  }

  /**
   * Destroys ChatFileManager, saves cache, and stops auto-save
   */
  async destroy(): Promise<void> {
    console.log('ChatFileManager: Destroying...');

    // Stop auto-save timer
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }

    // Stop members update timer
    if (this.membersUpdateTimer) {
      clearInterval(this.membersUpdateTimer);
      this.membersUpdateTimer = undefined;
    }

    // Final save of all cached chats
    try {
      await this.saveAllChats();
      console.log('ChatFileManager: Final save completed');
    } catch (error) {
      console.error('ChatFileManager: Failed final save:', error);
    }

    console.log('ChatFileManager: Destroyed');
  }

  private async createNewChat(chatId: number, firstMessage: TParsedMessage): Promise<TChat> {
    // Try to get real chat name and participants from VK API
    let chatName = `Chat ${chatId}`; // fallback name
    let allChatUsers: TUser[] = [];
    let activeChatUsers: TUser[] = [];

    if (this.vkApi) {
      try {
        const conversationsResponse = await this.vkApi.getConversationsById([chatId]);
        if (conversationsResponse.items?.length) {
          const conversation = conversationsResponse.items[0];
          // Get chat name
          if (conversation.chat_settings?.title) {
            chatName = conversation.chat_settings.title;
          } else if (conversation.peer?.type === 'user' && conversation.peer.id) {
            // For private chats, we might want to use the user's name
            const userInfo = await this.userManager.getUserInfo(conversation.peer.id);
            chatName = `Диалог с ${userInfo.name}`;
          }

          // Get all participants using messages.getConversationMembers API method
          try {
            const membersResponse = await this.vkApi.getConversationMembers(chatId);

            if (membersResponse?.profiles?.length) {
              // Use profile data directly from the API response (no additional requests needed!)
              for (const profile of membersResponse.profiles) {
                if (profile.id) {
                  // Convert VK API user to our format
                  const user = {
                    id: profile.id,
                    name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
                    lastActivity: profile.last_seen?.time ? new Date(profile.last_seen.time * 1000) : new Date(),
                  };

                  // Cache the user for future requests
                  this.userManager.cacheUser(user);

                  // Add to chat participants
                  allChatUsers.push({
                    ...user,
                    lastActivity: new Date(), // Set current time for new chat creation
                  });
                }
              }

              console.log(`ChatFileManager: Loaded ${allChatUsers.length} participants for chat ${chatId} from API profiles`);
            } else if (membersResponse?.items?.length) {
              // Fallback to old method if profiles are not available
              const participantIds = membersResponse.items
                .map(item => item.member_id)
                .filter(id => id && id > 0) as number[];

              if (participantIds.length > 0) {
                const usersMap = await this.userManager.batchGetUsers(participantIds);
                for (const [, userData] of usersMap) {
                  allChatUsers.push({
                    ...userData,
                    lastActivity: new Date(),
                  });
                }
                console.log(`ChatFileManager: Loaded ${allChatUsers.length} participants for chat ${chatId} via batchGetUsers fallback`);
              }
            }
          } catch (error) {
            console.warn(`ChatFileManager: Failed to fetch chat participants for ${chatId}:`, error);
          }
        }
      } catch (error) {
        console.warn(`ChatFileManager: Failed to fetch chat data for ${chatId}, using fallback:`, error);
      }
    }

    // Fallback: if no participants loaded, add at least the message author
    if (allChatUsers.length === 0) {
      const author = await this.userManager.getUserInfo(firstMessage.fromId);
      allChatUsers = [author];
    }

    // Add message author as active user (they just sent a message)
    const messageAuthor = await this.userManager.getUserInfo(firstMessage.fromId);
    activeChatUsers = [{ ...messageAuthor, lastActivity: new Date() }];

    const newChat: TChat = {
      id: chatId,
      name: chatName,
      users: allChatUsers,
      activeUsers: activeChatUsers,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log(`ChatFileManager: Created new chat ${chatId} - "${chatName}" with ${allChatUsers.length} participants`);
    return newChat;
  }

  private async updateChatUsers(chat: TChat, messageAuthor: TUser): Promise<void> {
    // Add to users list if not present
    const userIndex = chat.users.findIndex(u => u.id === messageAuthor.id);
    if (userIndex === -1) {
      chat.users.push(messageAuthor);
    } else {
      // Update existing user data
      chat.users[userIndex] = messageAuthor;
    }

    // Update active users
    await this.updateActiveUsers(chat.id, messageAuthor.id);
  }

  private async loadChatFromFile(chatId: number): Promise<TChat | null> {
    // Try to find existing file path
    let filePath = this.chatFilePaths.get(chatId);

    if (!filePath) {
      // Search for file by pattern
      const chatFiles = await this.fileStorage.listChatFiles();
      filePath = chatFiles.find(path => path.includes(`chat-${chatId}-`));

      if (!filePath) {
        return null; // Chat file doesn't exist
      }

      // Cache the file path
      this.chatFilePaths.set(chatId, filePath);
    }

    try {
      const storedData = await this.fileStorage.readJSONFile<TStoredChatData>(filePath);
      if (!storedData) {
        return null;
      }

      // Convert stored data back to TChat format
      const chat: TChat = {
        id: storedData.id,
        name: storedData.name,
        users: storedData.users.map(user => ({
          ...user,
          lastActivity: user.lastActivity ? new Date(user.lastActivity) : undefined,
        })),
        activeUsers: storedData.activeUsers.map(user => ({
          ...user,
          lastActivity: user.lastActivity ? new Date(user.lastActivity) : undefined,
        })),
        messages: storedData.messages,
        createdAt: new Date(storedData.createdAt),
        updatedAt: new Date(storedData.updatedAt),
      };

      return chat;
    } catch (error) {
      console.error(`ChatFileManager: Failed to load chat ${chatId} from file:`, error);
      return null;
    }
  }

  private async saveChatToFile(chatId: number, chat: TChat): Promise<void> {
    try {
      // Create backup if enabled
      const existingPath = this.chatFilePaths.get(chatId);
      if (this.config.enableBackups && existingPath) {
        await this.fileStorage.createBackup(existingPath);
      }

      // Generate file path
      const filePath = this.fileStorage.generateChatFilePath(chatId, chat.name);
      this.chatFilePaths.set(chatId, filePath);

      // Create stored data with metadata
      const storedData: TStoredChatData = {
        ...chat,
        version: '1.0',
        metadata: {
          fileCreated: existingPath ? new Date(await this.getFileCreationDate(existingPath)) : new Date(),
          lastMessageId: chat.messages.length > 0 ? Math.max(...chat.messages.map(m => m.id)) : 0,
          messageCount: chat.messages.length,
          participantCount: chat.users.length,
        },
      };

      await this.fileStorage.writeJSONFile(filePath, storedData);
    } catch (error) {
      console.error(`ChatFileManager: Failed to save chat ${chatId} to file:`, error);
      throw error;
    }
  }

  private async getFileCreationDate(filePath: string): Promise<number> {
    try {
      const stats = await this.fileStorage.getFileStats(filePath);
      return stats?.ctime.getTime() || Date.now();
    } catch {
      return Date.now();
    }
  }

  private async warmUpCache(): Promise<void> {
    try {
      const chatFiles = await this.fileStorage.listChatFiles();
      console.log(`ChatFileManager: Found ${chatFiles.length} existing chat files`);

      // Don't load all files at once to avoid memory issues
      const filesToLoad = Math.min(chatFiles.length, Math.floor(this.config.maxMemoryCacheSize / 2));

      for (let i = 0; i < filesToLoad; i++) {
        const filePath = chatFiles[i];

        // Extract chat ID from filename
        const match = filePath.match(/chat-(\d+)-/);
        if (match) {
          const chatId = parseInt(match[1], 10);
          this.chatFilePaths.set(chatId, filePath);
        }
      }

      console.log(`ChatFileManager: Warmed up cache with ${filesToLoad} chat file paths`);
    } catch (error) {
      console.error('ChatFileManager: Failed to warm up cache:', error);
    }
  }

  private evictOldestCacheEntry(): void {
    // Simple LRU eviction - remove first entry (oldest)
    const firstKey = this.chatCache.keys().next().value;
    if (firstKey !== undefined) {
      this.chatCache.delete(firstKey);
      console.log(`ChatFileManager: Evicted chat ${firstKey} from cache`);
    }
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      this.saveAllChats().catch(error => {
        console.error('ChatFileManager: Auto-save failed:', error);
      });
    }, this.config.autoSaveInterval);

    console.log(`ChatFileManager: Auto-save started (interval: ${this.config.autoSaveInterval}ms)`);
  }

  private startMembersUpdate(): void {
    this.membersUpdateTimer = setInterval(() => {
      this.updateAllChatMembers().catch(error => {
        console.error('ChatFileManager: Members update failed:', error);
      });
    }, this.config.membersUpdateInterval);

    console.log(`ChatFileManager: Members update started (interval: ${this.config.membersUpdateInterval}ms)`);
  }

  private async updateAllChatMembers(): Promise<void> {
    if (!this.vkApi) {
      console.warn('ChatFileManager: Cannot update chat members - VK API not available');
      return;
    }

    const chatIds = Array.from(this.chatCache.keys());
    console.log(`ChatFileManager: Starting periodic update of ${chatIds.length} chats`);

    let updatedChats = 0;
    let newMembersFound = 0;

    for (const chatId of chatIds) {
      try {
        const newMembers = await this.updateChatMembers(chatId);
        if (newMembers > 0) {
          updatedChats++;
          newMembersFound += newMembers;
        }
      } catch (error) {
        console.warn(`ChatFileManager: Failed to update members for chat ${chatId}:`, error);
      }
    }

    console.log(`ChatFileManager: Members update completed - ${updatedChats} chats updated, ${newMembersFound} new members found`);
  }

  private async updateChatMembers(chatId: number): Promise<number> {
    if (!this.vkApi) {
      return 0;
    }

    const chat = this.chatCache.get(chatId);
    if (!chat) {
      return 0;
    }

    try {
      // Get current members from VK API
      const membersResponse = await this.vkApi.getConversationMembers(chatId);

      if (!membersResponse?.profiles?.length) {
        return 0;
      }

      const existingUserIds = new Set(chat.users.map(user => user.id));
      let newMembersCount = 0;

      // Process all profiles from the API response
      for (const profile of membersResponse.profiles) {
        if (profile.id && !existingUserIds.has(profile.id)) {
          // New member found!
          const user = {
            id: profile.id,
            name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
            lastActivity: profile.last_seen?.time ? new Date(profile.last_seen.time * 1000) : new Date(),
          };

          // Cache the user for future requests
          this.userManager.cacheUser(user);

          // Add to chat users list
          chat.users.push(user);
          newMembersCount++;

          console.log(`ChatFileManager: New member added to chat ${chatId}: ${user.name} (${user.id})`);
        }
      }

      // Update chat metadata if we found new members
      if (newMembersCount > 0) {
        chat.updatedAt = new Date();
        this.chatCache.set(chatId, chat);

        // Save updated chat to file
        await this.saveChatToFile(chatId, chat);
      }

      return newMembersCount;
    } catch (error) {
      console.warn(`ChatFileManager: Failed to fetch members for chat ${chatId}:`, error);
      return 0;
    }
  }
}

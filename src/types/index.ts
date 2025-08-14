// Core data model interfaces
export interface TUser {
  id: number;
  name: string;
  lastActivity?: Date;
}

export interface TMessage {
  id: number;
  author: TUser;
  date: string; // ISO string
  content: string;
  attachments?: TAttachment[];
}

export interface TAttachment {
  type: 'photo' | 'audio' | 'video' | 'doc' | 'sticker' | 'link' | 'geo';
  id: string;
  url?: string;
  title?: string;
  metadata?: Record<string, any>;
}

export interface TChat {
  name: string;
  id: number;
  users: TUser[];
  activeUsers: TUser[];
  messages: TMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Long Poll and API related types
export interface TLongPollServerConfig {
  server: string;
  key: string;
  ts: number;
  pts?: number;
}

export interface TParsedMessage {
  messageId: number;
  peerId: number;
  fromId: number;
  timestamp: number;
  text: string;
  attachments: TAttachment[];
  flags: TMessageFlags;
  conversationMessageId?: number;
}

export interface TMessageFlags {
  unread: boolean;
  outbox: boolean;
  replied: boolean;
  important: boolean;
  chat: boolean;
  friends: boolean;
  spam: boolean;
  delUser: boolean;
  fixed: boolean;
  media: boolean;
}

// Cache and storage types
export interface TCachedUser extends TUser {
  cachedAt: Date;
  ttl: number;
}

export interface TStoredChatData extends TChat {
  version: string; // Версия формата файла
  metadata: {
    fileCreated: Date;
    lastMessageId: number;
    messageCount: number;
    participantCount: number;
  };
}

// Configuration and error handling types
export interface TErrorRecoveryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  bufferSize: number;
  stateSaveInterval: number;
}

export interface TLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  metadata?: Record<string, any>;
}

// Event types for Long Poll
export type TLongPollEvent = (number | string | Record<string, any>)[];

export interface TConnectionState {
  connected: boolean;
  lastTs?: number;
  lastPts?: number;
  reconnectAttempts: number;
}

// Component interface contracts
export interface TLongPollCollector {
  start(): Promise<void>;
  stop(): Promise<void>;
  reconnect(): Promise<void>;
  // eslint-disable-next-line no-unused-vars
  onEvent(callback: (event: TLongPollEvent) => Promise<void>): void;
}

export interface TEventProcessor {
  // eslint-disable-next-line no-unused-vars
  processEvent(event: TLongPollEvent): Promise<void>;
  // eslint-disable-next-line no-unused-vars
  registerHandler(eventType: number, handler: (event: TLongPollEvent) => Promise<void>): void;
}

export interface TChatManager {
  // eslint-disable-next-line no-unused-vars
  saveMessage(chatId: number, message: TParsedMessage): Promise<void>;
  // eslint-disable-next-line no-unused-vars
  getChatData(chatId: number): Promise<TChat | null>;
  // eslint-disable-next-line no-unused-vars
  updateActiveUsers(chatId: number, userId: number): Promise<void>;
}

export interface TUserManager {
  // eslint-disable-next-line no-unused-vars
  getUserInfo(userId: number): Promise<TUser>;
  // eslint-disable-next-line no-unused-vars
  batchGetUsers(userIds: number[]): Promise<Map<number, TUser>>;
  clearCache(): void;
}

export interface TMessageParser {
  // eslint-disable-next-line no-unused-vars
  parseMessageEvent(event: TLongPollEvent): TParsedMessage;
  // eslint-disable-next-line no-unused-vars
  parseAttachments(attachmentData: Record<string, any>): TAttachment[];
}

// Test types
export interface TMockLongPollResponse {
  ts: number;
  updates: number[][];
  failed?: number;
}

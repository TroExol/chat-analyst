import type {
  TLongPollCollector,
  TLongPollEvent,
  TConnectionState,
  TLongPollServerConfig,
} from '../types';
import type { TLongPollConnectionParams, TLongPollResponse } from './VKApi/types';
import { VKApi } from './VKApi';
import { Logger } from './Logger';
import { ErrorHandler } from './ErrorHandler';
import { calculateBackoffDelay } from '../utils';

/**
 * Long Poll connection configuration
 */
export interface TLongPollCollectorConfig {
  maxReconnectAttempts: number;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
  pollTimeout: number; // wait parameter for Long Poll
  connectionHealthCheckInterval: number;
  enableConnectionPersistence: boolean;
  enableMissedEventsRecovery: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_LONGPOLL_COLLECTOR_CONFIG: TLongPollCollectorConfig = {
  maxReconnectAttempts: 10,
  baseReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  pollTimeout: 25, // VK recommended
  connectionHealthCheckInterval: 60000, // 1 minute
  enableConnectionPersistence: true,
  enableMissedEventsRecovery: true,
};

/**
 * Connection statistics
 */
export interface TConnectionStats {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  reconnectionAttempts: number;
  totalEventsReceived: number;
  lastConnectionTime: Date | null;
  lastEventTime: Date | null;
  uptime: number; // milliseconds
}

/**
 * LongPollCollector manages VK Long Poll server connection
 * Requirements: 1.1, 1.2, 1.3, 4.1, 4.4
 */
export class LongPollCollector implements TLongPollCollector {
  private vkApi: VKApi;
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private config: TLongPollCollectorConfig;

  // Connection state
  private connectionState: TConnectionState;
  private serverConfig: TLongPollServerConfig | null = null;
  private isRunning = false;
  private isConnecting = false;

  // Event handling
  // eslint-disable-next-line no-unused-vars
  private eventCallbacks: Array<(event: TLongPollEvent) => Promise<void>> = [];

  // Timers and intervals
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Statistics
  private stats: TConnectionStats;
  private startTime: Date | null = null;

  constructor(
    vkApi: VKApi,
    logger: Logger,
    errorHandler: ErrorHandler,
    config: Partial<TLongPollCollectorConfig> = {},
  ) {
    this.vkApi = vkApi;
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.config = { ...DEFAULT_LONGPOLL_COLLECTOR_CONFIG, ...config };

    this.connectionState = {
      connected: false,
      reconnectAttempts: 0,
    };

    this.stats = {
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      reconnectionAttempts: 0,
      totalEventsReceived: 0,
      lastConnectionTime: null,
      lastEventTime: null,
      uptime: 0,
    };

    this.logger.info('LongPollCollector', 'Initialized with configuration', {
      config: this.config,
    });
  }

  /**
   * Start Long Poll connection
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('LongPollCollector', 'Already running, ignoring start request');
      return;
    }

    this.logger.info('LongPollCollector', 'Starting Long Poll connection');

    this.isRunning = true;
    this.startTime = new Date();
    this.connectionState.reconnectAttempts = 0;

    try {
      await this.connectToServer();
      this.startHealthCheck();
      this.startPolling();

      this.logger.info('LongPollCollector', 'Long Poll connection started successfully');
    } catch (error) {
      this.isRunning = false;
      this.logger.error('LongPollCollector', 'Failed to start Long Poll connection', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop Long Poll connection
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('LongPollCollector', 'Not running, ignoring stop request');
      return;
    }

    this.logger.info('LongPollCollector', 'Stopping Long Poll connection');

    this.isRunning = false;
    this.connectionState.connected = false;

    // Clear all timers
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Calculate uptime
    if (this.startTime) {
      this.stats.uptime = Date.now() - this.startTime.getTime();
    }

    this.logger.info('LongPollCollector', 'Long Poll connection stopped', {
      finalStats: this.getStats(),
    });
  }

  /**
   * Reconnect to Long Poll server
   */
  async reconnect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.debug('LongPollCollector', 'Already reconnecting, skipping request');
      return;
    }

    this.logger.info('LongPollCollector', 'Initiating reconnection', {
      reconnectAttempts: this.connectionState.reconnectAttempts,
    });

    this.connectionState.connected = false;
    this.stats.reconnectionAttempts++;

    try {
      await this.connectToServer();

      // Reset reconnect attempts on successful connection
      this.connectionState.reconnectAttempts = 0;

      this.logger.info('LongPollCollector', 'Reconnection successful');

      // Resume polling if we're still running
      if (this.isRunning) {
        this.startPolling();
      }
    } catch (error) {
      this.logger.error('LongPollCollector', 'Reconnection failed', {
        error: (error as Error).message,
        reconnectAttempts: this.connectionState.reconnectAttempts,
      });

      // Schedule next reconnection attempt if we haven't exceeded max attempts
      if (this.connectionState.reconnectAttempts < this.config.maxReconnectAttempts && this.isRunning) {
        this.scheduleReconnection();
      } else {
        this.logger.error('LongPollCollector', 'Max reconnection attempts exceeded, stopping');
        await this.stop();
      }

      throw error;
    }
  }

  /**
   * Register event callback
   */
  // eslint-disable-next-line no-unused-vars
  onEvent(callback: (event: TLongPollEvent) => Promise<void>): void {
    this.eventCallbacks.push(callback);

    this.logger.info('LongPollCollector', 'Event callback registered', {
      totalCallbacks: this.eventCallbacks.length,
    });
  }

  /**
   * Get connection statistics
   */
  getStats(): TConnectionStats {
    const currentStats = { ...this.stats };

    if (this.startTime) {
      currentStats.uptime = Date.now() - this.startTime.getTime();
    }

    return currentStats;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): TConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Get server configuration
   */
  getServerConfig(): TLongPollServerConfig | null {
    return this.serverConfig ? { ...this.serverConfig } : null;
  }

  /**
   * Connect to VK Long Poll server
   */
  private async connectToServer(): Promise<void> {
    this.isConnecting = true;
    this.stats.totalConnections++;

    try {
      this.logger.info('LongPollCollector', 'Connecting to VK Long Poll server');

      // Get Long Poll server configuration from VK API
      const serverResponse = await this.vkApi.getLongPollServerForChat();

      if (!serverResponse.server || !serverResponse.key || !serverResponse.ts) {
        throw new Error('Invalid Long Poll server response: missing required fields');
      }

      this.serverConfig = {
        server: serverResponse.server,
        key: serverResponse.key,
        ts: serverResponse.ts,
        pts: serverResponse.pts,
      };

      this.connectionState.connected = true;
      this.connectionState.lastPts = serverResponse.pts;
      this.stats.successfulConnections++;
      this.stats.lastConnectionTime = new Date();

      this.logger.info('LongPollCollector', 'Connected to Long Poll server successfully', {
        server: this.serverConfig.server,
        ts: this.serverConfig.ts,
        pts: this.serverConfig.pts,
      });

      // Recover missed events if enabled and we have previous pts
      if (this.config.enableMissedEventsRecovery && this.connectionState.lastPts && this.connectionState.lastPts !== serverResponse.pts) {
        await this.recoverMissedEvents();
      }

    } catch (error) {
      this.stats.failedConnections++;
      this.connectionState.connected = false;

      this.logger.error('LongPollCollector', 'Failed to connect to Long Poll server', {
        error: (error as Error).message,
        reconnectAttempts: this.connectionState.reconnectAttempts,
      });

      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Start continuous polling for events
   */
  private startPolling(): void {
    if (!this.connectionState.connected || !this.serverConfig) {
      this.logger.warn('LongPollCollector', 'Cannot start polling: not connected');
      return;
    }

    this.logger.debug('LongPollCollector', 'Starting polling for events');
    this.pollForEvents();
  }

  /**
   * Poll for events from Long Poll server
   */
  private async pollForEvents(): Promise<void> {
    if (!this.isRunning || !this.connectionState.connected || !this.serverConfig) {
      return;
    }

    try {
      const connectionParams: TLongPollConnectionParams = {
        server: this.serverConfig.server,
        key: this.serverConfig.key,
        ts: this.serverConfig.ts,
        wait: this.config.pollTimeout,
        mode: 170, // Get attachments info + extended events
        version: 3,
      };

      this.logger.debug('LongPollCollector', 'Polling for events', {
        ts: connectionParams.ts,
        wait: connectionParams.wait,
      });

      const response: TLongPollResponse = await this.vkApi.connectToLongPollServer(connectionParams);

      // Handle Long Poll response
      await this.handleLongPollResponse(response);

      // Schedule next poll
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.pollForEvents(), 100);
      }

    } catch (error) {
      this.logger.error('LongPollCollector', 'Error during polling', {
        error: (error as Error).message,
      });

      await this.handleConnectionError(error as Error);
    }
  }

  /**
   * Handle Long Poll response and process events
   */
  private async handleLongPollResponse(response: TLongPollResponse): Promise<void> {
    if (!this.serverConfig) {
      throw new Error('Server config not available');
    }

    // Update timestamp for next request
    this.serverConfig.ts = response.ts;

    if (response.updates && response.updates.length > 0) {
      this.logger.debug('LongPollCollector', `Received ${response.updates.length} events`, {
        ts: response.ts,
        eventCount: response.updates.length,
      });

      this.stats.totalEventsReceived += response.updates.length;
      this.stats.lastEventTime = new Date();

      // Process each event through registered callbacks
      for (const event of response.updates) {
        await this.processEventSafely(event as TLongPollEvent);
      }
    }
  }

  /**
   * Process single event through all registered callbacks
   */
  private async processEventSafely(event: TLongPollEvent): Promise<void> {
    if (this.eventCallbacks.length === 0) {
      this.logger.debug('LongPollCollector', 'No event callbacks registered');
      return;
    }

    try {
      // Execute all callbacks in parallel
      const callbackPromises = this.eventCallbacks.map(callback =>
        this.executeCallbackSafely(callback, event),
      );

      await Promise.all(callbackPromises);

    } catch (error) {
      this.logger.error('LongPollCollector', 'Error processing event', {
        event,
        error: (error as Error).message,
      });

      // Don't throw - continue processing other events
    }
  }

  /**
   * Execute event callback with error handling
   */
  private async executeCallbackSafely(
    // eslint-disable-next-line no-unused-vars
    callback: (event: TLongPollEvent) => Promise<void>,
    event: TLongPollEvent,
  ): Promise<void> {
    try {
      await callback(event);
    } catch (error) {
      this.logger.error('LongPollCollector', 'Event callback failed', {
        event,
        error: (error as Error).message,
      });

      // Use error handler for potential retry
      await this.errorHandler.handleError(
        error as Error,
        () => callback(event),
        'event-callback-processing',
      );
    }
  }

  /**
   * Handle connection errors with retry logic
   */
  private async handleConnectionError(error: Error): Promise<void> {
    this.connectionState.connected = false;
    this.connectionState.reconnectAttempts++;

    this.logger.warn('LongPollCollector', 'Connection error occurred', {
      error: error.message,
      reconnectAttempts: this.connectionState.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
    });

    // Don't attempt reconnection if we're not running
    if (!this.isRunning) {
      return;
    }

    // Check if we should attempt reconnection
    if (this.connectionState.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnection();
    } else {
      this.logger.error('LongPollCollector', 'Max reconnection attempts exceeded', {
        reconnectAttempts: this.connectionState.reconnectAttempts,
        maxAttempts: this.config.maxReconnectAttempts,
      });
      await this.stop();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnection(): void {
    const delay = calculateBackoffDelay(
      this.connectionState.reconnectAttempts - 1,
      this.config.baseReconnectDelay,
      this.config.maxReconnectDelay,
    );

    this.logger.info('LongPollCollector', `Scheduling reconnection in ${delay}ms`, {
      attempt: this.connectionState.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        this.logger.error('LongPollCollector', 'Scheduled reconnection failed', {
          error: (error as Error).message,
        });
      }
    }, delay);
  }

  /**
   * Start connection health monitoring
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.connectionHealthCheckInterval);

    this.logger.debug('LongPollCollector', 'Health check started', {
      interval: this.config.connectionHealthCheckInterval,
    });
  }

  /**
   * Perform connection health check
   */
  private performHealthCheck(): void {
    const now = new Date();
    const timeSinceLastEvent = this.stats.lastEventTime
      ? now.getTime() - this.stats.lastEventTime.getTime()
      : null;

    this.logger.debug('LongPollCollector', 'Performing health check', {
      connected: this.connectionState.connected,
      timeSinceLastEvent,
      isRunning: this.isRunning,
    });

    // Check if connection seems stale (no events for a long time)
    const maxStaleTime = this.config.connectionHealthCheckInterval * 3;
    if (timeSinceLastEvent && timeSinceLastEvent > maxStaleTime) {
      this.logger.warn('LongPollCollector', 'Connection appears stale, initiating reconnection', {
        timeSinceLastEvent,
        maxStaleTime,
      });

      // Don't await - let it run in background
      this.reconnect().catch(error => {
        this.logger.error('LongPollCollector', 'Health check reconnection failed', {
          error: (error as Error).message,
        });
      });
    }
  }

  /**
   * Recover missed events using getLongPollHistory
   */
  private async recoverMissedEvents(): Promise<void> {
    if (!this.config.enableMissedEventsRecovery || !this.serverConfig) {
      return;
    }

    const lastPts = this.connectionState.lastPts;
    const currentPts = this.serverConfig.pts;

    if (!lastPts || !currentPts || lastPts >= currentPts) {
      this.logger.debug('LongPollCollector', 'No missed events to recover');
      return;
    }

    try {
      this.logger.info('LongPollCollector', 'Recovering missed events', {
        lastPts,
        currentPts,
        missedEvents: currentPts - lastPts,
      });

      const historyResponse = await this.vkApi.getLongPollHistory(this.serverConfig.ts, lastPts);

      if (historyResponse.messages?.items && historyResponse.messages.items.length > 0) {
        this.logger.info('LongPollCollector', `Recovered ${historyResponse.messages.items.length} missed messages`);

        // Process recovered messages as events
        for (const message of historyResponse.messages.items) {
          // Convert message to Long Poll event format
          const recoveredEvent: TLongPollEvent = [
            4, // MESSAGE_NEW
            message.id,
            message.flags || 0,
            message.peer_id,
            message.date,
            message.text || '',
            { from: message.from_id?.toString() },
            message.attachments || {},
          ];

          await this.processEventSafely(recoveredEvent);
        }
      }

    } catch (error) {
      this.logger.error('LongPollCollector', 'Failed to recover missed events', {
        error: (error as Error).message,
        lastPts,
        currentPts,
      });
      // Don't throw - missed events recovery is not critical
    }
  }

  /**
   * Get detailed connection information
   */
  getConnectionInfo(): {
    state: TConnectionState;
    config: TLongPollServerConfig | null;
    stats: TConnectionStats;
    isRunning: boolean;
    } {
    return {
      state: this.getConnectionState(),
      config: this.getServerConfig(),
      stats: this.getStats(),
      isRunning: this.isRunning,
    };
  }

  /**
   * Destroy collector and cleanup resources
   */
  async destroy(): Promise<void> {
    await this.stop();

    // Clear all callbacks
    this.eventCallbacks = [];

    this.logger.info('LongPollCollector', 'Collector destroyed', {
      finalStats: this.getStats(),
    });
  }
}

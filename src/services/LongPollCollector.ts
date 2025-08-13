// Placeholder for LongPollCollector class - will be implemented in later tasks
import type { TLongPollCollector, TLongPollEvent } from '../types/index.js';

export class LongPollCollector implements TLongPollCollector {
  async start(): Promise<void> {
    // Implementation will be added in task 8.1
    throw new Error('Not implemented yet');
  }

  async stop(): Promise<void> {
    // Implementation will be added in task 8.1
    throw new Error('Not implemented yet');
  }

  async reconnect(): Promise<void> {
    // Implementation will be added in task 8.2
    throw new Error('Not implemented yet');
  }

  onEvent(_callback: (event: TLongPollEvent) => Promise<void>): void {
    // Implementation will be added in task 8.1
    throw new Error('Not implemented yet');
  }
}

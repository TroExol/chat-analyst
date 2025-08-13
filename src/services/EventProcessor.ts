// Placeholder for EventProcessor class - will be implemented in later tasks
import type { TEventProcessor, TLongPollEvent } from '../types';

export class EventProcessor implements TEventProcessor {
  async processEvent(_event: TLongPollEvent): Promise<void> {
    // Implementation will be added in task 7.1
    throw new Error('Not implemented yet');
  }

  registerHandler(_eventType: number, _handler: (event: TLongPollEvent) => Promise<void>): void {
    // Implementation will be added in task 7.1
    throw new Error('Not implemented yet');
  }
}

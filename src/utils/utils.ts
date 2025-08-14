import { mkdir } from 'fs/promises';

export const getFormData = (data: Record<string, any>) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, value.toString());
    }
  });
  return formData;
};

/**
 * Sanitizes file name for safe file system usage
 */
export function sanitizeFileName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\.$/, '')
    .trim()
    .substring(0, 100);
}

/**
 * Creates directory if it doesn't exist
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as any)?.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Sleeps for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  multiplier: number = 2,
): number {
  const delay = baseDelay * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelay);
}

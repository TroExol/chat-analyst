import {
  MessagesGetLongPollHistoryParams,
  MessagesGetLongPollHistoryResponse,
  MessagesGetLongPollServerParams,
  MessagesGetLongPollServerResponse,
  UsersGetParams,
  UsersGetResponse,
  MessagesGetConversationsByIdParams,
  MessagesGetConversationsByIdResponse,
  MessagesGetConversationMembersParams,
  MessagesGetConversationMembersResponse,
} from '@vkontakte/api-schema-typescript';
import { TApiWithAccessTokenParams, TRefreshAccessTokenResponse, TLongPollResponse, TVKApiResponse, TLongPollConnectionParams } from './types';
import { getFormData } from '../../utils';

export class VKApi {
  private readonly baseUrl: string = 'https://api.vk.com/method';
  private token: string = '';
  private currentUserId: number | null = null; // Cache for current user ID

  public getLongPollServerForChat = (): Promise<MessagesGetLongPollServerResponse> => {
    const params: TApiWithAccessTokenParams<MessagesGetLongPollServerParams> = {
      access_token: this.token,
      v: '5.199',
      need_pts: 1,
      group_id: 0,
      lp_version: 3,
    };
    return this.fetchWithRetry<MessagesGetLongPollServerParams, MessagesGetLongPollServerResponse>(
      `${this.baseUrl}/messages.getLongPollServer`,
      'POST',
      params,
    );
  };

  public getLongPollHistory = async (ts: number, pts: number): Promise<MessagesGetLongPollHistoryResponse> => {
    const params: TApiWithAccessTokenParams<MessagesGetLongPollHistoryParams> = {
      access_token: this.token,
      v: '5.199',
      ts,
      pts,
    };
    return await this.fetchWithRetry<MessagesGetLongPollHistoryParams, MessagesGetLongPollHistoryResponse>(
      `${this.baseUrl}/messages.getLongPollHistory`,
      'POST',
      params,
    );
  };

  /**
   * Direct connection to VK Long Poll server for real-time events
   * @param connectionParams - Long Poll connection parameters from getLongPollServerForChat
   * @returns Promise with Long Poll response containing events
   */
  public connectToLongPollServer = async (connectionParams: TLongPollConnectionParams): Promise<TLongPollResponse> => {
    const { server, key, ts, wait = 25, mode = 170, version = 3 } = connectionParams;

    const url = `https://${server}?act=a_check&key=${key}&ts=${ts}&wait=${wait}&mode=${mode}&version=${version}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`Long Poll request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as TLongPollResponse;

      // Handle Long Poll specific errors
      if (data.failed) {
        throw new Error(`Long Poll failed with code: ${data.failed}`);
      }

      return data;
    } catch (error) {
      throw new Error(`Long Poll connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  /**
   * Get users information by IDs
   * @param userIds - Array of user IDs to fetch
   * @param fields - Additional fields to include
   * @returns Promise with users data
   */
  public getUsers = async (userIds?: number[], fields?: string[]): Promise<UsersGetResponse> => {
    const params: TApiWithAccessTokenParams<UsersGetParams> = {
      access_token: this.token,
      v: '5.199',
      user_ids: userIds?.join(','),
      fields: fields?.join(','),
    };

    return this.fetchWithRetry<UsersGetParams, UsersGetResponse>(
      `${this.baseUrl}/users.get`,
      'POST',
      params,
    );
  };

  /**
   * Get conversations by IDs to fetch chat titles and info
   * @param peerIds - Array of peer IDs (chat IDs)
   * @returns Promise with conversations data
   */
  public getConversationsById = async (peerIds: number[]): Promise<MessagesGetConversationsByIdResponse> => {
    const params: TApiWithAccessTokenParams<MessagesGetConversationsByIdParams> = {
      access_token: this.token,
      v: '5.199',
      peer_ids: peerIds.join(','),
    };

    return this.fetchWithRetry<MessagesGetConversationsByIdParams, MessagesGetConversationsByIdResponse>(
      `${this.baseUrl}/messages.getConversationsById`,
      'POST',
      params,
    );
  };

  /**
   * Get conversation members list
   * @param peerId - Chat/conversation ID
   * @param offset - Offset for pagination
   * @param count - Number of members to return
   * @returns Promise with conversation members data
   */
  public getConversationMembers = async (
    peerId: number,
    offset = 0,
    count = 200,
  ): Promise<MessagesGetConversationMembersResponse> => {
    const params: TApiWithAccessTokenParams<MessagesGetConversationMembersParams> = {
      access_token: this.token,
      v: '5.199',
      peer_id: peerId,
      offset,
      count,
      extended: 1, // Return profiles and groups information
    };

    return this.fetchWithRetry<MessagesGetConversationMembersParams, MessagesGetConversationMembersResponse>(
      `${this.baseUrl}/messages.getConversationMembers`,
      'POST',
      params,
    );
  };

  /**
   * Get current user ID from VK API
   * @returns Promise with current user ID
   */
  public getCurrentUserId = async (): Promise<number> => {
    if (this.currentUserId !== null) {
      return this.currentUserId;
    }

    try {
      const response = await this.getUsers(undefined, ['id']); // Get current user info

      if (response && response.length > 0 && typeof response[0].id === 'number') {
        this.currentUserId = response[0].id;
        return this.currentUserId;
      }
    } catch (error) {
      console.warn('VKApi: Failed to get current user ID:', error);
    }

    throw new Error('Unable to determine current user ID');
  };

  public refreshAccessToken = async () => {
    const data = await fetch('https://login.vk.com/?act=web_token', {
      method: 'POST',
      body: `version=1&app_id=6287487&access_token=${this.token || 'some_token'}`,
      headers: {
        Cookie: process.env.VK_COOKIE || '',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        accept: '*/*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'ru,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        pragma: 'no-cache',
        priority: 'u=1, i',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        cookie: process.env.VK_COOKIE || '',
        Referer: 'https://vk.com/',
        Origin: 'https://vk.com',
      },
    }).then((res) => res.json()) as TRefreshAccessTokenResponse;
    if (data.type === 'okay') {
      this.token = data.data.access_token;
      console.log('Токен обновлен');
      return true;
    }
    console.log('Токен не обновлен', data);
    return false;
  };

  /**
   * Set access token for API calls
   * @param token - VK access token
   */
  public setAccessToken = (token: string): void => {
    this.token = token;
  };

  /**
   * Get current access token
   * @returns Current VK access token
   */
  public getAccessToken = (): string => {
    return this.token;
  };

  private fetchWithRetry = async <P extends Record<string, any>, R>(
    url: string,
    method: 'POST' | 'GET',
    params: TApiWithAccessTokenParams<P>,
  ): Promise<R> => {
    let countTries = 0;
    const maxRetries = 3;

    const getter = async (): Promise<R> => {
      if (countTries >= maxRetries) {
        throw new Error(`VK API: Превышено максимальное количество попыток (${maxRetries})`);
      }

      try {
        const data = await fetch(url, {
          method,
          body: getFormData({
            ...params,
            access_token: this.token,
          }),
        }).then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return res.json();
        }) as TVKApiResponse<R>;

        // Handle VK API errors
        if (data.error) {
          const error = data.error;
          console.log(`VK API Error: ${error.error_code} - ${error.error_msg}`);

          switch (error.error_code) {
          case 5: {
            // Invalid access token
            console.log('Попытка обновления токена...');
            const tokenRefreshed = await this.refreshAccessToken();
            if (tokenRefreshed) {
              countTries++;
              return getter();
            }
            throw new Error('Не удалось обновить токен доступа');
          }

          case 6:
            // Too many requests per second
            console.log('Rate limit достигнут, ожидание...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            countTries++;
            return getter();

          case 14:
            // Captcha needed
            throw new Error('Требуется ввод капчи. Невозможно автоматически обработать.');

          case 15:
            // Access denied
            throw new Error('Доступ запрещен. Проверьте права токена.');

          default:
            throw new Error(`VK API Error ${error.error_code}: ${error.error_msg}`);
          }
        }

        if (!data.response) {
          throw new Error('VK API: Пустой ответ от сервера');
        }

        return data.response;
      } catch (error) {
        if (error instanceof Error) {
          // If it's a known VK API error, don't retry
          if (error.message.includes('VK API Error') ||
              error.message.includes('Требуется ввод капчи') ||
              error.message.includes('Доступ запрещен')) {
            throw error;
          }
        }

        // For network errors, retry with exponential backoff
        countTries++;
        if (countTries < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, countTries - 1), 10000);
          console.log(`Повторная попытка через ${delay}ms (попытка ${countTries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return getter();
        }

        throw error;
      }
    };

    return getter();
  };
}

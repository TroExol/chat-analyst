import { MessagesGetLongPollHistoryParams, MessagesGetLongPollHistoryResponse, MessagesGetLongPollServerParams, MessagesGetLongPollServerResponse } from '@vkontakte/api-schema-typescript';
import { TApiWithAccessTokenParams, TRefreshAccessTokenResponse } from './types';
import { getFormData } from '../../utils';

export class VKApi {
  private readonly baseUrl: string = 'https://api.vk.com/method';
  private token: string = '';

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

  // public getLongPollHistory = async (ts: number, pts: number) => {
  //   const params: TApiWithAccessTokenParams<MessagesGetLongPollHistoryParams> = {
  //     access_token: this.token,
  //     v: '5.199',
  //     ts,
  //     pts,
  //   };
  //   return await this.fetchWithRetry<MessagesGetLongPollHistoryParams, MessagesGetLongPollHistoryResponse>(
  //     `${this.baseUrl}/messages.getLongPollHistory`,
  //     'POST',
  //     params,
  //   );
  // };

  public refreshAccessToken = async () => {
    const data = await fetch('https://login.vk.com/?act=web_token', {
      method: 'POST',
      body: `version=1&app_id=6287487&access_token=${process.env.VK_ACCESS_TOKEN || 'adsd'}`,
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

  private fetchWithRetry = async <P extends Record<string, any>, R>(
    url: string,
    method: 'POST' | 'GET',
    params: TApiWithAccessTokenParams<P>,
  ): Promise<R> => {
    let countTries = 0;
    const getter = async () => {
      if (countTries > 2) {
        return {
          error: {
            error_code: 9991,
            error_msg: 'Много попыток',
          },
        };
      }

      const data = await fetch(url, {
        method,
        body: getFormData({
          ...params,
          access_token: this.token,
        }),
      }).then((res) => res.json());

      if (data.error) {
        console.log('fetchWithRetry: Ошибка', data.error);
        if (data.error.error_code === 5) {
          await this.refreshAccessToken();
          countTries++;
          return getter();
        }
      }

      return data.response;
    };

    return getter();
  };
}

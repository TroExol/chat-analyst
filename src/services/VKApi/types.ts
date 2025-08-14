export interface TRefreshAccessTokenResponse {
  type: 'okay' | 'error';
  data: {
    access_token: string;
    expires: number;
    user_id: number;
    logout_hash: string;
  };
}

export type TApiWithAccessTokenParams<T> = T & {
  access_token: string;
  v: string;
};

export interface TLongPollResponse {
  ts: number;
  updates: number[][];
  failed?: number;
}

export interface TVKApiError {
  error_code: number;
  error_msg: string;
}

export interface TVKApiResponse<T> {
  response?: T;
  error?: TVKApiError;
}

export interface TLongPollConnectionParams {
  server: string;
  key: string;
  ts: number;
  wait?: number;
  mode?: number;
  version?: number;
}

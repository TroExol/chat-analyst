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

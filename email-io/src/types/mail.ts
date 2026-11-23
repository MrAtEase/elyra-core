export type IcloudCredentials = {
  email: string;
  appPassword: string;
  imapHost?: string;
  imapPort?: number;
};

export type IcloudSmtpCredentials = {
  email: string;
  appPassword: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean; // default false
};

export type IcloudFoldersRequest = {
  workspaceId: string;
  identityId: string;
  credentials: IcloudCredentials;
};

export type IcloudThreadsRequest = {
  workspaceId: string;
  identityId: string;
  folder?: string;
  limit?: number;
  credentials: IcloudCredentials;
};

export type IcloudSendPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

export type IcloudSendRequest = {
  workspaceId: string;
  identityId: string;
  credentials: IcloudSmtpCredentials;
  payload: IcloudSendPayload;
};

export type IcloudAppendPayload = {
  folder: string;
  rawMime: string;
};

export type IcloudAppendRequest = {
  workspaceId: string;
  identityId: string;
  credentials: IcloudCredentials;
  payload: IcloudAppendPayload;
};

export interface Env {
  ASSISTANT_KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_SCOPES?: string;
  GOOGLE_REDIRECT_URI?: string;
  DEFAULT_USER_KEY?: string;
  NOTION_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_CHAT_MODEL?: string;
  INTERNAL_API_KEY?: string;
  INTERNAL_API_SECRET?: string;
  ASSISTANT_OS_PROXY_SECRET?: string;
  ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE?: string;
  EMAIL_IO_BASE_URL?: string;
  EMAIL_IO_INTERNAL_KEY?: string;
  EMAIL_IO_INTERNAL_SECRET?: string;
}

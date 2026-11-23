export type UserFriendlyError = {
  message: string;
  code?: string;
};

const UNKNOWN_USER_FRIENDLY_ERROR: UserFriendlyError = Object.freeze({
  message: "Unknown error",
});

export function toUserFriendlyError(error: unknown): UserFriendlyError {
  void error;
  return { ...UNKNOWN_USER_FRIENDLY_ERROR };
}
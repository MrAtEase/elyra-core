export type OAuthFailure = {
  code: string;
  needs_auth: boolean;
  safe_message: string;
};

export function mapGoogleTokenFailure(input: { error?: string | null; description?: string | null }): OAuthFailure {
  const error = (input.error || "").toLowerCase();
  const description = input.description || "";

  if (error === "invalid_grant") {
    return {
      code: "GOOGLE_REAUTH_REQUIRED",
      needs_auth: true,
      safe_message: "Google session expired. Reconnect required.",
    };
  }

  if (error === "invalid_client") {
    return {
      code: "GOOGLE_CLIENT_CONFIG_ERROR",
      needs_auth: false,
      safe_message: "Google integration is temporarily unavailable.",
    };
  }

  return {
    code: "GOOGLE_TOKEN_REFRESH_FAILED",
    needs_auth: false,
    safe_message: description || "Google token refresh failed.",
  };
}

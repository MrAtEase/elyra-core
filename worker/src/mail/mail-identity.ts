export type MailProvider = "google" | "icloud";

export type MailIdentity = {
  id: string;
  email: string;
  provider: MailProvider;
  status: "active" | "pending" | "revoked";
};

type WorkspaceConnectionPreview = {
  id: string;
  domain: string | null;
  provider: string | null;
  status: string | null;
};

const normalizeProviderValue = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  return value.toLowerCase();
};

const resolveMailProviderFromConnection = (providerValue: string | null | undefined): MailProvider | null => {
  const normalized = normalizeProviderValue(providerValue);
  if (normalized.startsWith("google")) {
    return "google";
  }
  if (normalized === "imap_smtp" || normalized === "icloud" || normalized === "apple") {
    return "icloud";
  }
  return null;
};

const resolveIdentityStatus = (connectionStatus: string | null | undefined): MailIdentity["status"] => {
  const normalized = (connectionStatus || "").toString().toLowerCase();
  if (normalized === "revoked") {
    return "revoked";
  }
  if (normalized === "connected") {
    return "active";
  }
  return "pending";
};

export function buildMailIdentities(
  connections: WorkspaceConnectionPreview[],
  configs: Record<string, Record<string, any>>
): MailIdentity[] {
  return connections
    .filter((connection) => (connection.domain || "").toLowerCase() === "mail")
    .map((connection) => {
      const provider = resolveMailProviderFromConnection(connection.provider);
      if (!provider) {
        return null;
      }
      const config = configs[connection.id] ?? {};
      const emailValue = typeof config.email === "string"
        ? config.email.trim()
        : typeof config.primaryEmail === "string"
          ? config.primaryEmail.trim()
          : "";
      return {
        id: connection.id,
        email: emailValue || "",
        provider,
        status: resolveIdentityStatus(connection.status),
      };
    })
    .filter((identity): identity is MailIdentity => Boolean(identity));
}

export function findMailIdentityById(
  identities: MailIdentity[],
  identityId: string | null | undefined
): MailIdentity | null {
  if (!identityId) {
    return null;
  }
  return identities.find((identity) => identity.id === identityId) ?? null;
}

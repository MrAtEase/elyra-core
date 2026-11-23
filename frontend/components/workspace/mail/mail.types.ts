export type MailProvider = "google" | "icloud";

export type MailIdentity = {
  id: string;
  email: string;
  provider: MailProvider;
  status: "active" | "pending" | "revoked";
};

export type MailFolder = {
  id: string;
  name: string;
};

export type MailThreadPreview = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: number;
  unread: boolean;
};

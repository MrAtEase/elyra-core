export type MailProviderKey = "icloud_imap";
export type CalendarProviderKey = "icloud_caldav";

export type ProviderSelection = {
  mailProvider: MailProviderKey;
  calendarProvider: CalendarProviderKey;
};

export function resolveProviders(): ProviderSelection {
  return {
    mailProvider: "icloud_imap",
    calendarProvider: "icloud_caldav",
  };
}

import type { MailIdentity } from "@/components/workspace/mail/mail.types";

type IdentityPickerProps = {
  identities: MailIdentity[];
  value: string | null;
  onChange: (identityId: string) => void;
};

export function IdentityPicker({ identities, value, onChange }: IdentityPickerProps) {
  if (!identities.length) {
    return null;
  }

  return (
    <select
      value={value ?? ""}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue) {
          onChange(nextValue);
        }
      }}
      className="workspace-mail__identity-picker"
    >
      {identities.map((identity) => {
        const label = `${identity.email} · ${identity.provider}`;
        const suffix =
          identity.status !== "active" ? ` (${identity.status.replace("_", " ")})` : "";
        const isSelectable = identity.status !== "revoked";
        return (
          <option key={identity.id} value={identity.id} disabled={!isSelectable}>
            {label}
            {suffix}
          </option>
        );
      })}
    </select>
  );
}

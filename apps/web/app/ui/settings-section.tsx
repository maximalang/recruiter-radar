import type { ReactNode } from "react";

export type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

/**
 * Shared settings layout primitive.
 * Keeps account, access, security and diagnostics surfaces aligned.
 */
export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section aria-labelledby="settings-section-title">
      <h2 id="settings-section-title">{title}</h2>
      {description ? <p>{description}</p> : null}
      <div>{children}</div>
    </section>
  );
}

import { useId, type ReactNode } from "react";

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
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {description ? <p>{description}</p> : null}
      <div>{children}</div>
    </section>
  );
}

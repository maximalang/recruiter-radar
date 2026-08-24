import type { ReactNode } from "react";

export type SettingsSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
};

/**
 * Shared settings layout primitive.
 * Keeps account, access, security and diagnostics surfaces aligned while
 * allowing existing CSS modules to supply route-specific presentation.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
  headerClassName,
  contentClassName,
}: SettingsSectionProps) {
  return (
    <section className={className}>
      <div className={headerClassName}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

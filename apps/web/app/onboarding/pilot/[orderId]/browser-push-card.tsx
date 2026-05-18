type BrowserPushCardProps = {
  configured: boolean;
  publicKey: string | null;
  connectToken: string | null;
  helperLabel: string;
  activeSubscriptionCount: number;
  serverStateLabel: string;
  serverHelperLabel: string;
};

export function BrowserPushCard(props: BrowserPushCardProps) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <strong>{props.configured ? "Браузер подключён" : "Браузер пока не подключён"}</strong>
      <div>{props.serverStateLabel}</div>
      <div>{props.serverHelperLabel || props.helperLabel}</div>
      <div>Активных подписок: {props.activeSubscriptionCount}</div>
      {props.publicKey ? <code>{props.publicKey}</code> : null}
      {props.connectToken ? <code>{props.connectToken}</code> : null}
    </div>
  );
}

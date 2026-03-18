import { sendLeadToTelegramAction, updateLeadStatusAction } from "./actions";
import { ACTIONABLE_LEAD_STATUSES, getLeads, type LeadStatus } from "../lib/db";
import { getTelegramConfigError } from "../lib/telegram";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function getStatusStyles(status: LeadStatus) {
  switch (status) {
    case "won":
      return {
        backgroundColor: "#dcfce7",
        color: "#166534"
      };
    case "replied":
      return {
        backgroundColor: "#dbeafe",
        color: "#1d4ed8"
      };
    case "contacted":
      return {
        backgroundColor: "#e0f2fe",
        color: "#075985"
      };
    case "badfit":
    case "dismissed":
      return {
        backgroundColor: "#fee2e2",
        color: "#991b1b"
      };
    case "snooze":
      return {
        backgroundColor: "#f3e8ff",
        color: "#7e22ce"
      };
    case "saved":
      return {
        backgroundColor: "#fef3c7",
        color: "#92400e"
      };
    case "new":
    default:
      return {
        backgroundColor: "#e5e7eb",
        color: "#374151"
      };
  }
}

function getActionButtonStyle(isActive: boolean) {
  return {
    padding: "6px 10px",
    borderRadius: "999px",
    border: isActive ? "1px solid #111827" : "1px solid #d1d5db",
    backgroundColor: isActive ? "#111827" : "#ffffff",
    color: isActive ? "#ffffff" : "#374151",
    fontSize: "0.85rem",
    lineHeight: 1.2,
    cursor: isActive ? "default" : "pointer",
    opacity: isActive ? 1 : 0.92
  } as const;
}

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const value = searchParams[key];

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return null;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const { rows, error } = await getLeads();
  const telegramConfigError = getTelegramConfigError();
  const telegramNoticeStatus = getSearchParamValue(resolvedSearchParams, "telegramStatus");
  const telegramNoticeMessage = getSearchParamValue(resolvedSearchParams, "telegramMessage");
  const hasTelegramNotice =
    telegramNoticeStatus !== null &&
    telegramNoticeMessage !== null &&
    (telegramNoticeStatus === "success" || telegramNoticeStatus === "error");

  return (
    <main
      style={{
        maxWidth: "1120px",
        margin: "0 auto",
        padding: "40px 20px 64px",
        color: "#111827",
        fontFamily: "ui-sans-serif, system-ui, sans-serif"
      }}
    >
      <header style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>Recruiter Radar</h1>
        <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
          Leads from PostgreSQL with inline status updates
        </p>
      </header>

      {error ? (
        <section
          style={{
            padding: "16px",
            border: "1px solid #fca5a5",
            borderRadius: "12px",
            backgroundColor: "#fef2f2",
            color: "#991b1b"
          }}
        >
          {error}
        </section>
      ) : null}

      {!error && hasTelegramNotice ? (
        <section
          style={{
            marginBottom: "16px",
            padding: "16px",
            border: telegramNoticeStatus === "success" ? "1px solid #86efac" : "1px solid #fca5a5",
            borderRadius: "12px",
            backgroundColor: telegramNoticeStatus === "success" ? "#f0fdf4" : "#fef2f2",
            color: telegramNoticeStatus === "success" ? "#166534" : "#991b1b"
          }}
        >
          {telegramNoticeMessage}
        </section>
      ) : null}

      {!error && telegramConfigError ? (
        <section
          style={{
            marginBottom: "16px",
            padding: "16px",
            border: "1px solid #fca5a5",
            borderRadius: "12px",
            backgroundColor: "#fff7ed",
            color: "#9a3412"
          }}
        >
          {telegramConfigError}
        </section>
      ) : null}

      {!error && rows.length === 0 ? (
        <section
          style={{
            padding: "24px",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            backgroundColor: "#f9fafb",
            color: "#6b7280"
          }}
        >
          No leads found yet.
        </section>
      ) : !error ? (
        <section
          style={{
            overflowX: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            backgroundColor: "#ffffff",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)"
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "980px"
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#f9fafb", textAlign: "left" }}>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Company
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Status
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Score
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Last signal
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  User
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Change status
                </th>
                <th style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
                  Telegram
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {lead.orgName}
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        textTransform: "lowercase",
                        ...getStatusStyles(lead.status)
                      }}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {lead.score ?? "-"}
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {formatDate(lead.lastSignalAt)}
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {lead.userName}
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    <form
                      action={updateLeadStatusAction}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px"
                      }}
                    >
                      <input type="hidden" name="leadId" value={lead.id} />
                      {ACTIONABLE_LEAD_STATUSES.map((status) => {
                        const isActive = lead.status === status;

                        return (
                          <button
                            key={status}
                            type="submit"
                            name="status"
                            value={status}
                            disabled={isActive}
                            style={getActionButtonStyle(isActive)}
                          >
                            {status}
                          </button>
                        );
                      })}
                    </form>
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    <form action={sendLeadToTelegramAction}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      <button
                        type="submit"
                        disabled={Boolean(telegramConfigError)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "10px",
                          border: telegramConfigError ? "1px solid #d1d5db" : "1px solid #0f172a",
                          backgroundColor: telegramConfigError ? "#f3f4f6" : "#0f172a",
                          color: telegramConfigError ? "#9ca3af" : "#ffffff",
                          fontSize: "0.9rem",
                          lineHeight: 1.2,
                          cursor: telegramConfigError ? "not-allowed" : "pointer"
                        }}
                      >
                        Send to Telegram
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}

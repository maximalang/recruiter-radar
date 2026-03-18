import { getLeads } from "../lib/db";

export const dynamic = "force-dynamic";

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

export default async function HomePage() {
  const { rows, error } = await getLeads();

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
          Leads from PostgreSQL
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
              minWidth: "760px"
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
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {lead.orgName}
                  </td>
                  <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                    {lead.status}
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
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}

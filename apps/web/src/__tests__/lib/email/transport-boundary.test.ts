jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EmailMessage } from "@/lib/email/transport";

/**
 * Message-boundary regression suite for the SMTP/Postbox adapter.
 *
 * Every case here is a form that the address parser advisories can be abused
 * with (quadratic parsing, depth-limit bypass, comment mis-parsing, IDN
 * allow-list bypass) or that would widen the transport surface (file/URL
 * content, attachments, header injection). The adapter must refuse them before
 * a provider is contacted, and must never echo the refused content.
 */
const smtpEnv = {
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_REPLY_TO: process.env.SMTP_REPLY_TO,
  SMTP_TLS_SERVERNAME: process.env.SMTP_TLS_SERVERNAME,
  AUTH_EMAIL_TRANSPORT: process.env.AUTH_EMAIL_TRANSPORT,
  AUTH_EMAIL_TEST_OUTBOX_PATH: process.env.AUTH_EMAIL_TEST_OUTBOX_PATH,
};

type TransportModule = typeof import("@/lib/email/transport");
type CreateTransport = typeof import("nodemailer").default.createTransport;

type Loaded = {
  transport: TransportModule;
  createTransport: jest.MockedFunction<CreateTransport>;
  sendMail: jest.Mock;
};

/** Fresh module registry per case so the cached transporter never leaks. */
async function loadTransport(): Promise<Loaded> {
  jest.resetModules();
  const [transport, nodemailer] = await Promise.all([
    import("@/lib/email/transport"),
    import("nodemailer"),
  ]);
  const sendMail = jest.fn().mockResolvedValue({ messageId: "test" });
  const createTransport = jest.mocked(nodemailer.default.createTransport);
  createTransport.mockReturnValue({ sendMail } as never);
  return { transport, createTransport, sendMail };
}

function baseMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: "recipient@example.test",
    subject: "Sign-in link",
    html: "<p>link</p>",
    text: "link",
    ...overrides,
  };
}

describe("email transport message boundary", () => {
  let info: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.AUTH_EMAIL_TRANSPORT;
    delete process.env.AUTH_EMAIL_TEST_OUTBOX_PATH;
    delete process.env.SMTP_REPLY_TO;
    delete process.env.SMTP_TLS_SERVERNAME;
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "mailer";
    process.env.SMTP_PASS = "test-only-password";
    process.env.SMTP_FROM = "no-reply@example.test";
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    for (const [name, value] of Object.entries(smtpEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("closes file/URL access and pins the TLS identity explicitly", async () => {
    const { transport, createTransport } = await loadTransport();

    await expect(transport.sendEmail(baseMessage())).resolves.toEqual({ ok: true });

    expect(createTransport).toHaveBeenCalledTimes(1);
    const options = createTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(options).toEqual(expect.objectContaining({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: { servername: "smtp.example.test" },
      connectionTimeout: expect.any(Number),
      greetingTimeout: expect.any(Number),
      socketTimeout: expect.any(Number),
    }));
  });

  test("honours an explicit SMTP_TLS_SERVERNAME and rejects unusable values", async () => {
    process.env.SMTP_TLS_SERVERNAME = "mail.pinned.test";
    const pinned = await loadTransport();
    await pinned.transport.sendEmail(baseMessage());
    expect(
      (pinned.createTransport.mock.calls[0]![0] as Record<string, unknown>).tls,
    ).toEqual({ servername: "mail.pinned.test" });

    process.env.SMTP_TLS_SERVERNAME = "has space.test";
    const malformed = await loadTransport();
    await malformed.transport.sendEmail(baseMessage());
    expect(
      (malformed.createTransport.mock.calls[0]![0] as Record<string, unknown>).tls,
    ).toBeUndefined();

    process.env.SMTP_TLS_SERVERNAME = "127.0.0.1";
    const ipLiteral = await loadTransport();
    await ipLiteral.transport.sendEmail(baseMessage());
    expect(
      (ipLiteral.createTransport.mock.calls[0]![0] as Record<string, unknown>).tls,
    ).toBeUndefined();
  });

  test("sends only allowlisted fields and never spreads extra message keys", async () => {
    const { transport, sendMail } = await loadTransport();
    const widened = {
      ...baseMessage(),
      attachments: [{ path: "/etc/passwd" }],
      raw: "From: attacker@example.test\r\nBcc: victim@example.test",
    } as unknown as EmailMessage;

    await expect(transport.sendEmail(widened)).resolves.toEqual({ ok: true });

    expect(sendMail).toHaveBeenCalledWith({
      from: "no-reply@example.test",
      replyTo: undefined,
      to: "recipient@example.test",
      subject: "Sign-in link",
      html: "<p>link</p>",
      text: "link",
    });
  });

  test("keeps several plain recipients and canonicalises their spelling", async () => {
    const { transport, sendMail } = await loadTransport();

    await expect(transport.sendEmail(baseMessage({
      to: " first@example.test ,second@example.test ",
    }))).resolves.toEqual({ ok: true });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "first@example.test,second@example.test",
    }));
  });

  test.each([
    ["display name", "Alice <alice@example.test>"],
    ["RFC 5322 comment", "alice@example.test (work)"],
    ["quoted local part", "\"alice smith\"@example.test"],
    ["group syntax", "Friends:alice@example.test;"],
    ["structured array", ["alice@example.test"]],
    ["header injection", "alice@example.test\r\nBcc: victim@example.test"],
    ["dotless domain", "alice@localhost"],
    ["double dot in domain", "alice@example..test"],
    ["leading dot in local part", ".alice@example.test"],
    ["missing local part", "@example.test"],
    ["empty recipient", "   "],
    ["trailing separator", "alice@example.test,"],
    ["control character", "alice@exa\u0000mple.test"],
  ])("refuses %s before contacting a provider", async (_label, to) => {
    const { transport, createTransport, sendMail } = await loadTransport();

    const result = await transport.sendEmail(
      baseMessage({ to: to as unknown as string }),
    );

    expect(result).toEqual({ ok: false, reason: "invalid_recipient" });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("email.message_rejected");
    expect(logged).not.toContain("alice@example.test");
  });

  test("refuses a recipient list above the fan-out ceiling", async () => {
    const { transport, sendMail } = await loadTransport();
    const tooMany = Array.from({ length: 21 }, (_, i) => `user${i}@example.test`);

    await expect(transport.sendEmail(baseMessage({ to: tooMany.join(",") })))
      .resolves.toEqual({ ok: false, reason: "invalid_recipient" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("refuses oversized or injected message headers and bodies", async () => {
    const cases: Partial<EmailMessage>[] = [
      { subject: "ok\r\nBcc: victim@example.test" },
      { subject: "x".repeat(301) },
      { html: "x".repeat(512 * 1024 + 1) },
      { text: ["x".repeat(512 * 1024 + 1)] as unknown as string },
    ];

    for (const overrides of cases) {
      const { transport, createTransport, sendMail } = await loadTransport();
      await expect(transport.sendEmail(baseMessage(overrides)))
        .resolves.toEqual({ ok: false, reason: "invalid_message" });
      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    }
  });

  test("passes canonical recipients to the Postbox destination", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.POSTBOX_ACCESS_KEY_ID = "access-key";
    process.env.POSTBOX_SECRET_ACCESS_KEY = "secret-key";
    process.env.POSTBOX_FROM = "support@example.test";
    process.env.POSTBOX_ENDPOINT = "https://postbox.example.test";
    try {
      const { transport } = await loadTransport();
      await expect(transport.sendEmail(baseMessage({
        to: "one@example.test, two@example.test",
      }))).resolves.toEqual({ ok: true });

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
        Destination: { ToAddresses: string[] };
      };
      expect(body.Destination.ToAddresses).toEqual([
        "one@example.test",
        "two@example.test",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.POSTBOX_ACCESS_KEY_ID;
      delete process.env.POSTBOX_SECRET_ACCESS_KEY;
      delete process.env.POSTBOX_FROM;
      delete process.env.POSTBOX_ENDPOINT;
    }
  });

  test("records the canonical recipient in the deterministic test outbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-transport-boundary-"));
    const outboxPath = join(directory, "outbox.json");
    process.env.AUTH_EMAIL_TRANSPORT = "test";
    process.env.AUTH_EMAIL_TEST_OUTBOX_PATH = outboxPath;
    try {
      const { transport } = await loadTransport();
      await expect(transport.sendEmail(baseMessage({
        to: " first@example.test , second@example.test ",
      }))).resolves.toEqual({ ok: true });

      const entries = JSON.parse(await readFile(outboxPath, "utf8")) as Array<{
        to: string;
      }>;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.to).toBe("first@example.test,second@example.test");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

import nodemailer from "nodemailer";

import { sendEmail } from "@/lib/email/transport";

const mockCreateTransport = jest.mocked(nodemailer.createTransport);
const mockSendMail = jest.fn();

const smtpEnv = {
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_REPLY_TO: process.env.SMTP_REPLY_TO,
  AUTH_EMAIL_TRANSPORT: process.env.AUTH_EMAIL_TRANSPORT,
  AUTH_EMAIL_TEST_OUTBOX_PATH: process.env.AUTH_EMAIL_TEST_OUTBOX_PATH,
};

describe("email transport privacy boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUTH_EMAIL_TRANSPORT;
    delete process.env.AUTH_EMAIL_TEST_OUTBOX_PATH;
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "mailer";
    process.env.SMTP_PASS = "test-only-password";
    process.env.SMTP_FROM = "no-reply@example.test";
    delete process.env.SMTP_REPLY_TO;
    mockCreateTransport.mockReturnValue({
      sendMail: mockSendMail,
    } as never);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(smtpEnv)) {
      restoreEnv(name, value);
    }
  });

  test("does not expose provider error text, recipient, or message content", async () => {
    const providerError = Object.assign(
      new Error(
        "550 rejected alice.private@example.com for token magic-secret-value",
      ),
      {
        code: "EENVELOPE",
        command: "RCPT TO",
        responseCode: 550,
        response:
          "550 alice.private@example.com magic-secret-value was rejected",
      },
    );
    mockSendMail.mockRejectedValueOnce(providerError);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await sendEmail({
      to: "alice.private@example.com",
      subject: "Your magic-secret-value sign-in link",
      html: "<a href='https://example.test/magic-secret-value'>Sign in</a>",
      text: "https://example.test/magic-secret-value",
    });

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      JSON.stringify({
        level: "error",
        event: "email.send_failed",
        message: "smtp_send_failed",
        failureCategory: "envelope",
        smtpCommand: "recipient",
        responseCode: 550,
      }),
    );

    const observableOutput = JSON.stringify({
      result,
      logs: consoleError.mock.calls,
    });
    expect(observableOutput).not.toContain("alice.private@example.com");
    expect(observableOutput).not.toContain("magic-secret-value");
    expect(observableOutput).not.toContain(providerError.message);
    consoleError.mockRestore();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

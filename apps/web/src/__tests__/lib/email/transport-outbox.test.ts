import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isEmailConfigured,
  readTestEmailOutbox,
  resolveTestEmailOutboxPath,
  sendEmail,
} from "@/lib/email/transport";

const originalTransport = process.env.AUTH_EMAIL_TRANSPORT;
const originalOutboxPath = process.env.AUTH_EMAIL_TEST_OUTBOX_PATH;
const originalNodeEnv = process.env.NODE_ENV;

describe("deterministic auth email test outbox", () => {
  let directory = "";
  let outboxPath = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "rr-auth-outbox-"));
    outboxPath = join(directory, "outbox.json");
    process.env.AUTH_EMAIL_TRANSPORT = "test";
    process.env.AUTH_EMAIL_TEST_OUTBOX_PATH = outboxPath;
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "test",
      writable: true,
    });
  });

  afterEach(async () => {
    restoreEnv("AUTH_EMAIL_TRANSPORT", originalTransport);
    restoreEnv("AUTH_EMAIL_TEST_OUTBOX_PATH", originalOutboxPath);
    restoreEnv("NODE_ENV", originalNodeEnv);
    await rm(directory, { recursive: true, force: true });
  });

  test("records messages in stable sequence without SMTP", async () => {
    expect(isEmailConfigured()).toBe(true);

    await expect(sendEmail({
      to: "first@example.com",
      subject: "First",
      html: "<p>First</p>",
      text: "First",
    })).resolves.toEqual({ ok: true });
    await expect(sendEmail({
      to: "second@example.com",
      subject: "Second",
      html: "<p>Second</p>",
      text: "Second",
    })).resolves.toEqual({ ok: true });

    await expect(readTestEmailOutbox(outboxPath)).resolves.toEqual([
      {
        sequence: 1,
        to: "first@example.com",
        subject: "First",
        html: "<p>First</p>",
        text: "First",
      },
      {
        sequence: 2,
        to: "second@example.com",
        subject: "Second",
        html: "<p>Second</p>",
        text: "Second",
      },
    ]);
  });

  test("fails closed when test transport is requested in production", async () => {
    expect(resolveTestEmailOutboxPath({
      AUTH_EMAIL_TRANSPORT: "test",
      AUTH_EMAIL_TEST_OUTBOX_PATH: outboxPath,
      NODE_ENV: "production",
    })).toBeNull();
    await expect(readFile(outboxPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

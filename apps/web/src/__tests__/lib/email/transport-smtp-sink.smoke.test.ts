/**
 * DISPOSABLE smoke evidence for the mailer transport boundary.
 *
 * No external email, no provider account, no customer data:
 *   1. the hardened adapter renders and delivers a real message over SMTP to a
 *      loopback sink (envelope + DATA observed on the wire) using the canonical
 *      recipient list;
 *   2. the transport options this repo configures make nodemailer refuse
 *      file-path and URL attachment content (EFILEACCESS / EURLACCESS), with a
 *      control transport proving the flags are the operative control.
 *
 * Run: npx jest src/__tests__/lib/email/transport-smtp-sink.smoke.test.ts --runInBand
 */
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import nodemailer from "nodemailer";

import { sendEmail } from "@/lib/email/transport";

type Received = {
  envelope: { mailFrom: string[]; rcptTo: string[] };
  data: string;
};

function startSink(): Promise<{ port: number; server: Server; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    let current: Received | null = null;
    socket.setEncoding("utf8");
    socket.write("220 sink.localhost ESMTP disposable-sink\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 Ok: queued as SINK1\r\n");
          } else {
            data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
        } else if (/^EHLO/i.test(line)) {
          // Deliberately no AUTH advertisement: the sink accepts mail without it.
          socket.write("250-sink.localhost\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n");
        } else if (/^HELO/i.test(line)) {
          socket.write("250 sink.localhost\r\n");
        } else if (/^MAIL FROM/i.test(line)) {
          current = { envelope: { mailFrom: [line], rcptTo: [] }, data: "" };
          socket.write("250 2.1.0 Ok\r\n");
        } else if (/^RCPT TO/i.test(line)) {
          current?.envelope.rcptTo.push(line);
          socket.write("250 2.1.5 Ok\r\n");
        } else if (/^DATA/i.test(line)) {
          inData = true;
          data = "";
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (/^RSET/i.test(line)) {
          socket.write("250 2.0.0 Ok\r\n");
        } else if (/^QUIT/i.test(line)) {
          if (current) received.push({ ...current, data });
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 2.0.0 Ok\r\n");
        }
        index = buffer.indexOf("\r\n");
      }
    });
    socket.on("close", () => {
      if (current && !received.includes(current)) received.push({ ...current, data });
    });
    socket.on("error", () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as { port: number }).port, server, received });
    });
  });
}

async function waitFor(predicate: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("sink did not receive the message in time");
}

describe("disposable mailer smoke", () => {
  let sink: { port: number; server: Server; received: Received[] };
  let directory = "";
  const envBackup = { ...process.env };

  beforeAll(async () => {
    sink = await startSink();
    directory = await mkdtemp(join(tmpdir(), "rr-smtp-sink-"));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => sink.server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.AUTH_EMAIL_TRANSPORT;
    delete process.env.AUTH_EMAIL_TEST_OUTBOX_PATH;
    delete process.env.POSTBOX_ACCESS_KEY_ID;
    delete process.env.POSTBOX_SECRET_ACCESS_KEY;
    delete process.env.SMTP_TLS_SERVERNAME;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(sink.port);
    process.env.SMTP_FROM = "no-reply@example.test";
    process.env.SMTP_USER = "smoke-user";
    process.env.SMTP_PASS = "smoke-password-value";
    sink.received.length = 0;
  });

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in envBackup)) delete process.env[name];
      else process.env[name] = envBackup[name];
    }
  });

  test("delivers the rendered message to a loopback SMTP sink", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const log = await sendEmail({
      to: " first@example.test ,second@example.test ",
      subject: "Sink smoke",
      html: "<p>rendered-html-marker</p>",
      text: "rendered-text-marker",
    });
    info.mockRestore();

    expect(log).toEqual({ ok: true });
    await waitFor(() => sink.received.length > 0);

    const message = sink.received[0]!;
    expect(message.envelope.mailFrom[0]).toContain("no-reply@example.test");
    // The canonical recipient list, not the caller's raw string, is the envelope.
    expect(message.envelope.rcptTo).toEqual([
      "RCPT TO:<first@example.test>",
      "RCPT TO:<second@example.test>",
    ]);
    expect(message.data).toContain("Subject: Sink smoke");
    expect(message.data).toContain("rendered-text-marker");
    expect(message.data).toMatch(/rendered-html-marker/);
    // The configured SMTP password never travels inside the message body.
    expect(message.data).not.toContain("smoke-password-value");
  }, 30000);

  test("configured transport options refuse file and URL attachment content", async () => {
    const attachmentPath = join(directory, "attachment.txt");
    await writeFile(attachmentPath, "attachment-content-marker\n", "utf8");

    // `streamTransport` runs the same message/attachment pipeline without a
    // network peer, so the access-control error is deterministic instead of
    // racing the SMTP conversation (which can surface ESTREAM first).
    const shared = { streamTransport: true, buffer: true } as const;
    const hardened = nodemailer.createTransport({
      ...shared,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const control = nodemailer.createTransport({ ...shared });
    const mail = {
      from: "no-reply@example.test",
      to: "sink-recipient@example.test",
      subject: "Attachment policy",
      text: "body",
    };

    await expect(hardened.sendMail({
      ...mail,
      attachments: [{ path: attachmentPath }],
    })).rejects.toMatchObject({ code: "EFILEACCESS" });

    await expect(hardened.sendMail({
      ...mail,
      attachments: [{ href: "https://example.test/remote.txt" }],
    })).rejects.toMatchObject({ code: "EURLACCESS" });

    // Control: identical content is readable once the flags are absent, so the
    // flags are what closed the surface.
    const controlInfo = await control.sendMail({
      ...mail,
      attachments: [{ path: attachmentPath }],
    });
    const rendered = String((controlInfo as { message?: unknown }).message ?? "");
    // nodemailer transmits attachment bodies base64-encoded by default, so
    // assert on the encoded file content (which includes its trailing newline).
    const encoded = (await readFile(attachmentPath)).toString("base64");
    expect(rendered).toContain(encoded);
  }, 30000);

  test("the hardened adapter drops extra message keys instead of resolving them", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const log = await sendEmail({
      to: "sink-recipient@example.test",
      subject: "Extra keys",
      html: "<p>body</p>",
      text: "body",
      attachments: [{ path: join(directory, "attachment.txt") }],
    } as never);
    info.mockRestore();

    // Extra keys are dropped by the allowlisted payload, so the send succeeds
    // and no attachment is ever resolved.
    expect(log).toEqual({ ok: true });
    await waitFor(() => sink.received.length > 0);
    expect(sink.received[0]!.data).not.toContain("attachment-content-marker");
  }, 30000);
});
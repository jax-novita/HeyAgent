/**
 * Gmail via IMAP + App Password — no OAuth redirect hell.
 * https://myaccount.google.com/apppasswords
 */
import { ImapFlow } from "imapflow";
import { connect as connectTls, type TLSSocket } from "node:tls";

export interface GmailImapCredentials {
  mode: "imap";
  email: string;
  appPassword: string;
}

function normalizeAppPassword(value: string): string {
  return value.replace(/\s+/g, "");
}

export async function gmailImapSummary(
  creds: GmailImapCredentials,
  limit = 10,
  unreadOnly = false,
): Promise<string> {
  const pageSize = Math.max(1, Math.min(Number(limit) || 10, 25));
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: creds.email,
      pass: normalizeAppPassword(creds.appPassword),
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox && typeof client.mailbox === "object"
        ? Number(client.mailbox.exists ?? 0)
        : 0;
      if (!total) {
        return unreadOnly ? "Новых непрочитанных писем нет." : "Во входящих писем не найдено.";
      }

      const uids = unreadOnly
        ? await client.search({ seen: false }, { uid: true })
        : await client.search({ all: true }, { uid: true });

      const list = (Array.isArray(uids) ? uids : []).map(Number).filter(Boolean);
      if (!list.length) {
        return unreadOnly ? "Новых непрочитанных писем нет." : "Во входящих писем не найдено.";
      }

      const selected = list.slice(-pageSize).reverse();
      const lines: string[] = [
        unreadOnly
          ? `Непрочитанные письма (${selected.length}):`
          : `Последние входящие письма (${selected.length}):`,
      ];

      let index = 0;
      for await (const msg of client.fetch(
        selected,
        { envelope: true, source: false, uid: true, flags: true },
        { uid: true },
      )) {
        index += 1;
        const env = msg.envelope;
        const from =
          env?.from?.map((a) => a.name || a.address || "").filter(Boolean).join(", ") ||
          "(неизвестный отправитель)";
        const subject = env?.subject || "(без темы)";
        const date = env?.date ? formatDate(env.date) : "";
        const unread = !(msg.flags && msg.flags.has("\\Seen"));
        lines.push("");
        lines.push(`${index}. ${unread ? "● " : ""}${from}`);
        lines.push(`   Тема: ${subject}`);
        if (date) lines.push(`   Когда: ${date}`);
      }

      if (index === 0) {
        return unreadOnly ? "Новых непрочитанных писем нет." : "Во входящих писем не найдено.";
      }
      return lines.join("\n");
    } finally {
      lock.release();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid credentials|AUTHENTICATIONFAILED|Application-specific password/i.test(msg)) {
      return [
        "ERROR: Gmail отклонил пароль.",
        "Нужен пароль приложения (не обычный пароль Google):",
        "  https://myaccount.google.com/apppasswords",
        "Потом: npx hey connect gmail",
      ].join("\n");
    }
    return `ERROR: IMAP Gmail: ${msg}`;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function testGmailImap(creds: GmailImapCredentials): Promise<string> {
  return gmailImapSummary(creds, 3, false);
}

export async function gmailImapCreateDraft(
  creds: GmailImapCredentials,
  to: string,
  subject: string,
  body: string,
): Promise<string> {
  const client = createImapClient(creds);
  try {
    await client.connect();
    const mailboxes = await client.list();
    const drafts = mailboxes.find((mailbox) => mailbox.specialUse === "\\Drafts");
    if (!drafts) return "ERROR: Gmail Drafts mailbox was not found.";
    const raw = buildRawMessage(creds.email, to, subject, body);
    await client.append(drafts.path, raw, ["\\Draft"], new Date());
    return `Draft created for ${to}: ${subject}`;
  } catch (error) {
    return `ERROR: Gmail draft: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function gmailSmtpSend(
  creds: GmailImapCredentials,
  to: string,
  subject: string,
  body: string,
): Promise<string> {
  let socket: TLSSocket | undefined;
  try {
    socket = connectTls({
      host: "smtp.gmail.com",
      port: 465,
      servername: "smtp.gmail.com",
      timeout: 30_000,
    });
    const smtp = createSmtpConversation(socket);
    await waitForSecureConnection(socket);
    await smtp.expect(220);
    await smtp.command("EHLO heyagent.local", 250);
    await smtp.command("AUTH LOGIN", 334);
    await smtp.command(Buffer.from(creds.email).toString("base64"), 334);
    await smtp.command(Buffer.from(normalizeAppPassword(creds.appPassword)).toString("base64"), 235);
    await smtp.command(`MAIL FROM:<${creds.email}>`, 250);
    await smtp.command(`RCPT TO:<${to}>`, [250, 251]);
    await smtp.command("DATA", 354);
    const raw = buildRawMessage(creds.email, to, subject, body)
      .replace(/^\./gm, "..");
    socket.write(`${raw}\r\n.\r\n`);
    await smtp.expect(250);
    await smtp.command("QUIT", 221);
    return `Email sent to ${to}: ${subject}`;
  } catch (error) {
    return `ERROR: Gmail SMTP: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    socket?.destroy();
  }
}

function createImapClient(creds: GmailImapCredentials): ImapFlow {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: creds.email,
      pass: normalizeAppPassword(creds.appPassword),
    },
    logger: false,
  });
}

function buildRawMessage(from: string, to: string, subject: string, body: string): string {
  const encodedSubject = /[^\x20-\x7e]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
    : subject;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

function waitForSecureConnection(socket: TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.authorized) {
      resolve();
      return;
    }
    socket.once("secureConnect", () => resolve());
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("SMTP connection timed out")));
  });
}

function createSmtpConversation(socket: TLSSocket): {
  expect: (codes: number | number[]) => Promise<string>;
  command: (command: string, codes: number | number[]) => Promise<string>;
} {
  let buffer = "";
  const waiters: Array<{
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    codes: number[];
  }> = [];
  const drain = () => {
    while (waiters.length > 0) {
      const match = buffer.match(/(?:^|\r\n)(\d{3}) ([^\r\n]*)(?:\r\n|$)/);
      if (!match) break;
      const end = (match.index ?? 0) + match[0].length;
      const response = buffer.slice(0, end).trim();
      buffer = buffer.slice(end);
      const waiter = waiters.shift()!;
      const code = Number(match[1]);
      if (waiter.codes.includes(code)) waiter.resolve(response);
      else waiter.reject(new Error(`SMTP ${response}`));
    }
  };
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drain();
  });
  const expect = (codes: number | number[]) =>
    new Promise<string>((resolve, reject) => {
      waiters.push({ resolve, reject, codes: Array.isArray(codes) ? codes : [codes] });
      drain();
    });
  return {
    expect,
    command: (command, codes) => {
      socket.write(`${command}\r\n`);
      return expect(codes);
    },
  };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

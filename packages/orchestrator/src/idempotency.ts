/**
 * Idempotency guards: don't spam the same Telegram message, don't re-search
 * when the chat is already open, etc.
 */
export class IdempotencyGuard {
  private lastSend = new Map<string, { text: string; at: number }>();
  private openChats = new Map<string, number>();

  /** Returns false if the same message was sent to contact within windowMs. */
  canSend(contact: string, text: string, windowMs = 15_000): boolean {
    const key = contact.trim().toLowerCase();
    const prev = this.lastSend.get(key);
    const now = Date.now();
    if (
      prev &&
      now - prev.at < windowMs &&
      prev.text.trim().toLowerCase() === text.trim().toLowerCase()
    ) {
      return false;
    }
    return true;
  }

  recordSend(contact: string, text: string): void {
    this.lastSend.set(contact.trim().toLowerCase(), {
      text,
      at: Date.now(),
    });
  }

  markChatOpen(contact: string): void {
    this.openChats.set(contact.trim().toLowerCase(), Date.now());
  }

  isChatOpen(contact: string, freshMs = 30 * 60_000): boolean {
    const at = this.openChats.get(contact.trim().toLowerCase());
    return Boolean(at && Date.now() - at < freshMs);
  }

  clearChat(contact?: string): void {
    if (!contact) {
      this.openChats.clear();
      return;
    }
    this.openChats.delete(contact.trim().toLowerCase());
  }
}

export const globalIdempotency = new IdempotencyGuard();

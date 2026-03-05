const TTL_MS = 5 * 60 * 1000; // 5 minutes

// MVP in-memory dedupe. This resets on server restart / new lambda instance.
const processedMessageIds = new Map<string, number>();

function cleanup(now: number) {
  processedMessageIds.forEach((ts, id) => {
    if (now - ts > TTL_MS) processedMessageIds.delete(id);
  });
}

/**
 * Returns true if we should process this messageId now.
 * If messageId is missing/empty, we allow processing (can't dedupe).
 */
export function shouldProcessMessage(messageId: unknown): boolean {
  if (typeof messageId !== "string") return true;
  const id = messageId.trim();
  if (!id) return true;

  const now = Date.now();
  cleanup(now);

  const last = processedMessageIds.get(id);
  if (typeof last === "number" && now - last <= TTL_MS) return false;

  processedMessageIds.set(id, now);
  return true;
}


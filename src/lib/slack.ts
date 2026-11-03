/**
 * Minimal Slack notifier — posts run summaries / errors to #forecast-ops via a
 * bot token (chat:write). Best-effort: logs and returns false on failure, never
 * throws. Configured via SLACK_BOT_TOKEN + SLACK_FORECAST_OPS_CHANNEL.
 *
 * Notice convention: routine run summaries go through `postForecastOpsNotice`,
 * which renders them as a Slack `context` block — the small grey text Notion's
 * own automation notifications use — prefixed with NOTICE_EMOJI in the icon slot:
 *
 *   :notion: *Forecast rebuilt* — 312 monthly rows from 48 segments …
 *
 * Failures (`postForecastOps` with :x:) stay full-size so they stand out.
 */

/** Emoji in the icon slot of every routine notice. */
export const NOTICE_EMOJI = ":notion:";

/** #forecast-ops channel (id or name). */
export const FORECAST_OPS_CHANNEL = process.env.SLACK_FORECAST_OPS_CHANNEL || "#forecast-ops";

/**
 * Post a message to a Slack channel (by id or name) via chat.postMessage. With
 * `notice`, the text is also sent as a context block (small grey text); the
 * plain text then serves as the notification fallback.
 */
export async function postToChannel(channel: string, text: string, opts: { notice?: boolean } = {}): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(`[forecast] SLACK_BOT_TOKEN not set — skipping Slack message to ${channel}: ${text}`);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, text, unfurl_links: false, ...(opts.notice ? { blocks: [contextBlock(text)] } : {}) }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!body.ok) {
        console.error(`[forecast] chat.postMessage to ${channel} failed: ${body.error ?? res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error(`[forecast] failed to post Slack message to ${channel}:`, err);
    return false;
  }
}

/** Post to #forecast-ops. */
export async function postForecastOps(text: string): Promise<void> {
  await postToChannel(FORECAST_OPS_CHANNEL, text);
}

/** Slack caps a context block's mrkdwn element at 2000 characters. */
const CONTEXT_TEXT_LIMIT = 2000;

/** A single-element `context` block (small grey text) carrying mrkdwn `text`. */
function contextBlock(text: string): { type: "context"; elements: { type: "mrkdwn"; text: string }[] } {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

/**
 * Post a routine notice as a context block (see the notice convention above).
 * `text` doubles as the notification fallback. A message too long for a context
 * element is posted full-size instead of being rejected as invalid_blocks.
 */
export async function postNotice(channel: string, text: string): Promise<boolean> {
  return postToChannel(channel, text, { notice: text.length <= CONTEXT_TEXT_LIMIT });
}

/** Post a routine notice to #forecast-ops as a context block. */
export async function postForecastOpsNotice(text: string): Promise<void> {
  await postNotice(FORECAST_OPS_CHANNEL, text);
}

/**
 * Reading a Telegram channel post into a searchable row — pure parts.
 *
 * Two ways a post arrives: the bot, an admin of the channel, receives every channel_post and
 * edited_channel_post; and an older post comes in when the owner forwards it to the bot
 * (Telegram gives bots no channel history). Either way the same three things are kept: the
 * text, where its buy button leads, and the post's own address.
 */

export interface ChannelRef {
  chatId: string;
  username: string | null;
  messageId: number;
  /** Seconds since the epoch, as Telegram sends it. */
  date: number;
}

/** The text a reader sees: a text post's text, or a photo / album post's caption. */
export function messageText(msg: any): string {
  return String(msg?.text ?? msg?.caption ?? '');
}

/**
 * Every link in the post, in order. The channel posts hide the affiliate link behind
 * «🛒 לרכישה» (a text_link entity, invisible in the text), so entities come first; links
 * written out in the text are found by their url entities, or by pattern when Telegram sent none.
 */
export function messageLinks(msg: any): string[] {
  const text = messageText(msg);
  const entities: any[] = msg?.entities || msg?.caption_entities || [];
  const out: string[] = [];
  for (const e of entities) {
    if (e?.type === 'text_link' && e.url) out.push(String(e.url));
    else if (e?.type === 'url') out.push(text.slice(e.offset, e.offset + e.length));
  }
  if (!out.length) out.push(...(text.match(/https?:\/\/[^\s<>"'«»]+/g) || []));
  return out.map((u) => u.replace(/[).,!?:;]+$/, '')).filter((u) => /^https?:\/\//i.test(u));
}

/** Where the reader buys: the first link that does not stay inside Telegram (bot invite, channel mention). */
export function buyLink(links: string[]): string | null {
  return links.find((u) => !/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(u)) || null;
}

/** A channel_post's own address. */
export function channelPostRef(msg: any): ChannelRef | null {
  if (msg?.chat?.type !== 'channel' || !msg.message_id) return null;
  return { chatId: String(msg.chat.id), username: msg.chat.username || null, messageId: Number(msg.message_id), date: Number(msg.date) || 0 };
}

/** Where a message the owner forwarded came from — only a channel post counts. */
export function forwardedChannelRef(msg: any): ChannelRef | null {
  const o = msg?.forward_origin;
  if (o?.type === 'channel' && o.chat && o.message_id) {
    return { chatId: String(o.chat.id), username: o.chat.username || null, messageId: Number(o.message_id), date: Number(o.date) || 0 };
  }
  const c = msg?.forward_from_chat; // before Bot API 7.0
  if (c?.type === 'channel' && msg.forward_from_message_id) {
    return { chatId: String(c.id), username: c.username || null, messageId: Number(msg.forward_from_message_id), date: Number(msg.forward_date) || 0 };
  }
  return null;
}

/** Is this one of the owner's channels? Saved channels are stored as "-100…" or "@name". */
export function isOwnChannel(ref: Pick<ChannelRef, 'chatId' | 'username'>, savedChannelIds: string[]): boolean {
  const ids = new Set(savedChannelIds.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean));
  if (ids.has(ref.chatId.toLowerCase())) return true;
  return !!ref.username && (ids.has(`@${ref.username.toLowerCase()}`) || ids.has(ref.username.toLowerCase()));
}

/** The post's address on t.me — public by @username, otherwise the members-only /c/ form. */
export function channelPostUrl(username: string | null, chatId: string, messageId: number): string | null {
  if (username) return `https://t.me/${username}/${messageId}`;
  const m = String(chatId).match(/^-100(\d+)$/);
  return m ? `https://t.me/c/${m[1]}/${messageId}` : null;
}

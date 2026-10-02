import type { ContextItem, Message, ProviderDescriptor } from '@jam/protocol';

/** A file size as people read it: 512 B, 18 KB, 1.4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
};

/** What a sent attachment was, beside its name: an image's type, a file's size. */
export function attachmentDetail(item: ContextItem): string {
  const info = item.attachment;
  if (!info) return '';
  return info.kind === 'image' ? (IMAGE_TYPES[info.mediaType] ?? 'Image') : formatBytes(info.bytes);
}

/** Context that reaches the agent as an image: a snapshot or an attached image. */
export const sendsImage = (item: ContextItem) =>
  item.kind === 'snapshot' || item.attachment?.kind === 'image';

/**
 * Why the staged images cannot be sent with this agent and model, or null.
 * The runtime refuses the same Send; saying so first keeps a message from
 * being typed for a model that cannot see what is attached to it. Unknown
 * support is not a refusal.
 */
export function imagesRefused(
  descriptor: ProviderDescriptor | undefined,
  options: Record<string, string>,
  context: readonly ContextItem[],
): string | null {
  if (!descriptor || descriptor.id === 'mock' || !context.some(sendsImage)) return null;
  const model = options.model
    ? descriptor.models?.find((item) => item.id === options.model)
    : descriptor.models?.find((item) => item.isDefault);
  const refused =
    descriptor.capabilities.images?.status === 'unsupported' || model?.images === 'unsupported';
  return refused
    ? `${descriptor.name} does not accept images with this model. Remove the image or choose another model.`
    : null;
}

/** One sentence for the files the chooser would not attach. */
export function refusalMessage(refused: readonly { name: string; reason: string }[]): string {
  return refused.map(({ name, reason }) => `${name} was not attached: ${reason}`).join(' ');
}

/** The files sent in a conversation, oldest first. */
export function sentAttachments(messages: readonly Message[]): ContextItem[] {
  return messages.flatMap((message) =>
    message.role === 'user'
      ? message.blocks.flatMap((block) =>
          block.type === 'context' ? block.items.filter((item) => item.attachment) : [],
        )
      : [],
  );
}

/**
 * The attachment a reply's inline code refers to: its file name exactly, or
 * the path of JAM Code's copy, which ends in the attachment's ID. When two
 * share a name, the one sent last.
 */
export function attachmentNamed(
  code: string,
  attachments: readonly ContextItem[],
): ContextItem | undefined {
  const named = code.trim();
  if (!named || !attachments.length) return undefined;
  const copy = /(attachment-[0-9a-f-]{36})(?:\.[A-Za-z0-9]{1,16})?$/.exec(named)?.[1];
  return [...attachments]
    .reverse()
    .find((item) => (copy ? item.assetId === copy : item.attachment?.name === named));
}

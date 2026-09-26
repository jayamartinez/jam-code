import type { Conversation, Resource, SearchResult, Session } from './types';

function words(value: string): string[] {
  return (
    value
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  );
}

/** Preview approximation of plain-token FTS prefix matching, never SQL syntax. */
export function searchDocument(resource: Resource, conversation: Conversation): string {
  return [
    resource.title,
    ...conversation.messages.flatMap((message) =>
      message.blocks.map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'context') return block.items.map((item) => item.label).join(' ');
        return [block.title, block.detail, ...(block.files?.map((file) => file.path) ?? [])].join(
          ' ',
        );
      }),
    ),
  ].join('\n');
}

export function searchPreview(
  query: string,
  resources: Resource[],
  sessions: Session[],
  conversations: Map<string, Conversation>,
): SearchResult[] {
  const terms = words(query);
  // Empty and punctuation-only queries never expand to every transcript.
  if (!terms.length) return [];
  return resources
    .flatMap((resource): SearchResult[] => {
      const conversation = conversations.get(resource.id);
      const session = sessions.find((item) => item.id === resource.sessionId);
      if (!conversation || !session || !resource.projectId) return [];
      const document = searchDocument(resource, conversation);
      const tokens = words(document);
      if (!terms.every((term) => tokens.some((token) => token.startsWith(term)))) return [];
      const firstTerm = terms[0];
      const matchIndex = firstTerm ? document.toLocaleLowerCase('en-US').indexOf(firstTerm) : 0;
      const start = Math.max(0, matchIndex - 48);
      return [
        {
          resourceId: resource.id,
          title: resource.title,
          projectId: resource.projectId,
          providerId: session.providerId,
          presentation: session.presentation,
          pinned: resource.pinned,
          snippet: `${start ? '…' : ''}${document.slice(start, start + 220).replace(/\s+/g, ' ')}${document.length > start + 220 ? '…' : ''}`,
          updatedAt: resource.updatedAt,
        },
      ];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 50);
}

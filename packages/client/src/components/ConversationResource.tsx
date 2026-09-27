import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Project, Resource, Session } from '@jam/protocol';
import type { RuntimeClient } from '../state/runtime-client';
import { ConversationPane } from './ConversationPane';
import type { PaneChromeProps } from './PaneChrome';

/**
 * One conversation pane, subscribed to its own resource.
 *
 * Several conversations can be visible at once, so the transcript subscription
 * is scoped per pane rather than to whichever pane happens to be focused. A
 * pane that is not focused still streams, and rendering one pane does not
 * re-render the others.
 */
export function ConversationResource({
  client,
  resource,
  project,
  session,
  composer,
  chrome,
}: {
  client: RuntimeClient;
  resource: Resource;
  project?: Project;
  session?: Session;
  composer: Omit<
    React.ComponentProps<typeof ConversationPane>,
    'resource' | 'project' | 'session' | 'conversation' | keyof PaneChromeProps
  >;
  chrome: Pick<
    PaneChromeProps,
    'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
  >;
}) {
  const resourceId = resource.id;
  const conversation = useSyncExternalStore(
    useCallback(
      (listener) => client.subscribeConversation(resourceId, listener),
      [client, resourceId],
    ),
    useCallback(() => client.getConversation(resourceId), [client, resourceId]),
    useCallback(() => client.getConversation(resourceId), [client, resourceId]),
  );

  useEffect(() => {
    void client.loadConversation(resourceId);
  }, [client, resourceId]);

  // Model and option choices need the provider's own lists, checked once.
  const providerId = session?.providerId;
  useEffect(() => {
    if (providerId && providerId !== 'mock') void client.ensureProviders();
  }, [client, providerId]);

  return (
    <ConversationPane
      {...chrome}
      {...composer}
      resource={resource}
      project={project}
      session={session}
      conversation={conversation}
    />
  );
}

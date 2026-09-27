import { useEffect, useState } from 'react';
import type { JamTransport } from '@jam/protocol';

/** Bounded asset reads only when a preview is actually mounted. */
export function SnapshotImage({
  id,
  transport,
  thumbnail = true,
}: {
  id: string;
  transport: Pick<JamTransport, 'request'>;
  thumbnail?: boolean;
}) {
  const [image, setImage] = useState<{ id: string; url?: string; error?: string }>();
  useEffect(() => {
    let disposed = false;
    void transport.request('snapshot.asset', { id, thumbnail }).then(
      ({ dataUrl }) => {
        if (!disposed) setImage({ id, url: dataUrl });
      },
      () => {
        if (!disposed) setImage({ id, error: 'Snapshot image is unavailable.' });
      },
    );
    return () => {
      disposed = true;
    };
  }, [id, thumbnail, transport]);
  return image?.id === id && image.url ? (
    <img className="snapshot-image" src={image.url} alt="Captured window" />
  ) : (
    <span className="snapshot-image-placeholder">
      {image?.id === id ? image.error : 'Loading snapshot…'}
    </span>
  );
}

import type { GitFileDiff } from '@jam/protocol';
export function ReviewPatch({ diff }: { diff: GitFileDiff }) {
  return (
    <div className="review-patch">
      {diff.file.previousPath && (
        <p className="pane-footnote mono">Renamed from {diff.file.previousPath}</p>
      )}
      {diff.binary ? (
        <div className="pane-state">Binary or non-UTF-8 file. Text diff unavailable.</div>
      ) : diff.hunks.length ? (
        diff.hunks.map((hunk, index) => (
          <div key={`${hunk.header}-${index}`}>
            <div className="diff-hunk">{hunk.header}</div>
            {hunk.lines.map((line, index) => (
              <div key={index} className={`diff-line ${line.kind}`}>
                <span>{line.oldLine ?? ''}</span>
                <span>{line.newLine ?? ''}</span>
                <span>{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}</span>
                <code>{line.text}</code>
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="pane-state">
          {diff.metadata.filter((line) => !line.startsWith('diff --git')).join('\n') ||
            'No text changes in this version.'}
        </div>
      )}
      {diff.truncated && (
        <p className="pane-footnote">
          Diff preview limited to 512 KiB / 5,000 lines. Counts cover displayed lines only. File
          actions affect the entire file.
        </p>
      )}
    </div>
  );
}

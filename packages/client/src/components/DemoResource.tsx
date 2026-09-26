import { FileDiff, Terminal, X } from 'lucide-react';
import { IconButton } from './Controls';

export default function DemoResource({
  kind,
  onClose,
}: {
  kind: 'diff' | 'terminal';
  onClose(): void;
}) {
  return (
    <section
      className={`pane ${kind === 'terminal' ? 'terminal-pane' : 'diff-pane'}`}
      aria-label={`${kind} demonstration`}
    >
      <header className="pane-header">
        <div className="pane-heading">
          {kind === 'diff' ? <FileDiff size={13} /> : <Terminal size={13} />}
          <strong>{kind === 'diff' ? 'PaneHost.tsx' : 'pnpm dev'}</strong>
          {kind === 'diff' && (
            <>
              <span className="success">+9</span>
              <span className="danger">−12</span>
            </>
          )}
          <span className="demo-label">Static demo</span>
        </div>
        <IconButton label={`Close ${kind} view`} onClick={onClose}>
          <X size={13} />
        </IconButton>
      </header>
      {kind === 'terminal' ? (
        <div className="terminal-demo">
          <pre>
            {
              '  VITE  ·  illustrative output\n\n  ➜  Local: http://localhost:5173/\n  ➜  No server is running in this pane\n\n10:44:02 [demo] session detached (pane closed)\n10:44:09 [demo] session reattached\n\n❯ '
            }
          </pre>
          <p>Terminal integration is planned. This pane executes nothing.</p>
        </div>
      ) : (
        <div className="diff-demo">
          <div className="diff-hunk">@@ -18,14 +18,11 @@ PaneHost</div>
          {[
            ['18', ' ', 'export function PaneHost({ pane }) {'],
            ['19', '−', '  const process = createProcess();'],
            ['20', '−', '  useEffect(() => {'],
            ['21', '−', '    return () => process.kill();'],
            ['22', '−', '  }, [pane.id]);'],
            ['19', '+', '  const session = useSession(pane.sessionId);'],
            ['20', '+', '  useEffect(() => {'],
            ['21', '+', '    const handle = registry.attach(session.id);'],
            ['22', '+', '    return () => handle.detach();'],
          ].map(([line, sign, code], index) => (
            <div
              key={index}
              className={`diff-line ${sign === '+' ? 'addition' : sign === '−' ? 'deletion' : ''}`}
            >
              <span>{line}</span>
              <span>{sign}</span>
              <code>{code}</code>
            </div>
          ))}
          <div className="diff-note">
            <span className="subtle">Example review annotation · not sent</span>
            <p>What reaps sessions nobody reattaches to? Add an idle timeout.</p>
            <button className="button" disabled title="Interactive review annotations are planned">
              Send review
            </button>
          </div>
          <div className="diff-line addition">
            <span>23</span>
            <span>+</span>
            <code>{'  }, [pane.sessionId]);'}</code>
          </div>
          <div className="diff-line">
            <span>24</span>
            <span> </span>
            <code>{'  return <SessionView session={session} />;'}</code>
          </div>
          <div className="diff-hunk">@@ -52,6 +49,4 @@ onClose</div>
          <div className="diff-line deletion">
            <span>53</span>
            <span>−</span>
            <code>process.kill();</code>
          </div>
          <div className="diff-line addition">
            <span>50</span>
            <span>+</span>
            <code>layout.hide(pane.id); // restorable</code>
          </div>
        </div>
      )}
    </section>
  );
}

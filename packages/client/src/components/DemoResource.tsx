import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { ResourceIcon } from './icons';

type Chrome = Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
>;

export default function DemoResource({ kind, chrome }: { kind: 'diff'; chrome: Chrome }) {
  return (
    <PaneChrome
      {...chrome}
      className="diff-pane"
      label={`${kind} demonstration`}
      heading={
        <>
          <ResourceIcon kind={kind} />
          <strong>PaneHost.tsx</strong>
          <span className="success">+9</span>
          <span className="danger">−12</span>
        </>
      }
      status={<span className="demo-label">Static demo</span>}
    >
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
    </PaneChrome>
  );
}

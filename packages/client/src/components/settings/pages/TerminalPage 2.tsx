import { PageHeader, Planned } from '../controls';

export default function TerminalPage() {
  return (
    <div className="sv-page">
      <PageHeader
        title="Terminal"
        description="Terminal settings are being redesigned."
        aside={<Planned />}
      />
    </div>
  );
}

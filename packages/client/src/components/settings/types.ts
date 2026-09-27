import type { JamTransport, Project, ProjectIcon, ProviderDescriptor } from '@jam/protocol';
import type { DesktopServices, SnapshotHost } from '../../desktop';

export type SettingsPageId =
  | 'General'
  | 'Appearance'
  | 'Projects'
  | 'Providers'
  | 'Usage'
  | 'Browser'
  | 'Terminal'
  | 'Snapshots'
  | 'Skills'
  | 'Keybindings'
  | 'Storage'
  | 'Advanced'
  | 'About';

export interface ProjectChanges {
  name?: string;
  paths?: string[];
  icon?: ProjectIcon;
  pinned?: boolean;
}

/** Everything a Settings page may read or change. Pages own no records. */
export interface SettingsPageProps {
  providers: ProviderDescriptor[];
  projects: Project[];
  platform: DesktopServices['platform'];
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  onUpdateProject(projectId: string, changes: ProjectChanges): Promise<void>;
  /** Moves to another Settings page, e.g. from a "Providers ›" link. */
  onNavigate(page: SettingsPageId): void;
  /** Runtime requests for pages backed by runtime settings (Snapshots). */
  transport: JamTransport;
  /** Present only in the desktop app, where capture exists. */
  snapshots?: SnapshotHost;
}

import type {
  JamTransport,
  Project,
  ProjectIcon,
  ProviderDescriptor,
  RequestMap,
} from '@jam/protocol';
import type { DesktopServices, SnapshotHost } from '../../desktop';
import type { NewThreadWorkspace, TimeFormat } from '../../state/preferences';

export type SettingsPageId =
  | 'General'
  | 'Notifications'
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

/** Provider checks and saved provider settings; the runtime owns both. */
export interface ProviderControl {
  /** Checks providers once, if nothing has checked them yet. */
  ensure(): Promise<void>;
  /** Asks every provider again. */
  refresh(): Promise<void>;
  configure(changes: RequestMap['provider.configure']['params']): Promise<void>;
}

/** Adding, removing and relinking projects; the runtime owns the records. */
export interface ProjectControl {
  /** Opens the folder picker and adds the chosen folder. Absent without one. */
  add?(): Promise<Project | null>;
  /** Forgets a project. Its folder and history stay on disk. */
  remove(projectId: string): Promise<void>;
  /** Chooses a folder with the picker, opened in `start`; absent without one. */
  pickFolder?(start?: string): Promise<string | null>;
  /** Opens the system emoji picker; absent without one. */
  openEmojiPicker?(): Promise<void>;
}

/** Everything a Settings page may read or change. Pages own no records. */
export interface SettingsPageProps {
  providers: ProviderDescriptor[];
  providerControl: ProviderControl;
  projects: Project[];
  platform: DesktopServices['platform'];
  idleThreadDays: number | null;
  onIdleThreadDays(next: number | null): void;
  /** Reveal agent replies as they stream. */
  streamReplies: boolean;
  onStreamReplies(next: boolean): void;
  /** How message times and dividers read. */
  timeFormat: TimeFormat;
  onTimeFormat(next: TimeFormat): void;
  /** Where a new chat's workspace starts. */
  newThreadWorkspace: NewThreadWorkspace;
  onNewThreadWorkspace(next: NewThreadWorkspace): void;
  onUpdateProject(projectId: string, changes: ProjectChanges): Promise<void>;
  projectControl: ProjectControl;
  /** Moves to another Settings page, e.g. from a "Providers ›" link. */
  onNavigate(page: SettingsPageId): void;
  /** Runtime requests for pages backed by runtime settings (Snapshots). */
  transport: JamTransport;
  /** Present only in the desktop app, where capture exists. */
  snapshots?: SnapshotHost;
  /** JAM Code's GitHub pages; present only in the desktop app. */
  openFeedback?: DesktopServices['openFeedback'];
}

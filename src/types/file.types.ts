// Types for file entries and system information
// Matches the Rust structs in src-tauri

/**
 * High-level cloud sync state, mirroring the Rust enum
 * (`#[serde(rename_all = "kebab-case")]`).
 */
export type CloudSyncState = 'synced' | 'syncing' | 'online-only' | 'error';

export interface FileEntry {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    modified: string;
    created: string;
    extension: string;
    /** Legacy flag — kept in sync with `sync_state === 'online-only'` when known. */
    is_cloud_placeholder: boolean;
    /** Storage provider id (e.g. "OneDrive!Personal", "iCloud!", "GoogleDriveFS!") when applicable. */
    cloud_provider?: string | null;
    /** Sync state from the Windows Cloud Files API; absent for non-cloud items. */
    sync_state?: CloudSyncState | null;
}

export interface DriveInfo {
    name: string;
    path: string;
    total_space: number;
    free_space: number;
}

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'size' | 'type';
export type SortOrder = 'asc' | 'desc';

/**
 * Sentinel path for the virtual Home aggregator view. When a tab's `path`
 * equals this value the file browser renders `<HomeView />` instead of
 * `<FileGrid />` / `<FileList />`. Chosen as a `tachy:` URI so it can never
 * collide with a real Windows path.
 */
export const HOME_PATH = 'tachy:home' as const;
export type HomePath = typeof HOME_PATH;

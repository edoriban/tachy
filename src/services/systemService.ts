// System service - encapsulates all Tauri system-related API calls
// Drives, quick access, context menu, terminal, properties, etc.

import { invoke } from '@tauri-apps/api/core';
import type { DriveInfo, FileEntry } from '../types';

export interface ContextMenuParams {
    x: number;
    y: number;
    filePath: string | null;
    isFile: boolean;
    hasClipboard: boolean;
    /** True when the right-clicked target is a directory — gates the pin menu. */
    isDir?: boolean;
    /** True when the directory is already in Quick Access pins. */
    isPinned?: boolean;
}

export interface SystemService {
    getDrives: () => Promise<DriveInfo[]>;
    /** @deprecated Quick Access is now driven by `pinnedStore`; kept for backward-compat. */
    getQuickAccess: () => Promise<FileEntry[]>;
    getFoldersMetadata: (paths: string[], opts?: { withCloudStatus?: boolean }) => Promise<FileEntry[]>;
    getKnownFolders: () => Promise<Record<string, string>>;
    getRecentFiles: (max?: number) => Promise<FileEntry[]>;
    getParentDirectory: (path: string) => Promise<string | null>;
    showContextMenu: (params: ContextMenuParams) => Promise<void>;
    openInTerminal: (path: string) => Promise<void>;
    showNativeProperties: (path: string) => Promise<void>;
}

export const systemService: SystemService = {
    getDrives: () =>
        invoke<DriveInfo[]>('get_drives'),

    getQuickAccess: () =>
        invoke<FileEntry[]>('get_quick_access'),

    getFoldersMetadata: (paths: string[], opts) =>
        invoke<FileEntry[]>('get_folders_metadata', {
            paths,
            withCloudStatus: opts?.withCloudStatus ?? true,
        }),

    getKnownFolders: () =>
        invoke<Record<string, string>>('get_known_folders'),

    getRecentFiles: (max = 30) =>
        invoke<FileEntry[]>('get_recent_files', { max }),

    getParentDirectory: (path: string) =>
        invoke<string | null>('get_parent_directory', { path }),

    showContextMenu: (params: ContextMenuParams) =>
        invoke('show_context_menu', {
            x: params.x,
            y: params.y,
            filePath: params.filePath,
            isFile: params.isFile,
            hasClipboard: params.hasClipboard,
            isDir: params.isDir ?? false,
            isPinned: params.isPinned ?? false,
        }),

    openInTerminal: (path: string) =>
        invoke('open_in_terminal', { path }),

    showNativeProperties: (path: string) =>
        invoke('show_native_properties', { path }),
};

// HomeView — the virtual aggregator rendered when the active tab points at
// the `HOME_PATH` sentinel. Mirrors the Windows 11 File Explorer Home page:
//
//   - "Quick access" — folder cards driven by the persistent `pinnedStore`.
//   - "Recent" — files surfaced by the `get_recent_files` Tauri command,
//     which resolves Windows' Recent .lnk shortcuts to their targets.
//
// We intentionally don't reuse FileGrid/FileList here: those are virtualized,
// directory-shaped views with selection, sort, and column headers. Home is a
// scrollable composition of two distinct sections, so a custom layout reads
// far cleaner than shoehorning sections into FileList.

import { FC, useEffect, useState, useMemo } from 'react';
import type { FileEntry } from '@types';
import { systemService } from '@services';
import { usePinnedStore } from '@store';
import { getQuickAccessIcon, FolderIcon } from '@utils/icons';
import { Thumbnail } from './Thumbnail';

interface HomeViewProps {
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
    /** Bumped by parent to trigger a reload (used by Toolbar refresh). */
    refreshKey?: number;
}

const SectionHeader: FC<{ label: string }> = ({ label }) => (
    <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] mb-3 select-none">
        {label}
    </h2>
);

// Card for a pinned folder — chunky tile, mirrors Win11's larger-than-list look.
const QuickAccessCard: FC<{
    file: FileEntry;
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}> = ({ file, onOpen, onContextMenu }) => {
    const icon = getQuickAccessIcon(file.name, 28);
    return (
        <button
            onClick={() => onOpen(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
            className="group flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)] transition-colors text-left min-w-0"
            title={file.path}
        >
            <span className="shrink-0 w-10 h-10 flex items-center justify-center rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)]">
                {icon}
            </span>
            <span className="flex flex-col min-w-0">
                <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                    {file.name}
                </span>
                <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                    {file.path}
                </span>
            </span>
        </button>
    );
};

// Recent row — compact row with thumbnail, modified date, parent folder.
const RecentRow: FC<{
    file: FileEntry;
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}> = ({ file, onOpen, onContextMenu }) => {
    const parent = useMemo(() => {
        // Take parent path without the trailing filename. Defensive against
        // both forward and backslashes (Recent items can occasionally come
        // from UNC paths).
        const idx = Math.max(file.path.lastIndexOf('\\'), file.path.lastIndexOf('/'));
        return idx > 0 ? file.path.slice(0, idx) : '';
    }, [file.path]);

    return (
        <button
            onClick={() => onOpen(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
            className="w-full grid grid-cols-[24px_1fr_140px_1fr] items-center gap-3 px-3 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-hover)] transition-colors text-left"
            title={file.path}
        >
            <span className="shrink-0 w-5 h-5 flex items-center justify-center">
                {file.is_dir
                    ? <FolderIcon size={20} />
                    : <Thumbnail path={file.path} extension={file.extension} isDir={false} size={20} />
                }
            </span>
            <span className="truncate text-[13px] text-[var(--color-text-primary)]">
                {file.name}
            </span>
            <span className="truncate text-[12px] text-[var(--color-text-muted)]">
                {file.modified || '-'}
            </span>
            <span className="truncate text-[12px] text-[var(--color-text-muted)]">
                {parent}
            </span>
        </button>
    );
};

export const HomeView: FC<HomeViewProps> = ({ onOpen, onContextMenu, refreshKey = 0 }) => {
    const pinnedPaths = usePinnedStore((s) => s.pinnedPaths);
    const [pinnedFiles, setPinnedFiles] = useState<FileEntry[]>([]);
    const [recentFiles, setRecentFiles] = useState<FileEntry[]>([]);
    const [loadingRecent, setLoadingRecent] = useState(true);

    // Resolve pin paths -> FileEntry whenever the pin list changes.
    // Skipped paths (deleted folders) just disappear from the grid.
    useEffect(() => {
        let cancelled = false;
        if (pinnedPaths.length === 0) {
            setPinnedFiles([]);
            return;
        }
        // Quick access cards don't render CloudBadge — skip the per-pin Cloud
        // Files API query so this resolves in a few ms even with many pins.
        systemService
            .getFoldersMetadata(pinnedPaths, { withCloudStatus: false })
            .then((entries) => {
                if (!cancelled) setPinnedFiles(entries);
            })
            .catch((err) => {
                console.error('[HomeView] getFoldersMetadata failed', err);
                if (!cancelled) setPinnedFiles([]);
            });
        return () => { cancelled = true; };
    }, [pinnedPaths, refreshKey]);

    // Load recent files. Cheap to re-run on refreshKey (small directory).
    useEffect(() => {
        let cancelled = false;
        setLoadingRecent(true);
        systemService
            .getRecentFiles(30)
            .then((entries) => {
                if (!cancelled) setRecentFiles(entries);
            })
            .catch((err) => {
                console.error('[HomeView] getRecentFiles failed', err);
                if (!cancelled) setRecentFiles([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingRecent(false);
            });
        return () => { cancelled = true; };
    }, [refreshKey]);

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-8">
                {/* Quick access */}
                <section>
                    <SectionHeader label="Quick access" />
                    {pinnedFiles.length === 0 ? (
                        <p className="text-[12px] text-[var(--color-text-muted)] py-4">
                            No pinned items. Right-click any folder and choose
                            <span className="mx-1 text-[var(--color-text-secondary)]">Pin to Quick access</span>.
                        </p>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                            {pinnedFiles.map((file) => (
                                <QuickAccessCard
                                    key={file.path}
                                    file={file}
                                    onOpen={onOpen}
                                    onContextMenu={onContextMenu}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* Recent */}
                <section>
                    <SectionHeader label="Recent" />
                    {loadingRecent ? (
                        <p className="text-[12px] text-[var(--color-text-muted)] py-4">Loading…</p>
                    ) : recentFiles.length === 0 ? (
                        <p className="text-[12px] text-[var(--color-text-muted)] py-4">
                            No recent activity.
                        </p>
                    ) : (
                        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] overflow-hidden">
                            <div className="grid grid-cols-[24px_1fr_140px_1fr] items-center gap-3 px-3 py-2 text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                                <span />
                                <span>Name</span>
                                <span>Date accessed</span>
                                <span>Location</span>
                            </div>
                            <div className="py-1">
                                {recentFiles.map((file) => (
                                    <RecentRow
                                        key={file.path}
                                        file={file}
                                        onOpen={onOpen}
                                        onContextMenu={onContextMenu}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

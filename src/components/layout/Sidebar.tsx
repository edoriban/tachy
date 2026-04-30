// Enhanced Sidebar with virtual Home + pinneable Quick Access + Cloud Drives + Tree Navigation.
// Matches Windows 11 Explorer sidebar structure.
//
// Quick Access pins are now driven by `pinnedStore` (Zustand persist), so the
// list reflects whatever the user has pinned via context menus. Right-clicking
// a pin opens the same Tauri context menu that the file browser uses, with
// the `is_pinned: true` flag set so it shows "Unpin from Quick access".

import { FC, useEffect, useState, useMemo } from 'react';
import type { FileEntry, DriveInfo } from '@types';
import { HOME_PATH } from '@types';
import { fileService, systemService, type CloudDrive } from '@services';
import { usePinnedStore } from '@store';
import { DriveIcon, getQuickAccessIcon } from '@utils/icons';
import { TreeItem } from './TreeItem';

interface SidebarProps {
    drives: DriveInfo[];
    currentPath: string;
    onNavigate: (path: string) => void;
    /** Surface a right-clicked pin upward so the parent's useContextMenu hook
     *  can route the resulting "unpin" menu action back through the same flow
     *  as folder-tree right-clicks. */
    onPinContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

// Icons
const OneDriveIcon: FC<{ size?: number }> = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
            d="M12 6C14.5 6 16.5 7.5 17.5 9.5C20 9.5 22 11.5 22 14C22 16.5 20 18.5 17.5 18.5H7C4 18.5 2 16 2 13.5C2 11 4 9 6.5 9C6.5 7.5 8 6 10 6H12Z"
            fill="#0078D4"
        />
    </svg>
);

const ICloudIcon: FC<{ size?: number }> = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
            d="M12 6C14.5 6 16.5 7.5 17.5 9.5C20 9.5 22 11.5 22 14C22 16.5 20 18.5 17.5 18.5H7C4 18.5 2 16 2 13.5C2 11 4 9 6.5 9C6.5 7.5 8 6 10 6H12Z"
            fill="#3B9FD8"
        />
    </svg>
);

const HomeIcon: FC<{ size?: number }> = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
            d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

const ThisPCIcon: FC<{ size?: number }> = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M8 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 17V21" stroke="currentColor" strokeWidth="2" />
    </svg>
);

// Lucide-style "Pin" icon. Inlined to match the project's existing
// inline-SVG icon pattern (no external icon library dep).
const PinIndicatorIcon: FC<{ size?: number }> = ({ size = 12 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
);

export const Sidebar: FC<SidebarProps> = ({ drives, currentPath, onNavigate, onPinContextMenu }) => {
    const [cloudDrives, setCloudDrives] = useState<CloudDrive[]>([]);
    const [thisPCExpanded, setThisPCExpanded] = useState(true);

    const pinnedPaths = usePinnedStore((s) => s.pinnedPaths);
    const [pinnedFiles, setPinnedFiles] = useState<FileEntry[]>([]);

    // Load cloud drives on mount
    useEffect(() => {
        fileService.getCloudDrives().then(setCloudDrives).catch(console.error);
    }, []);

    // Resolve the persisted pin path list into FileEntry records (same metadata
    // shape we use elsewhere, so the right-click context menu can carry the
    // full file object back into useContextMenu).
    useEffect(() => {
        let cancelled = false;
        if (pinnedPaths.length === 0) {
            setPinnedFiles([]);
            return;
        }
        // Sidebar rows don't render CloudBadge, so skip the cloud_status COM
        // queries — keeps Home -> Sidebar refresh path snappy.
        systemService
            .getFoldersMetadata(pinnedPaths, { withCloudStatus: false })
            .then((entries) => {
                if (!cancelled) setPinnedFiles(entries);
            })
            .catch((err) => {
                console.error('[Sidebar] getFoldersMetadata failed', err);
                if (!cancelled) setPinnedFiles([]);
            });
        return () => { cancelled = true; };
    }, [pinnedPaths]);

    // Separate OneDrive and iCloud
    const oneDrives = useMemo(
        () => cloudDrives.filter(c => c.provider.toLowerCase().includes('onedrive')),
        [cloudDrives]
    );
    const iCloudDrives = useMemo(
        () => cloudDrives.filter(c => c.provider.toLowerCase().includes('icloud')),
        [cloudDrives]
    );

    const homeActive = currentPath === HOME_PATH;

    return (
        <aside className="w-56 shrink-0 sidebar flex flex-col overflow-hidden">
            {/* Top Section: Home + OneDrive */}
            <div className="py-2 px-2">
                <nav className="space-y-0.5">
                    {/* Home — virtual aggregator, never a real path */}
                    <button
                        onClick={() => onNavigate(HOME_PATH)}
                        className={`sidebar-item w-full relative ${homeActive ? 'active' : ''}`}
                        style={{ paddingLeft: 8 }}
                    >
                        <span className="w-4 shrink-0" aria-hidden="true" />
                        <span className="w-5 flex justify-center shrink-0 text-[var(--color-accent)]">
                            <HomeIcon />
                        </span>
                        <span className="truncate font-medium">Home</span>
                    </button>

                    {/* OneDrive folders (expandable) */}
                    {oneDrives.map((cloud) => {
                        const isActive = currentPath.toLowerCase() === cloud.path.toLowerCase();
                        return (
                            <TreeItem
                                key={cloud.path}
                                name={cloud.name}
                                path={cloud.path}
                                icon={<OneDriveIcon size={18} />}
                                depth={0}
                                isActive={isActive}
                                currentPath={currentPath}
                                onNavigate={onNavigate}
                            />
                        );
                    })}
                </nav>
            </div>

            {/* Divider */}
            <div className="h-px bg-[var(--color-border)] mx-4 my-1 opacity-50" />

            {/* Quick Access — driven by pinnedStore. Empty state intentional:
                if a user unpins everything, the section just disappears.        */}
            {pinnedFiles.length > 0 && (
                <div className="py-1 px-2">
                    <nav className="space-y-0.5">
                        {pinnedFiles.map((folder) => {
                            const isActive = currentPath.toLowerCase() === folder.path.toLowerCase();
                            return (
                                <button
                                    key={folder.path}
                                    onClick={() => onNavigate(folder.path)}
                                    onContextMenu={(e) => onPinContextMenu(e, folder)}
                                    className={`sidebar-item w-full relative ${isActive ? 'active' : ''}`}
                                    style={{ paddingLeft: 8 }}
                                    title={folder.path}
                                >
                                    <span className="w-4 shrink-0" aria-hidden="true" />
                                    <span className="w-5 flex justify-center shrink-0">
                                        {getQuickAccessIcon(folder.name, 18)}
                                    </span>
                                    <span className="truncate font-medium">{folder.name}</span>
                                    <span
                                        className="ml-auto shrink-0 text-[var(--color-text-muted)]"
                                        aria-hidden="true"
                                    >
                                        <PinIndicatorIcon size={12} />
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                </div>
            )}

            {/* Divider */}
            <div className="h-px bg-[var(--color-border)] mx-4 my-1 opacity-50" />

            {/* iCloud Drives */}
            {iCloudDrives.length > 0 && (
                <div className="py-1 px-2">
                    <nav className="space-y-0.5">
                        {iCloudDrives.map((cloud) => {
                            const isActive = currentPath.toLowerCase() === cloud.path.toLowerCase();
                            return (
                                <TreeItem
                                    key={cloud.path}
                                    name={cloud.name}
                                    path={cloud.path}
                                    icon={<ICloudIcon size={18} />}
                                    depth={0}
                                    isActive={isActive}
                                    currentPath={currentPath}
                                    onNavigate={onNavigate}
                                />
                            );
                        })}
                    </nav>
                </div>
            )}

            {/* This PC - Expandable Tree */}
            <div className="py-1 px-2 flex-1 overflow-y-auto">
                {/* This PC Header */}
                <button
                    onClick={() => setThisPCExpanded(!thisPCExpanded)}
                    className="sidebar-item w-full relative"
                    style={{ paddingLeft: 8 }}
                >
                    <span className={`w-4 flex justify-center shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${thisPCExpanded ? 'rotate-90' : ''}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </span>
                    <span className="w-5 flex justify-center shrink-0 text-[var(--color-text-secondary)]">
                        <ThisPCIcon />
                    </span>
                    <span className="truncate font-semibold text-[var(--color-text-secondary)]">This PC</span>
                </button>

                {/* Drives Tree */}
                {thisPCExpanded && (
                    <nav className="space-y-0.5">
                        {drives.map((drive) => {
                            const letter = drive.path.charAt(0);
                            const isActive = currentPath.toLowerCase() === drive.path.toLowerCase();
                            return (
                                <TreeItem
                                    key={drive.path}
                                    name={`Local Disk (${letter}:)`}
                                    path={drive.path}
                                    icon={<DriveIcon size={16} />}
                                    depth={1}
                                    isActive={isActive}
                                    currentPath={currentPath}
                                    onNavigate={onNavigate}
                                />
                            );
                        })}
                    </nav>
                )}
            </div>
        </aside>
    );
};

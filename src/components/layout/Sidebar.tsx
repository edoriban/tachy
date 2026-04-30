// Enhanced Sidebar with Home, Cloud Drives, and Tree Navigation
// Matches Windows 11 Explorer sidebar structure

import { FC, useEffect, useState } from 'react';
import type { FileEntry, DriveInfo } from '@types';
import { fileService, type CloudDrive } from '@services';
import { DriveIcon, getQuickAccessIcon } from '@utils/icons';
import { TreeItem } from './TreeItem';

interface SidebarProps {
    drives: DriveInfo[];
    quickAccess: FileEntry[];
    currentPath: string;
    onNavigate: (path: string) => void;
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

export const Sidebar: FC<SidebarProps> = ({ drives, quickAccess, currentPath, onNavigate }) => {
    const [cloudDrives, setCloudDrives] = useState<CloudDrive[]>([]);
    const [thisPCExpanded, setThisPCExpanded] = useState(true);

    // Load cloud drives on mount
    useEffect(() => {
        fileService.getCloudDrives().then(setCloudDrives).catch(console.error);
    }, []);

    // Separate OneDrive and iCloud
    const oneDrives = cloudDrives.filter(c => c.provider.toLowerCase().includes('onedrive'));
    const iCloudDrives = cloudDrives.filter(c => c.provider.toLowerCase().includes('icloud'));

    return (
        <aside className="w-56 shrink-0 sidebar flex flex-col overflow-hidden">
            {/* Top Section: Home + OneDrive */}
            <div className="py-2 px-2">
                <nav className="space-y-0.5">
                    {/* Home */}
                    <button
                        onClick={() => {
                            const desktop = quickAccess.find(f => f.name === 'Desktop')?.path;
                            if (desktop) {
                                const home = desktop.replace('\\Desktop', '');
                                onNavigate(home);
                            }
                        }}
                        className={`sidebar-item w-full relative ${currentPath.toLowerCase() === (quickAccess.find(f => f.name === 'Desktop')?.path.replace('\\Desktop', '') ?? '').toLowerCase()
                            ? 'active'
                            : ''
                            }`}
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

            {/* Quick Access Libraries */}
            <div className="py-1 px-2">
                <nav className="space-y-0.5">
                    {quickAccess.map((folder) => {
                        const isActive = currentPath.toLowerCase() === folder.path.toLowerCase();
                        return (
                            <button
                                key={folder.path}
                                onClick={() => onNavigate(folder.path)}
                                className={`sidebar-item w-full relative ${isActive ? 'active' : ''}`}
                                style={{ paddingLeft: 8 }}
                                title={folder.path}
                            >
                                <span className="w-4 shrink-0" aria-hidden="true" />
                                <span className="w-5 flex justify-center shrink-0">
                                    {getQuickAccessIcon(folder.name, 18)}
                                </span>
                                <span className="truncate font-medium">{folder.name}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>

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

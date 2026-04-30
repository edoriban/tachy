// FileItem component - individual file/folder display
// Reusable for both grid and list views
import { FC } from 'react';
import type { FileEntry } from '../../types';
import { getFileIcon } from '../../utils/icons';
import { formatSize, getFileType } from '../../utils/format';
import { CloudBadge } from './CloudBadge';

interface FileItemProps {
    file: FileEntry;
    isSelected: boolean;
    viewMode: 'grid' | 'list';
    onClick: () => void;
    onDoubleClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}

export const FileItem: FC<FileItemProps> = ({
    file,
    isSelected,
    viewMode,
    onClick,
    onDoubleClick,
    onContextMenu,
}) => {
    if (viewMode === 'grid') {
        return (
            <button
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onContextMenu={onContextMenu}
                className={`group flex flex-col items-center gap-1 p-3 rounded-lg transition-all
          ${isSelected
                        ? 'bg-[var(--color-bg-selected)] ring-1 ring-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-bg-hover)]'
                    }`}
                title={file.path}
            >
                <div className="relative w-12 h-12 flex items-center justify-center">
                    {getFileIcon(file.extension, file.is_dir, 48)}
                    {file.sync_state && (
                        <span className="pointer-events-none absolute bottom-0 right-0">
                            <CloudBadge syncState={file.sync_state} size={14} />
                        </span>
                    )}
                </div>
                <span className={`text-[12px] text-center leading-tight max-w-[80px] break-words line-clamp-2
          ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
                >
                    {file.name}
                </span>
            </button>
        );
    }

    // List view
    return (
        <button
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            className={`file-row w-full grid grid-cols-[1fr_150px_150px_100px] gap-4 px-6 py-2 items-center text-left transition-colors
        ${isSelected ? 'selected' : 'hover:bg-[var(--color-bg-hover)]'}`}
        >
            {/* Name with icon */}
            <div className="flex items-center gap-3 min-w-0 pl-1">
                <div className="relative shrink-0 w-5 h-5 flex items-center justify-center">
                    {getFileIcon(file.extension, file.is_dir, 20)}
                    {file.sync_state && (
                        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5">
                            <CloudBadge syncState={file.sync_state} size={11} />
                        </span>
                    )}
                </div>
                <span
                    className={`truncate text-[13px] ${isSelected ? 'text-[var(--color-accent)]' : ''}`}
                    title={file.name}
                >
                    {file.name}
                </span>
            </div>

            {/* Modified */}
            <div className="text-[12px] text-[var(--color-text-secondary)]">
                {file.modified || '-'}
            </div>

            {/* Type */}
            <div className="text-[12px] text-[var(--color-text-secondary)] truncate">
                {getFileType(file.extension, file.is_dir)}
            </div>

            {/* Size */}
            <div className="text-[12px] text-[var(--color-text-secondary)] text-right pr-2">
                {file.is_dir ? '-' : formatSize(file.size)}
            </div>
        </button>
    );
};

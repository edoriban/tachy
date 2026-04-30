// FileGrid component - displays files in a grid layout with thumbnails
// Using Thumbnail component for image previews
// Supports multi-selection with selectedPaths array

import { FC } from 'react';
import type { FileEntry } from '@types';
import { Thumbnail } from './Thumbnail';
import { CloudBadge } from './CloudBadge';

interface FileGridProps {
    files: FileEntry[];
    selectedPaths: string[];
    onSelect: (file: FileEntry, event: React.MouseEvent) => void;
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

export const FileGrid: FC<FileGridProps> = ({ files, selectedPaths, onSelect, onOpen, onContextMenu }) => {
    if (files.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                <div className="text-center">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 opacity-50">
                        <path d="M3 7C3 5.34315 4.34315 4 6 4H10.1716C10.702 4 11.2107 4.21071 11.5858 4.58579L13 6H18C19.6569 6 21 7.34315 21 9V17C21 18.6569 19.6569 20 18 20H6C4.34315 20 3 18.6569 3 17V7Z" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <p className="text-sm">This folder is empty</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
                {files.map((file) => {
                    const isSelected = selectedPaths.includes(file.path);
                    return (
                        <button
                            key={file.path}
                            onClick={(e) => onSelect(file, e)}
                            onDoubleClick={() => onOpen(file)}
                            onContextMenu={(e) => onContextMenu(e, file)}
                            className={`file-item flex flex-col items-center p-3 rounded-[var(--radius-lg)] transition-all duration-100 cursor-pointer group
                ${isSelected
                                    ? 'bg-[var(--color-bg-selected)] ring-1 ring-[var(--color-accent)]/40'
                                    : 'hover:bg-[var(--color-bg-hover)]'
                                }`}
                        >
                            {/* Thumbnail or Icon */}
                            <div className="relative w-14 h-14 flex items-center justify-center mb-2">
                                <Thumbnail
                                    path={file.path}
                                    extension={file.extension}
                                    isDir={file.is_dir}
                                    size={56}
                                />
                                {file.sync_state && (
                                    <span className="pointer-events-none absolute bottom-0 right-0">
                                        <CloudBadge syncState={file.sync_state} size={14} />
                                    </span>
                                )}
                            </div>
                            <span
                                className={`text-[12px] text-center w-full px-1 leading-snug ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
                                    }`}
                                title={file.name}
                                style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    wordBreak: 'break-word'
                                }}
                            >
                                {file.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

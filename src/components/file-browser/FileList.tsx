import { FC, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, SortBy, SortOrder } from '@types';
import { getFileIcon } from '@utils/icons';
import { formatSize, getFileType } from '@utils/format';
import { CloudBadge } from './CloudBadge';

interface FileListProps {
    files: FileEntry[];
    selectedPaths: string[];
    sortBy: SortBy;
    sortOrder: SortOrder;
    onSort: (column: SortBy) => void;
    onSelect: (file: FileEntry, event: React.MouseEvent) => void;
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}

// Row height for virtualization
const ROW_HEIGHT = 36;

// Sort arrow indicator
const SortArrow: FC<{ direction: SortOrder }> = ({ direction }) => (
    <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="ml-1 opacity-70"
    >
        <path d={direction === 'asc' ? 'M7 14l5-5 5 5H7z' : 'M7 10l5 5 5-5H7z'} />
    </svg>
);

// Clickable column header
const ColumnHeader: FC<{
    label: string;
    column: SortBy;
    currentSort: SortBy;
    sortOrder: SortOrder;
    onClick: () => void;
    className?: string;
}> = ({ label, column, currentSort, sortOrder, onClick, className = '' }) => {
    const isActive = currentSort === column;

    return (
        <button
            onClick={onClick}
            className={`flex items-center text-left hover:text-[var(--color-text-primary)] transition-colors cursor-pointer select-none ${className} ${isActive ? 'text-[var(--color-text-primary)]' : ''}`}
        >
            {label}
            {isActive && <SortArrow direction={sortOrder} />}
        </button>
    );
};

// Individual file row component
const FileRow: FC<{
    file: FileEntry;
    isSelected: boolean;
    style: React.CSSProperties;
    onSelect: (file: FileEntry, event: React.MouseEvent) => void;
    onOpen: (file: FileEntry) => void;
    onContextMenu: (e: React.MouseEvent, file: FileEntry) => void;
}> = ({ file, isSelected, style, onSelect, onOpen, onContextMenu }) => (
    <button
        style={style}
        onClick={(e) => onSelect(file, e)}
        onDoubleClick={() => onOpen(file)}
        onContextMenu={(e) => onContextMenu(e, file)}
        className={`file-row absolute left-0 right-0 grid grid-cols-[1fr_150px_150px_100px] gap-4 px-6 items-center text-left transition-colors
            ${isSelected ? 'selected bg-[var(--color-bg-selected-row)]' : 'hover:bg-[var(--color-bg-hover)]'}`}
    >
        {/* Name with icon */}
        <div className="flex items-center gap-3 min-w-0 pl-1">
            <div className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
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

export const FileList: FC<FileListProps> = ({
    files,
    selectedPaths,
    sortBy,
    sortOrder,
    onSort,
    onSelect,
    onOpen,
    onContextMenu
}) => {
    // Ref for the scrollable container
    const parentRef = useRef<HTMLDivElement>(null);

    // Sort files with memoization
    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            // Folders always first
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

            let comparison = 0;
            switch (sortBy) {
                case 'name':
                    comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                    break;
                case 'date':
                    comparison = (a.modified || '').localeCompare(b.modified || '');
                    break;
                case 'size':
                    comparison = a.size - b.size;
                    break;
                case 'type':
                    const typeA = getFileType(a.extension, a.is_dir);
                    const typeB = getFileType(b.extension, b.is_dir);
                    comparison = typeA.localeCompare(typeB);
                    break;
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }, [files, sortBy, sortOrder]);

    // Virtual row rendering
    const rowVirtualizer = useVirtualizer({
        count: sortedFiles.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10, // Render 10 extra rows above/below viewport
    });

    if (files.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                <div className="text-center">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto mb-3 opacity-40">
                        <path d="M8 12C8 9.79 9.79 8 12 8H20.69C21.75 8 22.77 8.42 23.52 9.17L26 12H36C38.21 12 40 13.79 40 16V36C40 38.21 38.21 40 36 40H12C9.79 40 8 38.21 8 36V12Z" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <p className="text-sm">This folder is empty</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Sticky Header */}
            <div className="flex-shrink-0 grid grid-cols-[1fr_150px_150px_100px] gap-4 px-6 py-2 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                <ColumnHeader
                    label="Name"
                    column="name"
                    currentSort={sortBy}
                    sortOrder={sortOrder}
                    onClick={() => onSort('name')}
                    className="pl-8"
                />
                <ColumnHeader
                    label="Modified"
                    column="date"
                    currentSort={sortBy}
                    sortOrder={sortOrder}
                    onClick={() => onSort('date')}
                />
                <ColumnHeader
                    label="Type"
                    column="type"
                    currentSort={sortBy}
                    sortOrder={sortOrder}
                    onClick={() => onSort('type')}
                />
                <ColumnHeader
                    label="Size"
                    column="size"
                    currentSort={sortBy}
                    sortOrder={sortOrder}
                    onClick={() => onSort('size')}
                    className="justify-end pr-2"
                />
            </div>

            {/* Virtualized Rows Container */}
            <div
                ref={parentRef}
                className="flex-1 overflow-auto"
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const file = sortedFiles[virtualRow.index];
                        const isSelected = selectedPaths.includes(file.path);

                        return (
                            <FileRow
                                key={file.path}
                                file={file}
                                isSelected={isSelected}
                                style={{
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                                onSelect={onSelect}
                                onOpen={onOpen}
                                onContextMenu={onContextMenu}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

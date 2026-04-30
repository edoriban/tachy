import { FC, useState, useEffect, useRef } from 'react';
import type { ViewMode } from '@types';
import { HOME_PATH } from '@types';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    SearchIcon,
    GridIcon,
    ListIcon,
    RefreshIcon,
    CutIcon,
    CopyIcon,
    PasteIcon,
    RenameIcon,
    DeleteIcon,
    NewFolderIcon
} from '@utils/icons';

interface ToolbarProps {
    currentPath: string;
    canGoBack: boolean;
    canGoForward: boolean;
    viewMode: ViewMode;
    searchQuery: string;
    hasSelection: boolean;
    hasClipboard: boolean;
    showPreview: boolean;
    onBack: () => void;
    onForward: () => void;
    onUp: () => void;
    onRefresh: () => void;
    onNavigate: (path: string) => void;
    onViewModeChange: (mode: ViewMode) => void;
    onSearchChange: (query: string) => void;
    onNewFolder: () => void;
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onRename: () => void;
    onDelete: () => void;
    onTogglePreview: () => void;
}

interface NavButtonProps {
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    title: string;
}

const NavButton: FC<NavButtonProps> = ({ icon, onClick, disabled, title }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] 
      text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
      hover:bg-[var(--color-bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent 
      disabled:hover:text-[var(--color-text-secondary)] transition-all"
    >
        {icon}
    </button>
);

interface ActionButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
}

const ActionButton: FC<ActionButtonProps> = ({ icon, label, onClick, disabled, danger }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        className={`px-3 py-1.5 flex items-center gap-2 rounded-[var(--radius-md)] text-[12px] transition-all font-medium
      ${disabled
                ? 'opacity-30 cursor-not-allowed'
                : danger
                    ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] hover:bg-[rgba(239,68,68,0.1)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-hover)]'
            }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

export const Toolbar: FC<ToolbarProps> = ({
    currentPath,
    canGoBack,
    canGoForward,
    viewMode,
    searchQuery,
    hasSelection,
    hasClipboard,
    showPreview,
    onBack,
    onForward,
    onUp,
    onRefresh,
    onNavigate,
    onViewModeChange,
    onSearchChange,
    onNewFolder,
    onCut,
    onCopy,
    onPaste,
    onRename,
    onDelete,
    onTogglePreview,
}) => {
    const [pathInput, setPathInput] = useState(currentPath);
    const [isEditing, setIsEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isEditing) {
            // Keep the sentinel out of the editable input — show empty so the
            // user types a real path to leave Home.
            setPathInput(currentPath === HOME_PATH ? '' : currentPath);
        }
    }, [currentPath, isEditing]);

    const handlePathSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (pathInput.trim()) {
            onNavigate(pathInput.trim());
            setIsEditing(false);
        }
    };

    const handlePathKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setPathInput(currentPath);
            setIsEditing(false);
            inputRef.current?.blur();
        }
    };

    // Parse breadcrumbs. The virtual Home path is rendered as a single
    // "Home" pill rather than its sentinel string.
    const isHome = currentPath === HOME_PATH;
    const breadcrumbs = isHome ? ['Home'] : currentPath.split('\\').filter(Boolean);

    return (
        <div className="flex flex-col">
            {/* Main toolbar row (Navigation + Address + Search) */}
            <header className="toolbar">
                {/* Navigation */}
                <div className="flex items-center gap-1">
                    <NavButton icon={<ChevronLeftIcon size={18} />} onClick={onBack} disabled={!canGoBack} title="Back" />
                    <NavButton icon={<ChevronRightIcon size={18} />} onClick={onForward} disabled={!canGoForward} title="Forward" />
                    <NavButton icon={<ChevronUpIcon size={18} />} onClick={onUp} title="Up" />
                    <NavButton icon={<RefreshIcon size={16} />} onClick={onRefresh} title="Refresh" />
                </div>

                {/* Breadcrumb / Path */}
                <div className="flex-1 min-w-0 mx-2">
                    {isEditing ? (
                        <form onSubmit={handlePathSubmit} className="w-full">
                            <input
                                ref={inputRef}
                                type="text"
                                value={pathInput}
                                onChange={(e) => setPathInput(e.target.value)}
                                onBlur={() => {
                                    setTimeout(() => {
                                        setIsEditing(false);
                                        setPathInput(currentPath);
                                    }, 150);
                                }}
                                onKeyDown={handlePathKeyDown}
                                className="address-bar w-full text-[13px] text-[var(--color-text-primary)]"
                                autoFocus
                                spellCheck={false}
                            />
                        </form>
                    ) : (
                        <div
                            onClick={() => setIsEditing(true)}
                            className="address-bar cursor-text overflow-hidden"
                        >
                            <div className="flex items-center h-full">
                                <div className="flex items-center px-1 text-[var(--color-text-muted)] mr-1">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                        <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </div>
                                {breadcrumbs.map((segment, index) => (
                                    <div key={index} className="flex items-center flex-shrink-0">
                                        {index > 0 && (
                                            <ChevronRightIcon size={12} className="mx-1 text-[var(--color-text-muted)] flex-shrink-0" />
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (isHome) {
                                                    onNavigate(HOME_PATH);
                                                    return;
                                                }
                                                const path = breadcrumbs.slice(0, index + 1).join('\\') + '\\';
                                                onNavigate(path);
                                            }}
                                            className="px-1.5 py-0.5 text-[13px] text-[var(--color-text-secondary)] rounded-[var(--radius-sm)]
                        hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                                        >
                                            {segment}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="relative w-56">
                    <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search"
                        className="address-bar w-full pl-10 pr-3 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                    />
                </div>
            </header>

            {/* Command Bar (New, Cut, Copy, etc.) */}
            <div className="h-10 flex items-center gap-2 px-4 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)]">
                <ActionButton
                    icon={<NewFolderIcon size={16} />}
                    label="New"
                    onClick={onNewFolder}
                />

                <div className="w-px h-5 bg-[var(--color-border)] mx-2" />

                <ActionButton icon={<CutIcon size={16} />} label="Cut" onClick={onCut} disabled={!hasSelection} />
                <ActionButton icon={<CopyIcon size={16} />} label="Copy" onClick={onCopy} disabled={!hasSelection} />
                <ActionButton icon={<PasteIcon size={16} />} label="Paste" onClick={onPaste} disabled={!hasClipboard} />
                <ActionButton icon={<RenameIcon size={16} />} label="Rename" onClick={onRename} disabled={!hasSelection} />
                <ActionButton icon={<DeleteIcon size={16} />} label="Delete" onClick={onDelete} disabled={!hasSelection} danger />

                <div className="flex-1" />

                {/* View toggle */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onViewModeChange('list')}
                        className={`w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] transition-colors ${viewMode === 'list'
                            ? 'bg-[var(--color-bg-hover)] text-[var(--color-accent)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                            }`}
                        title="List view"
                    >
                        <ListIcon size={16} />
                    </button>
                    <button
                        onClick={() => onViewModeChange('grid')}
                        className={`w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] transition-colors ${viewMode === 'grid'
                            ? 'bg-[var(--color-bg-hover)] text-[var(--color-accent)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                            }`}
                        title="Grid view"
                    >
                        <GridIcon size={16} />
                    </button>

                    <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

                    {/* Preview panel toggle */}
                    <button
                        onClick={onTogglePreview}
                        className={`w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] transition-colors ${showPreview
                            ? 'bg-[var(--color-bg-hover)] text-[var(--color-accent)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                            }`}
                        title="Preview pane"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="15" y1="3" x2="15" y2="21" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

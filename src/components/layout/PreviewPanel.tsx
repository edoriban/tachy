// PreviewPanel component - shows file preview and metadata
// Displays on the right side when a file is selected

import { FC, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, CloudSyncState } from '@types';
import { formatSize, getFileType } from '@utils/format';
import { Thumbnail } from '../file-browser/Thumbnail';
import { CloudBadge } from '../file-browser/CloudBadge';

// Extract parent directory from a Windows-style absolute path.
// Example: "C:\\Users\\Edgar\\Pictures\\photo.jpg" -> "C:\\Users\\Edgar\\Pictures"
const getParentPath = (fullPath: string): string => {
    if (!fullPath) return '';
    // Handle both backslash and forward slash; normalize to backslash for display.
    const normalized = fullPath.replace(/\//g, '\\');
    const lastSlash = normalized.lastIndexOf('\\');
    if (lastSlash <= 2) {
        // Path is at drive root (e.g., "C:\\file") — parent is the drive itself.
        return normalized.slice(0, Math.max(lastSlash + 1, 3));
    }
    return normalized.slice(0, lastSlash);
};

// Availability label derived from the Windows Cloud Files API state.
const getAvailabilityLabel = (state: CloudSyncState): string => {
    switch (state) {
        case 'synced':
            return 'Available on this device';
        case 'syncing':
            return 'Syncing…';
        case 'online-only':
            return 'Online only';
        case 'error':
            return 'Sync error';
    }
};

// Pretty-print the provider id Windows reports (e.g. "OneDrive!Personal").
const formatProvider = (provider: string): string => {
    // Provider ids look like "OneDrive!Personal" or "GoogleDriveFS!".
    const head = provider.split('!')[0]?.trim();
    if (!head) return provider;
    if (/^onedrive$/i.test(head)) return 'OneDrive';
    if (/^googledrive(fs)?$/i.test(head)) return 'Google Drive';
    if (/^icloud/i.test(head)) return 'iCloud';
    if (/^dropbox/i.test(head)) return 'Dropbox';
    return head;
};

interface PreviewPanelProps {
    file: FileEntry | null;
    isVisible: boolean;
    onClose: () => void;
}

interface FilePreviewData {
    content?: string;
    lineCount?: number;
    isTruncated?: boolean;
}

// Image extensions that can be previewed
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico', 'svg'];

// Video extensions that can show thumbnails
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'];

// Text extensions that can be previewed
const TEXT_EXTENSIONS = [
    'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'xml',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'sh', 'bat', 'ps1',
    'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'swift',
    'sql', 'graphql', 'vue', 'svelte', 'astro'
];

export const PreviewPanel: FC<PreviewPanelProps> = ({ file, isVisible, onClose }) => {
    const [previewData, setPreviewData] = useState<FilePreviewData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    // Auto-clear inline action messages after a moment.
    useEffect(() => {
        if (!actionMessage) return;
        const t = setTimeout(() => setActionMessage(null), 2400);
        return () => clearTimeout(t);
    }, [actionMessage]);

    const handleOpenProperties = async () => {
        if (!file) return;
        try {
            await invoke('show_native_properties', { path: file.path });
        } catch (err) {
            console.error('Failed to open properties dialog:', err);
            setActionMessage(`Could not open properties: ${String(err)}`);
        }
    };

    const handleShare = async () => {
        if (!file) return;
        try {
            await invoke('share_file_native', { path: file.path });
        } catch (err) {
            console.error('Failed to open share dialog:', err);
            setActionMessage(`Could not open share dialog: ${String(err)}`);
        }
    };

    // Load preview when file changes
    useEffect(() => {
        if (!file || file.is_dir) {
            setPreviewData(null);
            return;
        }

        const ext = file.extension.toLowerCase();

        // Only load text preview for text files
        if (TEXT_EXTENSIONS.includes(ext)) {
            loadTextPreview(file.path);
        } else {
            setPreviewData(null);
        }
    }, [file?.path]);

    const loadTextPreview = async (path: string) => {
        setIsLoading(true);
        setError(null);

        try {
            const result = await invoke<FilePreviewData>('read_file_preview', {
                path,
                maxLines: 100
            });
            setPreviewData(result);
        } catch (err) {
            setError(String(err));
            setPreviewData(null);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isVisible) return null;

    const ext = file?.extension?.toLowerCase() || '';
    const isImage = IMAGE_EXTENSIONS.includes(ext);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const isText = TEXT_EXTENSIONS.includes(ext);
    const hasLargeThumbnail = isImage || isVideo;

    return (
        <div className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between h-11 px-4 border-b border-[var(--color-border)]">
                <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    Preview
                </span>
                <button
                    onClick={onClose}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors"
                    title="Close preview"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {!file ? (
                <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-[13px] px-6">
                    <div className="text-center">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 opacity-40">
                            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M3 15l6-6 4 4 8-8" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                        <p>Select a file to preview</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    {/* File Icon/Thumbnail - centered with proper padding */}
                    <div className="pt-8 pb-6 flex justify-center">
                        <div className={`${hasLargeThumbnail ? 'w-44 h-44' : 'w-20 h-20'} flex items-center justify-center ${hasLargeThumbnail ? 'rounded-xl overflow-hidden bg-[var(--color-bg-base)] border border-[var(--color-border)] shadow-sm' : ''}`}>
                            <Thumbnail
                                path={file.path}
                                extension={file.extension}
                                isDir={file.is_dir}
                                size={hasLargeThumbnail ? 160 : 80}
                            />
                        </div>
                    </div>

                    {/* File Name - with better padding */}
                    <div className="px-5 pb-6 text-center">
                        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)] break-words leading-relaxed">
                            {file.name}
                        </h3>
                    </div>

                    {/* Separator */}
                    <div className="mx-5 border-t border-[var(--color-border)]" />

                    {/* Metadata - improved spacing */}
                    <div className="px-5 py-5">
                        <table className="w-full text-[12px]">
                            <tbody className="[&_tr]:h-8">
                                <tr>
                                    <td className="text-[var(--color-text-muted)] align-middle">Type</td>
                                    <td className="text-[var(--color-text-secondary)] text-right align-middle">
                                        {getFileType(file.extension, file.is_dir)}
                                    </td>
                                </tr>
                                <tr>
                                    <td className="text-[var(--color-text-muted)] align-middle whitespace-nowrap pr-3">File location</td>
                                    <td className="text-[var(--color-text-secondary)] text-right align-middle truncate max-w-0" title={getParentPath(file.path)}>
                                        {getParentPath(file.path) || '-'}
                                    </td>
                                </tr>
                                {!file.is_dir && (
                                    <tr>
                                        <td className="text-[var(--color-text-muted)] align-middle">Size</td>
                                        <td className="text-[var(--color-text-secondary)] text-right align-middle">
                                            {formatSize(file.size)}
                                        </td>
                                    </tr>
                                )}
                                <tr>
                                    <td className="text-[var(--color-text-muted)] align-middle whitespace-nowrap pr-3">Date modified</td>
                                    <td className="text-[var(--color-text-secondary)] text-right align-middle">
                                        {file.modified || '-'}
                                    </td>
                                </tr>
                                <tr>
                                    <td className="text-[var(--color-text-muted)] align-middle whitespace-nowrap pr-3">Date created</td>
                                    <td className="text-[var(--color-text-secondary)] text-right align-middle">
                                        {file.created || '-'}
                                    </td>
                                </tr>
                                {previewData?.lineCount && (
                                    <tr>
                                        <td className="text-[var(--color-text-muted)] align-middle">Lines</td>
                                        <td className="text-[var(--color-text-secondary)] text-right align-middle">
                                            {previewData.lineCount}{previewData.isTruncated ? '+' : ''}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Availability status — only for items in a cloud-provider namespace. */}
                    {file.cloud_provider && (
                        <>
                            <div className="mx-5 border-t border-[var(--color-border)]" />
                            <div className="px-5 py-4">
                                <div className="text-[11px] text-[var(--color-text-muted)] mb-2 font-medium uppercase tracking-wide">
                                    Availability status
                                </div>
                                <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                                    <CloudBadge syncState={file.sync_state} size={14} />
                                    <span>
                                        {file.sync_state
                                            ? getAvailabilityLabel(file.sync_state)
                                            : 'Status unavailable'}
                                    </span>
                                </div>
                                <div className="text-[11px] text-[var(--color-text-muted)] mt-1 ml-[22px]">
                                    via {formatProvider(file.cloud_provider)}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Separator */}
                    <div className="mx-5 border-t border-[var(--color-border)]" />

                    {/* Recent Activity (placeholder) */}
                    <div className="px-5 py-4">
                        <div className="text-[11px] text-[var(--color-text-muted)] mb-2 font-medium uppercase tracking-wide">
                            Recent Activity
                        </div>
                        <div className="text-[12px] text-[var(--color-text-muted)] italic">
                            No recent activity for this item.
                        </div>
                    </div>

                    {/* Separator */}
                    <div className="mx-5 border-t border-[var(--color-border)]" />

                    {/* Action buttons (Share / Properties) — Share for any file (Windows share dialog handles all files); hidden for folders since verb "share" doesn't apply to directories. */}
                    <div className="px-5 py-4 flex items-center gap-2">
                        {!file.is_dir && (
                            <button
                                type="button"
                                onClick={handleShare}
                                className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-base)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
                                title="Open Windows share dialog"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="18" cy="5" r="3" />
                                    <circle cx="6" cy="12" r="3" />
                                    <circle cx="18" cy="19" r="3" />
                                    <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                                    <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                                </svg>
                                Share
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleOpenProperties}
                            className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-base)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
                            title="Open Windows properties dialog"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                            Properties
                        </button>
                    </div>

                    {actionMessage && (
                        <div className="px-5 -mt-2 pb-3">
                            <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-base)] border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                                {actionMessage}
                            </div>
                        </div>
                    )}

                    {/* Text Preview */}
                    {isText && (
                        <>
                            {/* Separator */}
                            <div className="mx-5 border-t border-[var(--color-border)]" />

                            <div className="px-5 py-4">
                                <div className="text-[11px] text-[var(--color-text-muted)] mb-3 font-medium uppercase tracking-wide">
                                    Content
                                </div>
                                <div className="rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border)] p-3 max-h-56 overflow-auto">
                                    {isLoading ? (
                                        <div className="text-[var(--color-text-muted)] text-[12px] flex items-center gap-2">
                                            <div className="w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                                            Loading...
                                        </div>
                                    ) : error ? (
                                        <div className="text-[var(--color-danger)] text-[12px]">
                                            {error}
                                        </div>
                                    ) : previewData?.content ? (
                                        <pre className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words font-mono leading-relaxed">
                                            {previewData.content}
                                        </pre>
                                    ) : (
                                        <div className="text-[var(--color-text-muted)] text-[12px]">
                                            No preview available
                                        </div>
                                    )}
                                </div>
                                {previewData?.isTruncated && (
                                    <div className="text-[11px] text-[var(--color-text-muted)] mt-2 text-center opacity-70">
                                        Showing first 100 lines...
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

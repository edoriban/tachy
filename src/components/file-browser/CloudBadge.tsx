// CloudBadge — small overlay badge displayed on top of a file/folder icon
// to signal Windows Cloud Files API sync state. Mirrors File Explorer's
// per-item indicators for OneDrive, iCloud, Google Drive Stream, Dropbox, etc.

import { FC } from 'react';
import type { CloudSyncState } from '@types';

interface CloudBadgeProps {
    syncState?: CloudSyncState | null;
    /** Outer badge size in px. Default 14. */
    size?: number;
    /** Optional accessible label override. */
    title?: string;
}

const labelFor = (state: CloudSyncState): string => {
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

export const CloudBadge: FC<CloudBadgeProps> = ({ syncState, size = 14, title }) => {
    if (!syncState) return null;

    const label = title ?? labelFor(syncState);
    const inner = Math.max(8, size - 2);

    // White ring around the badge so it stays visible over busy thumbnails,
    // matching Windows File Explorer's affordance.
    const wrapperClass =
        'inline-flex items-center justify-center rounded-full bg-[var(--color-bg-surface)] ring-1 ring-[var(--color-border)] shadow-sm';

    if (syncState === 'synced') {
        return (
            <span
                className={wrapperClass}
                style={{ width: size, height: size }}
                aria-label={label}
                title={label}
            >
                <svg
                    width={inner}
                    height={inner}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-500"
                    aria-hidden="true"
                >
                    <path d="M20 6L9 17l-5-5" />
                </svg>
            </span>
        );
    }

    if (syncState === 'syncing') {
        return (
            <span
                className={wrapperClass}
                style={{ width: size, height: size }}
                aria-label={label}
                title={label}
            >
                <svg
                    width={inner}
                    height={inner}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blue-500 animate-spin"
                    aria-hidden="true"
                >
                    <path d="M21 12a9 9 0 1 1-3-6.7" />
                    <path d="M21 4v5h-5" />
                </svg>
            </span>
        );
    }

    if (syncState === 'online-only') {
        return (
            <span
                className={wrapperClass}
                style={{ width: size, height: size }}
                aria-label={label}
                title={label}
            >
                <svg
                    width={inner}
                    height={inner}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blue-500"
                    aria-hidden="true"
                >
                    <path d="M17.5 19a4.5 4.5 0 1 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6.5 19h11z" />
                </svg>
            </span>
        );
    }

    // error
    return (
        <span
            className={wrapperClass}
            style={{ width: size, height: size }}
            aria-label={label}
            title={label}
        >
            <svg
                width={inner}
                height={inner}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-red-500"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
        </span>
    );
};

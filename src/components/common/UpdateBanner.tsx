// UpdateBanner
// -----------------------------------------------------------------------------
// Discreet horizontal strip rendered between the TabBar and the Toolbar when a
// newer release is available on GitHub. Designed to feel native to the app:
// uses the same surface tokens as the toolbar (slightly elevated), the cyan
// accent for the primary action, and a ghost dismiss. It deliberately avoids
// notification reds/yellows — updates are an opportunity, not an alarm.
//
// State lives entirely in `useAppUpdate`. The banner just renders it.

import { FC } from 'react';
import { useAppUpdate } from '@hooks';

export const UpdateBanner: FC = () => {
    const { update, downloading, progress, install, dismiss, dismissed } = useAppUpdate();

    if (!update || dismissed) return null;

    const pct = Math.round(progress * 100);

    return (
        <div
            role="status"
            aria-live="polite"
            className="relative flex items-center gap-3 px-4 py-1.5 text-[12px] border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]"
        >
            {/* Subtle download progress bar overlays the bottom edge. */}
            {downloading && (
                <div
                    className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-[var(--color-accent)] transition-[width] duration-150"
                    style={{ width: `${pct}%` }}
                    aria-hidden="true"
                />
            )}

            <span aria-hidden="true" className="text-[var(--color-accent)]">
                ↑
            </span>

            <span className="flex-1 truncate">
                {downloading ? (
                    <>
                        Downloading update <span className="text-[var(--color-text-secondary)]">v{update.version}</span>
                        {pct > 0 ? ` — ${pct}%` : '…'}
                    </>
                ) : (
                    <>
                        Update available: <span className="text-[var(--color-accent)]">v{update.version}</span>
                    </>
                )}
            </span>

            <button
                type="button"
                onClick={install}
                disabled={downloading}
                className="px-3 py-1 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-black font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Install &amp; restart
            </button>
            <button
                type="button"
                onClick={dismiss}
                disabled={downloading}
                className="px-3 py-1 rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Later
            </button>
        </div>
    );
};

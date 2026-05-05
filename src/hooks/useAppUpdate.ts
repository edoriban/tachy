// useAppUpdate
// -----------------------------------------------------------------------------
// One-shot update check on app launch via tauri-plugin-updater. Talks to the
// `latest.json` manifest hosted as a GitHub release asset (configured in
// `src-tauri/tauri.conf.json` -> plugins.updater.endpoints).
//
// Failure modes are deliberately silent: offline, missing pubkey in dev, or a
// 404 on the manifest must NEVER surface as an error to the user. Updates are
// a passive enhancement — the banner only appears on the happy path.
//
// React 19 strict-mode safety: the effect is guarded with a ref + a cancel
// flag so the dev-mode double-mount doesn't trigger two parallel `check()`
// calls (which would race and could double-download).

import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UseAppUpdateResult {
    update: Update | null;
    downloading: boolean;
    progress: number; // 0..1, only meaningful while downloading
    install: () => Promise<void>;
    dismiss: () => void;
    dismissed: boolean;
}

export function useAppUpdate(): UseAppUpdateResult {
    const [update, setUpdate] = useState<Update | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const checkedRef = useRef(false);

    useEffect(() => {
        // React 19 strict-mode guard: only ever fire one check per app launch.
        if (checkedRef.current) return;
        checkedRef.current = true;

        let cancelled = false;
        (async () => {
            try {
                const result = await check();
                if (cancelled) return;
                // `check()` resolves to `null` when no update is available.
                if (result) {
                    setUpdate(result);
                }
            } catch {
                // Swallow: offline, dev-mode without pubkey, server hiccup.
                // Updates are passive — never warn the user.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const install = useCallback(async () => {
        if (!update || downloading) return;
        setDownloading(true);
        setProgress(0);
        try {
            let total = 0;
            let downloaded = 0;
            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        total = event.data.contentLength ?? 0;
                        downloaded = 0;
                        setProgress(0);
                        break;
                    case 'Progress':
                        downloaded += event.data.chunkLength;
                        if (total > 0) {
                            setProgress(Math.min(1, downloaded / total));
                        }
                        break;
                    case 'Finished':
                        setProgress(1);
                        break;
                }
            });
            // After install, restart so the new binary takes over immediately.
            await relaunch();
        } catch {
            // Same silent policy as `check()`. If install fails (network drop,
            // signature mismatch, user closed elevation prompt), we just leave
            // the banner visible — the user can retry or dismiss.
            setDownloading(false);
        }
    }, [update, downloading]);

    const dismiss = useCallback(() => {
        setDismissed(true);
    }, []);

    return { update, downloading, progress, install, dismiss, dismissed };
}

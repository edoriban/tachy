// Pinned folders store using Zustand + persist (localStorage).
// Drives the Quick Access section in both the Sidebar and the HomeView.
//
// Storage shape (localStorage key `tachy-pinned-v1`):
//   { state: { pinnedPaths: string[], seeded: boolean }, version: 1 }
//
// `seeded` exists so first-launch population from `get_known_folders` runs
// exactly once. After the seed, an empty `pinnedPaths` is treated as a
// deliberate "user removed every pin" state and is NOT re-seeded.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PinnedState {
    pinnedPaths: string[];
    seeded: boolean;

    addPin: (path: string) => void;
    removePin: (path: string) => void;
    isPinned: (path: string) => boolean;
    /** Mark first-run seeding complete and replace the pin list in one shot. */
    seedDefaults: (paths: string[]) => void;
    /** Reorder a pin from index `from` to index `to` (drag-reorder). */
    reorder: (from: number, to: number) => void;
}

// Normalize Windows paths for stable equality (trailing slash + case).
const normalize = (path: string): string =>
    path.replace(/[\\/]+$/, '').toLowerCase();

export const usePinnedStore = create<PinnedState>()(
    persist(
        (set, get) => ({
            pinnedPaths: [],
            seeded: false,

            addPin: (path) => {
                const target = normalize(path);
                const { pinnedPaths } = get();
                if (pinnedPaths.some(p => normalize(p) === target)) return;
                set({ pinnedPaths: [...pinnedPaths, path] });
            },

            removePin: (path) => {
                const target = normalize(path);
                set({
                    pinnedPaths: get().pinnedPaths.filter(p => normalize(p) !== target),
                });
            },

            isPinned: (path) => {
                const target = normalize(path);
                return get().pinnedPaths.some(p => normalize(p) === target);
            },

            seedDefaults: (paths) => {
                set({ pinnedPaths: paths, seeded: true });
            },

            reorder: (from, to) => {
                const { pinnedPaths } = get();
                if (
                    from < 0 || from >= pinnedPaths.length ||
                    to < 0 || to >= pinnedPaths.length ||
                    from === to
                ) return;
                const next = [...pinnedPaths];
                const [item] = next.splice(from, 1);
                next.splice(to, 0, item);
                set({ pinnedPaths: next });
            },
        }),
        {
            name: 'tachy-pinned-v1',
            version: 1,
        }
    )
);

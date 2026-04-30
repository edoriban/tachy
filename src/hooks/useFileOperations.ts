// Hook for file operations
// Encapsulates copy, cut, paste, create folder, rename, delete operations
// Supports multi-selection with Shift+Click and Ctrl+Click

import { useCallback } from 'react';
import { fileService, systemService } from '@services';
import { useTabStore, useClipboardStore } from '@store';
import type { FileEntry } from '@types';
import { HOME_PATH } from '@types';

export type DialogType = 'newFolder' | 'rename' | 'delete' | 'properties' | null;

interface FileOperationsReturn {
    handleCopy: () => void;
    handleCut: () => void;
    handlePaste: () => Promise<void>;
    handleNewFolder: (name: string) => Promise<void>;
    handleRename: (newName: string) => Promise<void>;
    handleDelete: () => Promise<void>;
    handleSelect: (file: FileEntry, event: React.MouseEvent) => void;
    handleOpen: (file: FileEntry) => Promise<void>;
    handleSelectAll: () => void;
    goUp: () => Promise<void>;
}

export function useFileOperations(): FileOperationsReturn {
    const { activeTabId, setSelectedPaths, clearSelection, updateTabState, navigateTo } = useTabStore();
    const { copy, cut, clear } = useClipboardStore();

    // Get selected files from current state
    const getSelectedFiles = useCallback(() => {
        const currentState = useTabStore.getState().getCurrentState();
        const files = useTabStore.getState().getCurrentFiles();
        return files.filter(f => currentState.selectedPaths.includes(f.path));
    }, []);

    const handleCopy = useCallback(() => {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length > 0) {
            copy(selectedFiles);
        }
    }, [copy, getSelectedFiles]);

    const handleCut = useCallback(() => {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length > 0) {
            cut(selectedFiles);
        }
    }, [cut, getSelectedFiles]);

    const handlePaste = useCallback(async () => {
        const currentState = useTabStore.getState().getCurrentState();
        const clipboardState = useClipboardStore.getState().clipboard;
        if (!clipboardState) return;

        try {
            for (const item of clipboardState.items) {
                if (clipboardState.operation === 'copy') {
                    await fileService.copyItem(item.path, currentState.path);
                } else {
                    await fileService.moveItem(item.path, currentState.path);
                }
            }

            if (clipboardState.operation === 'cut') {
                clear();
            }

            useTabStore.getState().refresh();
        } catch (error) {
            updateTabState(activeTabId, { error: String(error) });
        }
    }, [activeTabId, clear, updateTabState]);

    const handleNewFolder = useCallback(async (name: string) => {
        const currentState = useTabStore.getState().getCurrentState();
        try {
            await fileService.createFolder(currentState.path, name);
            useTabStore.getState().refresh();
        } catch (error) {
            updateTabState(activeTabId, { error: String(error) });
        }
    }, [activeTabId, updateTabState]);

    const handleRename = useCallback(async (newName: string) => {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length !== 1) return; // Can only rename one file at a time

        const selectedFile = selectedFiles[0];
        try {
            await fileService.renameItem(selectedFile.path, newName);
            useTabStore.getState().refresh();
            clearSelection(activeTabId);
        } catch (error) {
            updateTabState(activeTabId, { error: String(error) });
        }
    }, [activeTabId, clearSelection, updateTabState, getSelectedFiles]);

    const handleDelete = useCallback(async () => {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) return;

        try {
            // Delete all selected files
            for (const file of selectedFiles) {
                await fileService.deleteItem(file.path);
            }
            useTabStore.getState().refresh();
            clearSelection(activeTabId);
        } catch (error) {
            updateTabState(activeTabId, { error: String(error) });
        }
    }, [activeTabId, clearSelection, updateTabState, getSelectedFiles]);

    const handleSelect = useCallback((file: FileEntry, event: React.MouseEvent) => {
        const currentState = useTabStore.getState().getCurrentState();
        const files = useTabStore.getState().getCurrentFiles();
        const { selectedPaths, lastSelectedPath } = currentState;

        if (event.shiftKey && lastSelectedPath) {
            // Shift+Click: Range selection
            const lastIndex = files.findIndex(f => f.path === lastSelectedPath);
            const currentIndex = files.findIndex(f => f.path === file.path);

            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);
                const rangePaths = files.slice(start, end + 1).map(f => f.path);

                // Combine with existing selection if Ctrl is also held
                if (event.ctrlKey || event.metaKey) {
                    const combined = [...new Set([...selectedPaths, ...rangePaths])];
                    setSelectedPaths(activeTabId, combined, file.path);
                } else {
                    setSelectedPaths(activeTabId, rangePaths, file.path);
                }
            }
        } else if (event.ctrlKey || event.metaKey) {
            // Ctrl+Click: Toggle selection
            if (selectedPaths.includes(file.path)) {
                const newPaths = selectedPaths.filter(p => p !== file.path);
                setSelectedPaths(activeTabId, newPaths, newPaths.length > 0 ? file.path : undefined);
            } else {
                setSelectedPaths(activeTabId, [...selectedPaths, file.path], file.path);
            }
        } else {
            // Normal click: Single selection
            setSelectedPaths(activeTabId, [file.path], file.path);
        }
    }, [activeTabId, setSelectedPaths]);

    const handleSelectAll = useCallback(() => {
        const files = useTabStore.getState().getCurrentFiles();
        const allPaths = files.map(f => f.path);
        setSelectedPaths(activeTabId, allPaths, allPaths.length > 0 ? allPaths[allPaths.length - 1] : undefined);
    }, [activeTabId, setSelectedPaths]);

    const handleOpen = useCallback(async (file: FileEntry) => {
        if (file.is_dir) {
            navigateTo(file.path);
        } else {
            try {
                const { openPath } = await import('@tauri-apps/plugin-opener');
                await openPath(file.path);
            } catch (error) {
                console.error('Failed to open file:', error);
                updateTabState(activeTabId, { error: `Failed to open: ${error}` });
            }
        }
    }, [activeTabId, navigateTo, updateTabState]);

    const goUp = useCallback(async () => {
        const currentState = useTabStore.getState().getCurrentState();
        // Home has no parent — bail before hitting Tauri.
        if (currentState.path === HOME_PATH) return;
        try {
            const parent = await systemService.getParentDirectory(currentState.path);
            if (parent && parent !== currentState.path) {
                navigateTo(parent);
            }
        } catch (error) {
            console.error('Failed to get parent:', error);
        }
    }, [navigateTo]);

    return {
        handleCopy,
        handleCut,
        handlePaste,
        handleNewFolder,
        handleRename,
        handleDelete,
        handleSelect,
        handleOpen,
        handleSelectAll,
        goUp,
    };
}

// Hook for context menu handling
// Manages native Tauri context menu integration. Now also handles pinning a
// folder to / unpinning a folder from Quick Access.

import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { systemService } from '@services';
import { useTabStore, useClipboardStore, usePinnedStore } from '@store';
import { useFileOperations, type DialogType } from './useFileOperations';
import type { FileEntry } from '@types';

interface ContextMenuOptions {
    setDialog: (dialog: DialogType) => void;
}

interface ContextMenuReturn {
    handleContextMenu: (e: React.MouseEvent, file: FileEntry) => Promise<void>;
    handleBackgroundContextMenu: (e: React.MouseEvent) => Promise<void>;
    contextFileRef: React.MutableRefObject<FileEntry | null>;
}

export function useContextMenu({ setDialog }: ContextMenuOptions): ContextMenuReturn {
    const contextFileRef = useRef<FileEntry | null>(null);
    const { handleOpen, handleCut, handleCopy, handlePaste } = useFileOperations();
    const { activeTabId, setSelectedPaths, getCurrentState } = useTabStore();
    const hasClipboard = useClipboardStore((s) => s.clipboard !== null);
    const { addPin, removePin, isPinned } = usePinnedStore();

    // Handle right-click on file
    const handleContextMenu = useCallback(async (e: React.MouseEvent, file: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();

        setSelectedPaths(activeTabId, [file.path], file.path);
        contextFileRef.current = file;

        try {
            await systemService.showContextMenu({
                x: e.clientX,
                y: e.clientY,
                filePath: file.path,
                isFile: !file.is_dir,
                hasClipboard,
                isDir: file.is_dir,
                isPinned: file.is_dir ? isPinned(file.path) : false,
            });
        } catch (error) {
            console.error('Failed to show context menu:', error);
        }
    }, [activeTabId, setSelectedPaths, hasClipboard, isPinned]);

    // Handle right-click on background
    const handleBackgroundContextMenu = useCallback(async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        contextFileRef.current = null;

        try {
            await systemService.showContextMenu({
                x: e.clientX,
                y: e.clientY,
                filePath: null,
                isFile: false,
                hasClipboard,
                isDir: false,
                isPinned: false,
            });
        } catch (error) {
            console.error('Failed to show context menu:', error);
        }
    }, [hasClipboard]);

    // Store handlers in ref to avoid recreating listener on every render.
    // The pin/unpin actions also live here so the Tauri menu callback can
    // see the current store implementation.
    const handlersRef = useRef({
        handleOpen,
        handleCut,
        handleCopy,
        handlePaste,
        getCurrentState,
        addPin,
        removePin,
    });

    useEffect(() => {
        handlersRef.current = {
            handleOpen,
            handleCut,
            handleCopy,
            handlePaste,
            getCurrentState,
            addPin,
            removePin,
        };
    }, [handleOpen, handleCut, handleCopy, handlePaste, getCurrentState, addPin, removePin]);

    // Listen for context menu actions from Tauri
    useEffect(() => {
        let unlistenFn: (() => void) | null = null;
        let mounted = true;

        listen<string>('context-menu-action', async (event) => {
            if (!mounted) return;

            const action = event.payload;
            const file = contextFileRef.current;
            const handlers = handlersRef.current;

            console.log('[ContextMenu] Action received:', action, 'File:', file?.name);

            switch (action) {
                case 'open':
                    if (file) handlers.handleOpen(file);
                    break;
                case 'cut':
                    if (file) handlers.handleCut();
                    break;
                case 'copy':
                    if (file) handlers.handleCopy();
                    break;
                case 'paste':
                    handlers.handlePaste();
                    break;
                case 'new_folder':
                    setDialog('newFolder');
                    break;
                case 'rename':
                    if (file) setDialog('rename');
                    break;
                case 'delete':
                    if (file) setDialog('delete');
                    break;
                case 'open_terminal':
                    try {
                        const currentPath = handlers.getCurrentState().path;
                        await systemService.openInTerminal(file?.is_dir ? file.path : currentPath);
                    } catch (error) {
                        console.error('Failed to open terminal:', error);
                    }
                    break;
                case 'pin_quick_access':
                    if (file && file.is_dir) handlers.addPin(file.path);
                    break;
                case 'unpin_quick_access':
                    if (file) handlers.removePin(file.path);
                    break;
                case 'properties':
                    if (file) {
                        try {
                            await systemService.showNativeProperties(file.path);
                        } catch (error) {
                            console.error('Failed to show properties:', error);
                        }
                    }
                    break;
            }
        }).then((fn) => {
            if (mounted) unlistenFn = fn;
        });

        return () => {
            mounted = false;
            if (unlistenFn) unlistenFn();
        };
    }, [setDialog]);

    return {
        handleContextMenu,
        handleBackgroundContextMenu,
        contextFileRef,
    };
}

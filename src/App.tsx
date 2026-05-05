// Tachy - Main Application
// Refactored with SOLID principles using Zustand for state management

import { useState, useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './App.css';

// Stores
import { useAppStore, useTabStore, useClipboardStore, useFolderPrefsStore, usePinnedStore } from '@store';

// Hooks
import { useFileOperations, useKeyboardShortcuts, useKeyboardNavigation, useContextMenu, type DialogType } from '@hooks';

// Services
import { systemService } from '@services';

// Types
import { HOME_PATH } from '@types';

// Components - organized by category
import {
  TabBar,
  Sidebar,
  Toolbar,
  FileGrid,
  FileList,
  HomeView,
  PreviewPanel,
  InputDialog,
  ConfirmDialog,
  PropertiesDialog,
  UpdateBanner
} from '@components';

function App() {
  // Dialog state (local since it's UI-only)
  const [dialog, setDialog] = useState<DialogType>(null);

  // Preview panel state
  const [showPreview, setShowPreview] = useState(false);

  // App store
  const { drives, initialize } = useAppStore();

  // Folder preferences store
  const { getPrefs, setViewMode: saveFolderViewMode } = useFolderPrefsStore();

  // Get viewMode from folder prefs or default to 'grid'
  const currentPath = useTabStore((s) => s.getCurrentState().path);
  const folderPrefs = getPrefs(currentPath);
  const viewMode = folderPrefs?.viewMode || 'grid';

  // Tab store
  const {
    tabs,
    activeTabId,
    setActiveTab,
    addTab,
    closeTab,
    getCurrentState,
    getCurrentFiles,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    navigateTo,
    searchFiles,
    refresh,
    initializeFirstTab,
  } = useTabStore();

  // Clipboard store
  const clipboard = useClipboardStore((s) => s.clipboard);

  // Custom hooks
  const {
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
  } = useFileOperations();

  const { handleContextMenu, handleBackgroundContextMenu } = useContextMenu({ setDialog });

  useKeyboardShortcuts({
    dialog,
    setDialog,
    onNewTab: () => addTab(getCurrentState().path),
    onCloseTab: () => closeTab(activeTabId),
  });

  // Keyboard navigation for file browser
  useKeyboardNavigation({
    onOpen: handleOpen,
    onGoUp: goUp,
    onDeleteRequest: () => setDialog('delete'),
    onRenameRequest: () => setDialog('rename'),
    onSelectAll: handleSelectAll,
    isDialogOpen: dialog !== null,
  });

  // Get current state
  const currentState = getCurrentState();
  const currentFiles = getCurrentFiles();

  // Initialize app
  useEffect(() => {
    const init = async () => {
      await initialize();

      // First-launch pin seed: if the persistent store has never been seeded,
      // populate it with the Win32 known folders (Desktop, Downloads, etc.)
      // resolved via SHGetKnownFolderPath. This recovers the previous
      // hardcoded sidebar behavior while letting the user unpin any of them.
      const { seeded, seedDefaults } = usePinnedStore.getState();
      if (!seeded) {
        try {
          const known = await systemService.getKnownFolders();
          const ordered = ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos']
            .map((name) => known[name])
            .filter((p): p is string => typeof p === 'string' && p.length > 0);
          seedDefaults(ordered);
        } catch (err) {
          console.error('[App] failed to seed default pins', err);
          // Mark seeded anyway to avoid hammering the command on every launch.
          seedDefaults([]);
        }
      }

      // Open the virtual Home view as the initial tab. All actual locations
      // (Desktop, drives, etc.) are reachable from the sidebar.
      initializeFirstTab(HOME_PATH);
    };
    init();
  }, []);

  // Single-instance bridge: a second `tachy.exe` launch is intercepted by the
  // tauri-plugin-single-instance Rust callback, which emits `single-instance`
  // here with the new process's argv + cwd. We open the requested path as a
  // new tab in this (existing) window so users get Explorer-style multi-tab
  // behavior instead of multiple processes / tray icons.
  //
  // argv[0] is the exe path; meaningful args start at argv[1]. We pick the
  // first non-flag positional arg as the target path. If absent, we fall back
  // to HOME_PATH so the new tab is always non-empty.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<{ argv: string[]; cwd: string }>('single-instance', (event) => {
      const { argv } = event.payload;
      const pathArg = argv.slice(1).find((a) => !a.startsWith('-'));
      const targetPath = pathArg && pathArg.length > 0 ? pathArg : HOME_PATH;
      // Reuse the existing tab store action; identical to Ctrl+T behavior.
      useTabStore.getState().addTab(targetPath);
    }).then((fn) => {
      // React 19 strict mode double-invokes effects in dev. If the cleanup
      // already ran before listen() resolved, drop this stale subscription
      // immediately rather than leaking a duplicate listener.
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Get selected files from current files
  const selectedFiles = currentFiles.filter(f => currentState.selectedPaths.includes(f.path));
  const selectedFile = selectedFiles.length === 1 ? selectedFiles[0] : null;

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)]">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={setActiveTab}
        onTabClose={closeTab}
        onNewTab={() => addTab(currentState.path)}
      />

      {/* Update banner — only renders when a newer release is available.
          Hooks into tauri-plugin-updater on mount; silent on failure. */}
      <UpdateBanner />

      {/* Toolbar */}
      <Toolbar
        currentPath={currentState.path}
        canGoBack={canGoBack()}
        canGoForward={canGoForward()}
        viewMode={viewMode}
        searchQuery={currentState.searchQuery}
        hasSelection={currentState.selectedPaths.length > 0}
        hasClipboard={!!clipboard}
        showPreview={showPreview}
        onBack={goBack}
        onForward={goForward}
        onUp={goUp}
        onRefresh={refresh}
        onNavigate={navigateTo}
        onViewModeChange={(mode) => saveFolderViewMode(currentState.path, mode)}
        onSearchChange={searchFiles}
        onNewFolder={() => setDialog('newFolder')}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onRename={() => setDialog('rename')}
        onDelete={() => setDialog('delete')}
        onTogglePreview={() => setShowPreview(!showPreview)}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          drives={drives}
          currentPath={currentState.path}
          onNavigate={navigateTo}
          onPinContextMenu={handleContextMenu}
        />

        {/* Main content */}
        <main
          className="relative flex-1 flex flex-col overflow-hidden file-area"
          onContextMenu={handleBackgroundContextMenu}
        >
          {/* Search indicator */}
          {currentState.isSearching && (
            <div className="px-4 py-2 bg-[var(--color-bg-elevated)] border-b border-[var(--color-divider)] text-[12px] text-[var(--color-text-secondary)]">
              Search results for "<span className="text-[var(--color-accent)]">{currentState.searchQuery}</span>"
            </div>
          )}

          {/* Error */}
          {currentState.error && (
            <div className="px-4 py-2 bg-[rgba(248,81,73,0.1)] border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-[12px] flex items-center justify-between">
              <span>{currentState.error}</span>
              <button
                onClick={() => useTabStore.getState().updateTabState(activeTabId, { error: null })}
                className="hover:opacity-70"
              >
                ✕
              </button>
            </div>
          )}

          {/* Top progress bar while loading — overlays content WITHOUT hiding it.
              Stale entries from the previous folder remain visible until the new
              fetch resolves, eliminating the blank-flash between folders. */}
          {currentState.isLoading && (
            <div
              className="pointer-events-none absolute top-0 left-0 right-0 h-[2px] z-10 overflow-hidden"
              aria-hidden="true"
            >
              <div className="h-full w-1/3 bg-[var(--color-accent)] tachy-loading-bar" />
            </div>
          )}

          {/* Files (or virtual Home aggregator).
              While loading with no stale data (genuine first-time load on this tab),
              suppress the "empty folder" placeholder — the top progress bar alone
              communicates the in-flight fetch. */}
          {currentState.path === HOME_PATH ? (
            <HomeView
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
            />
          ) : currentState.isLoading && currentFiles.length === 0 ? (
            <div className="flex-1" />
          ) : viewMode === 'grid' ? (
            <FileGrid
              files={currentFiles}
              selectedPaths={currentState.selectedPaths}
              onSelect={handleSelect}
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <FileList
              files={currentFiles}
              selectedPaths={currentState.selectedPaths}
              sortBy={currentState.sortBy}
              sortOrder={currentState.sortOrder}
              onSort={(column) => {
                const newOrder = currentState.sortBy === column && currentState.sortOrder === 'asc' ? 'desc' : 'asc';
                useTabStore.getState().updateTabState(activeTabId, { sortBy: column, sortOrder: newOrder });
              }}
              onSelect={handleSelect}
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
            />
          )}

          {/* Status bar */}
          <footer className="h-6 flex items-center px-4 bg-[var(--color-bg-base)] border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
            <span>{currentState.path === HOME_PATH ? 'Home' : `${currentFiles.length} items`}</span>
            {selectedFiles.length > 0 && (
              <>
                <span className="mx-2">|</span>
                <span className="truncate">
                  {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} items selected`}
                </span>
              </>
            )}
            {clipboard && (
              <>
                <span className="flex-1" />
                <span className="text-[var(--color-accent)]">
                  {clipboard.operation === 'copy' ? 'Copied' : 'Cut'}: {clipboard.items.length} item(s)
                </span>
              </>
            )}
          </footer>
        </main>

        {/* Preview Panel */}
        <PreviewPanel
          file={selectedFile}
          isVisible={showPreview}
          onClose={() => setShowPreview(false)}
        />
      </div>

      {/* Dialogs */}
      {dialog === 'newFolder' && (
        <InputDialog
          title="New Folder"
          placeholder="Folder name"
          confirmLabel="Create"
          onConfirm={(name) => {
            handleNewFolder(name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'rename' && selectedFile && (
        <InputDialog
          title="Rename"
          initialValue={selectedFile.name}
          confirmLabel="Rename"
          onConfirm={(newName) => {
            handleRename(newName);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'delete' && selectedFile && (
        <ConfirmDialog
          title="Delete"
          message={`Are you sure you want to delete "${selectedFile.name}"?`}
          confirmLabel="Delete"
          confirmDanger
          onConfirm={() => {
            handleDelete();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'properties' && selectedFile && (
        <PropertiesDialog
          file={selectedFile}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default App;

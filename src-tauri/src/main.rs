// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Local};
use image::ImageFormat;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Sync state for files managed by a Windows Cloud Files API provider
/// (OneDrive, iCloud Drive, Google Drive Stream, Dropbox, etc.)
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CloudSyncState {
    /// File is fully hydrated and locally available.
    Synced,
    /// File is currently syncing/hydrating (download or upload in progress).
    Syncing,
    /// File is a placeholder; data lives in the cloud.
    OnlineOnly,
    /// Sync error reported by the provider.
    Error,
}

/// Represents a file or directory entry
#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub created: String,
    pub extension: String,
    pub is_cloud_placeholder: bool, // legacy: derived from sync_state == OnlineOnly when present
    /// Storage provider id when known (e.g. "OneDrive!Personal", "iCloud!", "GoogleDriveFS!").
    /// `None` for regular local files outside any cloud namespace.
    pub cloud_provider: Option<String>,
    /// High-level sync state from the Cloud Files API. `None` for non-cloud items.
    pub sync_state: Option<CloudSyncState>,
}

/// Format a SystemTime into a "YYYY-MM-DD HH:MM" local string, or "-" on error
fn format_system_time(time: std::io::Result<std::time::SystemTime>) -> String {
    time.map(|t| {
        let datetime: DateTime<Local> = t.into();
        datetime.format("%Y-%m-%d %H:%M").to_string()
    })
    .unwrap_or_else(|_| String::from("-"))
}

/// Represents a drive on the system
#[derive(Serialize)]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub total_space: u64,
    pub free_space: u64,
}

/// Check if a file is a cloud placeholder (not fully downloaded)
/// Uses FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (0x00400000)
#[cfg(target_os = "windows")]
fn is_cloud_placeholder(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x00400000;
    (metadata.file_attributes() & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
}

#[cfg(not(target_os = "windows"))]
fn is_cloud_placeholder(_metadata: &std::fs::Metadata) -> bool {
    false
}

/// Quick path-prefix check: skip COM querying for paths that obviously aren't
/// inside any cloud-provider namespace. Falls back to attribute-based heuristic
/// (FILE_ATTRIBUTE_RECALL_*) when we don't recognize the prefix.
#[cfg(target_os = "windows")]
fn looks_like_cloud_root(path: &Path) -> bool {
    let path_str = path.to_string_lossy().to_lowercase();
    // Common provider folder names we see under %USERPROFILE% (or other roots).
    [
        "\\onedrive",
        "\\onedrive - ",
        "\\icloud",
        "\\icloudphotos",
        "\\google drive",
        "\\googledrive",
        "\\my drive",
        "\\dropbox",
        "\\box",
    ]
    .iter()
    .any(|needle| path_str.contains(needle))
}

#[cfg(target_os = "windows")]
fn metadata_has_cloud_attrs(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // RECALL_ON_DATA_ACCESS | RECALL_ON_OPEN
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x00400000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x00040000;
    const FILE_ATTRIBUTE_PINNED: u32 = 0x00080000;
    const FILE_ATTRIBUTE_UNPINNED: u32 = 0x00100000;
    let attrs = metadata.file_attributes();
    (attrs
        & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_PINNED
            | FILE_ATTRIBUTE_UNPINNED))
        != 0
}

/// Query the Windows Cloud Files API (Shell PropertyStore) for the cloud
/// provider id and high-level sync state of `path`.
///
/// Returns `(None, None)` for items that are not part of any cloud namespace.
/// Errors from missing properties are swallowed — they just indicate a
/// non-cloud item, which is the common case.
#[cfg(target_os = "windows")]
fn get_cloud_status(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> (Option<String>, Option<CloudSyncState>) {
    // Fast path: if the path doesn't look like a known cloud root AND has no
    // recall/pin attributes, skip the COM call. This matters for large local
    // directory listings.
    if !looks_like_cloud_root(path) && !metadata_has_cloud_attrs(metadata) {
        return (None, None);
    }

    use windows::core::{GUID, PCWSTR};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
    use windows::Win32::UI::Shell::{IShellItem2, SHCreateItemFromParsingName};

    // PKEY definitions from propkey.h.
    // PKEY_FilePlaceholderStatus  {B2F9B9D6-FEC4-4DD5-94D7-8957488C807B}, 2  (UInt32)
    // PKEY_StorageProviderId      {FCEFF153-E839-4CF3-A9E7-EA22832094B8}, 108 (String)
    // PKEY_StorageProviderState   {E77E90DF-6271-4F5B-834F-2DD1F245DDA4}, 3  (UInt32)
    const PKEY_FILE_PLACEHOLDER_STATUS: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xB2F9B9D6_FEC4_4DD5_94D7_8957488C807B),
        pid: 2,
    };
    const PKEY_STORAGE_PROVIDER_ID: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xFCEFF153_E839_4CF3_A9E7_EA22832094B8),
        pid: 108,
    };
    const PKEY_STORAGE_PROVIDER_STATE: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xE77E90DF_6271_4F5B_834F_2DD1F245DDA4),
        pid: 3,
    };

    // PLACEHOLDER_STATES bits (from windows::Win32::UI::Shell::PropertiesSystem):
    //  PS_MARKED_FOR_OFFLINE_AVAILABILITY = 1
    //  PS_FULL_PRIMARY_STREAM_AVAILABLE   = 2
    //  PS_CREATE_FILE_ACCESSIBLE          = 4
    //  PS_CLOUDFILE_PLACEHOLDER           = 8
    const PS_FULL_PRIMARY_STREAM_AVAILABLE: u32 = 2;
    const PS_CLOUDFILE_PLACEHOLDER: u32 = 8;

    // STORAGEPROVIDERSTATE values
    const STORAGEPROVIDERSTATE_IN_SYNC: u32 = 2;
    const STORAGEPROVIDERSTATE_PINNED: u32 = 3;
    const STORAGEPROVIDERSTATE_PENDING_UPLOAD: u32 = 4;
    const STORAGEPROVIDERSTATE_PENDING_DOWNLOAD: u32 = 5;
    const STORAGEPROVIDERSTATE_TRANSFERRING: u32 = 6;
    const STORAGEPROVIDERSTATE_ERROR: u32 = 7;

    unsafe {
        // Existing commands rely on this being initialized; calling again is safe
        // (it returns S_FALSE/RPC_E_CHANGED_MODE — both ignored here).
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let wide: Vec<u16> = path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let item: IShellItem2 =
            match SHCreateItemFromParsingName(PCWSTR::from_raw(wide.as_ptr()), None) {
                Ok(it) => it,
                Err(_) => return (None, None),
            };

        // Provider id (string). Absence is normal for local files.
        let provider = match item.GetString(&PKEY_STORAGE_PROVIDER_ID) {
            Ok(pwstr) if !pwstr.is_null() => {
                let s = pwstr.to_string().ok();
                // SHStrDupW-allocated; release with CoTaskMemFree.
                windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as *const _));
                s
            }
            _ => None,
        };

        // Prefer FilePlaceholderStatus (most precise), fall back to StorageProviderState.
        let state = match item.GetUInt32(&PKEY_FILE_PLACEHOLDER_STATUS) {
            Ok(bits) => {
                if bits & PS_FULL_PRIMARY_STREAM_AVAILABLE != 0 {
                    Some(CloudSyncState::Synced)
                } else if bits & PS_CLOUDFILE_PLACEHOLDER != 0 {
                    Some(CloudSyncState::OnlineOnly)
                } else {
                    None
                }
            }
            Err(_) => None,
        };

        let state = match state {
            Some(s) => Some(s),
            None => match item.GetUInt32(&PKEY_STORAGE_PROVIDER_STATE) {
                Ok(v) => match v {
                    STORAGEPROVIDERSTATE_IN_SYNC | STORAGEPROVIDERSTATE_PINNED => {
                        Some(CloudSyncState::Synced)
                    }
                    STORAGEPROVIDERSTATE_PENDING_UPLOAD
                    | STORAGEPROVIDERSTATE_PENDING_DOWNLOAD
                    | STORAGEPROVIDERSTATE_TRANSFERRING => Some(CloudSyncState::Syncing),
                    STORAGEPROVIDERSTATE_ERROR => Some(CloudSyncState::Error),
                    _ => None,
                },
                Err(_) => None,
            },
        };

        // If we still have no state but file attributes say it's a recall placeholder,
        // we know enough to mark it OnlineOnly even without a provider id.
        let state = state.or_else(|| {
            if metadata_has_cloud_attrs(metadata) {
                Some(CloudSyncState::OnlineOnly)
            } else {
                None
            }
        });

        (provider, state)
    }
}

#[cfg(not(target_os = "windows"))]
fn get_cloud_status(
    _path: &Path,
    _metadata: &std::fs::Metadata,
) -> (Option<String>, Option<CloudSyncState>) {
    (None, None)
}

/// Helper to keep `is_cloud_placeholder` consistent with `sync_state` once we have it.
fn cloud_placeholder_flag(legacy: bool, state: &Option<CloudSyncState>) -> bool {
    match state {
        Some(CloudSyncState::OnlineOnly) => true,
        Some(_) => false,
        None => legacy,
    }
}

/// Read the contents of a directory
#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();

    let read_result = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_result {
        if let Ok(entry) = entry {
            if let Ok(metadata) = entry.metadata() {
                let modified = format_system_time(metadata.modified());
                let created = format_system_time(metadata.created());

                let extension = entry
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();

                let legacy_placeholder = is_cloud_placeholder(&metadata);
                let (cloud_provider, sync_state) = get_cloud_status(&entry.path(), &metadata);
                entries.push(FileEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified,
                    created,
                    extension,
                    is_cloud_placeholder: cloud_placeholder_flag(legacy_placeholder, &sync_state),
                    cloud_provider,
                    sync_state,
                });
            }
        }
    }

    // Sort: directories first, then by name (case-insensitive)
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Get all available drives on Windows
#[tauri::command]
fn get_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();

    // Check common drive letters on Windows
    for letter in 'A'..='Z' {
        let path = format!("{}:\\", letter);
        let path_obj = Path::new(&path);

        if path_obj.exists() {
            drives.push(DriveInfo {
                name: format!("Local Disk ({}:)", letter),
                path: path.clone(),
                total_space: 0,
                free_space: 0,
            });
        }
    }

    drives
}

/// Search for files matching a query
#[tauri::command]
fn search_files(
    path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let search_path = Path::new(&path);

    if !search_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let query_lower = query.to_lowercase();
    let max = max_results.unwrap_or(100);
    let mut results = Vec::new();

    for entry in WalkDir::new(search_path)
        .max_depth(5) // Limit depth for performance
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if results.len() >= max {
            break;
        }

        let file_name = entry.file_name().to_string_lossy().to_lowercase();

        if file_name.contains(&query_lower) {
            if let Ok(metadata) = entry.metadata() {
                let modified = format_system_time(metadata.modified());
                let created = format_system_time(metadata.created());

                let extension = entry
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();

                let legacy_placeholder = is_cloud_placeholder(&metadata);
                let (cloud_provider, sync_state) = get_cloud_status(entry.path(), &metadata);
                results.push(FileEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified,
                    created,
                    extension,
                    is_cloud_placeholder: cloud_placeholder_flag(legacy_placeholder, &sync_state),
                    cloud_provider,
                    sync_state,
                });
            }
        }
    }

    // Sort: directories first, then by name
    results.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(results)
}

/// Get the parent directory of a path
#[tauri::command]
fn get_parent_directory(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

/// Get quick access folders
#[tauri::command]
fn get_quick_access() -> Vec<FileEntry> {
    let mut folders = Vec::new();

    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home_path = Path::new(&home);

        let quick_folders = [
            ("Desktop", "Desktop"),
            ("Downloads", "Downloads"),
            ("Documents", "Documents"),
            ("Pictures", "Pictures"),
            ("Music", "Music"),
            ("Videos", "Videos"),
        ];

        for (name, folder) in quick_folders {
            let folder_path = home_path.join(folder);
            if folder_path.exists() {
                folders.push(FileEntry {
                    name: name.to_string(),
                    path: folder_path.to_string_lossy().to_string(),
                    is_dir: true,
                    size: 0,
                    modified: String::new(),
                    created: String::new(),
                    extension: String::new(),
                    is_cloud_placeholder: false, // Local folders are never cloud placeholders
                    cloud_provider: None,
                    sync_state: None,
                });
            }
        }
    }

    folders
}

/// Build a `FileEntry` for a folder path. Returns `None` if the path does not exist
/// or cannot be stat'd. Used by the pinned-folders / known-folders commands so the
/// frontend gets consistent metadata (name, sync state, etc.) for sidebar pins.
///
/// When `with_cloud_status` is false, the (potentially expensive) Cloud Files
/// API query is skipped — callers that don't render a CloudBadge (Home Quick
/// access cards, Sidebar pin rows) should pass false to keep folder lookups
/// snappy. The legacy placeholder fallback (file attribute bits) is still
/// honored, so `is_cloud_placeholder` stays roughly correct.
fn make_folder_entry(path: &Path, with_cloud_status: bool) -> Option<FileEntry> {
    if !path.exists() {
        return None;
    }
    let metadata = match path.metadata() {
        Ok(m) => m,
        Err(_) => return None,
    };
    if !metadata.is_dir() {
        return None;
    }

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let modified = format_system_time(metadata.modified());
    let created = format_system_time(metadata.created());
    let legacy_placeholder = is_cloud_placeholder(&metadata);
    let (cloud_provider, sync_state) = if with_cloud_status {
        get_cloud_status(path, &metadata)
    } else {
        (None, None)
    };

    Some(FileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        size: 0,
        modified,
        created,
        extension: String::new(),
        is_cloud_placeholder: cloud_placeholder_flag(legacy_placeholder, &sync_state),
        cloud_provider,
        sync_state,
    })
}

/// Resolve a list of folder paths (typically from the frontend pinnedStore) into
/// `FileEntry` records. Skips paths that no longer exist on disk so a deleted
/// pin simply disappears from the UI rather than rendering a dead row.
///
/// `with_cloud_status` (default true) controls whether each entry runs the
/// Cloud Files API query for sync badges. The Home view's Quick access cards
/// and the sidebar pinned rows don't render CloudBadge, so they pass `false`
/// to skip the COM round-trip per pin.
#[tauri::command]
fn get_folders_metadata(
    paths: Vec<String>,
    with_cloud_status: Option<bool>,
) -> Vec<FileEntry> {
    let with_cloud = with_cloud_status.unwrap_or(true);
    paths
        .into_iter()
        .filter_map(|p| make_folder_entry(Path::new(&p), with_cloud))
        .collect()
}

/// Resolve the canonical paths for the Win32 known folders we use as default
/// Quick Access pins. Returns a `name -> absolute path` map; entries are skipped
/// if the folder does not exist (covers users who relocated their Documents).
///
/// Uses `SHGetKnownFolderPath` on Windows for the canonical resolution; falls
/// back to `%USERPROFILE%\<name>` joins on other platforms (mostly for tests).
#[tauri::command]
fn get_known_folders() -> HashMap<String, String> {
    let mut map = HashMap::new();

    #[cfg(target_os = "windows")]
    {
        use windows::core::GUID;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::UI::Shell::{
            SHGetKnownFolderPath, FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads,
            FOLDERID_Music, FOLDERID_Pictures, FOLDERID_Videos, KNOWN_FOLDER_FLAG,
        };

        let entries: [(&str, GUID); 6] = [
            ("Desktop", FOLDERID_Desktop),
            ("Downloads", FOLDERID_Downloads),
            ("Documents", FOLDERID_Documents),
            ("Pictures", FOLDERID_Pictures),
            ("Music", FOLDERID_Music),
            ("Videos", FOLDERID_Videos),
        ];

        for (name, guid) in entries {
            unsafe {
                if let Ok(pwstr) =
                    SHGetKnownFolderPath(&guid, KNOWN_FOLDER_FLAG(0), HANDLE::default())
                {
                    if !pwstr.is_null() {
                        if let Ok(s) = pwstr.to_string() {
                            if Path::new(&s).exists() {
                                map.insert(name.to_string(), s);
                            }
                        }
                        windows::Win32::System::Com::CoTaskMemFree(Some(
                            pwstr.as_ptr() as *const _,
                        ));
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            let home_path = Path::new(&home);
            for name in &["Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos"] {
                let p = home_path.join(name);
                if p.exists() {
                    map.insert(name.to_string(), p.to_string_lossy().to_string());
                }
            }
        }
    }

    map
}

/// Resolve a Windows shortcut (.lnk) to its target absolute path using
/// IShellLink + IPersistFile. Returns `None` if the link is broken, the target
/// no longer exists, or this isn't a Windows build.
#[cfg(target_os = "windows")]
fn resolve_lnk_target(lnk_path: &Path) -> Option<PathBuf> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH};

    unsafe {
        // Idempotent — STA already initialized for thumbnail/share commands.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let shell_link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = shell_link.cast().ok()?;

        // Encode .lnk path as null-terminated UTF-16.
        let wide: Vec<u16> = lnk_path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        persist.Load(PCWSTR::from_raw(wide.as_ptr()), STGM_READ).ok()?;

        // Resolve target path. SLGP_RAWPATH avoids prompting for missing volumes.
        let mut buf = vec![0u16; 1024];
        let mut find_data = WIN32_FIND_DATAW::default();
        shell_link
            .GetPath(&mut buf, &mut find_data, SLGP_RAWPATH.0 as u32)
            .ok()?;

        // Strip the trailing null.
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        if len == 0 {
            return None;
        }
        let target = String::from_utf16_lossy(&buf[..len]);
        let target_path = PathBuf::from(target);
        if target_path.exists() {
            Some(target_path)
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_lnk_target(_lnk_path: &Path) -> Option<PathBuf> {
    None
}

/// Read the Windows "Recent" items folder (FOLDERID_Recent), resolve each .lnk
/// shortcut to its target file, and return up to `max` most recent targets.
///
/// Sort order is by the .lnk's own mtime (which is when Windows last touched
/// the shortcut for that file — i.e. when it was last accessed/opened), not
/// the target's mtime. Dead links are skipped.
#[tauri::command]
fn get_recent_files(max: Option<usize>) -> Result<Vec<FileEntry>, String> {
    let limit = max.unwrap_or(30);

    #[cfg(target_os = "windows")]
    let recent_dir: PathBuf = {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_Recent, KNOWN_FOLDER_FLAG};

        unsafe {
            let pwstr = SHGetKnownFolderPath(
                &FOLDERID_Recent,
                KNOWN_FOLDER_FLAG(0),
                HANDLE::default(),
            )
            .map_err(|e| format!("SHGetKnownFolderPath(Recent) failed: {}", e))?;

            if pwstr.is_null() {
                return Err("Recent folder path is null".to_string());
            }

            let s = pwstr.to_string().map_err(|e| e.to_string())?;
            windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as *const _));
            PathBuf::from(s)
        }
    };

    #[cfg(not(target_os = "windows"))]
    let recent_dir: PathBuf = return Ok(Vec::new());

    if !recent_dir.exists() {
        return Ok(Vec::new());
    }

    // Collect (lnk_mtime, lnk_path) tuples first — cheap directory walk.
    // The expensive step is the per-link COM round-trip in `resolve_lnk_target`,
    // so we batch those into worker threads below.
    let read_dir = match fs::read_dir(&recent_dir) {
        Ok(r) => r,
        Err(e) => return Err(format!("Failed to read Recent dir: {}", e)),
    };

    let mut lnk_inputs: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in read_dir.flatten() {
        let lnk_path = entry.path();
        let ext = lnk_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext != "lnk" {
            continue;
        }
        let lnk_meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = lnk_meta
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        lnk_inputs.push((mtime, lnk_path));
    }

    // Resolve .lnk targets in parallel. Each worker thread initializes its
    // own COM apartment via `resolve_lnk_target`'s internal `CoInitializeEx`,
    // which is the supported pattern (IPersistFile works in any apartment).
    // We cap thread count to avoid spawning hundreds for huge Recent folders.
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> =
        Vec::with_capacity(lnk_inputs.len());
    if !lnk_inputs.is_empty() {
        let worker_count = std::cmp::min(lnk_inputs.len(), 8);
        let chunk_size = (lnk_inputs.len() + worker_count - 1) / worker_count;
        let chunks: Vec<Vec<(std::time::SystemTime, PathBuf)>> = lnk_inputs
            .chunks(chunk_size)
            .map(|c| c.to_vec())
            .collect();

        std::thread::scope(|s| {
            let handles: Vec<_> = chunks
                .into_iter()
                .map(|chunk| {
                    s.spawn(move || {
                        let mut out: Vec<(std::time::SystemTime, PathBuf)> =
                            Vec::with_capacity(chunk.len());
                        for (mtime, lnk_path) in chunk {
                            if let Some(target) = resolve_lnk_target(&lnk_path) {
                                out.push((mtime, target));
                            }
                        }
                        out
                    })
                })
                .collect();
            for h in handles {
                if let Ok(mut part) = h.join() {
                    candidates.append(&mut part);
                }
            }
        });
    }

    // Most recent first. Stable enough — duplicates (same file, multiple .lnks)
    // are de-duped after sort by tracking seen target paths.
    candidates.sort_by(|a, b| b.0.cmp(&a.0));

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<FileEntry> = Vec::with_capacity(limit);
    for (_, target) in candidates {
        if out.len() >= limit {
            break;
        }
        let key = target.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let metadata = match target.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = format_system_time(metadata.modified());
        let created = format_system_time(metadata.created());
        let extension = target
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let legacy_placeholder = is_cloud_placeholder(&metadata);
        let (cloud_provider, sync_state) = get_cloud_status(&target, &metadata);
        out.push(FileEntry {
            name: target
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: target.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
            created,
            extension,
            is_cloud_placeholder: cloud_placeholder_flag(legacy_placeholder, &sync_state),
            cloud_provider,
            sync_state,
        });
    }

    Ok(out)
}

/// Represents a cloud drive
#[derive(Serialize)]
pub struct CloudDrive {
    pub name: String,
    pub path: String,
    pub provider: String, // "onedrive", "icloud", "google_drive"
}

/// Get cloud drives (OneDrive, iCloud, etc.)
#[tauri::command]
fn get_cloud_drives() -> Vec<CloudDrive> {
    let mut drives = Vec::new();

    // Check for OneDrive
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home_path = Path::new(&home);

        // Check common OneDrive locations
        let onedrive_paths = [
            ("OneDrive", "OneDrive"),
            ("OneDrive - Personal", "OneDrive"),
        ];

        for (folder, provider) in onedrive_paths {
            let path = home_path.join(folder);
            if path.exists() && path.is_dir() {
                drives.push(CloudDrive {
                    name: folder.to_string(),
                    path: path.to_string_lossy().to_string(),
                    provider: provider.to_string(),
                });
            }
        }

        // Check for OneDrive Business (pattern: "OneDrive - CompanyName")
        if let Ok(entries) = fs::read_dir(&home_path) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("OneDrive - ") && !name.contains("Personal") {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_dir() {
                            drives.push(CloudDrive {
                                name: name.clone(),
                                path: entry.path().to_string_lossy().to_string(),
                                provider: "OneDrive".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Check for iCloud Drive
        let icloud_path = home_path.join("iCloudDrive");
        if icloud_path.exists() && icloud_path.is_dir() {
            drives.push(CloudDrive {
                name: "iCloud Drive".to_string(),
                path: icloud_path.to_string_lossy().to_string(),
                provider: "iCloud".to_string(),
            });
        }

        // Alternative iCloud path
        if let Some(appdata) = std::env::var_os("LOCALAPPDATA") {
            let icloud_alt = Path::new(&appdata).join("Apple").join("iCloudDrive");
            if icloud_alt.exists() && icloud_alt.is_dir() {
                drives.push(CloudDrive {
                    name: "iCloud Drive".to_string(),
                    path: icloud_alt.to_string_lossy().to_string(),
                    provider: "iCloud".to_string(),
                });
            }
        }

        // Check for iCloud Photos
        if let Some(appdata) = std::env::var_os("LOCALAPPDATA") {
            let icloud_photos = Path::new(&appdata).join("Apple").join("iCloudPhotos");
            if icloud_photos.exists() && icloud_photos.is_dir() {
                drives.push(CloudDrive {
                    name: "iCloud Photos".to_string(),
                    path: icloud_photos.to_string_lossy().to_string(),
                    provider: "iCloud".to_string(),
                });
            }
        }
    }

    drives
}

/// Get immediate child folders for tree navigation (lazy loading)
#[tauri::command]
fn get_folder_children(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut folders = Vec::new();

    let read_result = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_result.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden and system folders
                if !name.starts_with('.') && !name.starts_with('$') {
                    let legacy_placeholder = is_cloud_placeholder(&metadata);
                    let (cloud_provider, sync_state) =
                        get_cloud_status(&entry.path(), &metadata);
                    folders.push(FileEntry {
                        name,
                        path: entry.path().to_string_lossy().to_string(),
                        is_dir: true,
                        size: 0,
                        modified: String::new(),
                        created: String::new(),
                        extension: String::new(),
                        is_cloud_placeholder: cloud_placeholder_flag(
                            legacy_placeholder,
                            &sync_state,
                        ),
                        cloud_provider,
                        sync_state,
                    });
                }
            }
        }
    }

    // Sort by name (case-insensitive)
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(folders)
}

/// Create a new folder
#[tauri::command]
fn create_folder(path: String, name: String) -> Result<String, String> {
    let folder_path = Path::new(&path).join(&name);

    if folder_path.exists() {
        return Err(format!("A folder named '{}' already exists", name));
    }

    fs::create_dir(&folder_path).map_err(|e| e.to_string())?;

    Ok(folder_path.to_string_lossy().to_string())
}

/// Rename a file or folder
#[tauri::command]
fn rename_item(old_path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&old_path);

    if !old.exists() {
        return Err(format!("Item does not exist: {}", old_path));
    }

    let parent = old.parent().ok_or("Cannot get parent directory")?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("An item named '{}' already exists", new_name));
    }

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;

    Ok(new_path.to_string_lossy().to_string())
}

/// Delete a file or folder
#[tauri::command]
fn delete_item(path: String) -> Result<(), String> {
    let item_path = Path::new(&path);

    if !item_path.exists() {
        return Err(format!("Item does not exist: {}", path));
    }

    if item_path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Copy a file or folder to destination with smart naming
#[tauri::command]
fn copy_item(source: String, destination: String) -> Result<String, String> {
    let src = Path::new(&source);
    let src_name = src.file_name().ok_or("Cannot get file name")?;
    let dest_dir = Path::new(&destination);

    if !src.exists() {
        return Err(format!("Source does not exist: {}", source));
    }

    // Generate unique name if destination exists
    let dest_path = get_unique_path(dest_dir, src_name.to_str().unwrap_or(""), src.is_dir());

    if src.is_dir() {
        copy_dir_recursive(src, &dest_path)?;
    } else {
        fs::copy(&source, &dest_path).map_err(|e| e.to_string())?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

/// Generate a unique path by adding (1), (2), etc. if file exists
fn get_unique_path(dest_dir: &Path, name: &str, is_dir: bool) -> std::path::PathBuf {
    let mut dest_path = dest_dir.join(name);

    if !dest_path.exists() {
        return dest_path;
    }

    // Separate name and extension
    let (base_name, extension) = if is_dir {
        (name.to_string(), String::new())
    } else {
        let path = Path::new(name);
        let ext = path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| name.to_string());
        (stem, ext)
    };

    // Try adding (1), (2), etc.
    let mut counter = 1;
    loop {
        let new_name = format!("{} ({}){}", base_name, counter, extension);
        dest_path = dest_dir.join(&new_name);
        if !dest_path.exists() {
            return dest_path;
        }
        counter += 1;
        if counter > 1000 {
            // Safety limit
            break;
        }
    }

    dest_path
}

/// Helper function to copy directories recursively
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Move a file or folder to destination
#[tauri::command]
fn move_item(source: String, destination: String) -> Result<String, String> {
    let src = Path::new(&source);
    let src_name = src.file_name().ok_or("Cannot get file name")?;
    let dest_path = Path::new(&destination).join(src_name);

    if !src.exists() {
        return Err(format!("Source does not exist: {}", source));
    }

    if dest_path.exists() {
        return Err(format!(
            "Destination already exists: {}",
            dest_path.display()
        ));
    }

    // Try simple rename first (works if same filesystem)
    if fs::rename(&source, &dest_path).is_ok() {
        return Ok(dest_path.to_string_lossy().to_string());
    }

    // If rename fails (cross-filesystem), copy then delete
    if src.is_dir() {
        copy_dir_recursive(src, &dest_path)?;
        fs::remove_dir_all(&source).map_err(|e| e.to_string())?;
    } else {
        fs::copy(&source, &dest_path).map_err(|e| e.to_string())?;
        fs::remove_file(&source).map_err(|e| e.to_string())?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

/// Open terminal at specific path
#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args([
                "/C",
                "start",
                "powershell",
                "-NoExit",
                "-Command",
                &format!("cd '{}'", path),
            ])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Not supported on this OS".to_string());
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct FileProperties {
    created: String,
    accessed: String,
    modified: String,
    readonly: bool,
    hidden: bool,
}

/// Get detailed file properties
#[tauri::command]
fn get_file_properties(path: String) -> Result<FileProperties, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

    let created = metadata
        .created()
        .map(|t| {
            chrono::DateTime::<chrono::Local>::from(t)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default();

    let accessed = metadata
        .accessed()
        .map(|t| {
            chrono::DateTime::<chrono::Local>::from(t)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default();

    let modified = metadata
        .modified()
        .map(|t| {
            chrono::DateTime::<chrono::Local>::from(t)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default();

    let permissions = metadata.permissions();
    let readonly = permissions.readonly();

    // Check for hidden attribute on Windows
    let hidden = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::MetadataExt;
            let attributes = metadata.file_attributes();
            (attributes & 0x2) != 0
        }
        #[cfg(not(target_os = "windows"))]
        false
    };

    Ok(FileProperties {
        created,
        accessed,
        modified,
        readonly,
        hidden,
    })
}

// Window control commands for custom title bar
#[tauri::command]
async fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

// Show native Windows properties dialog
#[tauri::command]
fn show_native_properties(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;

        // Use ShellExecuteExW with "properties" verb
        #[repr(C)]
        #[allow(non_snake_case)]
        struct SHELLEXECUTEINFOW {
            cbSize: u32,
            fMask: u32,
            hwnd: *mut std::ffi::c_void,
            lpVerb: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShow: i32,
            hInstApp: *mut std::ffi::c_void,
            lpIDList: *mut std::ffi::c_void,
            lpClass: *const u16,
            hkeyClass: *mut std::ffi::c_void,
            dwHotKey: u32,
            hIcon: *mut std::ffi::c_void,
            hProcess: *mut std::ffi::c_void,
        }

        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteExW(pExecInfo: *mut SHELLEXECUTEINFOW) -> i32;
        }

        fn to_wide(s: &str) -> Vec<u16> {
            OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        }

        let verb = to_wide("properties");
        let file = to_wide(&path);

        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: 0x0000000C, // SEE_MASK_INVOKEIDLIST
            hwnd: ptr::null_mut(),
            lpVerb: verb.as_ptr(),
            lpFile: file.as_ptr(),
            lpParameters: ptr::null(),
            lpDirectory: ptr::null(),
            nShow: 1, // SW_SHOWNORMAL
            hInstApp: ptr::null_mut(),
            lpIDList: ptr::null_mut(),
            lpClass: ptr::null(),
            hkeyClass: ptr::null_mut(),
            dwHotKey: 0,
            hIcon: ptr::null_mut(),
            hProcess: ptr::null_mut(),
        };

        println!("[Properties] Opening for: {}", path);

        unsafe {
            ShellExecuteExW(&mut info);
        }
    }
    Ok(())
}

// Show native Windows share dialog (the modern Win11 share UI) using
// IDataTransferManagerInterop + WinRT DataTransferManager.
//
// The previous Win32 ShellExecuteExW("share") implementation invoked the
// LEGACY network-sharing verb, which fails with "no app associated" for most
// files (PDFs, ZIPs, etc.). The modern share UI (with My Phone, Discord,
// Teams, Nearby Sharing) requires the WinRT path.
//
// Implementation notes:
// - WinRT requires STA. Tauri command handlers run on tokio workers (MTA),
//   so we must dispatch to the main UI thread via app_handle.run_on_main_thread.
// - StorageFile::GetFileFromPathAsync is async; inside DataRequested we must
//   take a deferral, .get() the file synchronously, populate the package, and
//   complete the deferral.
// - SetStorageItems takes IIterable<IStorageItem>. windows-rs 0.58 does not
//   expose a public Vector<T> ctor, so we implement IIterable+IIterator
//   ourselves with #[implement] (see SingleItemIterable below).
#[tauri::command]
fn share_file_native(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Capture the raw HWND value here (on the calling thread). HWND values
        // are thread-agnostic; we use isize to send across threads (HWND
        // contains a raw pointer which is !Send).
        let hwnd_raw: isize = match window.hwnd() {
            Ok(h) => h.0 as isize,
            Err(e) => return Err(format!("Failed to get HWND: {}", e)),
        };

        println!("[Share] Opening WinRT share dialog for: {}", path);

        let path_for_main = path.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

        // Dispatch the WinRT calls onto the main thread (STA).
        let dispatch_result = app_handle.run_on_main_thread(move || {
            let result = share_impl::show_share_ui(hwnd_raw, path_for_main);
            let _ = tx.send(result);
        });

        if let Err(e) = dispatch_result {
            return Err(format!("Failed to dispatch to main thread: {}", e));
        }

        // ShowShareUIForWindow returns immediately after queuing the dialog;
        // recv should be quick. We block here so the Tauri command returns
        // a meaningful Result to the frontend.
        match rx.recv() {
            Ok(r) => r,
            Err(e) => Err(format!("Main-thread channel closed unexpectedly: {}", e)),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app_handle, window, path);
        Err("Native share dialog is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
mod share_impl {
    use windows::core::{implement, Interface, HSTRING};
    use windows::ApplicationModel::DataTransfer::{
        DataRequestedEventArgs, DataTransferManager,
    };
    use windows::Foundation::Collections::{
        IIterable, IIterable_Impl, IIterator, IIterator_Impl,
    };
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::{IStorageItem, StorageFile};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    use std::cell::Cell;

    /// Minimal IIterable<IStorageItem> backed by exactly one item.
    /// Implemented manually because windows-rs 0.58 has no public Vector<T> ctor.
    #[implement(IIterable<IStorageItem>)]
    struct SingleItemIterable {
        item: IStorageItem,
    }

    impl IIterable_Impl<IStorageItem> for SingleItemIterable_Impl {
        fn First(&self) -> windows::core::Result<IIterator<IStorageItem>> {
            let iter = SingleItemIterator {
                item: self.item.clone(),
                consumed: Cell::new(false),
            };
            Ok(iter.into())
        }
    }

    #[implement(IIterator<IStorageItem>)]
    struct SingleItemIterator {
        item: IStorageItem,
        consumed: Cell<bool>,
    }

    impl IIterator_Impl<IStorageItem> for SingleItemIterator_Impl {
        fn Current(&self) -> windows::core::Result<IStorageItem> {
            if self.consumed.get() {
                Err(windows::core::Error::new(
                    windows::core::HRESULT(0x8000000Bu32 as i32), // E_BOUNDS
                    "iterator exhausted",
                ))
            } else {
                Ok(self.item.clone())
            }
        }

        fn HasCurrent(&self) -> windows::core::Result<bool> {
            Ok(!self.consumed.get())
        }

        fn MoveNext(&self) -> windows::core::Result<bool> {
            self.consumed.set(true);
            Ok(false)
        }

        fn GetMany(
            &self,
            items: &mut [<IStorageItem as windows::core::Type<IStorageItem>>::Default],
        ) -> windows::core::Result<u32> {
            if self.consumed.get() || items.is_empty() {
                return Ok(0);
            }
            items[0] = Some(self.item.clone());
            self.consumed.set(true);
            Ok(1)
        }
    }

    pub fn show_share_ui(hwnd_raw: isize, path: String) -> Result<(), String> {
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);

        // Defensive: ensure STA on this thread. Idempotent — returns S_FALSE if
        // already STA. RPC_E_CHANGED_MODE means a different apartment was set
        // earlier; that's typically fine for the main UI thread (already STA).
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        let interop: IDataTransferManagerInterop =
            windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()
                .map_err(|e| format!("Failed to get IDataTransferManagerInterop: {}", e))?;

        let dtm: DataTransferManager = unsafe {
            interop
                .GetForWindow(hwnd)
                .map_err(|e| format!("GetForWindow failed: {}", e))?
        };

        let path_for_handler = path.clone();
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_sender, args| -> windows::core::Result<()> {
                let args = args.as_ref().ok_or_else(|| {
                    windows::core::Error::new(
                        windows::core::HRESULT(0x80004003u32 as i32), // E_POINTER
                        "DataRequested args were null",
                    )
                })?;
                let request = args.Request()?;
                let deferral = request.GetDeferral()?;

                // Always complete the deferral, even on error inside the body.
                let body = || -> windows::core::Result<()> {
                    let data = request.Data()?;
                    let props = data.Properties()?;
                    props.SetTitle(&HSTRING::from("Share"))?;

                    let path_h = HSTRING::from(path_for_handler.as_str());
                    let file: StorageFile =
                        StorageFile::GetFileFromPathAsync(&path_h)?.get()?;
                    let item: IStorageItem = file.cast()?;

                    let iterable: IIterable<IStorageItem> =
                        SingleItemIterable { item }.into();
                    data.SetStorageItems(&iterable, true)?;
                    Ok(())
                };

                let result = body();
                let _ = deferral.Complete();
                if let Err(e) = &result {
                    eprintln!("[Share] DataRequested handler error: {}", e);
                }
                result
            },
        );

        let _token = dtm
            .DataRequested(&handler)
            .map_err(|e| format!("DataRequested registration failed: {}", e))?;

        unsafe {
            interop
                .ShowShareUIForWindow(hwnd)
                .map_err(|e| format!("ShowShareUIForWindow failed: {}", e))?;
        }

        Ok(())
    }
}

// Native context menu using tauri::menu
//
// `is_file` is true when the right-clicked item is a non-directory file.
// `is_dir`  is true when it's a directory — used to gate the "Pin to Quick
// access" entry.
// `is_pinned` indicates the item is already in the user's Quick Access pins;
// the menu then shows "Unpin from Quick access" instead of the pin entry.
#[tauri::command]
async fn show_context_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    _x: f64,
    _y: f64,
    file_path: Option<String>,
    is_file: bool,
    has_clipboard: bool,
    is_dir: Option<bool>,
    is_pinned: Option<bool>,
) -> Result<(), String> {
    use tauri::menu::{ContextMenu, MenuBuilder, MenuItemBuilder};

    let is_dir = is_dir.unwrap_or(false);
    let is_pinned = is_pinned.unwrap_or(false);

    let mut menu_builder = MenuBuilder::new(&app);

    // If clicking on a file/folder, show "Open" first
    if file_path.is_some() && is_file {
        menu_builder = menu_builder
            .item(
                &MenuItemBuilder::with_id("open", "Open")
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            )
            .separator();
    }

    // File operations
    menu_builder = menu_builder
        .item(
            &MenuItemBuilder::with_id("cut", "Cut")
                .accelerator("Ctrl+X")
                .enabled(file_path.is_some())
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id("copy", "Copy")
                .accelerator("Ctrl+C")
                .enabled(file_path.is_some())
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id("paste", "Paste")
                .accelerator("Ctrl+V")
                .enabled(has_clipboard)
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_terminal", "Open in Terminal")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("new_folder", "New folder")
                .accelerator("Ctrl+Shift+N")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id("rename", "Rename")
                .accelerator("F2")
                .enabled(file_path.is_some())
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id("delete", "Delete")
                .accelerator("Delete")
                .enabled(file_path.is_some())
                .build(&app)
                .map_err(|e| e.to_string())?,
        );

    // Pin / unpin to Quick access — only for directories.
    if file_path.is_some() && is_dir {
        menu_builder = menu_builder.separator();
        if is_pinned {
            menu_builder = menu_builder.item(
                &MenuItemBuilder::with_id("unpin_quick_access", "Unpin from Quick access")
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            );
        } else {
            menu_builder = menu_builder.item(
                &MenuItemBuilder::with_id("pin_quick_access", "Pin to Quick access")
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            );
        }
    }

    // Properties only for files
    if file_path.is_some() {
        menu_builder = menu_builder.separator().item(
            &MenuItemBuilder::with_id("properties", "Properties")
                .build(&app)
                .map_err(|e| e.to_string())?,
        );
    }

    // Hybrid menu: append "Copy as path" + "Show more options" when the
    // user right-clicked on an actual item. Background right-click on the
    // empty file list area still gets the basic menu only.
    if file_path.is_some() {
        menu_builder = menu_builder
            .separator()
            .item(
                &MenuItemBuilder::with_id("copy_as_path", "Copy as path")
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            )
            .separator()
            .item(
                &MenuItemBuilder::with_id("show_more_options", "Show more options")
                    .build(&app)
                    .map_err(|e| e.to_string())?,
            );
    }

    let menu = menu_builder.build().map_err(|e| e.to_string())?;

    // Show menu at cursor position using popup
    menu.popup(window.as_ref().window())
        .map_err(|e| e.to_string())?;

    Ok(())
}

// Show the legacy Win32 shell context menu (the same one Windows shows on
// Shift+Right-click) at the given screen coordinates. This brings in all
// installed shell extensions (OneDrive submenu, 7-Zip "Compress to…", Git
// Bash "Open in Git Bash", "Send to", "Open with", etc.) without us
// implementing any of them. We're NOT replicating the Win11 modern menu —
// the legacy one (IContextMenu) is sufficient.
//
// COM init + shell APIs require STA. Tauri command handlers run on tokio
// workers (MTA), so we dispatch the work onto the main UI thread via
// app_handle.run_on_main_thread, mirroring share_file_native.
//
// `paths`: absolute filesystem paths of the right-clicked item(s). When
//          multiple are given, the menu operates on the whole selection.
// `x`, `y`: screen coordinates where the menu should appear (typically the
//           cursor position at right-click time, captured from event.screenX/Y).
#[tauri::command]
fn show_shell_context_menu(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    paths: Vec<String>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if paths.is_empty() {
            return Err("No paths provided".to_string());
        }

        let hwnd_raw: isize = match window.hwnd() {
            Ok(h) => h.0 as isize,
            Err(e) => return Err(format!("Failed to get HWND: {}", e)),
        };

        println!(
            "[ShellMenu] Showing IContextMenu for {} item(s) at ({}, {})",
            paths.len(),
            x,
            y
        );

        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let paths_for_main = paths.clone();
        let dispatch_result = app_handle.run_on_main_thread(move || {
            let result = shell_menu_impl::show_shell_menu(hwnd_raw, paths_for_main, x, y);
            let _ = tx.send(result);
        });

        if let Err(e) = dispatch_result {
            return Err(format!("Failed to dispatch to main thread: {}", e));
        }

        // TrackPopupMenuEx blocks until the user dismisses or selects, and
        // InvokeCommand can also spawn modal UI (e.g. "Send to ..." submenu
        // → file dialog). The recv just waits for whatever happens.
        match rx.recv() {
            Ok(r) => r,
            Err(e) => Err(format!("Main-thread channel closed unexpectedly: {}", e)),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app_handle, window, paths, x, y);
        Err("Shell context menu is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
mod shell_menu_impl {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::{PCSTR, PCWSTR};
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        IContextMenu, SHCreateShellItemArrayFromIDLists, SHParseDisplayName, BHID_SFUIObject,
        CMINVOKECOMMANDINFO, CMF_EXTENDEDVERBS, CMF_NORMAL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreatePopupMenu, DestroyMenu, TrackPopupMenuEx, HMENU, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    };

    /// HRESULT_FROM_WIN32(ERROR_CANCELLED). InvokeCommand returns this when
    /// the user cancels a modal launched by a verb (e.g. dismisses an "Open
    /// with" picker). Treat as success — the user simply backed out.
    const ERROR_CANCELLED_HRESULT: i32 = 0x800704C7u32 as i32;

    pub fn show_shell_menu(
        hwnd_raw: isize,
        paths: Vec<String>,
        x: i32,
        y: i32,
    ) -> Result<(), String> {
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);

        // Defensive: ensure STA. Idempotent on the main UI thread.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        // 1. Build PIDLs for each path.
        let mut pidls: Vec<*mut ITEMIDLIST> = Vec::with_capacity(paths.len());
        let cleanup_pidls = |pidls: &mut Vec<*mut ITEMIDLIST>| unsafe {
            for p in pidls.drain(..) {
                if !p.is_null() {
                    CoTaskMemFree(Some(p as *const _));
                }
            }
        };

        for path in &paths {
            let wide: Vec<u16> = std::ffi::OsStr::new(path)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            let parse_result = unsafe {
                SHParseDisplayName(
                    PCWSTR::from_raw(wide.as_ptr()),
                    None,
                    &mut pidl,
                    0,
                    None,
                )
            };
            if parse_result.is_err() || pidl.is_null() {
                let mut owned = pidls;
                cleanup_pidls(&mut owned);
                return Err(format!(
                    "SHParseDisplayName failed for {}: {:?}",
                    path, parse_result
                ));
            }
            pidls.push(pidl);
        }

        // 2. IShellItemArray from PIDLs.
        // SHCreateShellItemArrayFromIDLists takes &[*const ITEMIDLIST].
        let pidls_const: Vec<*const ITEMIDLIST> =
            pidls.iter().map(|p| *p as *const ITEMIDLIST).collect();
        let array = match unsafe { SHCreateShellItemArrayFromIDLists(&pidls_const) } {
            Ok(a) => a,
            Err(e) => {
                cleanup_pidls(&mut pidls);
                return Err(format!("SHCreateShellItemArrayFromIDLists failed: {}", e));
            }
        };

        // 3. Bind IContextMenu via BHID_SFUIObject.
        let context_menu: IContextMenu = match unsafe {
            array.BindToHandler::<Option<&windows::Win32::System::Com::IBindCtx>, IContextMenu>(
                None,
                &BHID_SFUIObject,
            )
        } {
            Ok(cm) => cm,
            Err(e) => {
                cleanup_pidls(&mut pidls);
                return Err(format!("BindToHandler(IContextMenu) failed: {}", e));
            }
        };

        // 4. Populate HMENU with the shell extension entries.
        let hmenu: HMENU = match unsafe { CreatePopupMenu() } {
            Ok(h) => h,
            Err(e) => {
                cleanup_pidls(&mut pidls);
                return Err(format!("CreatePopupMenu failed: {}", e));
            }
        };

        const ID_CMD_FIRST: u32 = 1;
        const ID_CMD_LAST: u32 = 0x7FFF;

        // CMF_EXTENDEDVERBS is the "Shift held" flag — surfaces hidden items
        // that the shell normally only shows on Shift+Right-click.
        let qcm_flags = CMF_NORMAL | CMF_EXTENDEDVERBS;
        if let Err(e) = unsafe {
            context_menu.QueryContextMenu(hmenu, 0, ID_CMD_FIRST, ID_CMD_LAST, qcm_flags)
        } {
            unsafe {
                let _ = DestroyMenu(hmenu);
            }
            cleanup_pidls(&mut pidls);
            return Err(format!("QueryContextMenu failed: {}", e));
        }

        // 5. TrackPopupMenuEx — blocks until user picks or cancels.
        // TPM_RETURNCMD: return the picked command id instead of posting WM_COMMAND.
        let cmd = unsafe {
            TrackPopupMenuEx(
                hmenu,
                (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                x,
                y,
                hwnd,
                None,
            )
        };

        if cmd.0 == 0 {
            // User cancelled (clicked outside or Esc). Not an error.
            unsafe {
                let _ = DestroyMenu(hmenu);
            }
            cleanup_pidls(&mut pidls);
            return Ok(());
        }

        // 6. InvokeCommand — relative ID is (cmd - ID_CMD_FIRST). MAKEINTRESOURCEA
        // packs that integer into the lpVerb pointer (high WORD must be zero).
        let relative_id = (cmd.0 as u32).saturating_sub(ID_CMD_FIRST);
        let mut info = CMINVOKECOMMANDINFO::default();
        info.cbSize = std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32;
        info.hwnd = hwnd;
        info.lpVerb = PCSTR(relative_id as usize as *const u8);
        info.nShow = 1; // SW_SHOWNORMAL

        let invoke_point = POINT { x, y };
        let _ = invoke_point; // reserved for CMINVOKECOMMANDINFOEX upgrade if needed

        let invoke_result = unsafe { context_menu.InvokeCommand(&info) };

        // 7. Cleanup regardless of invoke outcome.
        unsafe {
            let _ = DestroyMenu(hmenu);
        }
        cleanup_pidls(&mut pidls);

        match invoke_result {
            Ok(()) => Ok(()),
            Err(e) if e.code().0 == ERROR_CANCELLED_HRESULT => Ok(()),
            Err(e) => Err(format!("InvokeCommand failed: {}", e)),
        }
    }
}

/// Supported extensions for thumbnail generation - images (fast, use image crate)
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "ico", "tiff", "tif",
];

/// Extensions that Windows Shell can generate thumbnails for (videos, PDFs, etc)
const SHELL_THUMBNAIL_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpeg", "mpg", "pdf", "doc", "docx",
    "xls", "xlsx", "ppt", "pptx", "exe", "lnk", "url",
];

/// Check if file supports thumbnail via image crate
fn is_image_thumbnail_supported(extension: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&extension.to_lowercase().as_str())
}

/// Check if file supports thumbnail via Windows Shell
fn is_shell_thumbnail_supported(extension: &str) -> bool {
    SHELL_THUMBNAIL_EXTENSIONS.contains(&extension.to_lowercase().as_str())
}

/// Check if file supports any thumbnail generation
#[allow(dead_code)]
fn is_thumbnail_supported(extension: &str) -> bool {
    is_image_thumbnail_supported(extension) || is_shell_thumbnail_supported(extension)
}

/// Generate a thumbnail using Windows Shell API (IShellItemImageFactory)
/// This uses the same thumbnail system as Windows Explorer
fn generate_shell_thumbnail(path: &str, size: u32) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF,
    };

    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        // Convert path to wide string
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

        // Create shell item
        let shell_item: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR::from_raw(wide_path.as_ptr()), None)
                .map_err(|e| format!("Failed to create shell item: {:?}", e))?;

        // Request thumbnail
        let thumb_size = windows::Win32::Foundation::SIZE {
            cx: size as i32,
            cy: size as i32,
        };

        let hbitmap = shell_item
            .GetImage(thumb_size, SIIGBF(0))
            .map_err(|e| format!("Failed to get thumbnail: {:?}", e))?;

        // Convert HBITMAP to PNG
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            let _ = DeleteObject(hbitmap);
            CoUninitialize();
            return Err("Failed to create DC".to_string());
        }

        let old_bitmap = SelectObject(hdc, hbitmap);

        // Get bitmap info
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size as i32,
                biHeight: -(size as i32), // Negative for top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        // Allocate buffer for pixel data
        let mut pixels: Vec<u8> = vec![0u8; (size * size * 4) as usize];

        let result = GetDIBits(
            hdc,
            hbitmap,
            0,
            size,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Cleanup GDI objects
        SelectObject(hdc, old_bitmap);
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(hbitmap);
        CoUninitialize();

        if result == 0 {
            return Err("Failed to get bitmap bits".to_string());
        }

        // Convert BGRA to RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2); // Swap B and R
        }

        // Create image from raw pixels
        let actual_width = bmi.bmiHeader.biWidth.unsigned_abs();
        let actual_height = bmi.bmiHeader.biHeight.unsigned_abs();

        let img_buffer = image::RgbaImage::from_raw(actual_width, actual_height, pixels)
            .ok_or_else(|| "Failed to create image buffer".to_string())?;

        let img = image::DynamicImage::ImageRgba8(img_buffer);
        let thumbnail = img.thumbnail(size, size);

        // Encode to PNG
        let mut buffer = Cursor::new(Vec::new());
        thumbnail
            .write_to(&mut buffer, ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        let base64_data = general_purpose::STANDARD.encode(buffer.get_ref());
        Ok(format!("data:image/png;base64,{}", base64_data))
    }
}

/// Generate a thumbnail for an image or video file
/// Returns a base64-encoded PNG thumbnail
#[tauri::command]
async fn get_thumbnail(path: String, size: Option<u32>) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    // Get extension
    let extension = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let thumb_size = size.unwrap_or(96);

    // Use Windows Shell for videos and documents
    if is_shell_thumbnail_supported(&extension) {
        return generate_shell_thumbnail(&path, thumb_size);
    }

    // Use image crate for regular images (faster)
    if !is_image_thumbnail_supported(&extension) {
        return Err("Unsupported file type".to_string());
    }

    // Load and resize image
    let img = image::open(&path).map_err(|e| e.to_string())?;

    // Use thumbnail method for fast resizing (maintains aspect ratio)
    let thumbnail = img.thumbnail(thumb_size, thumb_size);

    // Encode to PNG in memory
    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    // Convert to base64
    let base64_data = general_purpose::STANDARD.encode(buffer.get_ref());

    Ok(format!("data:image/png;base64,{}", base64_data))
}

/// Result of reading a file preview
#[derive(Serialize)]
pub struct FilePreviewResult {
    pub content: String,
    pub line_count: usize,
    pub is_truncated: bool,
}

/// Read the first N lines of a text file for preview
#[tauri::command]
fn read_file_preview(path: String, max_lines: Option<usize>) -> Result<FilePreviewResult, String> {
    use std::io::{BufRead, BufReader};

    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if file_path.is_dir() {
        return Err("Cannot preview directories".to_string());
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let max = max_lines.unwrap_or(100);

    let mut lines = Vec::new();
    let mut total_lines = 0;
    let mut is_truncated = false;

    for line in reader.lines() {
        total_lines += 1;
        if lines.len() < max {
            match line {
                Ok(l) => lines.push(l),
                Err(_) => {
                    // Binary file or encoding error
                    return Err("Cannot preview binary files".to_string());
                }
            }
        } else {
            is_truncated = true;
            // Count remaining lines for total
            if let Ok(_) = line {
                continue;
            }
        }
    }

    Ok(FilePreviewResult {
        content: lines.join("\n"),
        line_count: total_lines,
        is_truncated,
    })
}

// Payload forwarded to the running instance when a second `tachy.exe` is
// launched. The frontend listens for the `single-instance` event and turns
// `argv[1..]` into a new tab in the existing window.
#[derive(Clone, serde::Serialize)]
struct SingleInstancePayload {
    argv: Vec<String>,
    cwd: String,
}

fn main() {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{Emitter, Manager, WindowEvent};

    tauri::Builder::default()
        // IMPORTANT: single-instance MUST be the first plugin. The plugin's
        // docs are explicit: registering it after others means a second
        // instance will have already initialized those plugins (some of which
        // grab global resources) before exiting, defeating the whole point.
        // The callback runs in the EXISTING (primary) instance only.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // Bring the main window forward.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Forward args to the frontend so it can open a new tab.
            let _ = app.emit(
                "single-instance",
                SingleInstancePayload { argv, cwd },
            );
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Create tray menu
            let show_item = MenuItemBuilder::with_id("show", "Show Tachy")
                .build(app)
                .expect("failed to build show menu item");
            let quit_item = MenuItemBuilder::with_id("quit", "Exit")
                .build(app)
                .expect("failed to build quit menu item");

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()
                .expect("failed to build tray menu");

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Tachy")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Double-click or left-click to show window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .expect("failed to build tray icon");

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close request
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .on_menu_event(|app, event| {
            // Handle context menu item clicks - emit to frontend
            let action_id = event.id().0.as_str();
            println!("[ContextMenu] Menu action clicked: {}", action_id);
            let _ = app.emit("context-menu-action", action_id);
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            get_drives,
            search_files,
            get_parent_directory,
            get_quick_access,
            get_folders_metadata,
            get_known_folders,
            get_recent_files,
            get_cloud_drives,
            get_folder_children,
            create_folder,
            rename_item,
            delete_item,
            copy_item,
            move_item,
            open_in_terminal,
            get_file_properties,
            minimize_window,
            maximize_window,
            close_window,
            is_maximized,
            show_native_properties,
            share_file_native,
            show_context_menu,
            show_shell_context_menu,
            get_thumbnail,
            read_file_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

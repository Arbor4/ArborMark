//! 启动诊断日志。
//!
//! Windows 安装包是 GUI 子系统，`stdout/stderr` 不可见；一旦启动阶段
//! （WebView2、菜单或窗口创建）出错，用户只会看到"点了没反应"。
//! 这里把关键步骤和 panic 追加到可预期的数据目录，便于定位：
//!   * Windows: `%APPDATA%\com.arbor.arbormark\startup.log`
//!   * macOS:   `~/Library/Application Support/com.arbor.arbormark/startup.log`
//!   * Linux:   `~/.local/share/com.arbor.arbormark/startup.log`
//!
//! `ARBORMARK_DATA_DIR` 存在时优先写进该目录。

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn init() -> PathBuf {
    let path = log_path();
    let _ = LOG_PATH.set(path.clone());
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &path,
        format!(
            "=== ArborMark {} startup ({}) ===\n",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ),
    );
    append(&format!(
        "exe={:?} data_dir={:?}",
        std::env::current_exe().ok(),
        std::env::var_os("ARBORMARK_DATA_DIR")
    ));

    // GUI 进程没有控制台，panic 默认只写 stderr。安装一个 hook 落到同一个文件，
    // 这样 `panic = "abort"` 也能留下最后一条记录。
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        append(&format!("PANIC: {info}\n{backtrace}"));
    }));

    path
}

pub fn path() -> PathBuf {
    LOG_PATH.get().cloned().unwrap_or_else(log_path)
}

pub fn log(message: &str) {
    append(message);
}

fn append(message: &str) {
    let path = LOG_PATH
        .get()
        .cloned()
        .unwrap_or_else(log_path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "[{}] {message}", timestamp());
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn log_path() -> PathBuf {
    if let Some(dir) = std::env::var_os("ARBORMARK_DATA_DIR") {
        return PathBuf::from(dir).join("startup.log");
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata)
                .join("com.arbor.arbormark")
                .join("startup.log");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return home
                .join("Library")
                .join("Application Support")
                .join("com.arbor.arbormark")
                .join("startup.log");
        }
    }

    if let Some(data) = dirs::data_dir() {
        return data.join("com.arbor.arbormark").join("startup.log");
    }
    std::env::temp_dir().join("arbormark-startup.log")
}

/// 启动失败时的原生对话框。
///
/// 不能使用 tauri-plugin-dialog 的 `blocking_show`：它要求不在主线程，
/// 而 `setup` 正好在主线程，阻塞等待会死锁。Windows 直接调用 `MessageBoxW`，
/// 不依赖事件循环；其它平台退回 stderr（GUI 下通常不可见，但日志仍有记录）。
pub fn native_error(title: &str, message: &str) {
    append(&format!("NATIVE_ERROR {title}: {message}"));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
        };
        let wide = |text: &str| -> Vec<u16> {
            std::ffi::OsStr::new(text)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        };
        let title = wide(title);
        let message = wide(message);
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("[ArborMark] {title}: {message}");
    }
}

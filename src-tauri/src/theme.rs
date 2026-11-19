//! 原生窗口外观：让 Windows 标题栏与原生菜单栏跟随应用的明暗主题。
//!
//! Tauri 的窗口标题栏与菜单栏都是系统绘制的，默认只跟随系统设置；应用内切到
//! 暗色时它们会保持亮色，和正文/侧边栏割裂。这里在主题变化时：
//! * 用 `DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)` 把标题栏切暗；
//! * 通过 uxtheme 的未文档化导出（`SetPreferredAppMode` / `AllowDarkModeForWindow`）
//!   让 Win32 菜单栏使用暗色主题，并重绘菜单栏。
//!
//! 非 Windows 平台是空实现。

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// 上一次应用过的模式。只在**真的换了模式**时才刷新已存在的窗口：
/// 新建窗口时重复给所有窗口发 `WM_THEMECHANGED` 会让原窗口整块重绘
/// （表现为打开新窗口瞬间原窗口闪一下）。
static LAST_MODE: Mutex<Option<bool>> = Mutex::new(None);

fn set_mode_if_changed(dark: bool) -> bool {
    let mut guard = match LAST_MODE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let changed = guard.map(|previous| previous != dark).unwrap_or(true);
    *guard = Some(dark);
    changed
}

/// 对整个应用（进程级菜单偏好 + 所有窗口）应用明暗外观。
pub fn apply_to_all(app: &AppHandle, dark: bool) {
    let mode_changed = set_mode_if_changed(dark);
    if mode_changed {
        apply_app_mode(dark);
    }

    for (_label, window) in app.webview_windows() {
        apply_window(&window, dark, mode_changed);
    }
}

/// 只设置进程级的菜单/控件明暗偏好（要在创建菜单之前调用，菜单栏才会用暗色）。
pub fn apply_app_mode(dark: bool) {
    #[cfg(target_os = "windows")]
    platform::set_app_mode(dark);
    #[cfg(not(target_os = "windows"))]
    let _ = dark;
}

fn apply_window(window: &tauri::WebviewWindow, dark: bool, refresh_theme: bool) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            platform::apply(hwnd.0, dark, refresh_theme);
            log::info!(
                "[theme] 原生窗口外观 dark={dark} refresh={refresh_theme} label={}",
                window.label()
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, dark, refresh_theme);
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::UI::WindowsAndMessaging::DrawMenuBar;

    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;

    type Hwnd = *mut c_void;
    type SetPreferredAppModeFn = unsafe extern "system" fn(i32) -> i32;
    type AllowDarkModeForWindowFn = unsafe extern "system" fn(Hwnd, i32) -> i32;
    type SetWindowThemeFn = unsafe extern "system" fn(Hwnd, *const u16, *const u16) -> i32;

    fn uxtheme() -> Option<isize> {
        let name: Vec<u16> = "uxtheme.dll\0".encode_utf16().collect();
        let handle = unsafe { GetModuleHandleW(name.as_ptr()) };
        if handle.is_null() {
            None
        } else {
            Some(handle as isize)
        }
    }

    fn by_ordinal(index: usize) -> Option<usize> {
        let handle = uxtheme()?;
        unsafe {
            match GetProcAddress(handle as _, index as *const u8) {
                Some(func) => Some(func as usize),
                None => None,
            }
        }
    }

    fn by_name(name: &str) -> Option<usize> {
        let handle = uxtheme()?;
        let bytes = format!("{name}\0").into_bytes();
        unsafe {
            match GetProcAddress(handle as _, bytes.as_ptr()) {
                Some(func) => Some(func as usize),
                None => None,
            }
        }
    }

    /// 进程级偏好：0 = 跟随系统，1 = 允许暗色，2 = 强制暗色，3 = 强制亮色。
    pub fn set_app_mode(dark: bool) {
        let Some(addr) = by_ordinal(135) else { return };
        unsafe {
            let set_preferred: SetPreferredAppModeFn = std::mem::transmute(addr);
            set_preferred(if dark { 2 } else { 3 });
        }
        // uxtheme 会把菜单栏等非客户区主题缓存住：只改 SetPreferredAppMode，
        // 已经画过的菜单栏会保持旧颜色（暗→亮时菜单仍是暗的）。
        // ordinal 136 = FlushMenuThemes，强制丢弃这份缓存。
        if let Some(addr) = by_ordinal(136) {
            unsafe {
                let flush: unsafe extern "system" fn() = std::mem::transmute(addr);
                flush();
            }
        }
    }

    pub fn apply(hwnd: Hwnd, dark: bool, refresh_theme: bool) {
        if hwnd.is_null() {
            return;
        }
        let flag: i32 = if dark { 1 } else { 0 };
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE,
                &flag as *const i32 as *const c_void,
                std::mem::size_of::<i32>() as u32,
            );
            if let Some(addr) = by_ordinal(104) {
                let allow: AllowDarkModeForWindowFn = std::mem::transmute(addr);
                allow(hwnd, flag);
            }
            if let Some(addr) = by_name("SetWindowTheme") {
                let set_theme: SetWindowThemeFn = std::mem::transmute(addr);
                let mut theme: Vec<u16> = if dark { "DarkMode_Explorer" } else { "Explorer" }
                    .encode_utf16()
                    .collect();
                theme.push(0);
                set_theme(hwnd, theme.as_ptr(), std::ptr::null());
            }
            // 菜单栏是窗口非客户区的一部分：只有模式真的变了才需要通知窗口
            // 重算主题并重绘，否则每次建新窗口都会让已有窗口闪一下。
            // 使用异步非阻塞 PostMessageW 替代同步 SendMessageW，防止多窗口下跨线程等待死锁卡顿。
            if refresh_theme {
                let _ = windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW(
                    hwnd,
                    windows_sys::Win32::UI::WindowsAndMessaging::WM_THEMECHANGED,
                    0,
                    0,
                );
                let _ = DrawMenuBar(hwnd);
            }
        }
    }
}

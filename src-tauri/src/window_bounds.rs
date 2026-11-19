//! Windows 窗口尺寸上限放行。
//!
//! 系统默认把可调整窗口的「最大跟踪尺寸」限制在虚拟桌面大小，所以单屏时窗口
//! 拖到屏幕边缘就拖不动了。这里给窗口挂一个子类过程，把 `WM_GETMINMAXINFO`
//! 里的 `ptMaxTrackSize` 调大：窗口可以比屏幕更宽（多显示器横跨、超宽屏或
//! 先拉宽再看内容都需要）。
//!
//! 只改「拖拽调整」的上限，`ptMaxSize` 不动，最大化仍然按当前显示器处理。

#[cfg(target_os = "windows")]
mod platform {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_WNDPROC, MINMAXINFO, WM_GETMINMAXINFO,
    };

    /// 足够覆盖多显示器拼接的宽度；再大也没有实际意义。
    const MAX_TRACK_SIZE: i32 = 32_000;

    static OLD_PROCS: Mutex<Option<HashMap<isize, isize>>> = Mutex::new(None);

    fn store(hwnd: isize, old: isize) {
        let mut guard = match OLD_PROCS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard
            .get_or_insert_with(HashMap::new)
            .insert(hwnd, old);
    }

    fn lookup(hwnd: isize) -> Option<isize> {
        let guard = match OLD_PROCS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.as_ref().and_then(|map| map.get(&hwnd).copied())
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_GETMINMAXINFO {
            let info = &mut *(lparam as *mut MINMAXINFO);
            info.ptMaxTrackSize.x = info.ptMaxTrackSize.x.max(MAX_TRACK_SIZE);
            info.ptMaxTrackSize.y = info.ptMaxTrackSize.y.max(MAX_TRACK_SIZE);
            return 0;
        }
        match lookup(hwnd as isize) {
            Some(old) => {
                let prev = std::mem::transmute::<isize, Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>>(old);
                CallWindowProcW(prev, hwnd, msg, wparam, lparam)
            }
            None => 0,
        }
    }

    /// 给窗口挂上子类过程。重复调用是安全的（同一窗口只换一次）。
    pub fn allow_resize_beyond_screen(hwnd: HWND) {
        if hwnd.is_null() {
            return;
        }
        unsafe {
            if lookup(hwnd as isize).is_some() {
                return;
            }
            let old = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            if old == 0 {
                log::warn!("[window] 取原窗口过程失败，跳过尺寸放行");
                return;
            }
            store(hwnd as isize, old);
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, subclass_proc as *const () as usize as isize);
            log::info!("[window] 已放开最大可调整尺寸（允许超过屏幕宽度）");
        }
    }
}

/// 允许把窗口拖得比屏幕还宽。
#[cfg(target_os = "windows")]
pub fn allow_resize_beyond_screen(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        platform::allow_resize_beyond_screen(hwnd.0);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn allow_resize_beyond_screen(_window: &tauri::WebviewWindow) {}

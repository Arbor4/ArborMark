//! IPC 分发层：等价于旧主进程的 `ipc/ipc-router.js`。
//!
//! 通道名与 `src/main/channels.json` 一一对应；未实现的通道返回 `null`，
//! 与旧版 `invokeUnsupported` 的兜底行为一致，渲染层不需要逐个改。

pub mod clipboard;
pub mod dialog;
pub mod document;
pub mod export;
pub mod fs;
pub mod images;
pub mod library;
pub mod misc;
pub mod pandoc;
pub mod path;
pub mod search;
pub mod setting;
pub mod shell;
pub mod spell;
pub mod touchbar;
pub mod window;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

#[tauri::command]
pub async fn ipc_invoke(
    app: AppHandle,
    window: tauri::WebviewWindow,
    channel: String,
    payload: Value,
) -> Result<Value, String> {
    let state = app.state::<AppState>();

    match channel.as_str() {
        // ---- dialog ----
        "dialog.showOpenDialog" => dialog::show_open(&app, &payload),
        "dialog.showSaveDialog" => dialog::show_save(&app, &payload),
        "dialog.showMessageBox" => dialog::show_message(&app, &payload),

        // ---- shell ----
        "shell.openExternal" => shell::open_external(&payload),
        "shell.openItem" => shell::open_item(&payload),
        "shell.showItemInFolder" => shell::show_item_in_folder(&payload),
        "shell.trashItem" => shell::trash_item(&payload),
        "shell.showProperties" | "shell.showItemProperties" => shell::show_properties(&payload),
        "shell.showDownload" => shell::show_download(&payload),
        "shell.isFolder" => shell::is_folder(&payload),
        "shell.removeIfEmpty" => shell::remove_if_empty(&payload),
        "shell.showSaveImage" => shell::show_save_image(&app, &payload),

        // ---- clipboard ----
        "clipboard.readText" | "clipboard.readTextSync" | "clipboard.read" => clipboard::read_text(),
        "clipboard.readHTMLSync" => clipboard::read_html(),
        "clipboard.writeText" => clipboard::write_text(&payload),
        "clipboard.write" => clipboard::write(&payload),
        "clipboard.postCopy" => clipboard::post_copy(),
        "clipboard.readImage" => clipboard::read_image(),
        "clipboard.writeImage" => clipboard::write_image(&payload),
        "clipboard.readFilePaths" => clipboard::read_file_paths(),

        // ---- window ----
        "window.setTitle" | "window.setPreviewTitle" => window::set_title(&window, &payload),
        "window.close" => window::close(&window),
        "window.minimize" => window::minimize(&window),
        "window.maximize" => window::maximize(&window),
        "window.unmaximize" => window::unmaximize(&window),
        "window.isMaximized" => window::is_maximized(&window),
        "window.setFullScreen" | "window.fullscreen" => window::set_fullscreen(&window, &payload),
        "window.isFullScreen" => window::is_fullscreen(&window),
        "window.focus" => window::focus(&window),
        "window.pin" => window::set_always_on_top(&window, true),
        "window.unpin" => window::set_always_on_top(&window, false),
        "window.inspectElement" | "window.toggleDevTools" => window::toggle_devtools(&window),
        "window.enterFullscreen" => window::set_fullscreen(&window, &Value::Bool(true)),
        "window.exitFullscreen" => window::set_fullscreen(&window, &Value::Bool(false)),
        "window.checkAsFocus" => window::focus(&window),
        "window.open" => window::open_url(&payload),
        "window.restore" => window::restore(&window),
        // mac 通知 / QuickLook 等价 / 全窗口广播
        "window.setBackground" => window::set_background(),
        "window.setIsSchemeAwareness" => window::set_is_scheme_awareness(),
        "window.previewFile" => window::preview_file(&payload),
        "window.showDialog" => window::show_dialog(),
        "window.updateUIAfterExitSourceMode" => window::update_ui_after_exit_source_mode(),
        "window.refreshFullContentState" => window::refresh_full_content_state(),
        "window.setTitlebarTextMarginLeft" => window::set_titlebar_text_margin_left(&payload),
        "window.execForAll" | "execForAll" => window::exec_for_all(&app, &payload),

        // ---- touchBar（mac 硬件，诚实 no-op）----
        "touchBar.setBlockStyle" => touchbar::set_block_style(),
        "touchBar.setFencesOnSetLang" => touchbar::set_fences_on_set_lang(),
        "touchBar.setInlineEnabled" => touchbar::set_inline_enabled(),
        "touchBar.setInlineStates" => touchbar::set_inline_states(),
        "touchBar.showDialogTouchBar" => touchbar::show_dialog_touch_bar(),
        "touchBar.showFindReplaceTouchBar" => touchbar::show_find_replace_touch_bar(),
        "touchBar.showInsertTableTouchBar" => touchbar::show_insert_table_touch_bar(),
        "touchBar.updateFindReplaceMode" => touchbar::update_find_replace_mode(),
        "touchBar.updateInsertTableTouchBar" => touchbar::update_insert_table_touch_bar(),

        // ---- 拼写检查（mac 系统服务；空集合让调用链正常走完）----
        "word.getSpellSuggestionInContext" => spell::get_spell_suggestion_in_context(),
        "word.getTextReplacement" => spell::get_text_replacement(),
        "word.updateWordCount" => spell::update_word_count(),

        // ---- contextMenu（mac 原生菜单供数）----
        "contextMenu.setItems" => crate::menu::context_set_items(),
        "contextMenu.setActiveStyles" => crate::menu::context_set_active_styles(),

        // ---- webContents：编辑命令 ----
        "webContents.copy" => window::exec_edit_command(&window, "copy"),
        "webContents.cut" => window::exec_edit_command(&window, "cut"),
        "webContents.paste" => window::exec_edit_command(&window, "paste"),
        "webContents.undo" => window::exec_edit_command(&window, "undo"),
        "webContents.redo" => window::exec_edit_command(&window, "redo"),
        "webContents.selectAll" => window::exec_edit_command(&window, "selectAll"),
        "webContents.clearCache" => Ok(Value::Null),

        // ---- fs（新前端 src/web 的文件系统契约） ----
        "fs.readDir" => {
            // 图片放大/渲染走 asset 协议：仅放行用户实际打开的工作区目录（递归），
            // 静态 scope 为空，避免整盘暴露。
            if let Some(dir) = payload.get("path").and_then(Value::as_str) {
                let _ = app.asset_protocol_scope().allow_directory(dir, true);
            }
            fs::read_dir(&payload)
        }
        "fs.readFile" => fs::read_file(&payload),
        "fs.writeFile" => fs::write_file(&payload),
        "fs.stat" => fs::stat(&payload),
        "fs.createDir" => fs::create_dir(&payload),
        "fs.importFiles" => fs::import_files(&payload),
        "app.themeDir" => fs::theme_dir(),
        "app.launchFile" => misc::launch_file(&app),

        // ---- setting ----
        "setting.put" => setting::put(&app, &state, &payload),
        "setting.get" => setting::get(&state, &payload),
        "setting.loadAll" => setting::load_all(&app, &state),
        "app.loadOptions" | "loadOptions" => setting::app_options(),
        "setting.getRecentFiles" => setting::recents(&state),
        "setting.getThemes" => setting::get_themes(&state),
        "setting.updateRecentFile" => setting::update_recent(&app, &state, &payload),
        "setting.removeRecentDocument" => setting::remove_recent(&app, &state, &payload, "file"),
        "setting.removeRecentFolder" => setting::remove_recent(&app, &state, &payload, "folder"),
        "setting.openThemeFolder" => setting::open_theme_folder(),
        "setting.addRecentFolder" => setting::add_recent_folder(&app, &state, &payload),
        "setting.askForClearRecentDocuments" => setting::clear_recent_documents(&app, &state),
        "setting.askForClearRecentLocations" => setting::clear_recent_locations(&app, &state),
        // 旧主进程的常量桩与广播通道（返回值契约见 setting.rs 注释）
        "setting.fetchAnalytics" => setting::fetch_analytics(),
        "setting.getDownloadingDicts" => setting::get_downloading_dicts(),
        "setting.getKeyBinding" => setting::get_key_binding(),
        "setting.loadExports" => setting::load_exports(),
        "setting.showAndHighlight" => setting::show_and_highlight(&app, &payload),
        "theme.apply" => setting::apply_theme(&app, &state, &payload),
        "theme.setThemeSource" | "theme.setThemeSourceForNode" => {
            setting::set_theme_source(&app, &state, &payload)
        }
        "menu.updateCustomZoom" => window::update_custom_zoom(&window, &state, &payload),
        "menu.popup" => crate::menu::popup(&app, &window, &payload),
        "menu.update" | "menu.updateMenu" => crate::menu::update_menu_state(&app, &payload),
        "menu.dump" => crate::menu::dump(&app),
        "menu.refresh" => crate::menu::refresh(&app),
        "menu.refreshThemeMenu" => {
            crate::menu::sync_theme_checks(&app);
            Ok(Value::Bool(true))
        }
        "menu.rebuildThemes" => crate::menu::rebuild_themes_menu(&app, &payload),
        "app.showEmojiPanel" => Ok(Value::Bool(true)),
        "preference.open" | "app.openPreference" => misc::open_preference(&app),
        "setting.setCurTheme" => setting::set_cur_theme(&app, &state, &payload),
        // 偏好设置页的补充上下文：全部设置 + 路径 / 语言字段。
        "setting.getExtraOption" => {
            let mut out = state.all_settings().as_object().cloned().unwrap_or_default();
            if let Some(ctx) = crate::windows::path_context(&app).as_object() {
                for (key, value) in ctx {
                    out.insert(key.clone(), value.clone());
                }
            }
            Ok(Value::Object(out))
        }

        // ---- path / quick open ----
        "path.openFile" => path::open_file(&window, &payload),
        "path.openFolderInFinder" => path::open_folder_in_finder(&payload),
        "path.openUrl" | "path.openURL" => path::open_url(&payload),
        "path.openFileWithApplication" => path::open_file_with_application(&payload),
        "path.isDirectory" => path::is_directory(&payload),
        "path.readText" => path::read_text(&payload),
        "path.readTextLimited" => path::read_text_limited(&payload),
        "path.applicationsForFile" => path::applications_for_file(),
        "path.showInFinder" => path::show_in_finder(&payload),
        "path.selectFolderOrFile" => path::select_folder_or_file(&app),
        "path.showSaveDialog" => path::show_save_dialog(&app, &payload),
        "quickOpen.cacheRecentFiles" => Ok(Value::Bool(true)),
        "quickOpen.reindexFolderIfNeeded" => Ok(Value::Bool(true)),
        "quickOpen.stopQuery" => Ok(Value::Null),
        "quickOpen.query" => Ok(Value::Array(Vec::new())),

        // ---- 全局搜索 ----
        "search.content" | "globalSearch.query" => search::content(&payload),

        // ---- library ----
        "library.newFile" => library::new_file(&payload),
        "library.newFolder" => library::new_folder(&payload),
        "library.renameFile" => library::rename(&payload),
        "library.duplicate" => library::duplicate(&payload),
        "library.moveFile" => library::move_file(&payload),
        "library.trashItem" => library::trash(&payload),
        "library.listDocsUnder" => library::list_docs_under(&payload),
        "library.search" => library::search(),
        "library.fetchAllDocs" => library::fetch_all_docs(),
        "library.getRecentFolders" => library::get_recent_folders(&state),
        "library.updateListItem" => library::update_list_item(),
        "library.updateListItemIfIsOpen" => library::update_list_item_if_is_open(),
        "library.newFileUnder" => library::new_file_under(&payload),
        "library.showProperty" => library::show_property(),

        // ---- pandoc 导入与导出 ----
        "pandoc.version" => pandoc::version(Some(&state), Some(&payload)),
        "pandoc.setVersion" => pandoc::set_version(&payload),
        "pandoc.import" => pandoc::import(&app, &state, &payload),
        "pandoc.export" => pandoc::export(&state, &payload),

        // ---- images / image ----
        "images.addToBundle" => images::add_to_bundle(&window, &state, &payload),
        "images.copyImage" => images::copy_image(&window, &state, &payload),
        "images.savePNG" => images::save_png(&payload),
        "images.readDataUrl" => images::read_data_url(&payload),
        "images.selectImageSavePath" => images::select_image_save_path(&app, &payload),
        "images.insertLocalImage" => images::insert_local_image(&app),
        "images.prepImageMove" => images::prep_image_move(&payload),
        "images.getScale" => images::get_scale(),
        "images.iPicValidateBeforeUpload" => images::i_pic_validate_before_upload(),
        "images.upload" => images::upload(),
        "images.uploadCustom" => images::upload_custom(&payload),
        "images.startCopyAllImages" => images::start_copy_all_images(),
        "image.saveSVG" => images::save_svg(&payload),
        "image.saveSVGDialog" => images::save_svg_dialog(&app, &payload),

        // ---- path.* 文件操作 ----
        "path.copyFile" => library::copy_file(&payload),
        "path.moveFile" => library::move_file(&payload),
        "path.delete" => library::delete(&payload),
        "path.removeFiles" => library::remove_files(&payload),
        "path.moveTo" => library::move_to(&payload),

        // ---- app ----
        "app.restart" | "app.relaunch" | "setting.restart" | "setting.relaunch" => app.restart(),
        "app.cancelQuit" => {
            state.reset_close_flow(window.label());
            state.set_close_allowed(window.label(), false);
            Ok(Value::Bool(true))
        }
        "app.onCloseWin" => {
            let (target, mount) = if let Some(obj) = payload.as_object() {
                let t = obj.get("filePath").and_then(Value::as_str);
                let m = obj.get("mountFolder").and_then(Value::as_str);
                (t, m)
            } else if let Some(m) = payload.as_str() {
                (None, Some(m))
            } else {
                (None, None)
            };
            if target.is_some() || mount.is_some() {
                state.set_last_session(target.map(Some), mount.map(Some));
            }
            state.reset_close_flow(window.label());
            state.set_close_allowed(window.label(), true);
            let _ = window.close();
            Ok(Value::Bool(true))
        }
        "app.rendererError" => {
            // 渲染层用同一个通道上报 error / warning / console.warn，
            // 以前一律按 error 记录，导致「空文档光标定位」这类预期内的
            // 警告在日志里和真正的崩溃长得一样。
            let kind = payload.get("kind").and_then(Value::as_str).unwrap_or("?");
            let message = payload.get("message").and_then(Value::as_str).unwrap_or("");
            let detail = payload.get("detail").and_then(Value::as_str).unwrap_or("");
            let is_warning = matches!(kind, "warning" | "warn" | "skip") || kind.starts_with("console.warn");
            if is_warning {
                log::warn!("[renderer:{kind}] {message} | {detail}");
            } else {
                log::error!("[renderer:{kind}] {message} | {detail}");
            }
            Ok(Value::Null)
        }
        "app.rendererReady" => misc::renderer_ready(&app, &window, &payload),
        "app.showWelcome" | "setting.showWelcome" | "welcome.show" => misc::show_welcome(&app),
        "setting.showLicense" | "license.show" => misc::show_license(&app),
        "license.machineCode" => misc::machine_code(),
        "license.activate" => misc::license_activate(&payload),
        "license.deactivate" => misc::license_deactivate(),

        // ---- 设置项（简单桩）----
        "setting.getUserDict" => setting::get_user_dict(),
        "setting.getUserDictionaryPath" => setting::get_user_dictionary_path(),
        "setting.getUnsavedDraftsPath" => setting::get_unsaved_drafts_path(),
        "setting.openConfigFolder" => setting::open_config_folder(),
        "setting.saveUnsavedDraft" => setting::save_unsaved_draft(&payload),
        "setting.latestUnsavedDraft" => setting::latest_unsaved_draft(),
        "setting.checkUpdates" => misc::check_for_updates(&payload).await,
        "setting.resetAllDialogWarnings" => setting::reset_plain(&state, &["noHintForOpenLink"]),
        "setting.resetAdvancedSettings" => setting::reset_plain(&state, &[]),
        "setting.downloadDict" => setting::download_dict(&app, &payload),
        "setting.openUnsavedDraft" => setting::open_unsaved_draft(&app, &state),
        "setting.exitFocusAndTypewriterMode" => setting::exit_focus_and_typewriter_mode(&app),
        "url.request" => misc::url_request(&payload),

        // ---- 缩放与窗口状态 ----
        "setZoom" => window::set_zoom_payload(&window, &payload),
        "window.reportFocus" => window::report_focus(&window, &state),
        "window.selectNextTab" => window::cycle_window(&app, &window, true),
        "window.selectPreviousTab" => window::cycle_window(&app, &window, false),
        "window.setInSourceMode" | "window.setMenuBarVisibility" | "window.loadFinished"
        | "window.updateMenuForIsAlwaysOnTop" => Ok(Value::Bool(true)),
        "window.paste" | "window.pasteAsPlainText" => window::exec_edit_command(&window, "paste"),
        "app.download" => misc::download(&payload),
        "app.sendEvent" => misc::send_event(&app, &payload),
        "logger.debug" => misc::log_message("debug", &payload),
        "logger.info" => misc::log_message("info", &payload),
        "logger.warn" => misc::log_message("warn", &payload),
        "logger.error" => misc::log_message("error", &payload),
        // Electron 的 ipcRenderer.send("sendLog", msg) 是裸通道名（无 logger. 前缀），
        // 走 bridge.send 会落到这里；补上让渲染层 console.sendLog 诊断信息可见。
        "sendLog" => misc::log_message("info", &payload),
        "addBackup" => misc::log_message("info", &payload),
        "app.log" => misc::log_message("info", &payload),
        "updater.checkForUpdates" => misc::check_for_updates(&payload).await,
        "quit" => {
            let windows = app.webview_windows();
            if windows.is_empty() {
                app.exit(0);
            } else {
                for (_, w) in windows {
                    let _ = w.close();
                }
            }
            Ok(Value::Null)
        }

        // ---- app 文件打开 / 文档 ----
        "app.openFile" | "app.openFileOrFolder" | "app.openOrSwitch" => document::open_file(&app, &state, &payload),
        "app.openFolder" | "controller.openFolder" | "controller.selectFolder" => {
            document::open_folder(&app, &state, &payload)
        }
        // controller.* 的其余实现旧主进程放在 document.js（见该文件尾部）
        "controller.switchFolder" => document::switch_folder(&app, &state, &window, &payload),
        "controller.openInArborMark" => document::open_in_arbormark(&window, &payload),
        "controller.canSwitchWithoutAsk" => document::can_switch_without_ask(),
        "document.newWindow" | "controller.openInNewWindow" | "window.new" | "app.newWindow" => {
            document::new_window(&app, &state, &payload)
        }
        "document.switchDocument" => document::switch_document(&state, &window, &payload),
        "document.switchToUntitled" => document::switch_to_untitled(&state, &window),
        "document.loadData" => document::load_data(&state, &window),
        "document.getSnap" | "document.getSnapWithValidation" => document::get_snap(),
        "document.setContent" | "document.setLastSync" => document::set_content(),
        "document.noOtherWindow" => document::no_other_window(&state, &window),
        "document.hasDuplicateName" => document::has_duplicate_name(&state, &window, &payload),
        "document.rename" => document::rename(&state, &window, &payload),
        "document.addSnapAndLastSync" => document::add_snap_and_last_sync(),

        // ---- filesOp：文件操作撤销 ----
        "filesOp.registerUndo" => document::register_undo(&state, &payload),
        "filesOp.undoLabel" => document::undo_label(&state),
        "filesOp.getFocusPath" => document::undo_focus_path(&state),
        "filesOp.performUndo" => document::perform_undo(&state),
        "filesOp.clearUndo" => document::clear_undo(&state),
        "document.isDocumentEdited" => document::is_document_edited(),
        // 快照 / 磁盘重载族（契约见 document.rs 尾部）
        "document.needsUpdateSnap" => document::needs_update_snap(),
        "document.addSnap" => document::add_snap(&payload),
        "document.requestBuildSnap" => document::request_build_snap(),
        "document.getDataFromFile" => document::get_data_from_file(&window, &state),
        "document.refreshContentFromDisk" => document::refresh_content_from_disk(&window, &state),
        "document.enterOversize" => document::enter_oversize(),
        "document.updateChangeCount" => document::update_change_count(),
        "document.updateChangeCountIfUnedited" => document::update_change_count_if_unedited(),
        "document.checkIfMoveOnSave" => document::check_if_move_on_save(&window, &state, &payload),
        "document.recordUnusedAssets" => document::record_unused_assets(&window, &state, &payload),
        // controller.* 余项（旧版在 document.js 中实现）
        "controller.calcMountFolder" => document::calc_mount_folder(&window, &state),
        "controller.shouldLoadFolder" => document::should_load_folder(&window, &state),
        "controller.runCommand" => document::run_command(&payload),
        "controller.showErrorDialog" => document::show_error_dialog(&app, &payload),
        "controller.startDrag" => document::start_drag(&payload),
        "controller.bindFolderMonitor" => document::bind_folder_monitor(&app, &state, &window),
        "controller.screenshotHTML" => export::screenshot_html(&app, &state, &payload).await,
        // 多窗口同文档同步（协议见 document.rs 尾部注释）
        "document.syncFullContent" => document::sync_full_content(&app, &state, &window, &payload),
        "controller.syncFullContent" => document::sync_full_content(&app, &state, &window, &payload),
        "document.getContent" => document::get_content(&window, &state),
        "document.syncChangeIfNeeded" => document::sync_change_if_needed(&window, &state),
        "doc.syncChange" => document::sync_change(&app, &state, &window, &payload),

        "export.recordLastExport" => Ok(Value::Bool(true)),
        "export.printToPDF" => export::print_to_pdf(&app, &state, &payload).await,
        "export.print" => export::print(&app, &state, &window),
        "export.genPrintView" => export::gen_print_view(&app, &state, &payload),
        "export.destroyPrintView" => export::destroy_print_view(&app, &state, &payload),
        "export.prepareImageCapture" => export::prepare_image_capture(&app, &state, &payload).await,
        "export.captureImage" => export::capture_image(&app, &state, &payload).await,
        "export.docx" | "export.odt" | "export.rtf" | "export.epub" | "export.latex"
        | "export.mediawiki" | "export.rst" | "export.textile" | "export.opml" => {
            pandoc::export(&state, &payload)
        }

        // ---- 尚未迁移的域 ----
        other if other.starts_with("export.") => export::handle(other, &payload),
        other if other.starts_with("document.") => document::handle_fallback(other, &payload),

        other => {
            log::debug!("[ipc] 未处理通道: {other}");
            Ok(Value::Null)
        }
    }
}

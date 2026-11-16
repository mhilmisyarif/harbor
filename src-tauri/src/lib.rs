mod commands;

use commands::{apps, audio, icons, layout, media, stats, system_extra, widgets, windows_list};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn toggle_dock(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("dock") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        "Show / hide dock  (Alt+D)",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Harbor", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Harbor")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_dock(app),
            "settings" => {
                let _ = layout::show_settings(app);
            }
            "quit" => {
                layout::release_bar();
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch focuses the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("dock") {
                let _ = w.show();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::ALT, Code::KeyD)
                    {
                        toggle_dock(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(stats::StatsState::default())
        .manage(widgets::Http::default())
        .manage(widgets::NetState::default())
        .setup(|app| {
            let handle = app.handle();
            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyD))?;
            create_tray(handle)?;
            layout::place_bar(handle)?;
            layout::place_dock(handle, 480.0, layout::DOCK_HEIGHT, true)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Bar, dock and panel are never really closed, only hidden.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The widget panel behaves like a popover: click away to dismiss.
            WindowEvent::Focused(false) if window.label() == "widgets" => {
                let _ = window.hide();
                layout::note_widgets_hidden();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            stats::get_stats,
            windows_list::list_windows,
            windows_list::activate_window,
            windows_list::close_window,
            windows_list::foreground_title,
            apps::load_config,
            apps::save_config,
            apps::launch_app,
            icons::app_icon,
            icons::load_custom_icon,
            audio::get_volume,
            audio::set_volume,
            audio::toggle_mute,
            audio::get_microphone,
            audio::toggle_microphone_mute,
            media::now_playing,
            media::media_control,
            system_extra::top_processes,
            system_extra::get_dark_mode,
            system_extra::set_dark_mode,
            system_extra::shell_action,
            system_extra::search_or_open,
            system_extra::recycle_bin_info,
            system_extra::empty_recycle_bin,
            system_extra::input_language,
            system_extra::next_input_language,
            layout::layout_dock,
            layout::toggle_widgets,
            layout::open_settings,
            widgets::weather,
            widgets::geocode,
            widgets::locate_by_ip,
            widgets::stocks,
            widgets::crypto,
            widgets::fx,
            widgets::system_widgets,
            widgets::load_widget_config,
            widgets::save_widget_config,
            widgets::load_widget_data,
            widgets::save_widget_data,
            widgets::crypto_chart,
            widgets::leetcode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Harbor");
}

use colored::Colorize;
use std::{str::FromStr, sync::Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod config;
use config::Config;

mod context;
use context::{active_arc_url, get_focused_app, get_location, get_spotify_track};

// Record mode state
struct RecordModeState {
    enabled: bool,
}

// State type to hold our child process and config
struct AppState {
    server: Mutex<Option<CommandChild>>,
    config: Config,
    record_mode: Mutex<RecordModeState>,
}

fn create_main_window(app: &tauri::AppHandle) {
    let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/main-window".into()))
        .title("Thoughts")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .maximizable(true)
        .minimizable(true)
        .closable(true)
        .transparent(true)
        .center()
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build()
        .unwrap();

    let _ = win_builder.show();
    let _ = win_builder.set_focus();
}

#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    // Always destroy existing window and create fresh one to avoid stale data
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    create_main_window(&app);
}

#[tauri::command]
fn close_quickpanel(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-panel") {
        window.hide().unwrap();
    }
}

#[tauri::command]
fn toggle_record_mode(state: tauri::State<AppState>) -> Result<bool, String> {
    let mut record_mode = state.record_mode.lock().unwrap();
    record_mode.enabled = !record_mode.enabled;
    Ok(record_mode.enabled)
}

#[tauri::command]
fn get_record_mode(state: tauri::State<AppState>) -> Result<bool, String> {
    let record_mode = state.record_mode.lock().unwrap();
    Ok(record_mode.enabled)
}

fn toggle_launchbar(app: &tauri::AppHandle) {
    let window = app
        .get_webview_window("quick-panel")
        .expect("Did you label your window?");
    if let Ok(true) = window.is_visible() {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        window.set_always_on_top(true).unwrap();
    }
}

fn main() {
    let config = Config::new().expect("Failed to initialize config");

    // Determine if we're in dev mode
    let is_dev = cfg!(debug_assertions);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let app_handle = app.app_handle();

            // Cleanup any existing server process
            config.cleanup_existing_server();

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

            let shortcut_hint = if is_dev { "⇧+⌥+Space" } else { "⌥+Space" };
            let open_i = MenuItem::with_id(app, "open", "Open", true, Some(shortcut_hint))?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|tray, event| {
                    let app_handle = tray.app_handle();
                    match event.id().as_ref() {
                        "open" => {
                            // Always create fresh window to avoid stale data
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.close();
                            }
                            create_main_window(app_handle);
                        }
                        "quit" => app_handle.exit(0),
                        _ => {}
                    }
                })
                .build(app_handle)
                .unwrap();

            let window = app.get_webview_window("quick-panel").unwrap();

            // Configure window based on dev/prod mode
            if is_dev {
                // Dev mode: make it a normal window with decorations for easier debugging
                window.set_decorations(true).unwrap();
                window.set_always_on_top(false).unwrap();
                // Don't hide window initially in dev mode
            } else {
                // Production mode: frameless, always on top
                window.set_decorations(false).unwrap();
                window.set_always_on_top(true).unwrap();
                // Hide window initially in production
                window.hide().unwrap();
            }

            // Run sidecar tRPC server
            let sidecar = app.shell().sidecar("server").unwrap();
            let (mut rx, child) = sidecar.spawn().expect("Failed to spawn sidecar");

            // Store the PID in the file
            config
                .write_pid_file(child.pid())
                .expect("Failed to write PID file");

            // Store the child process handle and config in state
            app.manage(AppState {
                server: Mutex::new(Some(child)),
                config,
                record_mode: Mutex::new(RecordModeState { enabled: false }),
            });

            // Set up event handling for stdout/stderr
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!(
                                "{} {}",
                                "[tRPC]".bright_blue().bold(),
                                String::from_utf8_lossy(&line)
                            );
                        }
                        CommandEvent::Stderr(line) => {
                            println!(
                                "{} {}",
                                "[tRPC]".bright_red().bold(),
                                String::from_utf8_lossy(&line)
                            );
                        }
                        _ => {}
                    }
                }
            });

            // Set up window to close when it loses focus (only in production)
            if !is_dev {
                let window_clone = window.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Focused(focused) => {
                        if !focused {
                            let _ = window_clone.hide();
                        }
                    }
                    _ => {}
                });
            }

            // Use different shortcuts for dev vs production
            let shortcut = if is_dev {
                Shortcut::new(Some(Modifiers::SHIFT | Modifiers::ALT), Code::Space)
            } else {
                Shortcut::new(Some(Modifiers::ALT), Code::Space)
            };

            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Register the plugin with handlers
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, registered_shortcut, event| {
                        if registered_shortcut == &shortcut {
                            match event.state() {
                                ShortcutState::Pressed => {
                                    toggle_launchbar(app);
                                }
                                ShortcutState::Released => {
                                    // Handle release if needed
                                }
                            }
                        }
                    })
                    .build(),
            )?;
            app.global_shortcut().register(shortcut)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_main_window,
            close_quickpanel,
            active_arc_url,
            get_spotify_track,
            get_focused_app,
            get_location,
            toggle_record_mode,
            get_record_mode
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Some(mut child) = state.server.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                    state.config.cleanup_pid_file();
                }
            }
            _ => {}
        });
}

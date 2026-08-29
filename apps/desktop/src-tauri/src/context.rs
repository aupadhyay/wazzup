use std::io::{self, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::Manager;

const GET_SPOTIFY_TRACK: &str =
    include_str!("../scripts/applescript/get_spotify_track.applescript");
const GET_FOCUSED_APP: &str = include_str!("../scripts/applescript/get_focused_app.applescript");

const LOCATION_CLI_RELATIVE: &str = "resources/CoreLocationCLI.app/Contents/MacOS/CoreLocationCLI";

/// Known browsers: AppleScript app/process name + expression that returns the active URL.
/// Dia and Arc share a Chromium-family dictionary (`URL of active tab`).
const BROWSERS: &[(&str, &str)] = &[
    ("Dia", "URL of active tab of window 1"),
    ("Arc", "URL of active tab of front window"),
    ("Safari", "URL of current tab of front window"),
    ("Google Chrome", "URL of active tab of front window"),
    ("Brave Browser", "URL of active tab of front window"),
    ("Microsoft Edge", "URL of active tab of front window"),
    ("Chromium", "URL of active tab of front window"),
];

fn io_err(message: impl Into<String>) -> tauri::Error {
    tauri::Error::Io(io::Error::new(io::ErrorKind::Other, message.into()))
}

fn is_process_running(process_name: &str) -> bool {
    Command::new("/usr/bin/pgrep")
        .args(["-x", process_name])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_script_source(source: &str) -> Result<String, tauri::Error> {
    let mut child = Command::new("osascript")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(tauri::Error::Io)?;

    {
        let mut stdin = child.stdin.take().ok_or_else(|| {
            tauri::Error::Io(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "osascript stdin is unavailable",
            ))
        })?;
        stdin
            .write_all(source.as_bytes())
            .map_err(tauri::Error::Io)?;
    }

    let output = child.wait_with_output().map_err(tauri::Error::Io)?;

    if !output.status.success() {
        return Err(io_err(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn run_app_script_source(app_process_name: &str, source: &str) -> Result<String, tauri::Error> {
    if !is_process_running(app_process_name) {
        return Err(tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{app_process_name} is not running"),
        )));
    }

    run_script_source(source)
}

fn browser_url_script(app_name: &str, url_expr: &str) -> String {
    format!(
        r#"if application "{app}" is not running then error "{app} is not running"
tell application "{app}"
    if (count of windows) is 0 then error "{app} has no windows"
    set theUrl to {expr}
    if theUrl is missing value or theUrl is "" then error "{app} has no active URL"
    return theUrl
end tell"#,
        app = app_name,
        expr = url_expr,
    )
}

fn ordered_browsers(focused_name: Option<&str>) -> Vec<(&'static str, &'static str)> {
    let mut browsers: Vec<_> = BROWSERS.to_vec();
    if let Some(name) = focused_name {
        if let Some(index) = browsers.iter().position(|(app, _)| *app == name) {
            let preferred = browsers.remove(index);
            browsers.insert(0, preferred);
        }
    }
    browsers
}

fn is_usable_url(url: &str) -> bool {
    !url.is_empty() && url != "missing value"
}

/// Active URL from the focused browser when possible, otherwise the first running
/// supported browser (Dia, Arc, Safari, Chrome, and other Chromium apps).
#[tauri::command]
pub fn active_browser_url() -> Result<String, tauri::Error> {
    let focused_name = get_focused_app().ok().map(|app| app.name);
    let mut errors: Vec<String> = Vec::new();
    let mut tried_any = false;

    for (app, url_expr) in ordered_browsers(focused_name.as_deref()) {
        if !is_process_running(app) {
            continue;
        }
        tried_any = true;
        match run_script_source(&browser_url_script(app, url_expr)) {
            Ok(url) if is_usable_url(&url) => return Ok(url),
            Ok(url) => errors.push(format!("{app}: unusable URL {url:?}")),
            Err(error) => errors.push(format!("{app}: {error}")),
        }
    }

    if !tried_any {
        return Err(io_err("No supported browser is running"));
    }

    Err(io_err(format!(
        "Could not read a browser URL ({})",
        errors.join("; ")
    )))
}

#[tauri::command]
pub fn active_arc_url() -> Result<String, tauri::Error> {
    active_browser_url()
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SpotifyTrackInfo {
    artist: String,
    track: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct FocusedAppInfo {
    name: String,
    #[serde(rename = "bundleId")]
    bundle_id: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct LocationInfo {
    #[serde(rename = "time_local")]
    time_local: String,
    #[serde(rename = "subThoroughfare")]
    sub_thoroughfare: Option<String>,
    name: Option<String>,
    altitude: String,
    #[serde(rename = "h_accuracy")]
    h_accuracy: String,
    thoroughfare: Option<String>,
    region: String,
    locality: Option<String>,
    #[serde(rename = "administrativeArea")]
    administrative_area: Option<String>,
    longitude: String,
    #[serde(rename = "timeZone")]
    time_zone: String,
    direction: String,
    #[serde(rename = "isoCountryCode")]
    iso_country_code: Option<String>,
    #[serde(rename = "subLocality")]
    sub_locality: Option<String>,
    latitude: String,
    time: String,
    address: Option<String>,
    #[serde(rename = "subAdministrativeArea")]
    sub_administrative_area: Option<String>,
    speed: String,
    #[serde(rename = "postalCode")]
    postal_code: Option<String>,
    #[serde(rename = "v_accuracy")]
    v_accuracy: String,
    country: Option<String>,
}

#[tauri::command]
pub fn get_spotify_track() -> Result<SpotifyTrackInfo, tauri::Error> {
    let output_str = run_app_script_source("Spotify", GET_SPOTIFY_TRACK)?;
    let track_info: SpotifyTrackInfo = serde_json::from_str(&output_str)?;
    Ok(track_info)
}

#[tauri::command]
pub fn get_focused_app() -> Result<FocusedAppInfo, tauri::Error> {
    let output_str = run_script_source(GET_FOCUSED_APP)?;
    let app_info: FocusedAppInfo = serde_json::from_str(&output_str)?;
    Ok(app_info)
}

fn location_cli_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = app
        .path()
        .resolve(LOCATION_CLI_RELATIVE, tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(LOCATION_CLI_RELATIVE));
    candidates.push(PathBuf::from(
        "/Applications/CoreLocationCLI.app/Contents/MacOS/CoreLocationCLI",
    ));
    candidates.push(PathBuf::from("/opt/homebrew/bin/CoreLocationCLI"));
    candidates.push(PathBuf::from("/usr/local/bin/CoreLocationCLI"));
    candidates
}

fn resolve_location_cli(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    location_cli_candidates(app)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            io_err(
                "CoreLocationCLI was not found. It should be bundled at resources/CoreLocationCLI.app.",
            )
        })
}

#[tauri::command]
pub fn get_location(app: tauri::AppHandle) -> Result<LocationInfo, tauri::Error> {
    let cli_path = resolve_location_cli(&app)?;
    let output = Command::new(&cli_path)
        .arg("--json")
        .output()
        .map_err(tauri::Error::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!(
                "{} exited unsuccessfully",
                cli_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("CoreLocationCLI")
            )
        };
        return Err(io_err(detail));
    }

    let output_str = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let location_info: LocationInfo = serde_json::from_str(&output_str)?;
    Ok(location_info)
}

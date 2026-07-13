use std::io;
use std::path::PathBuf;
use std::process::Command;

fn get_script_path(script_name: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("scripts");
    path.push("applescript");
    path.push(script_name);
    path
}

fn run_script(script_path: &PathBuf) -> Result<String, tauri::Error> {
    let output = Command::new("osascript")
        .arg(script_path)
        .output()
        .map_err(|e| tauri::Error::Io(e))?;

    if !output.status.success() {
        return Err(tauri::Error::Io(io::Error::new(
            io::ErrorKind::Other,
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn run_app_script(app_process_name: &str, script_path: &PathBuf) -> Result<String, tauri::Error> {
    let status = Command::new("/usr/bin/pgrep")
        .args(["-x", app_process_name])
        .status()
        .map_err(tauri::Error::Io)?;

    if !status.success() {
        return Err(tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{app_process_name} is not running"),
        )));
    }

    run_script(script_path)
}

#[tauri::command]
pub fn active_arc_url() -> Result<String, tauri::Error> {
    let script_path = get_script_path("get_arc_url.applescript");
    run_app_script("Arc", &script_path)
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
    let script_path = get_script_path("get_spotify_track.applescript");
    let output_str = run_app_script("Spotify", &script_path)?;

    let track_info: SpotifyTrackInfo = serde_json::from_str(&output_str)?;

    Ok(track_info)
}

#[tauri::command]
pub fn get_focused_app() -> Result<FocusedAppInfo, tauri::Error> {
    let script_path = get_script_path("get_focused_app.applescript");
    let output_str = run_script(&script_path)?;

    let app_info: FocusedAppInfo = serde_json::from_str(&output_str)?;

    Ok(app_info)
}

#[tauri::command]
pub fn get_location() -> Result<LocationInfo, tauri::Error> {
    let output = Command::new("/opt/homebrew/bin/CoreLocationCLI")
        .arg("--json")
        .output()
        .map_err(|e| tauri::Error::Io(e))?;

    let output_str = String::from_utf8_lossy(&output.stdout).trim().to_owned();

    let location_info: LocationInfo = serde_json::from_str(&output_str)?;

    Ok(location_info)
}

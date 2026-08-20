use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::Duration;
use std::{env, fs};

pub const DEFAULT_SIDECAR_PORT: u16 = 4318;

/// 4318/4319 are OpenTelemetry OTLP defaults and are commonly claimed by Datadog.
/// Keep this list in sync with packages/rpc/server.ts.
const BACKUP_SIDECAR_PORTS: &[u16] = &[4320, 4321, 14130, 14131, 14132, 14133];

pub struct Config {
    config_dir: PathBuf,
    port: u16,
}

fn is_port_in_use(port: u16) -> bool {
    let timeout = Duration::from_millis(150);
    let addrs = [
        SocketAddr::from(([127, 0, 0, 1], port)),
        SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
    ];

    addrs
        .iter()
        .any(|addr| TcpStream::connect_timeout(addr, timeout).is_ok())
}

fn bind_ephemeral_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.local_addr().map(|addr| addr.port())
}

fn resolve_sidecar_port(preferred: u16) -> io::Result<u16> {
    let mut candidates = Vec::with_capacity(BACKUP_SIDECAR_PORTS.len() + 1);
    candidates.push(preferred);
    for &port in BACKUP_SIDECAR_PORTS {
        if port != preferred {
            candidates.push(port);
        }
    }

    for port in candidates {
        if !is_port_in_use(port) {
            if port != preferred {
                eprintln!(
                    "SIDECAR_PORT {} is in use; using backup port {}",
                    preferred, port
                );
            }
            return Ok(port);
        }
        eprintln!("Port {} is in use, trying a backup sidecar port...", port);
    }

    let port = bind_ephemeral_port()?;
    eprintln!(
        "All backup sidecar ports are in use; using ephemeral port {}",
        port
    );
    Ok(port)
}

impl Config {
    pub fn new() -> Result<Self, io::Error> {
        let preferred_port = env::var("SIDECAR_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_SIDECAR_PORT);
        let port = resolve_sidecar_port(preferred_port)?;

        let config_dir = match env::var("THOUGHTS_CONFIG_PATH").map(PathBuf::from) {
            Ok(path) => path,
            Err(_) => {
                let home_dir = dirs::home_dir().ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "Could not determine home directory",
                    )
                })?;
                eprintln!(
                    "Warning: THOUGHTS_CONFIG_PATH not set, using home directory as fallback"
                );
                home_dir.join(".thoughts")
            }
        };

        // Ensure config directory exists
        fs::create_dir_all(&config_dir)?;

        Ok(Config { config_dir, port })
    }

    pub fn get_port(&self) -> u16 {
        self.port
    }

    pub fn get_pid_file_path(&self) -> PathBuf {
        self.config_dir.join(format!("server-{}.pid", self.port))
    }

    pub fn write_pid_file(&self, pid: u32) -> io::Result<()> {
        fs::write(self.get_pid_file_path(), pid.to_string())
    }

    pub fn read_pid_file(&self) -> Option<u32> {
        fs::read_to_string(self.get_pid_file_path())
            .ok()
            .and_then(|content| content.trim().parse().ok())
    }

    pub fn cleanup_existing_server(&self) {
        if let Some(pid) = self.read_pid_file() {
            // Try to kill the process
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
            // Remove the PID file regardless of kill success
            let _ = fs::remove_file(self.get_pid_file_path());
        }
    }

    pub fn cleanup_pid_file(&self) {
        let _ = fs::remove_file(self.get_pid_file_path());
    }
}

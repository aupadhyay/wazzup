use std::io;
use std::path::PathBuf;
use std::{env, fs};

pub struct Config {
    config_dir: PathBuf,
    port: u16,
}

impl Config {
    pub fn new(port: u16) -> Result<Self, io::Error> {
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

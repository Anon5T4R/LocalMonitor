//! Programas na inicialização (aba "Inicialização").
//! Windows: chaves Run de HKCU + HKLM. Linux: `.desktop` em ~/.config/autostart
//! e /etc/xdg/autostart. Só LISTA (abrir a pasta pra desativar fica pro SO) —
//! remover entrada de outro programa é destrutivo demais pra um clique.

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupEntry {
    pub name: String,
    pub command: String,
    pub source: String, // "HKCU" | "HKLM" | caminho do .desktop
}

#[cfg(windows)]
pub fn list_startup() -> Vec<StartupEntry> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut out = Vec::new();
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    for (hive, label) in [(HKEY_CURRENT_USER, "HKCU"), (HKEY_LOCAL_MACHINE, "HKLM")] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(RUN) {
            for (name, value) in key.enum_values().flatten() {
                out.push(StartupEntry {
                    name,
                    command: value.to_string(),
                    source: label.to_string(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(not(windows))]
pub fn list_startup() -> Vec<StartupEntry> {
    use std::fs;

    let mut out = Vec::new();
    let mut dirs: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from("/etc/xdg/autostart")];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(std::path::Path::new(&home).join(".config/autostart"));
    }
    for dir in dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else { continue };
            // Pula os desativados (Hidden=true / X-GNOME-Autostart-enabled=false).
            let disabled = text.lines().any(|l| {
                let l = l.trim().to_lowercase();
                l == "hidden=true" || l == "x-gnome-autostart-enabled=false"
            });
            if disabled {
                continue;
            }
            let field = |k: &str| {
                text.lines()
                    .find_map(|l| l.strip_prefix(k).map(|v| v.trim().to_string()))
            };
            let name = field("Name=").unwrap_or_else(|| {
                path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            });
            out.push(StartupEntry {
                name,
                command: field("Exec=").unwrap_or_default(),
                source: path.to_string_lossy().into_owned(),
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

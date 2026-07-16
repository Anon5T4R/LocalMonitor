//! LocalMonitor — Gerenciador de Tarefas local: uma thread refresca o
//! `sysinfo` a cada 1,5 s e emite o snapshot (`sys-stats`); processos vêm
//! sob demanda (comando). Encerrar processo é pedido explícito da UI (com
//! confirmação lá — não é destrutivo de dados, mas derruba o app alvo).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiskInfo {
    mount: String,
    total: u64,
    available: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Stats {
    cpu_total: f32,
    per_core: Vec<f32>,
    mem_used: u64,
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    /// Bytes/s desde a última amostra (somados em todas as interfaces).
    net_rx: u64,
    net_tx: u64,
    disks: Vec<DiskInfo>,
    uptime_s: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcRow {
    pid: u32,
    name: String,
    cpu: f32,
    mem: u64,
}

/// System compartilhado entre a thread de stats e o comando de processos.
pub struct Sys(Mutex<System>);

fn collect_stats(sys: &mut System, networks: &mut Networks, disks: &mut Disks, interval_s: f64) -> Stats {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    networks.refresh(true);
    disks.refresh(true);

    let (mut rx, mut tx) = (0u64, 0u64);
    for (_name, data) in networks.iter() {
        rx += data.received();
        tx += data.transmitted();
    }

    Stats {
        cpu_total: sys.global_cpu_usage(),
        per_core: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        net_rx: (rx as f64 / interval_s) as u64,
        net_tx: (tx as f64 / interval_s) as u64,
        disks: disks
            .iter()
            .map(|d| DiskInfo {
                mount: d.mount_point().to_string_lossy().into_owned(),
                total: d.total_space(),
                available: d.available_space(),
            })
            .collect(),
        uptime_s: System::uptime(),
    }
}

/// Lista de processos (ordenação/corte na UI; teto de 400 pra não pesar).
#[tauri::command(async)]
fn list_processes(state: tauri::State<'_, Sys>) -> Vec<ProcRow> {
    let mut sys = state.0.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut rows: Vec<ProcRow> = sys
        .processes()
        .values()
        .map(|p| ProcRow {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu: p.cpu_usage(),
            mem: p.memory(),
        })
        .collect();
    rows.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
    rows.truncate(400);
    rows
}

/// Encerra um processo (a UI confirma antes).
#[tauri::command(async)]
fn kill_process(state: tauri::State<'_, Sys>, pid: u32) -> Result<(), String> {
    let sys = state.0.lock().unwrap();
    let p = sys
        .process(sysinfo::Pid::from_u32(pid))
        .ok_or("processo não encontrado (já saiu?)")?;
    if p.kill() {
        Ok(())
    } else {
        Err("o sistema recusou (permissão?)".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .manage(Sys(Mutex::new(System::new_all())))
        .setup(|app| {
            let handle: AppHandle = app.handle().clone();
            std::thread::spawn(move || {
                let mut networks = Networks::new_with_refreshed_list();
                let mut disks = Disks::new_with_refreshed_list();
                const INTERVAL: f64 = 1.5;
                loop {
                    {
                        let state = handle.state::<Sys>();
                        let mut sys = state.0.lock().unwrap();
                        let stats = collect_stats(&mut sys, &mut networks, &mut disks, INTERVAL);
                        let _ = handle.emit("sys-stats", stats);
                    }
                    std::thread::sleep(Duration::from_secs_f64(INTERVAL));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_processes, kill_process])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_stats_tem_dados_basicos() {
        let mut sys = System::new_all();
        let mut networks = Networks::new_with_refreshed_list();
        let mut disks = Disks::new_with_refreshed_list();
        std::thread::sleep(Duration::from_millis(250));
        let s = collect_stats(&mut sys, &mut networks, &mut disks, 0.25);
        assert!(s.mem_total > 0);
        assert!(!s.per_core.is_empty());
    }
}

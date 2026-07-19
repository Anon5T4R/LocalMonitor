//! LocalMonitor — Gerenciador de Tarefas local: uma thread refresca o
//! `sysinfo` a cada 1,5 s e emite o snapshot (`sys-stats`); processos vêm
//! sob demanda (comando). Encerrar processo é pedido explícito da UI (com
//! confirmação lá — não é destrutivo de dados, mas derruba o app alvo).

mod diskscan;
mod startup;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Disks, Networks, Pid, ProcessesToUpdate, System, Users};
use tauri::{AppHandle, Emitter, Manager};

use diskscan::{DirView, ScanDone, ScanState};
use startup::StartupEntry;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiskInfo {
    mount: String,
    total: u64,
    available: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetIface {
    name: String,
    rx: u64,
    tx: u64,
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
    /// Mesmas taxas, por interface (só as com tráfego, ordenadas por volume).
    net_ifaces: Vec<NetIface>,
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

/// Detalhe de um processo (aberto ao clicar numa linha).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcDetail {
    pid: u32,
    name: String,
    exe: Option<String>,
    cmd: String,
    cwd: Option<String>,
    user: Option<String>,
    parent: Option<u32>,
    status: String,
    cpu: f32,
    mem: u64,
    virtual_mem: u64,
    run_time_s: u64,
    /// Bytes lidos/escritos em disco desde a última amostra do sysinfo.
    disk_read: u64,
    disk_written: u64,
}

/// System compartilhado entre a thread de stats e o comando de processos.
pub struct Sys(Mutex<System>);

/// Intervalo (ms) do loop de stats — ajustável pela UI.
pub struct StatsInterval(AtomicU64);

fn collect_stats(sys: &mut System, networks: &mut Networks, disks: &mut Disks, interval_s: f64) -> Stats {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    networks.refresh(true);
    disks.refresh(true);

    let (mut rx, mut tx) = (0u64, 0u64);
    let rate = |b: u64| (b as f64 / interval_s) as u64;
    let mut ifaces: Vec<NetIface> = Vec::new();
    for (name, data) in networks.iter() {
        let (r, t) = (data.received(), data.transmitted());
        rx += r;
        tx += t;
        if r > 0 || t > 0 {
            ifaces.push(NetIface { name: name.clone(), rx: rate(r), tx: rate(t) });
        }
    }
    ifaces.sort_by_key(|i| std::cmp::Reverse(i.rx + i.tx));

    Stats {
        cpu_total: sys.global_cpu_usage(),
        per_core: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        net_rx: rate(rx),
        net_tx: rate(tx),
        net_ifaces: ifaces,
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

/// Detalhe completo de um processo (exe, linha de comando, usuário, IO…).
#[tauri::command(async)]
fn process_detail(state: tauri::State<'_, Sys>, pid: u32) -> Result<ProcDetail, String> {
    let mut sys = state.0.lock().unwrap();
    let target = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
    let users = Users::new_with_refreshed_list();
    let p = sys.process(target).ok_or("processo não encontrado (já saiu?)")?;
    let du = p.disk_usage();
    Ok(ProcDetail {
        pid,
        name: p.name().to_string_lossy().into_owned(),
        exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
        cmd: p
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" "),
        cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
        user: p
            .user_id()
            .and_then(|uid| users.get_user_by_id(uid))
            .map(|u| u.name().to_string()),
        parent: p.parent().map(|pp| pp.as_u32()),
        status: p.status().to_string(),
        cpu: p.cpu_usage(),
        mem: p.memory(),
        virtual_mem: p.virtual_memory(),
        run_time_s: p.run_time(),
        disk_read: du.read_bytes,
        disk_written: du.written_bytes,
    })
}

/// Programas na inicialização do sistema (aba "Inicialização").
#[tauri::command(async)]
fn list_startup() -> Vec<StartupEntry> {
    startup::list_startup()
}

/// Ajusta o intervalo (ms) do loop de stats (clamp 500–10000).
#[tauri::command(async)]
fn set_stats_interval(state: tauri::State<'_, StatsInterval>, ms: u64) {
    state.0.store(ms.clamp(500, 10000), Ordering::Relaxed);
}

/// Dispara a varredura de disco numa thread própria.
///
/// Retorna IMEDIATAMENTE — varrer `C:\` leva minutos e segurar o comando
/// deixaria a janela sem resposta. O progresso vai por `disk-scan-progress`
/// e o fim por `disk-scan-done` (com `canceled` dizendo como terminou).
/// Uma varredura por vez: a segunda chamada é recusada com erro em vez de
/// competir pelo mesmo state.
#[tauri::command(async)]
fn disk_scan_start(app: AppHandle, path: String) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("não é uma pasta acessível: {path}"));
    }
    let state = app.state::<ScanState>();
    // compare_exchange: dois cliques rápidos no botão não podem virar duas
    // threads varrendo e escrevendo no mesmo mapa.
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("já existe uma varredura em andamento".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    // Limpa o resultado anterior já: se a nova varredura for cancelada no
    // meio, é melhor a UI ver o parcial novo do que o completo antigo.
    state.map.lock().unwrap().clear();
    state.sizes.lock().unwrap().clear();

    let handle = app.clone();
    std::thread::spawn(move || {
        let inicio = Instant::now();
        let st = handle.state::<ScanState>();
        let mut emitir = |p: &diskscan::ScanProgress| {
            let _ = handle.emit("disk-scan-progress", p);
        };
        let (map, sizes, totals) = diskscan::scan(&root, &st.cancel, &mut emitir);
        let canceled = st.cancel.load(Ordering::SeqCst);
        *st.map.lock().unwrap() = map;
        *st.sizes.lock().unwrap() = sizes;
        *st.totals.lock().unwrap() = totals.clone();
        // running só cai DEPOIS do resultado publicado: assim quem receber o
        // evento de fim já encontra o mapa pronto pra consultar.
        st.running.store(false, Ordering::SeqCst);
        let _ = handle.emit(
            "disk-scan-done",
            ScanDone {
                root: root.to_string_lossy().into_owned(),
                canceled,
                elapsed_ms: inicio.elapsed().as_millis() as u64,
                totals,
            },
        );
    });
    Ok(())
}

/// Pede o cancelamento (a thread checa a flag a cada entrada de diretório,
/// então para em milissegundos). O parcial varrido até ali é preservado.
#[tauri::command(async)]
fn disk_scan_cancel(state: tauri::State<'_, ScanState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Filhos de UMA pasta da última varredura (é o que o treemap desenha).
#[tauri::command(async)]
fn disk_entries(state: tauri::State<'_, ScanState>, path: String) -> Result<DirView, String> {
    let map = state.map.lock().unwrap();
    let sizes = state.sizes.lock().unwrap();
    diskscan::dir_view(&map, &sizes, &path).ok_or_else(|| format!("pasta fora da varredura: {path}"))
}

/// Raízes sugeridas pra varrer (pontos de montagem reais da máquina) — evita
/// obrigar o usuário a digitar `C:\` na mão.
#[tauri::command(async)]
fn disk_roots() -> Vec<String> {
    Disks::new_with_refreshed_list()
        .iter()
        .map(|d| d.mount_point().to_string_lossy().into_owned())
        .collect()
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
        .manage(StatsInterval(AtomicU64::new(1500)))
        .manage(ScanState {
            cancel: AtomicBool::new(false),
            running: AtomicBool::new(false),
            ..Default::default()
        })
        .setup(|app| {
            let handle: AppHandle = app.handle().clone();
            std::thread::spawn(move || {
                let mut networks = Networks::new_with_refreshed_list();
                let mut disks = Disks::new_with_refreshed_list();
                let mut last = Instant::now();
                loop {
                    let ms = handle.state::<StatsInterval>().0.load(Ordering::Relaxed);
                    std::thread::sleep(Duration::from_millis(ms));
                    // Divide o tráfego pela janela REAL medida (o intervalo pode
                    // ter mudado no meio) pra a taxa em bytes/s ficar correta.
                    let now = Instant::now();
                    let elapsed = now.duration_since(last).as_secs_f64().max(0.001);
                    last = now;
                    let state = handle.state::<Sys>();
                    let mut sys = state.0.lock().unwrap();
                    let stats = collect_stats(&mut sys, &mut networks, &mut disks, elapsed);
                    drop(sys);
                    let _ = handle.emit("sys-stats", stats);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_processes,
            kill_process,
            process_detail,
            list_startup,
            set_stats_interval,
            disk_scan_start,
            disk_scan_cancel,
            disk_entries,
            disk_roots
        ])
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

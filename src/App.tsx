import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import SettingsModal from "./components/SettingsModal";
import Toasts from "./components/Toasts";
import { t } from "./lib/i18n";
import { formatBytes, formatUptime, sparkPoints } from "./lib/fmt";
import { useUi } from "./state/ui";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const HISTORY = 60;

interface DiskInfo {
  mount: string;
  total: number;
  available: number;
}

interface Stats {
  cpuTotal: number;
  perCore: number[];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  netRx: number;
  netTx: number;
  disks: DiskInfo[];
  uptimeS: number;
}

interface ProcRow {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
}

function Spark({ samples, max }: { samples: number[]; max: number }) {
  const points = sparkPoints(samples, 260, 56, max);
  return (
    <svg className="spark" viewBox="0 0 260 56" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

interface StartupEntry {
  name: string;
  command: string;
  source: string;
}

export default function App() {
  const [tab, setTab] = useState<"overview" | "processes" | "startup">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const cpuHist = useRef<number[]>([]);
  const rxHist = useRef<number[]>([]);
  const txHist = useRef<number[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState<"cpu" | "mem" | "name">("cpu");
  const [confirmKill, setConfirmKill] = useState<ProcRow | null>(null);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    if (!isTauri) return;
    const un = listen<Stats>("sys-stats", (e) => {
      setStats(e.payload);
      const push = (arr: number[], v: number) => {
        arr.push(v);
        if (arr.length > HISTORY) arr.shift();
      };
      push(cpuHist.current, e.payload.cpuTotal);
      push(rxHist.current, e.payload.netRx);
      push(txHist.current, e.payload.netTx);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const reloadProcs = async () => {
    if (!isTauri) return;
    setProcs(await invoke<ProcRow[]>("list_processes").catch(() => []));
  };

  // Aba de processos: recarrega a cada 3 s.
  useEffect(() => {
    if (tab !== "processes") return;
    void reloadProcs();
    const id = setInterval(() => void reloadProcs(), 3000);
    return () => clearInterval(id);
  }, [tab]);

  // Aba de inicialização: carrega uma vez ao abrir.
  useEffect(() => {
    if (tab !== "startup" || !isTauri) return;
    void invoke<StartupEntry[]>("list_startup").then(setStartup).catch(() => setStartup([]));
  }, [tab]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? procs.filter((p) => p.name.toLowerCase().includes(f)) : [...procs];
    list.sort((a, b) =>
      sortBy === "name" ? a.name.localeCompare(b.name) : sortBy === "mem" ? b.mem - a.mem : b.cpu - a.cpu,
    );
    return list.slice(0, 200);
  }, [procs, filter, sortBy]);

  const kill = async (p: ProcRow) => {
    setConfirmKill(null);
    try {
      await invoke("kill_process", { pid: p.pid });
      pushToast("ok", t("proc.killed"));
      await reloadProcs();
    } catch (e) {
      pushToast("error", t("proc.killFailed", { error: String(e) }));
    }
  };

  const netMax = Math.max(1024 * 128, ...rxHist.current, ...txHist.current);

  return (
    <div className="app">
      <div className="topbar">
        <div className="segmented">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            {t("tab.overview")}
          </button>
          <button
            className={tab === "processes" ? "active" : ""}
            onClick={() => setTab("processes")}
          >
            {t("tab.processes")}
          </button>
          <button className={tab === "startup" ? "active" : ""} onClick={() => setTab("startup")}>
            {t("tab.startup")}
          </button>
        </div>
        <span className="toolbar-fill" />
        {stats && (
          <span className="muted uptime">
            {t("card.uptime")}: {formatUptime(stats.uptimeS)}
          </span>
        )}
        <button title={t("top.settingsTitle")} onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </div>

      {tab === "overview" && (
        <div className="grid">
          <div className="card">
            <div className="card-head">
              <strong>{t("card.cpu")}</strong>
              <span className="big">{stats ? `${stats.cpuTotal.toFixed(0)}%` : "—"}</span>
            </div>
            <Spark samples={cpuHist.current} max={100} />
            <div className="cores">
              {stats?.perCore.map((c, i) => (
                <div key={i} className="core-track" title={`${c.toFixed(0)}%`}>
                  <div className="core-fill" style={{ height: `${Math.min(100, c)}%` }} />
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <strong>{t("card.mem")}</strong>
              <span className="big">
                {stats ? `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}` : "—"}
              </span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: stats ? `${(stats.memUsed / stats.memTotal) * 100}%` : 0 }}
              />
            </div>
            {stats && stats.swapTotal > 0 && (
              <div className="muted small">
                {t("card.swap")}: {formatBytes(stats.swapUsed)} / {formatBytes(stats.swapTotal)}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <strong>{t("card.net")}</strong>
              <span className="big">
                {stats
                  ? `${t("net.down", { v: formatBytes(stats.netRx) })}  ${t("net.up", { v: formatBytes(stats.netTx) })}`
                  : "—"}
              </span>
            </div>
            <Spark samples={rxHist.current} max={netMax} />
            <Spark samples={txHist.current} max={netMax} />
          </div>

          <div className="card">
            <div className="card-head">
              <strong>{t("card.disks")}</strong>
            </div>
            {stats?.disks.map((d) => {
              const used = d.total > 0 ? (d.total - d.available) / d.total : 0;
              return (
                <div key={d.mount} className="disk-row">
                  <span className="disk-mount">{d.mount}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${used * 100}%` }} />
                  </div>
                  <span className="muted small">
                    {t("disk.freeOf", { free: formatBytes(d.available), total: formatBytes(d.total) })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "processes" && (
        <div className="procs">
          <div className="procs-bar">
            <input
              value={filter}
              placeholder={t("proc.search")}
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button onClick={() => void reloadProcs()}>{t("proc.refresh")}</button>
          </div>
          <div className="procs-head">
            <button className="col name" onClick={() => setSortBy("name")}>
              {t("proc.name")} {sortBy === "name" && "▲"}
            </button>
            <span className="col pid">{t("proc.pid")}</span>
            <button className="col num" onClick={() => setSortBy("cpu")}>
              {t("proc.cpu")} {sortBy === "cpu" && "▼"}
            </button>
            <button className="col num" onClick={() => setSortBy("mem")}>
              {t("proc.mem")} {sortBy === "mem" && "▼"}
            </button>
            <span className="col act" />
          </div>
          <div className="procs-body">
            {shown.map((p) => (
              <div key={p.pid} className="proc-row">
                <span className="col name" title={p.name}>
                  {p.name}
                </span>
                <span className="col pid muted">{p.pid}</span>
                <span className="col num">{p.cpu.toFixed(1)}</span>
                <span className="col num">{formatBytes(p.mem)}</span>
                <span className="col act">
                  <button className="kill-btn" onClick={() => setConfirmKill(p)}>
                    {t("proc.kill")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "startup" && (
        <div className="startup">
          <div className="startup-note muted small">{t("startup.note")}</div>
          <div className="startup-head">
            <span className="col name">{t("startup.name")}</span>
            <span className="col src">{t("startup.source")}</span>
            <span className="col cmd">{t("startup.command")}</span>
          </div>
          <div className="startup-body">
            {startup.length === 0 && <div className="muted list-msg">{t("startup.empty")}</div>}
            {startup.map((s, i) => (
              <div key={i} className="startup-row">
                <span className="col name" title={s.name}>
                  {s.name}
                </span>
                <span className="col src muted" title={s.source}>
                  {s.source}
                </span>
                <span className="col cmd muted" title={s.command}>
                  {s.command}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmKill && (
        <div className="modal-backdrop" onClick={() => setConfirmKill(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>{t("proc.killConfirm", { name: confirmKill.name, pid: confirmKill.pid })}</p>
            <div className="modal-actions">
              <button onClick={() => setConfirmKill(null)}>{t("dlg.cancel")}</button>
              <button className="danger" onClick={() => void kill(confirmKill)}>
                {t("dlg.kill")}
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal />
      <Toasts />
    </div>
  );
}

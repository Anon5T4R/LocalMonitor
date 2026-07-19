import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBytes } from "../lib/fmt";
import { t } from "../lib/i18n";
import { collapseTail, squarify, type Rect } from "../lib/treemap";
import { useUi } from "../state/ui";

/**
 * Aba "Disco": manda o Rust varrer, acompanha o progresso e desenha o nível
 * atual como treemap. Nada aqui é destrutivo — o app não apaga arquivo, e o
 * rodapé diz isso pro usuário não esperar um botão de excluir.
 */

// Gotcha da suíte: fora do Tauri (vite dev no navegador, testes) o `invoke`
// rejeita e o `listen` nem existe. Toda chamada passa por esta guarda.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Teto de retângulos desenhados por nível. Ver collapseTail: acima disso as
 *  células ficam sub-pixel, o React engasga e o usuário não ganha informação. */
const MAX_CELLS = 120;

interface Entry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
}

interface DirView {
  path: string;
  total: number;
  entries: Entry[];
  truncated: boolean;
}

interface Totals {
  files: number;
  dirs: number;
  bytes: number;
  skipped: number;
  links: number;
}

interface Progress extends Totals {
  current: string;
}

interface Done extends Totals {
  root: string;
  canceled: boolean;
  elapsedMs: number;
}

/** Item que vai pro layout: entrada real ou o agregado "outros N". */
interface Cell {
  value: number;
  entry: Entry | null;
  label: string;
}

/** Trilha de migalhas do root até o caminho atual. */
function crumbs(root: string, cur: string): { label: string; path: string }[] {
  const sep = root.includes("\\") ? "\\" : "/";
  const out = [{ label: root, path: root }];
  if (cur.length > root.length && cur.startsWith(root)) {
    let acc = root.replace(/[\\/]+$/, "");
    for (const seg of cur.slice(root.length).split(/[\\/]/).filter(Boolean)) {
      acc = `${acc}${sep}${seg}`;
      out.push({ label: seg, path: acc });
    }
  }
  return out;
}

/**
 * Cor estável por nome: a mesma pasta guarda a mesma cor entre níveis e
 * entre varreduras, o que ajuda a reconhecer "aquele bloco roxo gigante".
 * Pastas ficam saturadas; arquivos, apagados — a distinção visual mais útil
 * é "dá pra entrar aqui?".
 */
function corDe(nome: string, isDir: boolean): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return isDir ? `hsl(${h} 55% 45%)` : `hsl(${h} 22% 38%)`;
}

export default function DiskTreemap() {
  const pushToast = useUi((s) => s.pushToast);
  const [roots, setRoots] = useState<string[]>([]);
  const [alvo, setAlvo] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [view, setView] = useState<DirView | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [hover, setHover] = useState<Entry | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // Mede o container de verdade (o treemap precisa de px, não de %) e
  // re-mede quando a janela muda. ResizeObserver e não window.resize: o
  // painel também muda de tamanho quando a barra de progresso aparece/some.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setBox({ x: 0, y: 0, w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ x: 0, y: 0, w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void invoke<string[]>("disk_roots")
      .then((r) => {
        setRoots(r);
        setAlvo((a) => a || r[0] || "");
      })
      .catch(() => {});
  }, []);

  const abrir = useCallback(async (path: string) => {
    if (!isTauri) return;
    try {
      setView(await invoke<DirView>("disk_entries", { path }));
      setHover(null);
    } catch (e) {
      pushToast("error", String(e));
    }
  }, [pushToast]);

  useEffect(() => {
    if (!isTauri) return;
    const unP = listen<Progress>("disk-scan-progress", (e) => setProgress(e.payload));
    const unD = listen<Done>("disk-scan-done", (e) => {
      setScanning(false);
      setDone(e.payload);
      setProgress(null);
      if (e.payload.canceled) pushToast("info", t("disk.canceled"));
      // Mesmo cancelada, o parcial é navegável — abre a raiz do que deu.
      setRootPath(e.payload.root);
      void abrir(e.payload.root);
    });
    return () => {
      void unP.then((f) => f());
      void unD.then((f) => f());
    };
  }, [abrir, pushToast]);

  const iniciar = async () => {
    if (!isTauri) return;
    const path = alvo.trim();
    if (!path) return;
    setDone(null);
    setView(null);
    setProgress(null);
    setScanning(true);
    try {
      await invoke("disk_scan_start", { path });
    } catch (e) {
      // Falha SÍNCRONA (caminho inexistente, varredura já rodando): o evento
      // de fim nunca vem, então o estado precisa ser destravado aqui.
      setScanning(false);
      pushToast("error", t("disk.failed", { error: String(e) }));
    }
  };

  const cancelar = () => {
    if (!isTauri) return;
    void invoke("disk_scan_cancel").catch(() => {});
  };

  // Layout: só recalcula quando o nível ou o tamanho do container mudam.
  const celulas = useMemo(() => {
    if (!view || box.w <= 0 || box.h <= 0) return [];
    const itens: Cell[] = view.entries.map((e) => ({ value: e.size, entry: e, label: e.name }));
    const { kept, otherValue, otherCount } = collapseTail(itens, MAX_CELLS);
    if (otherCount > 0) {
      kept.push({ value: otherValue, entry: null, label: t("disk.others", { n: otherCount }) });
    }
    // Células sub-pixel só custam DOM: o "outros" já as representa.
    return squarify(kept, box).filter((c) => c.w >= 1 && c.h >= 1);
  }, [view, box]);

  const trilha = view && rootPath ? crumbs(rootPath, view.path) : [];

  if (!isTauri) return <div className="disk-pane muted list-msg">{t("disk.needTauri")}</div>;

  return (
    <div className="disk-pane">
      <div className="disk-bar">
        <span className="muted small">{t("disk.pickHint")}</span>
        {roots.map((r) => (
          <button key={r} className={r === alvo ? "active" : ""} onClick={() => setAlvo(r)}>
            {r}
          </button>
        ))}
        <input
          className="disk-path"
          value={alvo}
          spellCheck={false}
          placeholder={t("disk.pathPlaceholder")}
          onChange={(e) => setAlvo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !scanning) void iniciar();
          }}
        />
        {scanning ? (
          <button className="danger" onClick={cancelar}>
            {t("disk.cancelScan")}
          </button>
        ) : (
          <button className="primary" onClick={() => void iniciar()}>
            {done ? t("disk.rescan") : t("disk.scan")}
          </button>
        )}
      </div>

      {scanning && (
        <div className="disk-status">
          <div className="scan-spinner" />
          <span>
            {t("disk.scanning", {
              files: progress?.files ?? 0,
              size: formatBytes(progress?.bytes ?? 0),
            })}
          </span>
          <span className="muted small ellipsis" title={progress?.current ?? ""}>
            {t("disk.current", { path: progress?.current ?? "…" })}
          </span>
          {(progress?.skipped ?? 0) > 0 && (
            <span className="muted small">{t("disk.skipped", { n: progress!.skipped })}</span>
          )}
        </div>
      )}

      {!scanning && done && (
        <div className="disk-status">
          <span>
            {t("disk.done", {
              size: formatBytes(done.bytes),
              files: done.files,
              dirs: done.dirs,
              secs: (done.elapsedMs / 1000).toFixed(1),
            })}
          </span>
          {done.skipped > 0 && (
            <span className="muted small">{t("disk.skipped", { n: done.skipped })}</span>
          )}
          {done.links > 0 && (
            <span className="muted small">{t("disk.links", { n: done.links })}</span>
          )}
        </div>
      )}

      {trilha.length > 0 && (
        <div className="disk-crumbs">
          <button
            title={t("disk.up")}
            disabled={trilha.length < 2}
            onClick={() => void abrir(trilha[trilha.length - 2].path)}
          >
            ↑
          </button>
          {trilha.map((c, i) => (
            <span key={c.path} className="crumb">
              {i > 0 && <span className="muted sep">›</span>}
              <button
                className={i === trilha.length - 1 ? "cur" : ""}
                onClick={() => void abrir(c.path)}
              >
                {c.label}
              </button>
            </span>
          ))}
          <span className="toolbar-fill" />
          <span className="muted small">{formatBytes(view!.total)}</span>
        </div>
      )}

      <div className="treemap-box" ref={boxRef}>
        {!view && !scanning && <div className="muted list-msg">{t("disk.noScan")}</div>}
        {view && view.entries.length === 0 && <div className="muted list-msg">{t("disk.emptyDir")}</div>}
        {celulas.map((c, i) => {
          const e = c.item.entry;
          const rotulo = `${c.item.label} — ${formatBytes(c.item.value)}`;
          return (
            <div
              key={e ? e.path : `outros-${i}`}
              className={`tm-cell${e?.isDir ? " dir" : ""}${e ? "" : " others"}`}
              style={{
                left: c.x,
                top: c.y,
                width: Math.max(0, c.w - 2),
                height: Math.max(0, c.h - 2),
                background: corDe(c.item.label, !!e?.isDir),
              }}
              title={e ? `${e.path}\n${formatBytes(e.size)}` : rotulo}
              onMouseEnter={() => setHover(e)}
              onDoubleClick={() => e?.isDir && void abrir(e.path)}
              onClick={() => e?.isDir && void abrir(e.path)}
            >
              {/* Rótulo só cabe em célula grande; abaixo disso o title/hover resolve. */}
              {c.w > 62 && c.h > 26 && (
                <span className="tm-label">
                  <span className="tm-name">{c.item.label}</span>
                  <span className="tm-size">{formatBytes(c.item.value)}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="disk-foot muted small">
        <span className="ellipsis" title={hover?.path ?? ""}>
          {hover ? `${hover.path} · ${formatBytes(hover.size)}` : t("disk.sizeNote")}
        </span>
        <span className="toolbar-fill" />
        {view?.truncated && <span>{t("disk.truncated", { n: view.entries.length })}</span>}
        <span>{t("disk.readOnly")}</span>
      </div>
    </div>
  );
}

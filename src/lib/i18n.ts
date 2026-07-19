import { useSyncExternalStore } from "react";

/** i18n leve da UI (padrão da suíte, ver docs/planos/padrao-apps.md). */

export type Locale = "pt" | "en" | "es";

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};

const LOCALE_KEY = "localmonitor.locale";

const pt = {
  "top.settingsTitle": "Configurações",
  "top.interval": "Intervalo de atualização",
  "proc.detailHint": "Detalhes de {name}",
  "detail.status": "Estado",
  "detail.user": "Usuário",
  "detail.parent": "PID pai",
  "detail.cpu": "CPU",
  "detail.mem": "Memória",
  "detail.runTime": "Tempo em execução",
  "detail.diskIo": "E/S de disco",
  "detail.exe": "Executável",
  "detail.cwd": "Diretório",
  "detail.cmd": "Linha de comando",
  "tab.overview": "Visão geral",
  "tab.processes": "Processos",
  "tab.startup": "Inicialização",
  "tab.disk": "Disco",

  "disk.pickHint": "Escolha uma unidade ou digite uma pasta para varrer:",
  "disk.pathPlaceholder": "Caminho da pasta",
  "disk.scan": "Varrer",
  "disk.rescan": "Varrer de novo",
  "disk.cancelScan": "Cancelar varredura",
  "disk.scanning": "Varrendo… {files} arquivos · {size}",
  "disk.current": "Lendo: {path}",
  "disk.done": "{size} em {files} arquivos e {dirs} pastas ({secs}s)",
  "disk.canceled": "Varredura cancelada — o que já foi lido continua no mapa.",
  "disk.failed": "A varredura falhou: {error}",
  "disk.skipped": "{n} pastas puladas (sem permissão)",
  "disk.links": "{n} links/junções não seguidos",
  "disk.truncated": "Só os {n} maiores itens desta pasta são exibidos.",
  "disk.emptyDir": "Esta pasta está vazia.",
  "disk.noScan": "Nenhuma varredura ainda. Escolha uma pasta acima.",
  "disk.needTauri": "O mapa de disco só funciona dentro do aplicativo.",
  "disk.up": "Subir um nível",
  "disk.others": "outros {n} itens",
  "disk.sizeNote": "Tamanhos são a soma lógica dos arquivos — não é o espaço que seria liberado.",
  "disk.readOnly": "Somente leitura: o LocalMonitor não apaga nada.",

  "startup.empty": "Nada inicia com o sistema (ou sem permissão pra ler).",
  "startup.name": "Programa",
  "startup.source": "Origem",
  "startup.command": "Comando",
  "startup.note": "Só leitura — para desativar, use o Gerenciador de Tarefas (Windows) ou as Aplicações de arranque (Linux).",

  "card.cpu": "CPU",
  "card.mem": "Memória",
  "card.net": "Rede",
  "card.disks": "Discos",
  "card.swap": "Swap",
  "card.uptime": "Ligado há",
  "net.down": "↓ {v}/s",
  "net.up": "↑ {v}/s",
  "disk.freeOf": "{free} livres de {total}",

  "proc.name": "Processo",
  "proc.pid": "PID",
  "proc.cpu": "CPU %",
  "proc.mem": "Memória",
  "proc.kill": "Encerrar",
  "proc.search": "Filtrar processos…",
  "proc.killConfirm": "Encerrar “{name}” (PID {pid})? Trabalho não salvo nesse app pode se perder.",
  "proc.killed": "Processo encerrado",
  "proc.killFailed": "Não deu pra encerrar: {error}",
  "proc.refresh": "Atualizar",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancelar",
  "dlg.kill": "Encerrar",

  "settings.title": "Configurações",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Escuro",
  "settings.themeNature": "Natureza",
  "settings.themeDarkBlue": "Azul escuro",
  "settings.themeCalmGreen": "Verde calmo",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Idioma",
  "settings.about":
    " — monitor de sistema 100% offline: CPU (total e por núcleo), memória, rede e discos ao vivo + lista de processos com encerrar. Parte da suíte Local.",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "top.settingsTitle": "Settings",
  "top.interval": "Refresh interval",
  "proc.detailHint": "Details for {name}",
  "detail.status": "Status",
  "detail.user": "User",
  "detail.parent": "Parent PID",
  "detail.cpu": "CPU",
  "detail.mem": "Memory",
  "detail.runTime": "Run time",
  "detail.diskIo": "Disk I/O",
  "detail.exe": "Executable",
  "detail.cwd": "Directory",
  "detail.cmd": "Command line",
  "tab.overview": "Overview",
  "tab.processes": "Processes",
  "tab.startup": "Startup",
  "tab.disk": "Disk",

  "disk.pickHint": "Pick a drive or type a folder to scan:",
  "disk.pathPlaceholder": "Folder path",
  "disk.scan": "Scan",
  "disk.rescan": "Scan again",
  "disk.cancelScan": "Cancel scan",
  "disk.scanning": "Scanning… {files} files · {size}",
  "disk.current": "Reading: {path}",
  "disk.done": "{size} across {files} files and {dirs} folders ({secs}s)",
  "disk.canceled": "Scan canceled — whatever was read stays on the map.",
  "disk.failed": "Scan failed: {error}",
  "disk.skipped": "{n} folders skipped (no permission)",
  "disk.links": "{n} links/junctions not followed",
  "disk.truncated": "Only the {n} largest items in this folder are shown.",
  "disk.emptyDir": "This folder is empty.",
  "disk.noScan": "No scan yet. Pick a folder above.",
  "disk.needTauri": "The disk map only works inside the app.",
  "disk.up": "Go up one level",
  "disk.others": "{n} more items",
  "disk.sizeNote": "Sizes are the logical sum of files — not the space that would be freed.",
  "disk.readOnly": "Read-only: LocalMonitor never deletes anything.",

  "startup.empty": "Nothing starts with the system (or no permission to read).",
  "startup.name": "Program",
  "startup.source": "Source",
  "startup.command": "Command",
  "startup.note": "Read-only — to disable, use Task Manager (Windows) or Startup Applications (Linux).",

  "card.cpu": "CPU",
  "card.mem": "Memory",
  "card.net": "Network",
  "card.disks": "Disks",
  "card.swap": "Swap",
  "card.uptime": "Uptime",
  "net.down": "↓ {v}/s",
  "net.up": "↑ {v}/s",
  "disk.freeOf": "{free} free of {total}",

  "proc.name": "Process",
  "proc.pid": "PID",
  "proc.cpu": "CPU %",
  "proc.mem": "Memory",
  "proc.kill": "End task",
  "proc.search": "Filter processes…",
  "proc.killConfirm": "End “{name}” (PID {pid})? Unsaved work in that app may be lost.",
  "proc.killed": "Process ended",
  "proc.killFailed": "Couldn't end it: {error}",
  "proc.refresh": "Refresh",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancel",
  "dlg.kill": "End task",

  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.themeSystem": "System",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeNature": "Nature",
  "settings.themeDarkBlue": "Dark blue",
  "settings.themeCalmGreen": "Calm green",
  "settings.themePastelPink": "Pastel pink",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Language",
  "settings.about":
    " — 100% offline system monitor: live CPU (total and per core), memory, network and disks + process list with end task. Part of the Local suite.",
};

const es: Record<MessageKey, string> = {
  "top.settingsTitle": "Configuración",
  "top.interval": "Intervalo de actualización",
  "proc.detailHint": "Detalles de {name}",
  "detail.status": "Estado",
  "detail.user": "Usuario",
  "detail.parent": "PID padre",
  "detail.cpu": "CPU",
  "detail.mem": "Memoria",
  "detail.runTime": "Tiempo en ejecución",
  "detail.diskIo": "E/S de disco",
  "detail.exe": "Ejecutable",
  "detail.cwd": "Directorio",
  "detail.cmd": "Línea de comandos",
  "tab.overview": "Visión general",
  "tab.processes": "Procesos",
  "tab.startup": "Inicio",
  "tab.disk": "Disco",

  "disk.pickHint": "Elige una unidad o escribe una carpeta para analizar:",
  "disk.pathPlaceholder": "Ruta de la carpeta",
  "disk.scan": "Analizar",
  "disk.rescan": "Analizar de nuevo",
  "disk.cancelScan": "Cancelar análisis",
  "disk.scanning": "Analizando… {files} archivos · {size}",
  "disk.current": "Leyendo: {path}",
  "disk.done": "{size} en {files} archivos y {dirs} carpetas ({secs}s)",
  "disk.canceled": "Análisis cancelado — lo ya leído sigue en el mapa.",
  "disk.failed": "El análisis falló: {error}",
  "disk.skipped": "{n} carpetas omitidas (sin permiso)",
  "disk.links": "{n} enlaces/uniones no seguidos",
  "disk.truncated": "Solo se muestran los {n} elementos más grandes de esta carpeta.",
  "disk.emptyDir": "Esta carpeta está vacía.",
  "disk.noScan": "Aún no hay análisis. Elige una carpeta arriba.",
  "disk.needTauri": "El mapa de disco solo funciona dentro de la aplicación.",
  "disk.up": "Subir un nivel",
  "disk.others": "otros {n} elementos",
  "disk.sizeNote": "Los tamaños son la suma lógica de los archivos — no el espacio que se liberaría.",
  "disk.readOnly": "Solo lectura: LocalMonitor nunca borra nada.",

  "startup.empty": "Nada se inicia con el sistema (o sin permiso para leer).",
  "startup.name": "Programa",
  "startup.source": "Origen",
  "startup.command": "Comando",
  "startup.note": "Solo lectura — para desactivar, usa el Administrador de tareas (Windows) o Aplicaciones al inicio (Linux).",

  "card.cpu": "CPU",
  "card.mem": "Memoria",
  "card.net": "Red",
  "card.disks": "Discos",
  "card.swap": "Swap",
  "card.uptime": "Encendido hace",
  "net.down": "↓ {v}/s",
  "net.up": "↑ {v}/s",
  "disk.freeOf": "{free} libres de {total}",

  "proc.name": "Proceso",
  "proc.pid": "PID",
  "proc.cpu": "CPU %",
  "proc.mem": "Memoria",
  "proc.kill": "Finalizar",
  "proc.search": "Filtrar procesos…",
  "proc.killConfirm": "¿Finalizar “{name}” (PID {pid})? El trabajo no guardado en esa app puede perderse.",
  "proc.killed": "Proceso finalizado",
  "proc.killFailed": "No se pudo finalizar: {error}",
  "proc.refresh": "Actualizar",

  "dlg.ok": "OK",
  "dlg.cancel": "Cancelar",
  "dlg.kill": "Finalizar",

  "settings.title": "Configuración",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.themeNature": "Naturaleza",
  "settings.themeDarkBlue": "Azul oscuro",
  "settings.themeCalmGreen": "Verde tranquilo",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Idioma",
  "settings.about":
    " — monitor de sistema 100% offline: CPU (total y por núcleo), memoria, red y discos en vivo + lista de procesos con finalizar. Parte de la suite Local.",
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { pt, en, es };

export function detectLocale(): Locale {
  const l = (typeof navigator !== "undefined" ? navigator.language : "pt").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("es")) return "es";
  return "pt";
}

function loadLocale(): Locale {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
  return v === "pt" || v === "en" || v === "es" ? v : detectLocale();
}

let current: Locale = loadLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* localStorage indisponível */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let msg: string = DICTS[current][key] ?? pt[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
}

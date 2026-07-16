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
  "tab.overview": "Visão geral",
  "tab.processes": "Processos",

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
  "settings.language": "Idioma",
  "settings.about":
    " — monitor de sistema 100% offline: CPU (total e por núcleo), memória, rede e discos ao vivo + lista de processos com encerrar. Parte da suíte Local.",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "top.settingsTitle": "Settings",
  "tab.overview": "Overview",
  "tab.processes": "Processes",

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
  "settings.language": "Language",
  "settings.about":
    " — 100% offline system monitor: live CPU (total and per core), memory, network and disks + process list with end task. Part of the Local suite.",
};

const es: Record<MessageKey, string> = {
  "top.settingsTitle": "Configuración",
  "tab.overview": "Visión general",
  "tab.processes": "Procesos",

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

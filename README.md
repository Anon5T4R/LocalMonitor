# LocalMonitor

Monitor de sistema **100% offline** da suíte Local — o Gerenciador de Tarefas
local: veja o que a máquina está fazendo e encerre o que travou.

## Recursos (v0.1)

- **Visão geral ao vivo** (1,5 s): CPU total com sparkline + **barras por
  núcleo**, memória/swap, **rede** (↓/↑ por segundo, com histórico) e
  **discos** (uso por volume)
- **Processos**: lista com filtro, ordenar por CPU/memória/nome e **encerrar**
  (com confirmação — trabalho não salvo no app alvo se perde)
- Uptime no topo · Tema claro/escuro/sistema · UI em **PT/EN/ES**

**Roadmap:** v0.2 = analisador de uso de disco (treemap navegável),
programas na inicialização · v0.3 = temperatura/GPU, alertas, histórico.

## Stack

Tauri 2 + React 19 + Vite + TS; Rust no back (`sysinfo` — o app inteiro é
sysinfo + UI; sparklines próprias em SVG). Sem rede, sem telemetria.

## Dev

```bash
npm install
npm run tauri dev   # porta 1476
```

## Release

Tag `vX.Y.Z` → GitHub Actions builda NSIS (Windows) + AppImage (Linux) e
publica a Release. Parte da suíte [Local](https://github.com/Anon5T4R).

## Licença

MIT

//! Varredura de uso de disco — a parte de I/O do treemap.
//!
//! Desenho: a varredura roda numa thread própria (pode levar MINUTOS em `C:\`),
//! empurra progresso por evento e é cancelável a qualquer momento por um
//! `AtomicBool` compartilhado. O resultado NÃO volta como uma árvore gigante
//! pro front — `C:\` tem milhões de nós e serializar isso mata a webview.
//! Em vez disso guardamos um mapa `pasta -> filhos ordenados` no state, e o
//! front pede um nível de cada vez (`disk_entries`). O treemap só desenha um
//! nível por vez de qualquer forma.
//!
//! Contabilidade: tamanho de pasta = soma dos tamanhos lógicos dos arquivos
//! abaixo. Isso IGNORA de propósito tamanho-em-disco (clusters), compressão
//! NTFS e arquivos esparsos, e conta hardlink uma vez por caminho — ou seja,
//! o número é "quanto isso pesaria copiado", não "quanto o volume liberaria".
//! Bater com o Explorer é possível; bater com o espaço livre do drive, não.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Teto de filhos guardados por pasta. Uma pasta de cache com 200 mil
/// arquivos não tem o que mostrar num treemap (cada um daria área
/// sub-pixel) e guardar tudo estoura a RAM. Os maiores é o que interessa;
/// o TAMANHO da pasta continua completo, só a LISTA é truncada.
const MAX_ENTRIES_PER_DIR: usize = 4000;

/// Profundidade máxima. Com no-follow em symlink/junção não deveria existir
/// ciclo, mas isto é o cinto além do suspensório: um bug de detecção vira
/// varredura lenta, nunca varredura infinita.
const MAX_DEPTH: usize = 256;

/// Intervalo mínimo entre eventos de progresso. Sem isto a varredura emite
/// dezenas de milhares de eventos por segundo e a webview é que trava —
/// exatamente o contrário do objetivo de rodar em background.
const PROGRESS_EVERY: Duration = Duration::from_millis(120);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanTotals {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    /// Pastas puladas por falta de permissão / erro de leitura. NUNCA aborta
    /// a varredura: em `C:\` sempre há System Volume Information e afins.
    pub skipped: u64,
    /// Links simbólicos e junções encontrados e NÃO seguidos (informativo:
    /// explica pro usuário por que a soma pode ser menor que a esperada).
    pub links: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub current: String,
    #[serde(flatten)]
    pub totals: ScanTotals,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanDone {
    pub root: String,
    pub canceled: bool,
    pub elapsed_ms: u64,
    #[serde(flatten)]
    pub totals: ScanTotals,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirView {
    pub path: String,
    pub total: u64,
    /// Filhos ordenados por tamanho decrescente (já vêm assim do scan).
    pub entries: Vec<Entry>,
    /// True se a lista foi truncada em MAX_ENTRIES_PER_DIR.
    pub truncated: bool,
}

/// Estado compartilhado entre a thread de varredura e os comandos.
#[derive(Default)]
pub struct ScanState {
    pub cancel: AtomicBool,
    pub running: AtomicBool,
    pub map: Mutex<HashMap<String, Vec<Entry>>>,
    pub sizes: Mutex<HashMap<String, u64>>,
    pub totals: Mutex<ScanTotals>,
}

/// DEFESA 1 — caminhos longos no Windows.
/// A API Win32 corta em MAX_PATH (260) a menos que o caminho use o prefixo
/// `\\?\`, que desliga a normalização. Sem isso, `node_modules` aninhado
/// simplesmente some da varredura com "arquivo não encontrado".
/// Pegadinhas do prefixo: exige caminho ABSOLUTO e já normalizado (nada de
/// `.`/`..`), e não vale pra UNC (`\\servidor\share` vira `\\?\UNC\...`) —
/// por isso a UNC é deixada em paz.
#[cfg(windows)]
pub fn long_path(p: &Path) -> PathBuf {
    let s = p.as_os_str().to_string_lossy();
    if s.starts_with(r"\\") || s.len() < 200 || !p.is_absolute() {
        return p.to_path_buf();
    }
    PathBuf::from(format!(r"\\?\{}", s.replace('/', r"\")))
}

/// No Linux/macOS não existe MAX_PATH desse tipo — identidade.
/// (Os dois `cfg` existem de propósito: função só-Windows chamada de código
/// compartilhado compila aqui e QUEBRA o job Ubuntu do CI.)
#[cfg(not(windows))]
pub fn long_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/// DEFESA 2 — junções do Windows.
/// `is_symlink()` do Rust cobre symlink de verdade, mas uma JUNCTION
/// (`mklink /J`, e é o que o Windows usa em `C:\Users\X\Documents and
/// Settings` e em `AppData\Local\Application Data`) NÃO é reportada como
/// symlink pelo std. Ela é um reparse point. Seguir uma dessas é o caminho
/// clássico pra varredura que nunca termina — `Application Data` aponta pra
/// si mesma e recursiona pra sempre. Aqui olhamos o atributo bruto.
#[cfg(windows)]
pub fn is_reparse_point(md: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub fn is_reparse_point(_md: &std::fs::Metadata) -> bool {
    false
}

/// Um nó é "atravessável" só se for diretório de verdade: nem symlink, nem
/// reparse point. Vale pro `symlink_metadata` (metadados do PRÓPRIO nó, sem
/// seguir o link) — usar `metadata()` aqui seria o bug, porque ele segue.
fn deve_descer(md: &std::fs::Metadata) -> bool {
    md.is_dir() && !md.file_type().is_symlink() && !is_reparse_point(md)
}

struct Ctx<'a> {
    cancel: &'a AtomicBool,
    map: HashMap<String, Vec<Entry>>,
    sizes: HashMap<String, u64>,
    totals: ScanTotals,
    last_emit: Instant,
    on_progress: &'a mut dyn FnMut(&ScanProgress),
}

impl Ctx<'_> {
    fn cancelado(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn talvez_emitir(&mut self, atual: &str) {
        if self.last_emit.elapsed() >= PROGRESS_EVERY {
            self.last_emit = Instant::now();
            let p = ScanProgress { current: atual.to_string(), totals: self.totals.clone() };
            (self.on_progress)(&p);
        }
    }
}

/// Varre `dir` recursivamente e devolve o tamanho total em bytes.
/// Nunca entra em pânico e nunca propaga erro: erro de pasta = pulo contado.
fn varrer(dir: &Path, profundidade: usize, ctx: &mut Ctx) -> u64 {
    if ctx.cancelado() || profundidade > MAX_DEPTH {
        return 0;
    }

    let chave = dir.to_string_lossy().into_owned();
    ctx.talvez_emitir(&chave);

    // DEFESA 3 — permissão negada.
    // `read_dir` falha em System Volume Information, $Recycle.Bin, perfis de
    // outros usuários… O erro é ESPERADO e local: conta e segue. Abortar a
    // varredura inteira porque uma pasta protegida apareceu tornaria o
    // recurso inútil justamente em `C:\`, que é o caso de uso principal.
    let rd = match std::fs::read_dir(long_path(dir)) {
        Ok(rd) => rd,
        Err(_) => {
            ctx.totals.skipped += 1;
            return 0;
        }
    };

    let mut filhos: Vec<Entry> = Vec::new();
    let mut total: u64 = 0;

    for item in rd {
        if ctx.cancelado() {
            break;
        }
        // Entrada individual ilegível (arquivo sumiu no meio da varredura,
        // nome inválido): pula essa, não a pasta.
        let item = match item {
            Ok(i) => i,
            Err(_) => {
                ctx.totals.skipped += 1;
                continue;
            }
        };
        let caminho = item.path();

        // symlink_metadata: metadados do LINK, não do alvo. Trocar por
        // metadata() aqui reintroduz o ciclo infinito.
        let md = match std::fs::symlink_metadata(long_path(&caminho)) {
            Ok(md) => md,
            Err(_) => {
                ctx.totals.skipped += 1;
                continue;
            }
        };

        let nome = item.file_name().to_string_lossy().into_owned();
        let caminho_s = caminho.to_string_lossy().into_owned();

        if md.file_type().is_symlink() || is_reparse_point(&md) {
            // Link/junção: aparece com tamanho 0 e NÃO é atravessado. O alvo
            // real será contado onde ele de fato mora.
            ctx.totals.links += 1;
            filhos.push(Entry { name: nome, path: caminho_s, size: 0, is_dir: md.is_dir() });
            continue;
        }

        if deve_descer(&md) {
            ctx.totals.dirs += 1;
            let tam = varrer(&caminho, profundidade + 1, ctx);
            total += tam;
            filhos.push(Entry { name: nome, path: caminho_s, size: tam, is_dir: true });
        } else if md.is_file() {
            let tam = md.len();
            ctx.totals.files += 1;
            ctx.totals.bytes += tam;
            total += tam;
            filhos.push(Entry { name: nome, path: caminho_s, size: tam, is_dir: false });
        }
    }

    filhos.sort_by(|a, b| b.size.cmp(&a.size));
    filhos.truncate(MAX_ENTRIES_PER_DIR);
    ctx.sizes.insert(chave.clone(), total);
    ctx.map.insert(chave, filhos);
    total
}

/// Entrada testável: sem Tauri, sem thread. Recebe o sinal de cancelamento e
/// um callback de progresso; devolve o mapa pasta→filhos e os totais.
pub fn scan(
    root: &Path,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(&ScanProgress),
) -> (HashMap<String, Vec<Entry>>, HashMap<String, u64>, ScanTotals) {
    let mut ctx = Ctx {
        cancel,
        map: HashMap::new(),
        sizes: HashMap::new(),
        totals: ScanTotals::default(),
        last_emit: Instant::now(),
        on_progress,
    };
    varrer(root, 0, &mut ctx);
    (ctx.map, ctx.sizes, ctx.totals)
}

/// Monta a visão de UM nível a partir do mapa já varrido.
pub fn dir_view(
    map: &HashMap<String, Vec<Entry>>,
    sizes: &HashMap<String, u64>,
    path: &str,
) -> Option<DirView> {
    let entries = map.get(path)?.clone();
    Some(DirView {
        truncated: entries.len() >= MAX_ENTRIES_PER_DIR,
        total: sizes.get(path).copied().unwrap_or_else(|| entries.iter().map(|e| e.size).sum()),
        path: path.to_string(),
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Cria uma arvorezinha determinística num diretório temporário.
    fn arvore(base: &Path) {
        fs::create_dir_all(base.join("a/b")).unwrap();
        fs::create_dir_all(base.join("vazia")).unwrap();
        fs::write(base.join("raiz.bin"), vec![0u8; 1000]).unwrap();
        fs::write(base.join("a/dentro.bin"), vec![0u8; 500]).unwrap();
        fs::write(base.join("a/b/fundo.bin"), vec![0u8; 250]).unwrap();
    }

    fn tmp(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lm-diskscan-{}-{}", nome, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn soma_recursiva_bate_e_ordena_por_tamanho() {
        let base = tmp("soma");
        arvore(&base);
        let cancel = AtomicBool::new(false);
        let (map, sizes, totals) = scan(&base, &cancel, &mut |_| {});

        let raiz = base.to_string_lossy().into_owned();
        assert_eq!(sizes[&raiz], 1750, "1000 + 500 + 250 somados recursivamente");
        assert_eq!(totals.files, 3);
        assert_eq!(totals.bytes, 1750);
        assert_eq!(totals.dirs, 3, "a, a/b e vazia");

        let filhos = &map[&raiz];
        // Ordenado decrescente: raiz.bin (1000) antes de a/ (750) antes de vazia (0).
        assert_eq!(filhos[0].name, "raiz.bin");
        assert_eq!(filhos[0].size, 1000);
        assert_eq!(filhos[1].name, "a");
        assert_eq!(filhos[1].size, 750);
        assert!(filhos[1].is_dir);
        for j in 1..filhos.len() {
            assert!(filhos[j - 1].size >= filhos[j].size, "saída precisa vir ordenada");
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn pasta_vazia_tem_tamanho_zero_e_aparece_no_mapa() {
        let base = tmp("vazia");
        arvore(&base);
        let cancel = AtomicBool::new(false);
        let (map, sizes, _) = scan(&base, &cancel, &mut |_| {});
        let vazia = base.join("vazia").to_string_lossy().into_owned();
        assert_eq!(sizes[&vazia], 0);
        assert!(map[&vazia].is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn cancelar_antes_de_comecar_nao_varre_nada() {
        let base = tmp("cancel");
        arvore(&base);
        let cancel = AtomicBool::new(true); // já cancelado
        let (map, _, totals) = scan(&base, &cancel, &mut |_| {});
        assert!(map.is_empty());
        assert_eq!(totals.files, 0);
        assert_eq!(totals.bytes, 0);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn caminho_inexistente_conta_pulo_em_vez_de_explodir() {
        let cancel = AtomicBool::new(false);
        let (map, _, totals) = scan(Path::new("/nao/existe/mesmo/xyz123"), &cancel, &mut |_| {});
        assert_eq!(totals.skipped, 1, "erro de leitura vira pulo contado");
        assert!(map.is_empty());
    }

    #[test]
    fn dir_view_devolve_total_e_filhos_do_nivel() {
        let base = tmp("view");
        arvore(&base);
        let cancel = AtomicBool::new(false);
        let (map, sizes, _) = scan(&base, &cancel, &mut |_| {});
        let a = base.join("a").to_string_lossy().into_owned();
        let v = dir_view(&map, &sizes, &a).expect("nível 'a' precisa existir no mapa");
        assert_eq!(v.total, 750);
        assert_eq!(v.entries.len(), 2, "dentro.bin + b/");
        assert!(!v.truncated);
        assert!(dir_view(&map, &sizes, "caminho/que/nao/foi/varrido").is_none());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn progresso_e_emitido_com_totais_crescentes() {
        let base = tmp("prog");
        arvore(&base);
        let cancel = AtomicBool::new(false);
        // PROGRESS_EVERY pode engolir todos os eventos numa árvore minúscula;
        // o que se testa é que o callback é chamável e nunca reporta mais do
        // que existe, não a cadência.
        let (_, _, totals) = scan(&base, &cancel, &mut |p: &ScanProgress| {
            assert!(p.totals.bytes <= 1750);
        });
        assert_eq!(totals.bytes, 1750);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn long_path_nao_mexe_em_caminho_curto_nem_em_unc() {
        let curto = Path::new(r"C:\temp");
        assert_eq!(long_path(curto), curto.to_path_buf());
        let unc = Path::new(r"\\servidor\share\coisa");
        assert_eq!(long_path(unc), unc.to_path_buf(), "UNC exige \\\\?\\UNC\\, então fica intacta");
    }

    #[cfg(windows)]
    #[test]
    fn long_path_prefixa_caminho_absoluto_muito_longo() {
        let longo = PathBuf::from(format!(r"C:\{}", "pasta\\".repeat(40)));
        assert!(longo.as_os_str().len() > 200);
        let p = long_path(&longo);
        assert!(p.to_string_lossy().starts_with(r"\\?\"), "passou de ~200 chars: precisa do prefixo");
    }

    #[test]
    fn arquivo_comum_nao_e_reparse_point() {
        let base = tmp("reparse");
        fs::write(base.join("x.bin"), b"oi").unwrap();
        let md = fs::symlink_metadata(base.join("x.bin")).unwrap();
        assert!(!is_reparse_point(&md));
        assert!(!deve_descer(&md), "arquivo não é atravessável");
        let md_dir = fs::symlink_metadata(&base).unwrap();
        assert!(deve_descer(&md_dir), "diretório de verdade é atravessável");
        let _ = fs::remove_dir_all(&base);
    }
}

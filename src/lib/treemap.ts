/**
 * Layout de treemap — MATEMÁTICA PURA, sem DOM, sem I/O, sem React.
 *
 * Por que separado: a varredura de disco é I/O (Rust, lenta, falível) e a
 * divisão dos retângulos é aritmética determinística. Só a segunda dá pra
 * testar de verdade, então ela mora aqui sozinha.
 *
 * Algoritmo: SQUARIFIED (Bruls, Huizing & van Wijk, 2000) e não
 * slice-and-dice. Motivo prático: slice-and-dice degenera em tiras de 1px
 * quando um diretório tem centenas de filhos — o usuário não consegue nem
 * clicar. O squarified minimiza a razão de aspecto (tende ao quadrado), que
 * é exatamente o que um mapa de disco clicável precisa. O custo é a ordem
 * dentro da linha não ser mais estritamente posicional, o que aqui não
 * importa: o rótulo diz o tamanho.
 *
 * CONTRATOS (garantidos pelos testes):
 *  - A soma das áreas das células == área do retângulo dado (a menos de
 *    erro de ponto flutuante), quando há ao menos um valor positivo.
 *  - Células com área positiva NUNCA se sobrepõem.
 *  - Itens com `value <= 0` viram células de área ZERO (largura ou altura 0)
 *    ancoradas na origem do retângulo. Não somem da lista — quem chama pode
 *    querer contá-los — mas também não roubam pixel de ninguém, e área zero
 *    não sobrepõe nada por definição.
 *  - A saída sai ORDENADA por `value` decrescente (o maior primeiro).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mínimo que um item precisa ter pra ser posicionado. */
export interface TreemapItem {
  value: number;
}

export interface TreemapCell<T> extends Rect {
  item: T;
}

/**
 * "Pior" razão de aspecto de uma linha já com `extra` de área — critério de
 * parada do squarified. `side` é o comprimento do lado ao longo do qual a
 * linha cresce; `sum` é a área total (px²) da linha.
 * Retorna Infinity para entradas degeneradas pra que qualquer alternativa
 * real vença a comparação.
 */
function worstRatio(sum: number, side: number, min: number, max: number): number {
  if (sum <= 0 || side <= 0 || min <= 0) return Infinity;
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

export function squarify<T extends TreemapItem>(items: readonly T[], rect: Rect): TreemapCell<T>[] {
  // Cópia: a função é pura, não mexe no array de quem chamou.
  const sorted = [...items].sort((a, b) => b.value - a.value);

  const zeroCell = (item: T): TreemapCell<T> => ({ x: rect.x, y: rect.y, w: 0, h: 0, item });

  const positives = sorted.filter((i) => i.value > 0 && Number.isFinite(i.value));
  const total = positives.reduce((s, i) => s + i.value, 0);

  // Degenerados: retângulo sem área, lista vazia, ou tudo zero/negativo.
  // Todos caem no mesmo caso — ninguém recebe pixel.
  if (rect.w <= 0 || rect.h <= 0 || positives.length === 0 || total <= 0) {
    return sorted.map(zeroCell);
  }

  const cells: TreemapCell<T>[] = [];
  const scale = (rect.w * rect.h) / total; // valor → px²
  const free: Rect = { ...rect };

  let row: T[] = [];
  let rowArea = 0;
  let rowMin = Infinity;
  let rowMax = 0;

  /**
   * Fecha a linha atual: ela consome uma faixa inteira do lado CURTO do
   * espaço livre, e os itens se dividem ao longo desse lado curto. Fatiar
   * pelo lado curto é o que mantém as células perto de quadradas.
   * `lastRow` faz a faixa comer todo o espaço restante — assim o erro de
   * ponto flutuante acumulado não deixa uma fresta no fim.
   */
  const flushRow = (lastRow: boolean) => {
    if (row.length === 0) return;
    const alongWidth = free.w < free.h; // lado curto é a largura → faixa horizontal
    const side = alongWidth ? free.w : free.h;
    let thick = side > 0 ? rowArea / side : 0;
    if (lastRow) thick = alongWidth ? free.h : free.w;

    let cursor = alongWidth ? free.x : free.y;
    const end = cursor + side;
    for (let i = 0; i < row.length; i++) {
      const it = row[i];
      const share = rowArea > 0 ? (it.value * scale * side) / rowArea : 0;
      // O último item da linha vai até a borda exata: sem fresta de arredondamento.
      const next = i === row.length - 1 ? end : Math.min(cursor + share, end);
      const len = Math.max(0, next - cursor);
      cells.push(
        alongWidth
          ? { x: cursor, y: free.y, w: len, h: thick, item: it }
          : { x: free.x, y: cursor, w: thick, h: len, item: it },
      );
      cursor = next;
    }

    if (alongWidth) {
      free.y += thick;
      free.h = Math.max(0, free.h - thick);
    } else {
      free.x += thick;
      free.w = Math.max(0, free.w - thick);
    }
    row = [];
    rowArea = 0;
    rowMin = Infinity;
    rowMax = 0;
  };

  for (let i = 0; i < positives.length; i++) {
    const it = positives[i];
    const area = it.value * scale;
    const side = Math.min(free.w, free.h);

    const current = worstRatio(rowArea, side, rowMin, rowMax);
    const withItem = worstRatio(rowArea + area, side, Math.min(rowMin, area), Math.max(rowMax, area));

    // Enquanto adicionar melhora (ou não piora) a razão de aspecto, a linha
    // cresce. Quando piora, fecha a linha e recomeça no espaço que sobrou.
    if (row.length > 0 && withItem > current) {
      flushRow(false);
    }

    row.push(it);
    rowArea += area;
    rowMin = Math.min(rowMin, area);
    rowMax = Math.max(rowMax, area);
  }
  flushRow(true);

  // Os não-positivos entram no fim, com área zero, preservando a ordem
  // decrescente global (eles são os menores por definição).
  for (const it of sorted) {
    if (!(it.value > 0 && Number.isFinite(it.value))) cells.push(zeroCell(it));
  }
  return cells;
}

/**
 * Agrupa a cauda longa: mantém os `max` maiores e soma o resto num item
 * sintético. Sem isso, uma pasta com 30 mil arquivos vira 30 mil <div>s de
 * área sub-pixel — trava o render e não informa nada.
 * Devolve também quantos foram agrupados, pra UI poder dizer ao usuário.
 */
export function collapseTail<T extends TreemapItem>(
  items: readonly T[],
  max: number,
): { kept: T[]; otherValue: number; otherCount: number } {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  if (max <= 0 || sorted.length <= max) return { kept: sorted, otherValue: 0, otherCount: 0 };
  const kept = sorted.slice(0, max);
  const tail = sorted.slice(max);
  return {
    kept,
    otherValue: tail.reduce((s, i) => s + Math.max(0, i.value), 0),
    otherCount: tail.length,
  };
}

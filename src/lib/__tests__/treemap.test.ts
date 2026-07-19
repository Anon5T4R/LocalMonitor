import { describe, expect, it } from "vitest";
import { collapseTail, squarify, type Rect, type TreemapCell } from "../treemap";

interface Item {
  name: string;
  value: number;
}

const RECT: Rect = { x: 0, y: 0, w: 800, h: 400 };

const area = (c: Rect) => c.w * c.h;

/** Área da interseção de dois retângulos (0 se não se tocam). */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function expectNoOverlap<T>(cells: TreemapCell<T>[]) {
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      // Tolerância de 1e-6: o algoritmo encosta bordas, não as cruza.
      expect(overlapArea(cells[i], cells[j])).toBeLessThan(1e-6);
    }
  }
}

function expectInside<T>(cells: TreemapCell<T>[], r: Rect) {
  for (const c of cells) {
    expect(c.x).toBeGreaterThanOrEqual(r.x - 1e-9);
    expect(c.y).toBeGreaterThanOrEqual(r.y - 1e-9);
    expect(c.x + c.w).toBeLessThanOrEqual(r.x + r.w + 1e-6);
    expect(c.y + c.h).toBeLessThanOrEqual(r.y + r.h + 1e-6);
  }
}

describe("squarify", () => {
  it("soma das áreas == área total do retângulo", () => {
    const items: Item[] = [
      { name: "a", value: 600 },
      { name: "b", value: 300 },
      { name: "c", value: 100 },
      { name: "d", value: 50 },
      { name: "e", value: 25 },
      { name: "f", value: 7 },
    ];
    const cells = squarify(items, RECT);
    const sum = cells.reduce((s, c) => s + area(c), 0);
    expect(sum).toBeCloseTo(area(RECT), 4);
  });

  it("área de cada célula é proporcional ao valor", () => {
    const items: Item[] = [
      { name: "a", value: 50 },
      { name: "b", value: 30 },
      { name: "c", value: 20 },
    ];
    const cells = squarify(items, RECT);
    const total = 100;
    for (const c of cells) {
      const esperado = (c.item.value / total) * area(RECT);
      // 1% de folga: a última célula de cada linha absorve o arredondamento.
      expect(Math.abs(area(c) - esperado)).toBeLessThan(esperado * 0.01 + 1);
    }
  });

  it("retângulos não se sobrepõem e ficam dentro do container", () => {
    const items: Item[] = Array.from({ length: 40 }, (_, i) => ({
      name: `i${i}`,
      value: Math.round(1000 / (i + 1)),
    }));
    const cells = squarify(items, RECT);
    expectNoOverlap(cells);
    expectInside(cells, RECT);
  });

  it("cobre o container inteiro (nenhum ponto de amostra fica de fora)", () => {
    const items: Item[] = [
      { name: "a", value: 9 },
      { name: "b", value: 5 },
      { name: "c", value: 4 },
      { name: "d", value: 2 },
      { name: "e", value: 1 },
    ];
    const cells = squarify(items, RECT);
    for (let px = 5; px < RECT.w; px += 37) {
      for (let py = 5; py < RECT.h; py += 31) {
        const dentro = cells.filter(
          (c) => px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h,
        );
        expect(dentro.length).toBe(1);
      }
    }
  });

  it("sai ordenado por tamanho decrescente", () => {
    const items: Item[] = [
      { name: "pequeno", value: 3 },
      { name: "grande", value: 100 },
      { name: "medio", value: 20 },
    ];
    const cells = squarify(items, RECT);
    expect(cells.map((c) => c.item.name)).toEqual(["grande", "medio", "pequeno"]);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i - 1].item.value).toBeGreaterThanOrEqual(cells[i].item.value);
    }
  });

  it("o maior item recebe a maior área", () => {
    const items: Item[] = [
      { name: "a", value: 7 },
      { name: "b", value: 70 },
      { name: "c", value: 23 },
    ];
    const cells = squarify(items, RECT);
    const maior = cells.reduce((m, c) => (area(c) > area(m) ? c : m));
    expect(maior.item.name).toBe("b");
  });

  it("razão de aspecto fica razoável (squarified faz jus ao nome)", () => {
    const items: Item[] = Array.from({ length: 20 }, (_, i) => ({ name: `i${i}`, value: 100 }));
    const cells = squarify(items, { x: 0, y: 0, w: 600, h: 600 });
    for (const c of cells) {
      const r = Math.max(c.w / c.h, c.h / c.w);
      // Slice-and-dice daria 30:1 aqui; o squarified fica perto de 1:1.
      expect(r).toBeLessThan(4);
    }
  });

  // ---- degenerados ----

  it("lista vazia devolve lista vazia", () => {
    expect(squarify([], RECT)).toEqual([]);
  });

  it("um item só ocupa o retângulo inteiro", () => {
    const cells = squarify([{ name: "só", value: 42 }], RECT);
    expect(cells).toHaveLength(1);
    expect(cells[0].x).toBeCloseTo(RECT.x);
    expect(cells[0].y).toBeCloseTo(RECT.y);
    expect(cells[0].w).toBeCloseTo(RECT.w);
    expect(cells[0].h).toBeCloseTo(RECT.h);
  });

  it("itens de tamanho zero viram células de área zero, sem sumir", () => {
    const items: Item[] = [
      { name: "a", value: 100 },
      { name: "vazio1", value: 0 },
      { name: "vazio2", value: 0 },
    ];
    const cells = squarify(items, RECT);
    expect(cells).toHaveLength(3);
    expect(cells.filter((c) => area(c) === 0).map((c) => c.item.name)).toEqual([
      "vazio1",
      "vazio2",
    ]);
    // O item com tamanho ainda ganha o retângulo todo.
    expect(area(cells[0])).toBeCloseTo(area(RECT), 4);
    expectNoOverlap(cells);
  });

  it("tudo zero: ninguém ganha pixel (e nada explode)", () => {
    const cells = squarify(
      [
        { name: "a", value: 0 },
        { name: "b", value: 0 },
      ],
      RECT,
    );
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => area(c) === 0)).toBe(true);
  });

  it("valores negativos e NaN não geram retângulo nem NaN na saída", () => {
    const cells = squarify(
      [
        { name: "ok", value: 10 },
        { name: "neg", value: -5 },
        { name: "nan", value: Number.NaN },
      ],
      RECT,
    );
    expect(cells).toHaveLength(3);
    for (const c of cells) {
      expect(Number.isFinite(c.x + c.y + c.w + c.h)).toBe(true);
      expect(c.w).toBeGreaterThanOrEqual(0);
      expect(c.h).toBeGreaterThanOrEqual(0);
    }
    expect(area(cells[0])).toBeCloseTo(area(RECT), 4);
  });

  it("retângulo sem área não gera célula com área", () => {
    const cells = squarify([{ name: "a", value: 10 }], { x: 3, y: 4, w: 0, h: 200 });
    expect(cells).toHaveLength(1);
    expect(area(cells[0])).toBe(0);
  });

  it("não modifica o array de entrada", () => {
    const items: Item[] = [
      { name: "a", value: 1 },
      { name: "b", value: 9 },
    ];
    const copia = [...items];
    squarify(items, RECT);
    expect(items).toEqual(copia);
  });

  it("aguenta um item gigante ao lado de migalhas sem sobrepor", () => {
    const items: Item[] = [
      { name: "gigante", value: 1e12 },
      ...Array.from({ length: 30 }, (_, i) => ({ name: `m${i}`, value: 1 })),
    ];
    const cells = squarify(items, RECT);
    expectNoOverlap(cells);
    expectInside(cells, RECT);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeCloseTo(area(RECT), 3);
  });
});

describe("collapseTail", () => {
  it("mantém os maiores e soma o resto", () => {
    const items: Item[] = [
      { name: "a", value: 10 },
      { name: "b", value: 8 },
      { name: "c", value: 5 },
      { name: "d", value: 2 },
      { name: "e", value: 1 },
    ];
    const r = collapseTail(items, 3);
    expect(r.kept.map((i) => i.name)).toEqual(["a", "b", "c"]);
    expect(r.otherValue).toBe(3);
    expect(r.otherCount).toBe(2);
  });

  it("lista menor que o limite passa inteira e ordenada", () => {
    const r = collapseTail(
      [
        { name: "a", value: 1 },
        { name: "b", value: 5 },
      ],
      10,
    );
    expect(r.kept.map((i) => i.name)).toEqual(["b", "a"]);
    expect(r.otherCount).toBe(0);
    expect(r.otherValue).toBe(0);
  });

  it("lista vazia não quebra", () => {
    const r = collapseTail([], 5);
    expect(r.kept).toEqual([]);
    expect(r.otherCount).toBe(0);
  });
});

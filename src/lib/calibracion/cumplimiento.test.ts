import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorPeriodo, evaluarPrograma, totalizar, type ItemPrograma } from "./cumplimiento.ts";
import { claveSemana, finSemanaIso, normalizarTag, parseFechaDMY, semanaIso } from "./fechas.ts";

const item = (id: string, tag: string, fechaPlan: string): ItemPrograma => ({
  id,
  tag,
  fechaPlan,
  origen: "WG",
  programa: "WG",
  frecuenciaDias: 28,
});

test("parseFechaDMY acepta dd/mm/yy y rechaza fechas inexistentes", () => {
  assert.equal(parseFechaDMY("05/03/26"), "2026-03-05");
  assert.equal(parseFechaDMY("31/02/2026"), null);
  assert.equal(parseFechaDMY(""), null);
});

test("normalizarTag quita guiones y espacios", () => {
  assert.equal(normalizarTag("ait-250006 "), "AIT250006");
});

test("semana ISO y fin de semana", () => {
  assert.equal(claveSemana("2026-01-01"), "2026-W01");
  assert.equal(finSemanaIso("2026-03-05"), "2026-03-08");
  assert.equal(semanaIso("2026-12-31").semana, 53);
});

test("calibración en la semana es en plazo; posterior es atrasada", () => {
  const prog = [item("a", "T1", "2026-03-02"), item("b", "T2", "2026-03-02")];
  const reg = [
    { tag: "T1", fecha: "2026-03-06" },
    { tag: "T2", fecha: "2026-03-20" },
  ];
  const r = evaluarPrograma(prog, reg, "2026-04-30").items;
  assert.equal(r.find((x) => x.tag === "T1")?.estado, "en_plazo");
  const t2 = r.find((x) => x.tag === "T2");
  assert.equal(t2?.estado, "atrasada");
  assert.equal(t2?.diasAtraso, 12);
});

test("un registro no satisface dos ítems consecutivos", () => {
  const prog = [item("a", "T1", "2026-01-05"), item("b", "T1", "2026-02-02")];
  const reg = [{ tag: "T1", fecha: "2026-01-14" }];
  const r = evaluarPrograma(prog, reg, "2026-03-01").items;
  assert.equal(r.find((x) => x.id === "a")?.estado, "atrasada");
  assert.equal(r.find((x) => x.id === "b")?.estado, "vencida");
});

test("futuro es por_vencer y adelanto cuenta en plazo", () => {
  const prog = [item("a", "T1", "2026-06-15"), item("b", "T2", "2026-12-14")];
  const reg = [{ tag: "T1", fecha: "2026-06-08" }];
  const r = evaluarPrograma(prog, reg, "2026-06-20").items;
  assert.equal(r.find((x) => x.id === "a")?.estado, "en_plazo");
  assert.equal(r.find((x) => x.id === "b")?.estado, "por_vencer");
});

test("período sin ningún registro se marca sin_registro y no entra al KPI", () => {
  const prog = [item("a", "T1", "2026-03-02"), item("b", "T1", "2026-06-08"), item("c", "T2", "2026-06-08")];
  const reg = [{ tag: "T1", fecha: "2026-03-03" }];
  const { items } = evaluarPrograma(prog, reg, "2026-09-01");
  const periodos = agruparPorPeriodo(items, "mes", ["2026-03-03"], "2026-09-01");
  const junio = periodos.find((p) => p.clave === "2026-06");
  assert.equal(junio?.sinRegistro, 2);
  assert.equal(junio?.exigibles, 0);
  assert.equal(junio?.cumplimiento, null);
  const total = totalizar(periodos);
  assert.equal(total.cumplimiento, 1);
  assert.equal(total.programadas, 3);
});

test("período con datos y sin calibración cuenta como vencido", () => {
  const prog = [item("a", "T1", "2026-03-02"), item("b", "T2", "2026-03-09")];
  const { items } = evaluarPrograma(prog, [{ tag: "T1", fecha: "2026-03-03" }], "2026-06-01");
  const p = agruparPorPeriodo(items, "mes", ["2026-03-03"], "2026-06-01")[0];
  assert.equal(p.vencidas, 1);
  assert.equal(p.cumplimiento, 0.5);
});

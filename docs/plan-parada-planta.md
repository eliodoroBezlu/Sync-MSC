# Plan de implementación — Módulo "Parada de Planta"

> Seguimiento y control de paradas mayores de planta (turnarounds). Primera parada
> objetivo: **PPML060**, preparativos desde el **lun 7 sep 2026**, ejecución **11–13 sep 2026**.

## 1. Alcance y reglas de negocio (confirmadas)

| Tema | Decisión |
|---|---|
| Acceso | Nuevo botón **"Parada de Planta"** en el menú de `/ordenes` (roles gestión: 1, 2, 3, 5) |
| Identificación | Código de parada configurable — esta es `PPML060` (60ª parada en 20 años) |
| Contratistas | **No son entidad ni grupo aparte.** Son apoyo a los grupos de Eléctricos, Instrumentistas y SC Tesa: solo **suman cabezas** a la dotación (se registra un número, sin nombres ni usuarios) |
| Fuera de alcance | **Sin presupuesto, sin costos, sin módulo de seguridad, sin turneros** |
| Base | El **listado de OT's** existente, cada una con la **fecha** en que se ejecutará |
| Fases | **1 – Preparativos** (desde 7 sep; algunas OTs ya se reportan en el flujo normal). **2 – Ejecución** (11–13 sep) |
| HH | **Solo se contabilizan las HH de la Fase 2 (11, 12, 13).** Las HH de preparativos no entran al tablero |
| Grupos | **Día** y **Noche**, sin turneros. Cada uno con supervisor(es) y dotación (propia + apoyo) |
| Reuniones | El **Reporte Diario del Supervisor** alimenta las reuniones de avance de **08:00** y **17:00** |
| UI | Página nueva; **indicadores del tablero en el encabezado** (solo avance y cumplimiento de OT — nada de seguridad ni costo) |

## 2. Stack y convenciones del proyecto (observadas)

- **Next.js 16 App Router + React 19**, Prisma 7 + PostgreSQL.
- API = route handlers en `src/app/api/**/route.ts`; respuesta con `NextResponse.json` y patrón de serialización `{ ...obj, _id: obj.id }`.
- PDF = `jspdf` + `jspdf-autotable` **en cliente**, banner naranja/navy, `piePagina()`, `doc.output("bloburl")` + `window.open` (ver `src/lib/planificacion/generarResumenOtsPdf.ts`).
- Import Excel = `xlsx`. Validación = `zod`.
- Auth cliente = `useUser()` de `@/context/AuthContext` (roles: 1 Admin, 2 Superintendente, 3 Supervisor, 4 Técnico, 5 Planificador, 6 Contratista).
- Estilos = inline (no Tailwind en estos módulos). Reusar look de `KpiStrip` / `src/app/planificacion/[id]/*`.
- Módulo análogo de referencia: **Planificación** (`PlanBorrador` → `PlanBorradorOt` → `RosterSemanal`, rutas `/planificacion` + `/api/planificacion/[id]/*`, workspace con sub-componentes).
- `OrdenTrabajo` ya admite `turno = "Parada de Planta"` y `estadoJDE = "44"`; existe `OtRegistroDiario`. **No se modifica `OrdenTrabajo`** — todo el seguimiento vive en tablas nuevas.

## 3. Modelo de datos (Prisma) — 5 modelos nuevos

Todos son tablas nuevas ⇒ migración **no destructiva** (`prisma db push`).

```prisma
// ─── PARADA DE PLANTA ─────────────────────────────────────────────────────────

model Parada {
  id                     String   @id @default(cuid())
  codigo                 String   @unique            // "PPML060"
  nombre                 String                       // descripción de la parada
  planta                 String?                      // o área principal
  fechaPreparativosInicio DateTime                    // 2026-09-07
  fechaEjecucionInicio   DateTime                     // 2026-09-11
  fechaEjecucionFin      DateTime                     // 2026-09-13
  estado                 String   @default("preparativos") // preparativos | ejecucion | cerrada
  creadoPor              String
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  ots             ParadaOt[]
  grupos          ParadaGrupo[]
  avances         ParadaAvanceDiario[]
  reportesDiarios ParadaReporteDiario[]

  @@index([estado, fechaEjecucionInicio(sort: Desc)])
}

model ParadaGrupo {
  id                 String  @id @default(cuid())
  paradaId           String
  turno              String                       // "Dia" | "Noche"
  disciplina         String                       // "ELEC" | "INST" | "TESA" | "MIXTO"
  supervisorNombre   String
  supervisorUsuarioId String?
  dotacionPropia     Int     @default(0)
  dotacionApoyo      Int     @default(0)          // contratistas que suman al grupo
  parada             Parada  @relation(fields: [paradaId], references: [id], onDelete: Cascade)

  @@unique([paradaId, turno, disciplina])
  @@index([paradaId])
}

model ParadaOt {
  id                String   @id @default(cuid())
  paradaId          String
  numeroOT          String
  ordenTrabajoId    String?                       // enlace opcional a OrdenTrabajo real
  descripcion       String
  tag               String   @default("")
  descripcionEquipo String   @default("")
  disciplina        String                        // ELEC | INST | TESA
  fase              String   @default("ejecucion") // preparativos | ejecucion
  hhEstimadas       Float    @default(0)
  fechaProg         DateTime?                      // fecha planificada (o inicio)
  fechaProgFin      DateTime?                      // si abarca varios días
  grupo             String   @default("Dia")       // Dia | Noche | Ambos
  responsable       String?                        // planificador/supervisor responsable
  critica           Boolean  @default(false)
  estado            String   @default("no_iniciada") // no_iniciada | en_ejecucion | terminada | con_retraso
  avancePct         Int      @default(0)           // cache del último avance diario
  observaciones     String?
  orden             Int?                            // orden de despliegue en el listado
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  parada  Parada               @relation(fields: [paradaId], references: [id], onDelete: Cascade)
  avances ParadaAvanceDiario[]

  @@index([paradaId, fase])
  @@index([numeroOT])
}

model ParadaAvanceDiario {
  id            String   @id @default(cuid())
  paradaId      String                            // denormalizado para el tablero
  paradaOtId    String
  fecha         DateTime                          // 11, 12 o 13
  turno         String                            // "Dia" | "Noche"
  avancePct     Int      @default(0)              // % físico al cierre del turno
  hhPropias     Float    @default(0)
  hhApoyo       Float    @default(0)
  estado        String                            // en_ejecucion | terminada | con_retraso | no_iniciada
  comentario    String?
  registradoPor String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  parada   Parada   @relation(fields: [paradaId], references: [id], onDelete: Cascade)
  paradaOt ParadaOt @relation(fields: [paradaOtId], references: [id], onDelete: Cascade)

  @@unique([paradaOtId, fecha, turno])
  @@index([paradaId, fecha])
}

model ParadaReporteDiario {
  id                  String   @id @default(cuid())
  paradaId            String
  fecha               DateTime
  turno               String                       // "Dia" | "Noche"
  reunion             String                       // "08:00" | "17:00"
  supervisorNombre    String
  supervisorUsuarioId String?
  resumen             String
  avanceGlobalPct     Int      @default(0)
  hhPropias           Float    @default(0)
  hhApoyo             Float    @default(0)
  otsTerminadas       String[]                     // números de OT
  otsConRetraso       Json     @default("[]")      // [{ numeroOT, motivo, accion }]
  pendientes          Json     @default("[]")      // [{ tipo: "material"|"repuesto"|"permiso"|"apoyo", detalle }]
  observaciones       String?
  estado              String   @default("borrador") // borrador | emitido
  pdfUrl              String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  parada Parada @relation(fields: [paradaId], references: [id], onDelete: Cascade)

  @@unique([paradaId, fecha, turno, reunion])
  @@index([paradaId, fecha])
}
```

### Reglas de consistencia

- **HH solo de Fase 2**: `ParadaAvanceDiario` únicamente existe para OTs `fase = "ejecucion"` y fechas 11–13. Las OTs de preparativos no tienen avance diario ni HH.
- Al guardar un `ParadaAvanceDiario` se actualiza el **cache** `ParadaOt.avancePct` (último valor) y `ParadaOt.estado` (según el avance/estado reportado).
- `ParadaOt.ordenTrabajoId` es opcional: si está, la pestaña Preparativos puede leer el `estado` real de la `OrdenTrabajo` y sus `OtRegistroDiario`.

## 4. Rutas API (`src/app/api/paradas/…`)

| Método | Ruta | Función |
|---|---|---|
| GET / POST | `/api/paradas` | Listar paradas / crear (`codigo`, `nombre`, fechas, `creadoPor`); POST crea grupos base Día/Noche |
| GET / PATCH / DELETE | `/api/paradas/[id]` | Detalle (con `ots`, `grupos`, agregados) / editar encabezado y `estado` / borrar |
| GET / POST | `/api/paradas/[id]/ots` | Listar / agregar OT individual |
| PATCH / DELETE | `/api/paradas/[id]/ots/[otId]` | Editar (`fase`, `fechaProg`, `grupo`, `hhEstimadas`, `estado`, `critica`, `responsable`) / quitar |
| POST | `/api/paradas/[id]/importar` | Importar listado de OTs desde `.xlsx` (o pegado). Mapea: N° OT, descripción, tag, disciplina, HH, fecha, fase, grupo |
| POST | `/api/paradas/[id]/vincular-ots` | Buscar `OrdenTrabajo` por `numeroOT` y enlazar (`ordenTrabajoId`) |
| GET / POST | `/api/paradas/[id]/grupos` | Listar / crear grupo |
| PATCH | `/api/paradas/[id]/grupos/[grupoId]` | Dotación propia/apoyo, supervisor |
| GET / POST | `/api/paradas/[id]/avances` | Listar por `fecha`/`turno` / **upsert** avance diario por OT (unique `paradaOtId+fecha+turno`) |
| GET / POST | `/api/paradas/[id]/reportes` | Listar / crear reporte diario del supervisor (auto-prellenado desde `avances` de ese `fecha+turno`) |
| GET / PATCH | `/api/paradas/[id]/reportes/[repId]` | Leer / editar / marcar `emitido` |
| GET | `/api/paradas/[id]/tablero` | Indicadores calculados del encabezado (server, para consistencia) |

Validación con `zod` en cada `POST`/`PATCH`. Gating de rol server-side siguiendo el patrón existente del repo (ver nota en §8).

## 5. Cálculo de indicadores — `src/lib/parada/indicadores.ts` (lógica pura + tests)

Entrada: `Parada` con `ots` + `avances`. Salida (`TableroParada`):

- **avanceGlobalPct** = `Σ(hhEstimadas_i × avancePct_i) / Σ(hhEstimadas_i)` sobre OTs `fase = "ejecucion"` (ponderado por HH; *fallback* a promedio simple si todas las HH son 0).
- **ots**: `{ total, terminadas, enEjecucion, noIniciadas, conRetraso }` — global y desglosado `preparativos` vs `ejecucion`.
- **cumplimientoHoy** = `terminadas / programadasHastaHoy` (OTs con `fechaProg ≤ hoy`).
- **porDisciplina** `{ ELEC, INST, TESA }` → `{ avancePct, otsTotal, otsTerminadas, hhReal, hhEst }`.
- **hh**: `hhEst` (Σ `hhEstimadas` fase ejecución), `hhReal` (Σ `hhPropias + hhApoyo` de `avances`), `factorProductividad` = `(avanceGlobalPct/100 × hhEst) / hhReal`.
- **diaActual**: `"Día 2 de 3"`, con `avancePlan` (lineal o por `fechaProg`) vs `avanceReal`.
- **serieDiaria**: `[{ fecha, avancePlanAcum, avanceRealAcum, hhReal }]` para el mini-gráfico del encabezado.

Tipos compartidos en `src/lib/parada/tipos.ts`.

## 6. UI

Ruta base top-level `/paradas` (como `/planificacion`).

### `/paradas/page.tsx` (client — lista)
- Tabla de paradas: código, nombre, fechas, estado, % avance.
- Botón **"Nueva Parada"** → modal: `codigo` (`PPML0XX`), `nombre`, `fechaPreparativosInicio`, `fechaEjecucionInicio/Fin`.

### `/paradas/[id]/page.tsx` (client — workspace / container)
- Carga `GET /api/paradas/[id]` + `GET /api/paradas/[id]/tablero`.
- **Encabezado fijo**: `<TableroParada indicadores={…} />` — franja de KPIs (avance global + anillo/curva, OTs por estado, cumplimiento hoy, por disciplina, HH real vs est, "Día X de 3", mini serie diaria).
- Pestañas (estado local `tab`): `resumen | preparativos | ejecucion | reportes | config`.

### Componentes en `/paradas/[id]/`

| Componente | Pestaña | Contenido |
|---|---|---|
| `TableroParada.tsx` | (encabezado) | KPIs — presentacional; reusa estilo de `KpiStrip` |
| `ListaOtsParada.tsx` | Resumen | Tabla de todas las OTs con filtros (fase / disciplina / estado). Columnas: N° OT, descripción, tag, disciplina, fase, grupo, HH est, `fechaProg`, % avance, estado. Edición inline (patrón `OtRow` de planificación) |
| `PanelPreparativos.tsx` | Preparativos | OTs `fase = "preparativos"`: N° OT, descripción, responsable, `fechaProg`, estado (editable), enlace a la OT real si `ordenTrabajoId`. **Sin HH** |
| `AvanceDiario.tsx` | Ejecución | Selector fecha (11/12/13) + turno (Día/Noche). Tabla de OTs `fase = "ejecucion"` de esa fecha/abiertas; por fila: `% avance`, `HH propias`, `HH apoyo`, `estado`, `comentario`; **Guardar** → `POST /avances` (upsert). Subtotales de HH y avance del turno |
| `ReporteDiarioSupervisor.tsx` | Reportes | Formulario: fecha, turno, reunión (08:00/17:00), resumen, avance global, HH, OTs terminadas (multiselect), OTs con retraso + acción, pendientes, observaciones. Botón **"Prellenar desde avances"**. Botón **"Generar PDF"**. Historial de reportes emitidos |
| `ConfigParada.tsx` | Config | Editar código/nombre/fechas/estado; grupos Día/Noche (dotación propia + apoyo, supervisor); **importar listado de OTs** (`input file .xlsx` + preview) o agregar OT manual; botón **"Vincular con OTs del sistema"** |

## 7. PDF — `src/lib/parada/`

- **`generarReporteDiarioPdf.ts`** — `jsPDF` + `autoTable`, mismo patrón que `generarResumenOtsPdf.ts` (banner, `piePagina`, `bloburl` + `window.open`). Secciones: encabezado (PPML060, fecha, turno, reunión, supervisor) · bloque de indicadores del día · tabla de OTs con avance del turno · OTs terminadas · tabla OTs con retraso + acción · pendientes · observaciones.
- **`generarInformeCierrePdf.ts`** *(Fase C)* — HH reales por OT, % cumplimiento por disciplina, curva de avance 11→13, lecciones aprendidas.

## 8. Integración con el resto del sistema

- **Menú** `src/app/ordenes/page.tsx` → agregar a `TODOS_MODULOS`:
  ```ts
  {
    href: "/paradas",
    label: "Parada de Planta",
    descripcion: "Seguimiento de paradas mayores — avance diario y reporte de supervisor",
    badge: "Parada",
    color: "#b91c1c",
    soloGestion: true,   // roles 2, 3, 5 (+ admin)
    icon: (/* SVG llave/engranaje */),
  }
  ```
- **OrdenTrabajo**: sin cambios de esquema. Enlace opcional vía `ParadaOt.ordenTrabajoId`.
- **Consolidado mensual de HH** *(opcional, Fase C)*: helper `hhParada(codigo)` que expone las HH de `ParadaAvanceDiario` etiquetadas `Parada PPML060`, separadas de propias/contratista, para que los reportes mensuales las sumen sin ensuciar la dotación fija.
- **Auth server-side**: varias rutas actuales del repo no validan rol en el servidor. Recomendación: al menos replicar el patrón vigente y, de preferencia, añadir verificación de sesión/rol en los handlers de escritura de `/api/paradas/*`.

## 9. Orden de trabajo por fases

### Fase A — Backend
1. Añadir los 5 modelos a `prisma/schema.prisma` → `prisma generate` → `npm run migrate` (local).
2. `src/lib/parada/tipos.ts` + `src/lib/parada/indicadores.ts` (lógica pura **con tests** — cobertura ≥ 80 %).
3. `/api/paradas` + `/api/paradas/[id]` (CRUD encabezado).
4. `/api/paradas/[id]/ots` + `/ots/[otId]` + `/grupos` + `/grupos/[grupoId]`.
5. `/api/paradas/[id]/importar` (xlsx) + `/vincular-ots`.
6. `/api/paradas/[id]/avances` + `/reportes` + `/reportes/[repId]`.
7. `/api/paradas/[id]/tablero`.

### Fase B — UI
8. `/paradas/page.tsx` (lista + crear).
9. `/paradas/[id]/page.tsx` (container + pestañas) + `TableroParada.tsx`.
10. `ConfigParada.tsx` (encabezado, grupos, importar OTs).
11. `ListaOtsParada.tsx` + `PanelPreparativos.tsx`.
12. `AvanceDiario.tsx`.
13. `ReporteDiarioSupervisor.tsx` + `generarReporteDiarioPdf.ts`.
14. Card en el menú `/ordenes`.

### Fase C — Cierre y pulido
15. `generarInformeCierrePdf.ts` + estado `"cerrada"`.
16. (Opcional) integración con consolidado mensual de HH.
17. `code-reviewer` + pruebas manuales con datos reales de PPML060 + `npm run build`.
18. Commit → push a `externo` y `origin` (deploy Railway).

## 10. Permisos por rol

| Acción | Roles |
|---|---|
| Ver el módulo | 1, 2, 3, 5 |
| Crear parada / importar OTs / config | 1, 2, 5 |
| Avance Diario + Reporte Diario del Supervisor | 3, 5 |
| Cerrar la parada | 1, 2 |

## 11. Decisiones abiertas (confirmar antes de Fase A)

1. **Dotación por día**: ¿la cantidad de personal (propia/apoyo) varía entre el 11, 12 y 13? — *Propuesta:* empezar con un valor único por grupo y permitir override en el reporte diario. Si se necesita por día, `ParadaGrupo.dotacionPorDia Json`.
2. **Quién carga el % de avance por OT**: ¿el supervisor/planificador en la reunión, o el técnico en campo? — *Propuesta:* supervisor/planificador en `AvanceDiario`, una vez por turno.
3. **Formato del Excel del listado de OTs**: se necesita una muestra real (nombres exactos de columnas) para el parser de `/importar`.
4. **Ponderación del avance global**: ¿por HH estimadas o por conteo de OTs? — *Propuesta:* por HH, con *fallback* a conteo.
5. **Horario de los grupos Día/Noche**: ¿distinto a los turnos normales 06:30 / 18:30? — solo afecta textos/labels.
6. **Reunión 08:00 / 17:00**: ¿un `ParadaReporteDiario` por reunión (2 por turno) o uno por turno? — *Propuesta:* campo `reunion` con las dos opciones, unique `paradaId+fecha+turno+reunion`.

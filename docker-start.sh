#!/bin/sh
echo "[start] Aplicando migraciones pendientes..."
node << 'MIGRATE'
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

// Lista de migraciones idempotentes — agregar aquí cada nuevo campo
const migraciones = [
  "ALTER TABLE \"ReporteTurno\" ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'supervisor'",
  "ALTER TABLE \"OtLinea\" ADD COLUMN IF NOT EXISTS adjuntos JSONB NOT NULL DEFAULT '[]'",
  "ALTER TABLE \"OtLinea\" ADD COLUMN IF NOT EXISTS \"estadoFinal\" TEXT",
  "ALTER TABLE \"OtRegistroDiario\" ADD COLUMN IF NOT EXISTS turno TEXT",
  "ALTER TABLE \"OtRegistroDiario\" ADD COLUMN IF NOT EXISTS adjuntos JSONB NOT NULL DEFAULT '[]'",
  "ALTER TABLE \"RegistroCalibracion\" ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'revision'",
  "ALTER TABLE \"RegistroCalibracion\" ADD COLUMN IF NOT EXISTS \"tecnicoFirma\" TEXT",
  "ALTER TABLE \"RegistroCalibracion\" ADD COLUMN IF NOT EXISTS \"supervisorFirma\" TEXT",
  "ALTER TABLE \"Usuario\" ADD COLUMN IF NOT EXISTS \"esContratista\" BOOLEAN NOT NULL DEFAULT false",
  "ALTER TABLE \"Usuario\" ADD COLUMN IF NOT EXISTS \"fechaExpiracion\" TIMESTAMP(3)",
  "ALTER TABLE \"OtProgramada\" ADD COLUMN IF NOT EXISTS \"personalAsignadoIds\" TEXT[] NOT NULL DEFAULT '{}'",
  "ALTER TABLE \"OtProgramada\" ADD COLUMN IF NOT EXISTS bitacora JSONB NOT NULL DEFAULT '[]'",

  // ── Competencias y Desempeño (2026-06) ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "TecnicoCompetencia" (
    id TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    disciplina TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'Básico',
    competencias TEXT[] NOT NULL DEFAULT '{}',
    certificado BOOLEAN NOT NULL DEFAULT false,
    "validaHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TecnicoCompetencia_usuarioId_disciplina_key" UNIQUE ("usuarioId", disciplina)
  )`,
  `CREATE TABLE IF NOT EXISTS "EquipoMantenimientoPlan" (
    id TEXT NOT NULL PRIMARY KEY,
    tag TEXT NOT NULL,
    disciplina TEXT NOT NULL,
    "tipoOT" TEXT NOT NULL DEFAULT 'PMT',
    descripcion TEXT NOT NULL,
    frecuencia TEXT NOT NULL,
    "basadoEn" TEXT NOT NULL DEFAULT 'calendario',
    personas INTEGER NOT NULL DEFAULT 1,
    "hrsTrabajo" DOUBLE PRECISION NOT NULL DEFAULT 2,
    grupo TEXT NOT NULL DEFAULT 'Diurno',
    "diasPreferidos" TEXT[] NOT NULL DEFAULT '{"Lu","Vi"}',
    "competenciaReq" TEXT,
    "ultimoEjecutado" TIMESTAMP(3),
    "proximoVencimiento" TIMESTAMP(3),
    activo BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquipoMantenimientoPlan_tag_tipoOT_key" UNIQUE (tag, "tipoOT")
  )`,
  `CREATE TABLE IF NOT EXISTS "TecnicoDesempenio" (
    id TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    tag TEXT NOT NULL,
    "tipoOT" TEXT NOT NULL,
    "otasCompletadas" INTEGER NOT NULL DEFAULT 0,
    "tiempoPromedio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    eficiencia DOUBLE PRECISION NOT NULL DEFAULT 100,
    "ultimaFecha" TIMESTAMP(3),
    tendencia TEXT NOT NULL DEFAULT 'estable',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TecnicoDesempenio_usuarioId_tag_tipoOT_key" UNIQUE ("usuarioId", tag, "tipoOT")
  )`,
  `CREATE TABLE IF NOT EXISTS "PlanConstraintAlert" (
    id TEXT NOT NULL PRIMARY KEY,
    "planBorradorId" TEXT NOT NULL,
    tipo TEXT NOT NULL,
    severidad TEXT NOT NULL DEFAULT 'warning',
    mensaje TEXT NOT NULL,
    detalles JSONB,
    resuelto BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS \"TecnicoCompetencia_disciplina_nivel_idx\" ON \"TecnicoCompetencia\" (disciplina, nivel)",
  "CREATE INDEX IF NOT EXISTS \"EquipoMantenimientoPlan_proximoVencimiento_activo_idx\" ON \"EquipoMantenimientoPlan\" (\"proximoVencimiento\", activo)",
  "CREATE INDEX IF NOT EXISTS \"TecnicoDesempenio_eficiencia_idx\" ON \"TecnicoDesempenio\" (eficiencia)",
  "CREATE INDEX IF NOT EXISTS \"PlanConstraintAlert_planBorradorId_resuelto_idx\" ON \"PlanConstraintAlert\" (\"planBorradorId\", resuelto)",

  // ── Planificación module (2026-06) ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "PlanBorrador" (
    id TEXT NOT NULL PRIMARY KEY,
    semana INTEGER NOT NULL,
    anio INTEGER NOT NULL,
    "areaCodigo" TEXT NOT NULL,
    disciplina TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'borrador',
    "creadoPor" TEXT NOT NULL,
    "publicadoEn" TIMESTAMP(3),
    "programacionSemanalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanBorrador_semana_anio_areaCodigo_key" UNIQUE (semana, anio, "areaCodigo")
  )`,
  `CREATE TABLE IF NOT EXISTS "PlanBorradorOt" (
    id TEXT NOT NULL PRIMARY KEY,
    "planBorradorId" TEXT NOT NULL,
    control INTEGER,
    "numeroOT" TEXT NOT NULL,
    "tipoOT" TEXT NOT NULL,
    "tipoTrabajo" TEXT NOT NULL,
    prioridad TEXT,
    descripcion TEXT NOT NULL,
    tag TEXT NOT NULL,
    "descripcionEquipo" TEXT NOT NULL DEFAULT '',
    personas INTEGER NOT NULL DEFAULT 1,
    "hrsTrabajo" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hhTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fechaInicioOt" TIMESTAMP(3),
    "fechaFinOt" TIMESTAMP(3),
    "diasTexto" TEXT,
    dias TEXT[] NOT NULL DEFAULT '{}',
    grupo TEXT NOT NULL DEFAULT 'Diurno',
    "personalAsignado" TEXT[] NOT NULL DEFAULT '{}',
    "personalAsignadoIds" TEXT[] NOT NULL DEFAULT '{}',
    "esGuardia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanBorradorOt_planBorradorId_fkey"
      FOREIGN KEY ("planBorradorId") REFERENCES "PlanBorrador"(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "RosterSemanal" (
    id TEXT NOT NULL PRIMARY KEY,
    "planBorradorId" TEXT NOT NULL,
    nombre TEXT NOT NULL,
    jde TEXT,
    "usuarioId" TEXT,
    grupo TEXT NOT NULL DEFAULT 'Diurno',
    "esContratista" BOOLEAN NOT NULL DEFAULT false,
    disciplina TEXT NOT NULL,
    asistencia JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterSemanal_planBorradorId_nombre_key" UNIQUE ("planBorradorId", nombre),
    CONSTRAINT "RosterSemanal_planBorradorId_fkey"
      FOREIGN KEY ("planBorradorId") REFERENCES "PlanBorrador"(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS \"PlanBorrador_anio_semana_estado_idx\" ON \"PlanBorrador\" (anio, semana, estado)",
  "CREATE INDEX IF NOT EXISTS \"PlanBorradorOt_planBorradorId_idx\" ON \"PlanBorradorOt\" (\"planBorradorId\")",
  "CREATE INDEX IF NOT EXISTS \"PlanBorradorOt_numeroOT_idx\" ON \"PlanBorradorOt\" (\"numeroOT\")",
  "CREATE INDEX IF NOT EXISTS \"RosterSemanal_planBorradorId_idx\" ON \"RosterSemanal\" (\"planBorradorId\")",

  // ── Importación PROGRAMA (JDE) en PlanBorradorOt (2026-07) ──────────────────
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"estadoJDE\" TEXT",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"estadoDetalle\" TEXT",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS solicitante TEXT",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS observaciones TEXT",

  // ── Selección semanal + backlog en PlanBorradorOt (2026-07) ──────────────────
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS seleccionada BOOLEAN NOT NULL DEFAULT false",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"motivoNoProgramada\" TEXT",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"comentarioNoProgramada\" TEXT",
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"esBacklog\" BOOLEAN NOT NULL DEFAULT false",

  // ── Cuadrillas fijas: membresía técnico×grupo×día (2026-07) ─────────────────
  `CREATE TABLE IF NOT EXISTS "CuadrillaMiembro" (
    id TEXT NOT NULL PRIMARY KEY,
    "planBorradorId" TEXT NOT NULL,
    grupo TEXT NOT NULL,
    dia TEXT NOT NULL,
    "tecnicoNombre" TEXT NOT NULL,
    "tecnicoUsuarioId" TEXT,
    origen TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuadrillaMiembro_planBorradorId_grupo_dia_tecnicoNombre_key" UNIQUE ("planBorradorId", grupo, dia, "tecnicoNombre"),
    CONSTRAINT "CuadrillaMiembro_planBorradorId_fkey"
      FOREIGN KEY ("planBorradorId") REFERENCES "PlanBorrador"(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS \"CuadrillaMiembro_planBorradorId_dia_idx\" ON \"CuadrillaMiembro\" (\"planBorradorId\", dia)",
  "CREATE INDEX IF NOT EXISTS \"CuadrillaMiembro_planBorradorId_grupo_idx\" ON \"CuadrillaMiembro\" (\"planBorradorId\", grupo)",

  // ── Capacidad HH por grupo/día en el Tablero (2026-07) ──────────────────────
  "ALTER TABLE \"PlanBorrador\" ADD COLUMN IF NOT EXISTS \"capacidadOverride\" JSONB NOT NULL DEFAULT '{}'",

  // ── Grupo asignado a mano: Balancear no lo sobrescribe (2026-07) ────────────
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"grupoManual\" BOOLEAN NOT NULL DEFAULT false",

  // ── Reparto manual de HH por día en una OT multi-día (2026-07) ──────────────
  "ALTER TABLE \"PlanBorradorOt\" ADD COLUMN IF NOT EXISTS \"hhPorDiaManual\" JSONB",
];

(async () => {
  for (const sql of migraciones) {
    try {
      await pool.query(sql);
      console.log('[migrate] OK:', sql.slice(0, 70));
    } catch(e) {
      console.log('[migrate] Skip:', e.message.slice(0, 100));
    }
  }
  // OT 892901 cerrada por técnico sin permiso → revertir a pendiente_revision
  try {
    const res = await pool.query(`
      UPDATE "OrdenTrabajo" SET estado = 'pendiente_revision'
      WHERE "numeroOT" = '892901' AND estado IN ('revisado','concluido')
    `);
    if (res.rowCount > 0) console.log('[migrate] OT 892901 revertida a pendiente_revision');
  } catch(e) {
    console.log('[migrate] OT 892901 skip:', e.message.slice(0, 80));
  }

  // Resetear OtProgramada huérfanas (apuntan a OrdenTrabajo eliminadas) — cualquier estado
  try {
    const res = await pool.query(`
      UPDATE "OtProgramada" SET estado = 'pendiente', "ordenTrabajoId" = NULL, "ordenTrabajoNum" = NULL
      WHERE "ordenTrabajoId" IS NOT NULL
        AND "ordenTrabajoId" NOT IN (SELECT id FROM "OrdenTrabajo")
    `);
    console.log('[migrate] OtProgramada huérfanas reseteadas:', res.rowCount);
  } catch(e) {
    console.log('[migrate] Reset huérfanas skip:', e.message.slice(0, 80));
  }

  // Backfill personalAsignadoIds: rellenar IDs desde los nombres ya asignados
  // (match exacto contra Usuario.nombre, de donde salieron los nombres del editor).
  // Solo rellena las OTs sin IDs aún → idempotente, no pisa asignaciones por identidad.
  try {
    const res = await pool.query(`
      UPDATE "OtProgramada" ot
      SET "personalAsignadoIds" = sub.ids
      FROM (
        SELECT o.id, array_agg(DISTINCT u.id) AS ids
        FROM "OtProgramada" o
        CROSS JOIN LATERAL unnest(o."personalAsignado") AS pn(nombre)
        JOIN "Usuario" u ON u.nombre = pn.nombre
        GROUP BY o.id
      ) sub
      WHERE ot.id = sub.id
        AND (ot."personalAsignadoIds" IS NULL OR cardinality(ot."personalAsignadoIds") = 0)
    `);
    console.log('[migrate] personalAsignadoIds backfill:', res.rowCount);
  } catch(e) {
    console.log('[migrate] Backfill IDs skip:', e.message.slice(0, 100));
  }

  // Asegurar contador 2026 >= 286 (9 certs reales subidos, próximo = 287)
  try {
    await pool.query(
      `INSERT INTO "Contador" (nombre, valor) VALUES ('calibracion-2026', 290)
       ON CONFLICT (nombre) DO UPDATE SET valor = GREATEST("Contador".valor, 290)`
    );
    console.log('[migrate] Contador calibracion-2026 OK.');
  } catch(e) {
    console.log('[migrate] Contador skip:', e.message.slice(0, 80));
  }

  await pool.end();
  console.log('[start] Migraciones completadas.');
})();
MIGRATE

echo "[start] Iniciando servidor Next.js..."
exec node server.js

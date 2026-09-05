// Borradores locales (IndexedDB) para el formulario de Registro de OT.
//
// Los técnicos a veces llenan una OT en el campo (fotos, líneas de tarea) sin
// conexión y sin terminar de enviarla; si cierran la pestaña o pierden señal
// antes de enviar, hoy se pierde todo. Este módulo guarda un snapshot del
// formulario en el propio navegador (nunca viaja al servidor) para poder
// recuperarlo la próxima vez que abran la página.
//
// Se usa IndexedDB en vez de localStorage porque las líneas pueden traer
// fotos en base64 (varios MB) y localStorage tiene un límite muy chico
// (~5-10MB) que se llenaría rápido.

const DB_NAME = "sync-msc-borradores";
const STORE = "borradores";
const DB_VERSION = 1;

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clave" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

export interface BorradorGuardado<T> {
  clave: string;
  datos: T;
  ts: number; // Date.now() del último guardado
}

/**
 * Guarda (o reemplaza) el borrador bajo `clave`. Nunca lanza: si falla (modo
 * privado del navegador, cuota agotada, etc.) devuelve `false` para que la UI
 * pueda avisar que el borrador NO quedó guardado en este dispositivo, sin
 * romper el llenado normal del formulario.
 */
export async function guardarBorrador<T>(clave: string, datos: T): Promise<boolean> {
  try {
    const db = await abrirDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const registro: BorradorGuardado<T> = { clave, datos, ts: Date.now() };
      tx.objectStore(STORE).put(registro);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (err: unknown) {
    console.error("No se pudo guardar el borrador local:", err);
    return false;
  }
}

/**
 * Pide al navegador que marque el almacenamiento del sitio como "persistente"
 * para que no lo borre automáticamente al quedarse sin espacio (o tras días de
 * inactividad, como hace Safari en iOS). Devuelve el estado real: `true` si ya
 * era persistente o si el navegador concedió el permiso. No falla si la API no
 * existe (navegadores viejos / WebView).
 */
export async function asegurarStoragePersistente(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Lee el borrador guardado bajo `clave`, o `null` si no existe o falla. */
export async function leerBorrador<T>(clave: string): Promise<BorradorGuardado<T> | null> {
  try {
    const db = await abrirDB();
    const resultado = await new Promise<BorradorGuardado<T> | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(clave);
      req.onsuccess = () => resolve((req.result as BorradorGuardado<T>) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return resultado;
  } catch (err: unknown) {
    console.error("No se pudo leer el borrador local:", err);
    return null;
  }
}

/** Borra el borrador guardado bajo `clave` (no falla si no existe). */
export async function borrarBorrador(clave: string): Promise<void> {
  try {
    const db = await abrirDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err: unknown) {
    console.error("No se pudo borrar el borrador local:", err);
  }
}

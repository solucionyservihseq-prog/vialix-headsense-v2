/* ============================================================
   VIALIX HEADSENSE - Almacenamiento local y sincronización
   ------------------------------------------------------------
   - Cada sesión (con todas sus muestras) se guarda en el celular
     con IndexedDB: localStorage se queda corto para sesiones
     largas (1 h ≈ 72.000 muestras).
   - Las sesiones que no se pudieron enviar quedan marcadas como
     pendientes y se reintentan al recuperar conexión.
   ============================================================ */

const Almacen = (() => {
  const DB_NOMBRE = "vialix_headsense_v2";
  const STORE = "sesiones";
  let dbPromesa = null;
  const memoria = new Map(); // respaldo si IndexedDB no está disponible (modo privado)

  function abrir() {
    if (!dbPromesa) {
      dbPromesa = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NOMBRE, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return dbPromesa;
  }

  async function operar(modo, fn) {
    const db = await abrir();
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modo);
      const resultado = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(resultado && "result" in resultado ? resultado.result : resultado);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function guardarSesion(sesion) {
    await operar("readwrite", (st) => (st ? st.put(sesion) : memoria.set(sesion.id, sesion)));
    return sesion;
  }

  async function obtenerSesion(id) {
    return operar("readonly", (st) => (st ? st.get(id) : memoria.get(id)));
  }

  async function borrarSesion(id) {
    await operar("readwrite", (st) => (st ? st.delete(id) : memoria.delete(id)));
  }

  // Lista sin las muestras (más liviano para mostrar el historial)
  async function listarSesiones() {
    const db = await abrir();
    const resumen = (s) => {
      const { muestras, ...resto } = s;
      if (resto.metricas) {
        const { eventos, ...met } = resto.metricas;
        resto.metricas = met;
      }
      return resto;
    };
    if (!db) return [...memoria.values()].map(resumen).sort((a, b) => b.inicio.localeCompare(a.inicio));
    return new Promise((resolve, reject) => {
      const lista = [];
      const tx = db.transaction(STORE, "readonly");
      tx.objectStore(STORE).openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          lista.push(resumen(cursor.value));
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(lista.sort((a, b) => b.inicio.localeCompare(a.inicio)));
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- Backend ---------- */

  function backendConfigurado() {
    const url = HEADSENSE_CONFIG.APPS_SCRIPT_URL;
    return !!url && !url.includes("PEGA_AQUI");
  }

  function armarPayload(s) {
    return {
      tipo: "sesion",
      id: s.id,
      inicio: s.inicio,
      fin: s.fin,
      usuario: s.usuario,
      identificacion: s.identificacion,
      etiqueta: s.etiqueta,
      placa: s.placa,
      montaje: s.montaje,
      modo_demo: !!s.modo_demo,
      lat: s.lat,
      lng: s.lng,
      metricas: s.metricas,
      deriva: s.deriva || null,
      csv_nombre: Analisis.nombreArchivo(s),
      csv: Analisis.aCSV(s.muestras, HEADSENSE_CONFIG.CSV_FORMATO)
    };
  }

  async function enviarSesion(sesion) {
    if (!backendConfigurado() || !navigator.onLine) return false;
    try {
      const res = await fetch(HEADSENSE_CONFIG.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS
        body: JSON.stringify(armarPayload(sesion))
      });
      const data = await res.json();
      if (!data || data.status !== "ok") throw new Error(data && data.mensaje ? data.mensaje : "Respuesta inválida del backend");
      sesion.sincronizada = true;
      sesion.csv_url = data.csv_url || "";
      await guardarSesion(sesion);
      return true;
    } catch (err) {
      console.warn("No se pudo enviar la sesión, queda pendiente:", err);
      return false;
    }
  }

  let sincronizando = false;
  async function sincronizarPendientes() {
    if (sincronizando || !backendConfigurado() || !navigator.onLine) return;
    sincronizando = true;
    try {
      const pendientes = (await listarSesiones()).filter((s) => !s.sincronizada);
      for (const p of pendientes) {
        const completa = await obtenerSesion(p.id);
        if (completa) await enviarSesion(completa);
      }
    } finally {
      sincronizando = false;
    }
  }

  async function contarPendientes() {
    return (await listarSesiones()).filter((s) => !s.sincronizada).length;
  }

  return {
    guardarSesion,
    obtenerSesion,
    borrarSesion,
    listarSesiones,
    backendConfigurado,
    enviarSesion,
    sincronizarPendientes,
    contarPendientes
  };
})();

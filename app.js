/* ============================================================
   VIALIX HEADSENSE - Lógica de la aplicación
   ============================================================ */

const STORAGE_KEYS = {
  USUARIO: "headsense2_usuario",
  IDENTIFICACION: "headsense2_identificacion",
  MONTAJE: "headsense2_montaje"
};

// Claves que guarda VIALIX KEY. Si ambas apps viven en el mismo usuario de
// GitHub Pages comparten el almacenamiento del navegador, así que HEADSENSE
// puede sugerir la persona y la placa ya registradas allá (solo lectura).
const VIALIX_KEY_STORAGE = {
  CONDUCTOR: "vialix_conductor",
  IDENTIFICACION: "vialix_identificacion",
  PLACA: "vialix_placa"
};

const MODO_DEMO_URL = new URLSearchParams(location.search).has("demo");

const state = {
  usuario: null,
  identificacion: null,
  modoDemo: MODO_DEMO_URL,
  qBase: null,
  sesion: null,       // sesión en curso
  muestreo: null,     // setInterval de captura
  animacion: null,    // requestAnimationFrame de la vista en vivo
  deriva: null,       // corrector de deriva de la rotación (sensor.js)
  ultimaRotCruda: 0,  // rotación sin corregir, para el recentrado manual
  wakeLock: null
};

/* ---------- Utilidades ---------- */

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function showView(id) {
  $all(".view").forEach(v => v.classList.remove("active"));
  $(`#${id}`).classList.add("active");
  window.scrollTo(0, 0);
}

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }

function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let resuelto = false;
    const finalizar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      resolve(valor);
    };
    setTimeout(() => finalizar(null), 4500);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finalizar({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => finalizar(null),
        { timeout: 4000 }
      );
    } catch (e) {
      finalizar(null);
    }
  });
}

async function actualizarBadgeCola() {
  const badge = $("#cola-badge");
  const cont = $("#cola-badge-cont");
  const n = await Almacen.contarPendientes();
  badge.textContent = n;
  cont.classList.toggle("hidden", n === 0);
  $("#aviso-backend").classList.toggle("hidden", Almacen.backendConfigurado());
}

async function sincronizar() {
  await Almacen.sincronizarPendientes();
  actualizarBadgeCola();
}

// Mantiene la pantalla encendida durante la medición: si el celular se
// bloquea, el navegador deja de entregar datos del giroscopio.
async function pedirPantallaEncendida() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {
    console.warn("No se pudo mantener la pantalla encendida:", e);
  }
}

function liberarPantalla() {
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

/* ---------- Identificación ---------- */

function initIdentificacion() {
  const usuario = lsGet(STORAGE_KEYS.USUARIO);
  const identificacion = lsGet(STORAGE_KEYS.IDENTIFICACION);
  if (usuario && identificacion) {
    state.usuario = usuario;
    state.identificacion = identificacion;
    irAHome();
  } else {
    $("#input-usuario").value = usuario || lsGet(VIALIX_KEY_STORAGE.CONDUCTOR) || "";
    $("#input-identificacion").value = lsGet(VIALIX_KEY_STORAGE.IDENTIFICACION) || "";
    showView("view-usuario");
  }
}

function guardarUsuario() {
  const nombre = $("#input-usuario").value.trim();
  const identificacion = $("#input-identificacion").value.trim();
  if (!nombre || !identificacion) {
    alert("Por favor escribe el nombre y el número de identificación para continuar.");
    return;
  }
  state.usuario = nombre;
  state.identificacion = identificacion;
  lsSet(STORAGE_KEYS.USUARIO, nombre);
  lsSet(STORAGE_KEYS.IDENTIFICACION, identificacion);
  irAHome();
}

function cambiarUsuario() {
  lsDel(STORAGE_KEYS.USUARIO);
  lsDel(STORAGE_KEYS.IDENTIFICACION);
  state.usuario = null;
  state.identificacion = null;
  $("#input-identificacion").value = "";
  showView("view-usuario");
}

/* ---------- Home ---------- */

function irAHome() {
  $("#home-usuario").textContent = state.usuario;
  $("#home-identificacion").textContent = state.identificacion;
  $("#home-cliente").textContent = HEADSENSE_CONFIG.NOMBRE_CLIENTE;
  const urlKey = HEADSENSE_CONFIG.VIALIX_KEY_URL;
  const enlaceKey = $("#btn-vialix-key");
  enlaceKey.classList.toggle("hidden", !urlKey);
  if (urlKey) enlaceKey.href = urlKey;
  actualizarBadgeCola();
  showView("view-home");
}

/* ---------- Preparar medición ---------- */

function irAPreparar() {
  const montaje = lsGet(STORAGE_KEYS.MONTAJE) || HEADSENSE_CONFIG.MONTAJE;
  const radio = $(`input[name="montaje"][value="${montaje}"]`);
  if (radio) radio.checked = true;
  const placa = $("#preparar-placa");
  if (!placa.value) placa.value = lsGet(VIALIX_KEY_STORAGE.PLACA) || "";
  $("#preparar-error").classList.add("hidden");
  $("#check-demo").checked = state.modoDemo;
  showView("view-preparar");
}

async function activarSensores() {
  const boton = $("#btn-activar-sensores");
  const error = $("#preparar-error");
  error.classList.add("hidden");
  state.modoDemo = $("#check-demo").checked;
  lsSet(STORAGE_KEYS.MONTAJE, $('input[name="montaje"]:checked').value);

  boton.disabled = true;
  boton.textContent = "Activando sensores…";
  try {
    if (!state.modoDemo) {
      if (!window.isSecureContext) {
        throw new Error("Los sensores solo funcionan si la app se abre con https:// (por ejemplo desde GitHub Pages).");
      }
      const permiso = await Sensor.pedirPermiso();
      if (!permiso) throw new Error("No se dio permiso para usar los sensores de movimiento. Actívalo en los ajustes del navegador e inténtalo de nuevo.");
    }
    const ok = await Sensor.iniciar({ modoDemo: state.modoDemo });
    if (!ok) throw new Error("Este dispositivo no está enviando datos del giroscopio. Usa un celular con giroscopio, o marca “Modo demostración” para probar la app.");
    iniciarCalibracion();
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove("hidden");
  } finally {
    boton.disabled = false;
    boton.textContent = "Activar sensores y calibrar";
  }
}

/* ---------- Calibración ---------- */

let calibracionTimer = null;

function iniciarCalibracion() {
  showView("view-calibrar");
  const duracion = HEADSENSE_CONFIG.DURACION_CALIBRACION_SEG * 1000;
  const texto = $("#calibrar-texto");
  const progreso = $("#calibrar-progreso");
  const lecturas = [];
  const inicio = performance.now();
  texto.textContent = "Mira al frente y quédate quieto…";
  progreso.style.width = "0%";

  clearInterval(calibracionTimer);
  calibracionTimer = setInterval(() => {
    const l = Sensor.lectura();
    if (!l) return;
    const movimiento = Math.max(Math.abs(l.v.x), Math.abs(l.v.y), Math.abs(l.v.z));
    if (movimiento > 20) {
      // Se movió: reiniciar
      lecturas.length = 0;
      texto.textContent = "Te moviste. Quédate quieto mirando al frente…";
    }
    lecturas.push(l.q);
    const avance = Math.min(1, (lecturas.length * 50) / duracion);
    progreso.style.width = `${Math.round(avance * 100)}%`;
    if (avance >= 1 && performance.now() - inicio >= duracion) {
      clearInterval(calibracionTimer);
      state.qBase = Sensor.qPromedio(lecturas);
      iniciarMedicion();
    }
  }, 50);
}

function cancelarCalibracion() {
  clearInterval(calibracionTimer);
  Sensor.detener();
  irAHome();
}

/* ---------- Medición ---------- */

function nuevaSesionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function iniciarMedicion() {
  const montaje = $('input[name="montaje"]:checked').value;
  state.sesion = {
    id: nuevaSesionId(),
    inicio: new Date().toISOString(),
    fin: null,
    usuario: state.usuario,
    identificacion: state.identificacion,
    etiqueta: $("#preparar-etiqueta").value.trim(),
    placa: $("#preparar-placa").value.trim().toUpperCase(),
    montaje,
    modo_demo: state.modoDemo,
    lat: "",
    lng: "",
    muestras: [],
    metricas: null,
    sincronizada: false
  };
  $("#medir-demo").classList.toggle("hidden", !state.modoDemo);
  showView("view-medir");
  await pedirPantallaEncendida();

  const cfg = HEADSENSE_CONFIG;
  const intervalo = 1000 / cfg.FRECUENCIA_MUESTREO_HZ;
  const t0 = performance.now();
  const r1 = (v) => Math.round(v * 10) / 10;

  // Reencuadre por cambio de rumbo: "auto" = solo si hay placa (conductor)
  const reencuadre = cfg.DERIVA.REENCUADRE_RUMBO === "auto"
    ? !!state.sesion.placa
    : cfg.DERIVA.REENCUADRE_RUMBO === true;
  state.deriva = Sensor.crearCorrectorDeriva(cfg.DERIVA, { reencuadre });

  clearInterval(state.muestreo);
  state.muestreo = setInterval(() => {
    const l = Sensor.lectura();
    if (!l) return;
    const a = Sensor.angulosCabeza(state.qBase, l, montaje);
    const t = Math.round(performance.now() - t0);
    state.ultimaRotCruda = a.rotacion;
    const rotacion = state.deriva.aplicar(a.rotacion, a.velRotacion, t);
    state.sesion.muestras.push([
      t,
      r1(a.flexion), r1(rotacion), r1(a.inclinacion),
      r1(a.velFlexion), r1(a.velRotacion), r1(a.velInclinacion)
    ]);
  }, intervalo);

  // Ubicación de referencia (no bloquea la medición)
  getGeo().then((geo) => {
    if (geo && state.sesion) {
      state.sesion.lat = geo.lat;
      state.sesion.lng = geo.lng;
    }
  });

  cancelAnimationFrame(state.animacion);
  let ultimoRefresco = 0;
  let ultimoConteo = 0;
  let conteo = { giros: 0, cabeceos: 0 };
  const canvas = $("#medir-grafica");
  const cuadro = (ahora) => {
    state.animacion = requestAnimationFrame(cuadro);
    if (ahora - ultimoRefresco < 100) return;
    ultimoRefresco = ahora;
    const m = state.sesion.muestras;
    const ultima = m[m.length - 1];
    $("#medir-tiempo").textContent = Analisis.fmtDuracion((performance.now() - t0) / 1000);
    if (ultima) {
      pintarAngulo("flexion", ultima[1]);
      pintarAngulo("rotacion", ultima[2]);
      pintarAngulo("inclinacion", ultima[3]);
      pintarCabeza(ultima[1], ultima[2], ultima[3]);
    }
    // Los eventos se recalculan cada 2 s (la sesión puede ser larga)
    if (ahora - ultimoConteo > 2000 && m.length > 1) {
      ultimoConteo = ahora;
      const met = Analisis.calcularMetricas(m, cfg);
      conteo = { giros: met.giros_izquierda + met.giros_derecha, cabeceos: met.cabeceos, riesgo: met.pct_riesgo };
      $("#medir-giros").textContent = conteo.giros;
      $("#medir-cabeceos").textContent = conteo.cabeceos;
      $("#medir-riesgo").textContent = `${conteo.riesgo}%`;
    }
    Analisis.dibujarSerie(canvas, m, { cfg, ventanaSeg: 30 });
  };
  state.animacion = requestAnimationFrame(cuadro);
}

function pintarAngulo(eje, valor) {
  const U = HEADSENSE_CONFIG.UMBRALES;
  const el = $(`#vivo-${eje}`);
  el.querySelector(".vivo-valor").textContent = `${valor > 0 ? "+" : ""}${valor.toFixed(0)}°`;
  let alerta = false;
  if (eje === "flexion") alerta = valor > U.FLEXION_ALTA || valor < -U.EXTENSION;
  if (eje === "rotacion") alerta = Math.abs(valor) > U.ROTACION;
  if (eje === "inclinacion") alerta = Math.abs(valor) > U.INCLINACION;
  el.classList.toggle("alerta", alerta);
  const pct = Math.max(-1, Math.min(1, valor / 90));
  const barra = el.querySelector(".vivo-barra span");
  barra.style.left = pct >= 0 ? "50%" : `${50 + pct * 50}%`;
  barra.style.width = `${Math.abs(pct) * 50}%`;
}

// Silueta de la cabeza vista de frente (rotación e inclinación) y de lado (flexión).
// La vista frontal es la de un observador que tiene a la persona enfrente,
// por eso la derecha de la persona se dibuja a la izquierda.
function pintarCabeza(flexion, rotacion, inclinacion) {
  $("#cabeza-frente").setAttribute("transform", `rotate(${(-inclinacion).toFixed(1)} 50 80)`);
  $("#cabeza-nariz").setAttribute("transform", `translate(${(Math.sin(rotacion * Math.PI / 180) * 18).toFixed(1)} 0)`);
  $("#cabeza-lado").setAttribute("transform", `rotate(${flexion.toFixed(1)} 150 72)`);
}

async function detenerMedicion() {
  if (!state.sesion) return;
  clearInterval(state.muestreo);
  cancelAnimationFrame(state.animacion);
  Sensor.detener();
  liberarPantalla();

  const sesion = state.sesion;
  state.sesion = null;
  sesion.fin = new Date().toISOString();
  sesion.deriva = state.deriva ? state.deriva.resumen() : null;

  if (sesion.muestras.length < 2) {
    alert("La medición fue demasiado corta. No se guardó.");
    irAHome();
    return;
  }

  sesion.metricas = Analisis.calcularMetricas(sesion.muestras, HEADSENSE_CONFIG);
  showView("view-enviando");
  try {
    await Almacen.guardarSesion(sesion);
  } catch (err) {
    console.warn("No se pudo guardar la sesión en el celular:", err);
  }
  await Almacen.enviarSesion(sesion);
  mostrarResultado(sesion);
  actualizarBadgeCola();
}

/* ---------- Resultado ---------- */

let sesionMostrada = null;

function mostrarResultado(sesion) {
  sesionMostrada = sesion;
  Analisis.renderResultado($("#resultado-contenido"), sesion, HEADSENSE_CONFIG);
  const estado = $("#resultado-estado");
  if (sesion.sincronizada) {
    estado.textContent = "✓ Sesión guardada en Google Sheets";
    estado.className = "estado-sync ok";
  } else if (!Almacen.backendConfigurado()) {
    estado.textContent = "Guardada solo en este celular (el backend aún no está configurado)";
    estado.className = "estado-sync pendiente";
  } else {
    estado.textContent = "Guardada en el celular · se enviará al recuperar conexión";
    estado.className = "estado-sync pendiente";
  }
  showView("view-resultado");
}

function descargarCSV() {
  if (!sesionMostrada) return;
  Analisis.descargar(
    Analisis.nombreArchivo(sesionMostrada),
    Analisis.aCSV(sesionMostrada.muestras, HEADSENSE_CONFIG.CSV_FORMATO)
  );
}

/* ---------- Historial ---------- */

async function irAHistorial() {
  const cont = $("#historial-lista");
  cont.innerHTML = `<div class="spinner"></div>`;
  showView("view-historial");
  const sesiones = await Almacen.listarSesiones();
  if (!sesiones.length) {
    cont.innerHTML = `<div class="card centrado"><p>Todavía no hay mediciones en este celular.</p></div>`;
    return;
  }
  const esc = Analisis.esc;
  cont.innerHTML = sesiones.map((s) => {
    const met = s.metricas || {};
    return `
      <button type="button" class="historial-item" data-id="${esc(s.id)}">
        <span class="historial-principal">
          <strong>${esc(s.etiqueta || "Sesión sin nombre")}</strong>
          <small>${new Date(s.inicio).toLocaleString()} · ${Analisis.fmtDuracion(met.duracion_seg || 0)}${s.modo_demo ? " · demo" : ""}</small>
        </span>
        <span class="historial-lado">
          <span class="pildora nivel-${esc(met.nivel_riesgo || "bajo")}">${met.pct_riesgo != null ? met.pct_riesgo + "%" : "--"}</span>
          <small>${s.sincronizada ? "✓ enviada" : "pendiente"}</small>
        </span>
      </button>`;
  }).join("");
}

async function abrirSesionHistorial(id) {
  const sesion = await Almacen.obtenerSesion(id);
  if (sesion) mostrarResultado(sesion);
}

async function borrarSesionMostrada() {
  if (!sesionMostrada) return;
  const aviso = sesionMostrada.sincronizada
    ? "¿Borrar esta sesión del celular? Seguirá guardada en Google Sheets."
    : "Esta sesión NO se ha enviado a Google Sheets. Si la borras se pierde. ¿Borrarla del celular?";
  if (!confirm(aviso)) return;
  await Almacen.borrarSesion(sesionMostrada.id);
  sesionMostrada = null;
  irAHistorial();
  actualizarBadgeCola();
}

/* ---------- Inicialización ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initIdentificacion();

  $("#btn-guardar-usuario").addEventListener("click", guardarUsuario);
  $("#btn-cambiar-usuario").addEventListener("click", cambiarUsuario);

  $("#btn-nueva-medicion").addEventListener("click", irAPreparar);
  $("#btn-historial").addEventListener("click", irAHistorial);
  $("#btn-volver-home-preparar").addEventListener("click", irAHome);
  $("#btn-activar-sensores").addEventListener("click", activarSensores);
  $("#btn-cancelar-calibracion").addEventListener("click", cancelarCalibracion);
  $("#btn-detener").addEventListener("click", detenerMedicion);
  $("#btn-recentrar").addEventListener("click", () => {
    if (state.deriva) state.deriva.recentrar(state.ultimaRotCruda);
  });

  $("#btn-descargar-csv").addEventListener("click", descargarCSV);
  $("#btn-borrar-sesion").addEventListener("click", borrarSesionMostrada);
  $("#btn-resultado-home").addEventListener("click", irAHome);
  $("#btn-volver-home-historial").addEventListener("click", irAHome);
  $("#historial-lista").addEventListener("click", (e) => {
    const item = e.target.closest(".historial-item");
    if (item) abrirSesionHistorial(item.dataset.id);
  });

  // Si la pantalla se apaga y vuelve, se pide de nuevo mantenerla encendida
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.sesion) pedirPantallaEncendida();
  });

  window.addEventListener("online", sincronizar);
  sincronizar();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(console.warn);
    let recargando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // No recargar en plena medición: se perderían los datos
      if (recargando || state.sesion) return;
      recargando = true;
      window.location.reload();
    });
  }
});

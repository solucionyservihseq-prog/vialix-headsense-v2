/* ============================================================
   VIALIX HEADSENSE - Página de análisis (analisis.html)
   ============================================================ */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  // Copia editable de la configuración: los cambios no tocan config.js
  const cfg = JSON.parse(JSON.stringify(HEADSENSE_CONFIG));
  let sesionActual = null;

  function mostrarError(msg) {
    const el = $("#analisis-error");
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
  }

  function analizar() {
    if (!sesionActual) return;
    sesionActual.metricas = Analisis.calcularMetricas(sesionActual.muestras, cfg);
    Analisis.renderResultado($("#analisis-resultado"), sesionActual, cfg);
  }

  async function abrirCSV(e) {
    const archivo = e.target.files && e.target.files[0];
    if (!archivo) return;
    mostrarError("");
    try {
      const texto = await archivo.text();
      const muestras = Analisis.desdeCSV(texto);
      // Intenta recuperar la fecha del nombre: headsense_<id>_AAAAMMDD_HHMM.csv
      const m = archivo.name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
      const inicio = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(archivo.lastModified);
      sesionActual = {
        inicio: inicio.toISOString(),
        etiqueta: archivo.name,
        usuario: "",
        muestras
      };
      $("#sesion-local").value = "";
      analizar();
    } catch (err) {
      sesionActual = null;
      $("#analisis-resultado").innerHTML = "";
      mostrarError(err.message);
    } finally {
      e.target.value = "";
    }
  }

  async function cargarListaLocal() {
    const select = $("#sesion-local");
    try {
      const sesiones = await Almacen.listarSesiones();
      for (const s of sesiones) {
        const op = document.createElement("option");
        op.value = s.id;
        op.textContent = `${new Date(s.inicio).toLocaleString()} · ${s.etiqueta || "Sesión sin nombre"} · ${s.usuario || ""}`;
        select.appendChild(op);
      }
      if (!sesiones.length) select.options[0].textContent = "— No hay mediciones en este dispositivo —";
    } catch (err) {
      select.disabled = true;
    }
  }

  async function abrirLocal() {
    const id = $("#sesion-local").value;
    if (!id) return;
    mostrarError("");
    const s = await Almacen.obtenerSesion(id);
    if (!s) return mostrarError("No se encontró la medición.");
    sesionActual = s;
    analizar();
  }

  function initUmbrales() {
    $all("[data-umbral]").forEach((input) => {
      input.value = cfg.UMBRALES[input.dataset.umbral];
    });
    $all("[data-evento]").forEach((input) => {
      input.value = cfg.EVENTOS[input.dataset.evento];
    });
    $all("[data-umbral], [data-evento]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        if (Number.isNaN(v)) return;
        if (input.dataset.umbral) cfg.UMBRALES[input.dataset.umbral] = v;
        else cfg.EVENTOS[input.dataset.evento] = v;
        analizar();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initUmbrales();
    cargarListaLocal();
    $("#archivo-csv").addEventListener("change", abrirCSV);
    $("#sesion-local").addEventListener("change", abrirLocal);
  });
})();

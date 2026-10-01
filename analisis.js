/* ============================================================
   VIALIX HEADSENSE - Análisis de movimientos de cabeza
   ------------------------------------------------------------
   Funciones puras que usan tanto la app (index.html) como la
   página de análisis (analisis.html):
   - Métricas: rangos, velocidades, tiempo por zona de postura,
     giros de cabeza y cabeceos bruscos.
   - Exportar / importar CSV.
   - Gráfica de la serie de tiempo (canvas, sin librerías).

   Cada muestra es un arreglo:
   [t_ms, flexion, rotacion, inclinacion, vel_flexion, vel_rotacion, vel_inclinacion]
   Ángulos en grados, velocidades en grados/segundo.
   Signos: flexión + = cabeza hacia abajo (− = hacia atrás),
           rotación + = giro a la izquierda,
           inclinación + = oreja derecha hacia el hombro derecho.
   ============================================================ */

const Analisis = (() => {
  const T = 0, FLEX = 1, ROT = 2, INCL = 3, VF = 4, VR = 5, VI = 6;

  const CAMPOS_CSV = [
    "t_seg", "flexion_grados", "rotacion_grados", "inclinacion_grados",
    "vel_flexion_gps", "vel_rotacion_gps", "vel_inclinacion_gps"
  ];

  /* ---------- Utilidades ---------- */

  function esc(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDuracion(seg) {
    seg = Math.max(0, Math.round(seg));
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    const s = seg % 60;
    const dos = (x) => String(x).padStart(2, "0");
    return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
  }

  function redondear(v, dec = 1) {
    const f = Math.pow(10, dec);
    return Math.round(v * f) / f;
  }

  function estadisticas(m, col) {
    let min = Infinity, max = -Infinity, suma = 0, suma2 = 0;
    for (const s of m) {
      const v = s[col];
      if (v < min) min = v;
      if (v > max) max = v;
      suma += v;
      suma2 += v * v;
    }
    const n = m.length;
    const prom = suma / n;
    const desv = Math.sqrt(Math.max(0, suma2 / n - prom * prom));
    return {
      min: redondear(min), max: redondear(max), rango: redondear(max - min),
      promedio: redondear(prom), desviacion: redondear(desv)
    };
  }

  function velocidades(m, col) {
    let pico = 0, suma = 0;
    for (const s of m) {
      const v = Math.abs(s[col]);
      if (v > pico) pico = v;
      suma += v;
    }
    return { pico: redondear(pico), promedio: redondear(suma / m.length) };
  }

  /* ---------- Métricas ---------- */

  function calcularMetricas(m, cfg) {
    if (!m || m.length < 2) return null;
    const U = cfg.UMBRALES;
    const E = cfg.EVENTOS;
    const n = m.length;
    const duracionSeg = (m[n - 1][T] - m[0][T]) / 1000;

    // Tiempo por zona. Se ignoran huecos largos (p. ej. si el celular se bloqueó)
    const maxDt = (1000 / cfg.FRECUENCIA_MUESTREO_HZ) * 5;
    const ms = { neutra: 0, moderada: 0, alta: 0, extension: 0, inclinacion: 0, rotacion: 0, sinRiesgo: 0, riesgo: 0, total: 0 };

    for (let i = 1; i < n; i++) {
      const dt = Math.min(m[i][T] - m[i - 1][T], maxDt);
      if (dt <= 0) continue;
      const p = m[i - 1];
      const f = p[FLEX];
      ms.total += dt;

      let sagital;
      if (f < -U.EXTENSION) sagital = "extension";
      else if (f > U.FLEXION_ALTA) sagital = "alta";
      else if (f > U.FLEXION_MODERADA) sagital = "moderada";
      else sagital = "neutra";
      ms[sagital] += dt;

      const lateral = Math.abs(p[INCL]) > U.INCLINACION;
      const giro = Math.abs(p[ROT]) > U.ROTACION;
      if (lateral) ms.inclinacion += dt;
      if (giro) ms.rotacion += dt;

      const riesgo = sagital === "alta" || sagital === "extension" || lateral || giro;
      if (riesgo) ms.riesgo += dt;
      else if (sagital === "neutra") ms.sinRiesgo += dt;
    }
    const pct = (x) => (ms.total > 0 ? redondear((x / ms.total) * 100) : 0);

    // Eventos
    const eventos = [];
    let giroActual = null;
    let ultimoGiro = -Infinity;
    let ultimoCabeceo = -Infinity;
    for (const s of m) {
      const t = s[T];
      const r = s[ROT];
      if (giroActual) {
        if (Math.abs(r) > Math.abs(giroActual.valor) && Math.sign(r) === Math.sign(giroActual.valor)) {
          giroActual.valor = redondear(r);
        }
        if (Math.abs(r) < E.GIRO_GRADOS / 2) giroActual = null;
      } else if (Math.abs(r) > E.GIRO_GRADOS && t - ultimoGiro > E.ANTIRREBOTE_MS) {
        giroActual = { t, tipo: r > 0 ? "giro_izquierda" : "giro_derecha", valor: redondear(r) };
        eventos.push(giroActual);
        ultimoGiro = t;
      }

      if (s[VF] > E.CABECEO_VELOCIDAD && s[FLEX] > E.CABECEO_GRADOS && t - ultimoCabeceo > E.ANTIRREBOTE_MS) {
        eventos.push({ t, tipo: "cabeceo", valor: redondear(s[VF]) });
        ultimoCabeceo = t;
      }
    }
    const contar = (tipo) => eventos.filter((e) => e.tipo === tipo).length;
    const girosIzq = contar("giro_izquierda");
    const girosDer = contar("giro_derecha");
    const cabeceos = contar("cabeceo");
    const minutos = duracionSeg / 60;

    const riesgoPct = pct(ms.riesgo);
    const nivel = riesgoPct < 10 ? "bajo" : riesgoPct < 30 ? "medio" : "alto";

    return {
      duracion_seg: redondear(duracionSeg),
      muestras: n,
      frecuencia_real_hz: duracionSeg > 0 ? redondear((n - 1) / duracionSeg) : 0,
      flexion: { ...estadisticas(m, FLEX), vel: velocidades(m, VF) },
      rotacion: { ...estadisticas(m, ROT), vel: velocidades(m, VR) },
      inclinacion: { ...estadisticas(m, INCL), vel: velocidades(m, VI) },
      pct_flexion_neutra: pct(ms.neutra),
      pct_flexion_moderada: pct(ms.moderada),
      pct_flexion_alta: pct(ms.alta),
      pct_extension: pct(ms.extension),
      pct_inclinacion: pct(ms.inclinacion),
      pct_rotacion: pct(ms.rotacion),
      pct_postura_neutra: pct(ms.sinRiesgo),
      pct_riesgo: riesgoPct,
      nivel_riesgo: nivel,
      giros_izquierda: girosIzq,
      giros_derecha: girosDer,
      giros_por_minuto: minutos > 0 ? redondear((girosIzq + girosDer) / minutos) : 0,
      cabeceos: cabeceos,
      cabeceos_por_hora: minutos > 0 ? redondear(cabeceos / (minutos / 60)) : 0,
      eventos
    };
  }

  /* ---------- CSV ---------- */

  function aCSV(m, formato) {
    const excel = formato !== "estandar";
    const sep = excel ? ";" : ",";
    const num = (v, dec) => {
      const txt = Number(v).toFixed(dec);
      return excel ? txt.replace(".", ",") : txt;
    };
    const filas = [CAMPOS_CSV.join(sep)];
    for (const s of m) {
      filas.push([
        num(s[T] / 1000, 2),
        num(s[FLEX], 1), num(s[ROT], 1), num(s[INCL], 1),
        num(s[VF], 1), num(s[VR], 1), num(s[VI], 1)
      ].join(sep));
    }
    return "﻿" + filas.join("\r\n");
  }

  function desdeCSV(texto) {
    const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lineas.length < 2) throw new Error("El archivo no tiene datos.");
    const sep = lineas[0].includes(";") ? ";" : ",";
    const encabezado = lineas[0].split(sep).map((c) => c.trim().toLowerCase());
    if (encabezado[0] !== "t_seg" || encabezado.length < 7) {
      throw new Error("El archivo no parece un CSV de VIALIX HEADSENSE (la primera columna debe ser t_seg).");
    }
    const m = [];
    for (let i = 1; i < lineas.length; i++) {
      const c = lineas[i].split(sep).map((v) => parseFloat(sep === ";" ? v.replace(",", ".") : v));
      if (c.length < 7 || c.some((v) => Number.isNaN(v))) continue;
      m.push([c[0] * 1000, c[1], c[2], c[3], c[4], c[5], c[6]]);
    }
    if (m.length < 2) throw new Error("No se encontraron filas válidas en el archivo.");
    return m;
  }

  function descargar(nombre, contenido, tipo = "text/csv;charset=utf-8") {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function nombreArchivo(sesion) {
    const fecha = new Date(sesion.inicio);
    const dos = (x) => String(x).padStart(2, "0");
    const sello = `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}_${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
    const quien = (sesion.identificacion || sesion.usuario || "sesion").toString().replace(/[^\w-]+/g, "_");
    return `headsense_${quien}_${sello}.csv`;
  }

  /* ---------- Gráfica ---------- */

  const SERIES = [
    { col: FLEX, nombre: "Flexión / extensión", var: "--serie-flexion" },
    { col: ROT, nombre: "Rotación", var: "--serie-rotacion" },
    { col: INCL, nombre: "Inclinación", var: "--serie-inclinacion" }
  ];

  function indiceDesde(m, t) {
    let lo = 0, hi = m.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (m[mid][T] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function dibujarSerie(canvas, m, opts = {}) {
    const ancho = canvas.clientWidth;
    const alto = canvas.clientHeight;
    if (!ancho || !alto) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(alto * dpr)) {
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ancho, alto);

    const css = getComputedStyle(canvas);
    const color = (v) => css.getPropertyValue(v).trim();
    const margenIzq = 36, margenDer = 8, margenSup = 10, margenInf = 20;
    const w = ancho - margenIzq - margenDer;
    const h = alto - margenSup - margenInf;

    if (!m || m.length < 2) {
      ctx.fillStyle = color("--texto-suave");
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Esperando datos…", ancho / 2, alto / 2);
      return;
    }

    const tFin = m[m.length - 1][T];
    const tIni = opts.ventanaSeg ? Math.max(m[0][T], tFin - opts.ventanaSeg * 1000) : m[0][T];
    const ini = opts.ventanaSeg ? indiceDesde(m, tIni) : 0;
    const span = Math.max(1, tFin - tIni);

    let maxAbs = 0;
    for (let i = ini; i < m.length; i++) {
      for (const s of SERIES) maxAbs = Math.max(maxAbs, Math.abs(m[i][s.col]));
    }
    const lim = Math.min(180, Math.max(45, Math.ceil(maxAbs / 15) * 15));
    const x = (t) => margenIzq + ((t - tIni) / span) * w;
    const y = (v) => margenSup + h / 2 - (v / lim) * (h / 2);

    // Rejilla y etiquetas
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const paso = lim >= 90 ? 45 : 15;
    for (let v = -lim; v <= lim; v += paso) {
      ctx.strokeStyle = v === 0 ? color("--eje") : color("--rejilla");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margenIzq, Math.round(y(v)) + 0.5);
      ctx.lineTo(margenIzq + w, Math.round(y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = color("--texto-suave");
      ctx.fillText(`${v}°`, margenIzq - 4, y(v));
    }

    // Umbrales de flexión alta / extensión
    if (opts.cfg) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color("--umbral");
      for (const v of [opts.cfg.UMBRALES.FLEXION_ALTA, -opts.cfg.UMBRALES.EXTENSION]) {
        if (Math.abs(v) > lim) continue;
        ctx.beginPath();
        ctx.moveTo(margenIzq, Math.round(y(v)) + 0.5);
        ctx.lineTo(margenIzq + w, Math.round(y(v)) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Tiempo
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = color("--texto-suave");
    const marcas = Math.max(2, Math.floor(w / 80));
    for (let k = 0; k <= marcas; k++) {
      const t = tIni + (span * k) / marcas;
      ctx.textAlign = k === 0 ? "left" : k === marcas ? "right" : "center";
      ctx.fillText(fmtDuracion((t - m[0][T]) / 1000), x(t), margenSup + h + 5);
    }

    // Series: por cada columna de píxeles se dibuja el mínimo y el máximo,
    // así una sesión de horas se ve completa sin perder picos.
    ctx.save();
    ctx.beginPath();
    ctx.rect(margenIzq, margenSup, w, h);
    ctx.clip();
    ctx.lineJoin = "round";
    for (const s of SERIES) {
      ctx.strokeStyle = color(s.var);
      ctx.lineWidth = 2;
      ctx.beginPath();
      let colActual = -1, vMin = 0, vMax = 0, primero = true;
      const volcar = () => {
        if (colActual < 0) return;
        const px = margenIzq + colActual + 0.5;
        if (primero) { ctx.moveTo(px, y(vMin)); primero = false; }
        else ctx.lineTo(px, y(vMin));
        if (vMax !== vMin) ctx.lineTo(px, y(vMax));
      };
      for (let i = ini; i < m.length; i++) {
        const col = Math.min(w - 1, Math.floor(((m[i][T] - tIni) / span) * w));
        const v = m[i][s.col];
        if (col !== colActual) {
          volcar();
          colActual = col; vMin = v; vMax = v;
        } else {
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
      }
      volcar();
      ctx.stroke();
    }

    // Marcadores de eventos
    if (opts.eventos) {
      for (const e of opts.eventos) {
        if (e.t < tIni) continue;
        const px = x(e.t);
        ctx.fillStyle = e.tipo === "cabeceo" ? color("--evento-cabeceo") : color("--evento-giro");
        ctx.beginPath();
        ctx.moveTo(px - 4, margenSup);
        ctx.lineTo(px + 4, margenSup);
        ctx.lineTo(px, margenSup + 6);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function leyendaHTML() {
    return `<div class="leyenda">${SERIES.map((s) =>
      `<span><i style="background:var(${s.var})"></i>${s.nombre}</span>`).join("")}
      <span><i class="leyenda-umbral"></i>Umbral</span></div>`;
  }

  /* ---------- Informe de resultados ---------- */

  const NIVELES = {
    bajo: "Bajo",
    medio: "Medio",
    alto: "Alto"
  };

  const NOMBRES_EVENTO = {
    giro_izquierda: "Giro a la izquierda",
    giro_derecha: "Giro a la derecha",
    cabeceo: "Cabeceo brusco"
  };

  function barra(pct, clase) {
    return pct > 0 ? `<span class="${clase}" style="width:${pct}%" title="${pct}%"></span>` : "";
  }

  function renderResultado(cont, sesion, cfg) {
    const met = sesion.metricas;
    if (!met) {
      cont.innerHTML = `<div class="card"><p>La sesión es demasiado corta para analizarla.</p></div>`;
      return;
    }
    const U = cfg.UMBRALES;
    const filaEje = (nombre, e, unidadNeg, unidadPos) => `
      <tr>
        <th>${nombre}<small>${unidadNeg} / ${unidadPos}</small></th>
        <td>${e.min}°</td><td>${e.max}°</td><td><strong>${e.rango}°</strong></td>
        <td>${e.promedio}°</td><td>${e.vel.pico}°/s</td>
      </tr>`;

    const eventos = met.eventos || [];
    const listaEventos = eventos.slice(0, 100).map((e) => `
      <li><span>${fmtDuracion((e.t - sesion.muestras[0][T]) / 1000)}</span>
      <span>${NOMBRES_EVENTO[e.tipo] || esc(e.tipo)}</span>
      <span>${e.tipo === "cabeceo" ? `${e.valor}°/s` : `${Math.abs(e.valor)}°`}</span></li>`).join("");

    cont.innerHTML = `
      <div class="card resumen-cabecera">
        <p class="etiqueta">${new Date(sesion.inicio).toLocaleString()}</p>
        <h2>${esc(sesion.etiqueta || "Sesión sin nombre")}</h2>
        <p class="resumen-meta">${esc(sesion.usuario || "")}${sesion.placa ? ` · ${esc(sesion.placa)}` : ""}${sesion.modo_demo ? " · <strong>Datos de demostración</strong>" : ""}</p>
      </div>

      <div class="kpis">
        <div class="kpi"><span class="kpi-valor">${fmtDuracion(met.duracion_seg)}</span><span class="kpi-nombre">Duración</span></div>
        <div class="kpi nivel-${met.nivel_riesgo}"><span class="kpi-valor">${met.pct_riesgo}%</span><span class="kpi-nombre">Tiempo en postura de riesgo · ${NIVELES[met.nivel_riesgo]}</span></div>
        <div class="kpi"><span class="kpi-valor">${met.giros_izquierda + met.giros_derecha}</span><span class="kpi-nombre">Giros de cabeza (${met.giros_izquierda} izq · ${met.giros_derecha} der)</span></div>
        <div class="kpi"><span class="kpi-valor">${met.cabeceos}</span><span class="kpi-nombre">Cabeceos bruscos (${met.cabeceos_por_hora}/h)</span></div>
      </div>

      <div class="card">
        <h2>Movimiento en el tiempo</h2>
        ${leyendaHTML()}
        <canvas class="grafica grafica-grande" aria-label="Ángulos de la cabeza en el tiempo"></canvas>
        <p class="ayuda">Arriba de 0°: cabeza hacia abajo, giro a la izquierda, inclinación a la derecha. Los triángulos marcan eventos.</p>
      </div>

      <div class="card">
        <h2>Postura del cuello (% del tiempo)</h2>
        <div class="barra-apilada">
          ${barra(met.pct_flexion_neutra, "z-neutra")}
          ${barra(met.pct_flexion_moderada, "z-moderada")}
          ${barra(met.pct_flexion_alta, "z-alta")}
          ${barra(met.pct_extension, "z-extension")}
        </div>
        <ul class="zonas">
          <li><i class="z-neutra"></i>Neutra (−${U.EXTENSION}° a ${U.FLEXION_MODERADA}°)<strong>${met.pct_flexion_neutra}%</strong></li>
          <li><i class="z-moderada"></i>Flexión moderada (${U.FLEXION_MODERADA}°–${U.FLEXION_ALTA}°)<strong>${met.pct_flexion_moderada}%</strong></li>
          <li><i class="z-alta"></i>Flexión alta (&gt; ${U.FLEXION_ALTA}°)<strong>${met.pct_flexion_alta}%</strong></li>
          <li><i class="z-extension"></i>Extensión (&gt; ${U.EXTENSION}° hacia atrás)<strong>${met.pct_extension}%</strong></li>
        </ul>
        <div class="barra-simple"><span>Inclinación lateral &gt; ${U.INCLINACION}°</span><div><span class="z-alta" style="width:${met.pct_inclinacion}%"></span></div><strong>${met.pct_inclinacion}%</strong></div>
        <div class="barra-simple"><span>Rotación &gt; ${U.ROTACION}°</span><div><span class="z-alta" style="width:${met.pct_rotacion}%"></span></div><strong>${met.pct_rotacion}%</strong></div>
      </div>

      <div class="card">
        <h2>Rango de movimiento</h2>
        <div class="tabla-scroll">
          <table class="tabla">
            <thead><tr><th></th><th>Mín</th><th>Máx</th><th>Rango</th><th>Prom.</th><th>Vel. pico</th></tr></thead>
            <tbody>
              ${filaEje("Flexión", met.flexion, "− atrás", "+ abajo")}
              ${filaEje("Rotación", met.rotacion, "− der", "+ izq")}
              ${filaEje("Inclinación", met.inclinacion, "− izq", "+ der")}
            </tbody>
          </table>
        </div>
        <p class="ayuda">${met.muestras.toLocaleString()} muestras a ${met.frecuencia_real_hz} Hz.</p>
      </div>

      <div class="card">
        <h2>Eventos (${eventos.length})</h2>
        ${eventos.length ? `<ul class="eventos">${listaEventos}</ul>${eventos.length > 100 ? `<p class="ayuda">Se muestran los primeros 100. El CSV y la hoja “Eventos” tienen todos.</p>` : ""}` : `<p class="ayuda">No se detectaron giros ni cabeceos.</p>`}
      </div>

      <p class="nota">Indicadores orientativos para análisis ergonómico y de seguridad vial. No reemplazan la valoración de un profesional de la salud.</p>
    `;

    const canvas = cont.querySelector(".grafica");
    const redibujar = () => dibujarSerie(canvas, sesion.muestras, { cfg, eventos });
    requestAnimationFrame(redibujar);
    if (cont._observador) cont._observador.disconnect();
    if ("ResizeObserver" in window) {
      cont._observador = new ResizeObserver(redibujar);
      cont._observador.observe(canvas);
    }
  }

  return {
    COL: { T, FLEX, ROT, INCL, VF, VR, VI },
    esc,
    fmtDuracion,
    calcularMetricas,
    aCSV,
    desdeCSV,
    descargar,
    nombreArchivo,
    dibujarSerie,
    leyendaHTML,
    renderResultado,
    NIVELES
  };
})();

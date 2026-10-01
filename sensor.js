/* ============================================================
   VIALIX HEADSENSE - Lectura del giroscopio
   ------------------------------------------------------------
   - Orientación absoluta del celular (DeviceOrientationEvent),
     convertida a cuaterniones para evitar saltos de ángulo.
   - Velocidad angular (DeviceMotionEvent.rotationRate).
   - Los ángulos de la cabeza se calculan RELATIVOS a la postura
     guardada en la calibración (mirar al frente = 0°).
   - Modo demostración con datos simulados, para probar la app
     en un computador sin giroscopio.
   ============================================================ */

const Sensor = (() => {
  const RAD = Math.PI / 180;
  const GRA = 180 / Math.PI;

  /* ---------- Cuaterniones [w, x, y, z] ---------- */

  function qEje(eje, grados) {
    const m = (grados * RAD) / 2;
    const s = Math.sin(m);
    return [Math.cos(m), eje === "x" ? s : 0, eje === "y" ? s : 0, eje === "z" ? s : 0];
  }

  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
  }

  function qConj(q) {
    return [q[0], -q[1], -q[2], -q[3]];
  }

  function qNorm(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }

  // Convención W3C: R = Rz(alpha) · Rx(beta) · Ry(gamma)
  function qDesdeOrientacion(alpha, beta, gamma) {
    return qMul(qMul(qEje("z", alpha), qEje("x", beta)), qEje("y", gamma));
  }

  // Descompone una rotación como Ry(giro) · Rx(cabeceo) · Rz(inclinación).
  // Con el celular vertical: Y = eje vertical de la cabeza, X = eje de oreja
  // a oreja, Z = eje que sale de la frente (o de la nuca).
  function eulerYXZ(q) {
    const [w, x, y, z] = q;
    const r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z);
    const r11 = 1 - 2 * (x * x + z * z);
    const r12 = 2 * (y * z - w * x);
    const r22 = 1 - 2 * (x * x + y * y);
    return {
      giro: Math.atan2(r02, r22) * GRA,
      cabeceo: Math.asin(Math.max(-1, Math.min(1, -r12))) * GRA,
      inclinacion: Math.atan2(r10, r11) * GRA
    };
  }

  // Promedio de varias orientaciones (para la calibración)
  function qPromedio(lista) {
    const ref = lista[0];
    const suma = [0, 0, 0, 0];
    for (const q of lista) {
      const signo = q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) suma[i] += signo * q[i];
    }
    return qNorm(suma);
  }

  /* ---------- Ángulos de la cabeza ---------- */

  function angulosCabeza(qBase, lectura, montaje) {
    const rel = qMul(qConj(qBase), lectura.q);
    const e = eulerYXZ(rel);
    const s = montaje === "nuca" ? -1 : 1;
    return {
      flexion: e.cabeceo * s,
      rotacion: e.giro,
      inclinacion: e.inclinacion * s,
      velFlexion: lectura.v.x * s,
      velRotacion: lectura.v.y,
      velInclinacion: lectura.v.z * s
    };
  }

  /* ---------- Captura ---------- */

  let ultimaQ = null;
  let ultimaV = { x: 0, y: 0, z: 0 };
  let activo = false;
  let demo = false;
  let demoTimer = null;
  let demoInicio = 0;

  function alOrientar(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    ultimaQ = qNorm(qDesdeOrientacion(e.alpha || 0, e.beta || 0, e.gamma || 0));
  }

  function alMover(e) {
    const r = e.rotationRate;
    if (!r) return;
    // rotationRate: alpha = eje Z, beta = eje X, gamma = eje Y (°/s)
    ultimaV = { x: r.beta || 0, y: r.gamma || 0, z: r.alpha || 0 };
  }

  function disponible() {
    return "DeviceOrientationEvent" in window;
  }

  // En iPhone el permiso se debe pedir dentro de un toque del usuario.
  async function pedirPermiso() {
    const pedir = async (Clase) => {
      if (Clase && typeof Clase.requestPermission === "function") {
        return (await Clase.requestPermission()) === "granted";
      }
      return true;
    };
    try {
      const a = await pedir(window.DeviceOrientationEvent);
      const b = await pedir(window.DeviceMotionEvent);
      return a && b;
    } catch (err) {
      console.warn("Permiso de sensores rechazado:", err);
      return false;
    }
  }

  function esperarDatos(ms) {
    return new Promise((resolve) => {
      const inicio = performance.now();
      const revisar = () => {
        if (ultimaQ) return resolve(true);
        if (performance.now() - inicio > ms) return resolve(false);
        setTimeout(revisar, 100);
      };
      revisar();
    });
  }

  async function iniciar({ modoDemo = false } = {}) {
    detener();
    ultimaQ = null;
    ultimaV = { x: 0, y: 0, z: 0 };
    demo = modoDemo;
    activo = true;
    if (demo) {
      iniciarDemo();
      return true;
    }
    if (!disponible()) return false;
    window.addEventListener("deviceorientation", alOrientar);
    window.addEventListener("devicemotion", alMover);
    const ok = await esperarDatos(2500);
    if (!ok) detener();
    return ok;
  }

  function detener() {
    activo = false;
    window.removeEventListener("deviceorientation", alOrientar);
    window.removeEventListener("devicemotion", alMover);
    clearInterval(demoTimer);
    demoTimer = null;
  }

  function lectura() {
    if (!activo || !ultimaQ) return null;
    return { q: ultimaQ, v: ultimaV };
  }

  /* ---------- Modo demostración ---------- */
  // Simula a un conductor: mirada al frente con leves oscilaciones,
  // revisiones de espejos cada pocos segundos, momentos mirando hacia
  // abajo y algún cabeceo. Los primeros 5 s se queda quieto para que
  // la calibración funcione.

  const Q_CELULAR_VERTICAL = qDesdeOrientacion(35, 90, 0);

  function anguloDemo(tSeg) {
    if (tSeg < 5) return { giro: 0, cabeceo: 0, inclinacion: 0 };
    const t = tSeg - 5;
    let cabeceo = 6 * Math.sin(t / 3.1) + 2 * Math.sin(t * 1.7);
    let giro = 4 * Math.sin(t / 2.3);
    let inclinacion = 3 * Math.sin(t / 4.1);

    // Revisión de espejo cada 9 s, alternando lados
    const ciclo = t % 9;
    if (ciclo > 6 && ciclo < 7.6) {
      const lado = Math.floor(t / 9) % 2 === 0 ? 1 : -1;
      giro += lado * 48 * Math.sin(((ciclo - 6) / 1.6) * Math.PI);
    }
    // Mirar hacia abajo (tablero / celular) cada 23 s
    const abajo = t % 23;
    if (abajo > 15 && abajo < 19) cabeceo += 28 * Math.sin(((abajo - 15) / 4) * Math.PI);
    // Cabeceo brusco cada 41 s
    const nod = t % 41;
    if (nod > 30 && nod < 30.8) cabeceo += 25 * Math.sin(((nod - 30) / 0.8) * Math.PI);
    // Inclinación sostenida cada 31 s
    const lat = t % 31;
    if (lat > 20 && lat < 25) inclinacion += 16 * Math.sin(((lat - 20) / 5) * Math.PI);

    return { giro, cabeceo, inclinacion };
  }

  function iniciarDemo() {
    demoInicio = performance.now();
    let previo = anguloDemo(0);
    let tPrevio = 0;
    const paso = () => {
      const t = (performance.now() - demoInicio) / 1000;
      const a = anguloDemo(t);
      const dt = Math.max(0.001, t - tPrevio);
      const qCabeza = qMul(qMul(qEje("y", a.giro), qEje("x", a.cabeceo)), qEje("z", a.inclinacion));
      ultimaQ = qNorm(qMul(Q_CELULAR_VERTICAL, qCabeza));
      ultimaV = {
        x: (a.cabeceo - previo.cabeceo) / dt,
        y: (a.giro - previo.giro) / dt,
        z: (a.inclinacion - previo.inclinacion) / dt
      };
      previo = a;
      tPrevio = t;
    };
    paso();
    demoTimer = setInterval(paso, 20);
  }

  /* ---------- Corrección de deriva de la rotación ---------- */
  // La flexión y la inclinación salen de la gravedad y no derivan. La rotación
  // (giro alrededor del eje vertical) no tiene esa referencia: el giroscopio
  // acumula error y, en un vehículo, el rumbo del carro también la cambia.
  // El corrector mantiene un "offset" que se resta a la rotación:
  //  1) Lento: con la cabeza quieta y cerca del centro, el offset se acerca a la
  //     postura actual (la persona mira al frente la mayor parte del tiempo).
  //  2) Reencuadre (solo conductores): si la rotación queda fija lejos del centro
  //     más tiempo del que dura una revisión de espejos, giró el vehículo.

  function envolver(g) {
    return ((g + 540) % 360) - 180;
  }

  function crearCorrectorDeriva(D, { reencuadre = false } = {}) {
    let offset = 0;
    let tPrevio = null;
    let quietoDesde = null;
    let fijo = null;          // { desde, ref }: rotación estable lejos del centro
    let acumulado = 0;        // grados corregidos por el modo lento
    let reencuadres = 0;

    function aplicar(rotCruda, velRot, tMs) {
      if (!D || !D.ACTIVA) return rotCruda;
      // dt acotado: si el celular se bloqueó, no corregir de golpe
      const dt = tPrevio == null ? 0 : Math.min(0.25, (tMs - tPrevio) / 1000);
      tPrevio = tMs;
      const rot = envolver(rotCruda - offset);

      if (Math.abs(velRot) < D.VEL_QUIETUD_GPS && Math.abs(rot) < D.VENTANA_CENTRO_GRADOS) {
        if (quietoDesde == null) quietoDesde = tMs;
        if (tMs - quietoDesde >= D.QUIETUD_MIN_MS && dt > 0) {
          const tope = D.MAX_CORRECCION_GPS * dt;
          const paso = Math.max(-tope, Math.min(tope, (rot * dt) / D.CONSTANTE_TIEMPO_SEG));
          offset = envolver(offset + paso);
          acumulado += Math.abs(paso);
        }
      } else {
        quietoDesde = null;
      }

      if (reencuadre) {
        if (Math.abs(rot) > D.REENCUADRE_GRADOS) {
          if (!fijo || Math.abs(envolver(rot - fijo.ref)) > D.REENCUADRE_TOLERANCIA_GRADOS) {
            fijo = { desde: tMs, ref: rot };
          } else if (tMs - fijo.desde >= D.REENCUADRE_ESTABLE_MS) {
            offset = envolver(offset + rot);
            reencuadres++;
            fijo = null;
          }
        } else {
          fijo = null;
        }
      }
      return envolver(rotCruda - offset);
    }

    // Recentrado manual: la persona mira al frente y toca el botón
    function recentrar(rotCruda) {
      offset = envolver(rotCruda);
      fijo = null;
    }

    function resumen() {
      return {
        offset_final: Math.round(offset * 10) / 10,
        corregido_lento: Math.round(acumulado * 10) / 10,
        reencuadres,
        reencuadre_activo: reencuadre
      };
    }

    return { aplicar, recentrar, resumen };
  }

  return {
    crearCorrectorDeriva,
    disponible,
    pedirPermiso,
    iniciar,
    detener,
    lectura,
    angulosCabeza,
    qPromedio,
    get esDemo() { return demo; }
  };
})();

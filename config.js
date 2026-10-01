/* ============================================================
   VIALIX HEADSENSE - Configuración
   Edita estos valores sin tocar el resto del código.
   ============================================================ */

const HEADSENSE_CONFIG = {
  // URL de la Web App de Google Apps Script de ESTE proyecto (termina en /exec).
  // Es un backend NUEVO, distinto al de VIALIX KEY (ver docs/GUIA_DESPLIEGUE.md).
  // Mientras diga PEGA_AQUI, las sesiones se guardan solo en el celular.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxCqIUzW66uyowTMRGzNHwDS2Qpi34B567as1mZb3oTRuFrTIr-5p5HmqoCCGvTyM7DNg/exec",

  // Nombre del cliente/empresa (aparece en el inicio)
  NOMBRE_CLIENTE: "Piloto VIALIX HEADSENSE",

  // Frecuencia con la que se guardan muestras (por segundo).
  // 20 Hz es suficiente para movimientos de cabeza y mantiene los archivos livianos
  // (1 hora ≈ 72.000 filas ≈ 4 MB de CSV).
  FRECUENCIA_MUESTREO_HZ: 20,

  // Formato del CSV descargable y del que se guarda en Drive.
  // "excel_es": separador ; y decimal con coma (abre directo en Excel en español).
  // "estandar": separador , y decimal con punto (Python, R, Power BI en inglés).
  CSV_FORMATO: "excel_es",

  // Segundos que la persona debe quedarse quieta mirando al frente para calibrar
  // la posición neutra (0°) de la cabeza.
  DURACION_CALIBRACION_SEG: 3,

  // Umbrales de referencia (grados) para clasificar la postura del cuello.
  // Basados en criterios ergonómicos tipo RULA / ISO 11226. Son orientativos,
  // no diagnósticos: ajústalos según el criterio de tu profesional SST.
  UMBRALES: {
    FLEXION_MODERADA: 10,   // cabeza hacia abajo: 10°–20° = moderado
    FLEXION_ALTA: 20,       // > 20° = alto
    EXTENSION: 5,           // cabeza hacia atrás más de 5° = riesgo
    INCLINACION: 10,        // inclinación lateral (oreja al hombro) más de 10°
    ROTACION: 45            // giro a un lado más de 45°
  },

  // Detección de eventos
  EVENTOS: {
    // Giro de cabeza (p. ej. revisar espejos / punto ciego): la rotación supera
    // este ángulo y luego vuelve cerca del centro.
    GIRO_GRADOS: 30,
    // Cabeceo brusco (posible señal de somnolencia o impacto): la cabeza cae
    // hacia adelante más rápido que esta velocidad (°/s) y supera el ángulo indicado.
    CABECEO_VELOCIDAD: 60,
    CABECEO_GRADOS: 15,
    // Tiempo mínimo entre dos eventos del mismo tipo (ms), para no contar doble.
    ANTIRREBOTE_MS: 800
  },

  // Corrección de deriva del eje de ROTACIÓN (ver docs/GUIA_MEDICION_Y_ANALISIS.md).
  // Flexión e inclinación no derivan: el navegador las referencia a la gravedad.
  // La rotación sí, por el giroscopio y porque el vehículo cambia de rumbo.
  DERIVA: {
    ACTIVA: true,
    // 1) Corrección lenta: cuando la cabeza está quieta y cerca del centro,
    //    el 0° de rotación se acerca poco a poco a la postura actual.
    VENTANA_CENTRO_GRADOS: 15,   // solo corrige si |rotación| < este valor
    VEL_QUIETUD_GPS: 8,          // y si la cabeza gira a menos de esta velocidad
    QUIETUD_MIN_MS: 2000,        // durante al menos este tiempo
    CONSTANTE_TIEMPO_SEG: 20,    // qué tan rápido se acerca (más alto = más lento)
    MAX_CORRECCION_GPS: 0.5,     // tope de corrección (°/s) para no borrar movimientos reales

    // 2) Reencuadre por cambio de rumbo (curvas, giros en esquinas): si la
    //    rotación se queda fija lejos del centro más tiempo del que dura una
    //    revisión de espejos, se asume que giró el vehículo, no la cabeza.
    //    "auto" = activo solo si la sesión tiene placa (conductor).
    //    true / false para forzarlo. En puestos fijos debe quedar apagado,
    //    porque borraría las rotaciones sostenidas (riesgo biomecánico).
    REENCUADRE_RUMBO: "auto",
    REENCUADRE_GRADOS: 20,
    REENCUADRE_ESTABLE_MS: 6000,  // un espejo dura 1–2 s; 6 s fijo = curva
    REENCUADRE_TOLERANCIA_GRADOS: 6 // variación máxima para considerarlo "fijo"
  },

  // Acceso directo a VIALIX KEY (la app de reporte del conductor).
  // Si ambas apps están en el mismo usuario de GitHub Pages, comparten la
  // identificación de la persona en el celular (no hay que escribirla dos veces).
  // Déjalo vacío ("") para ocultar el botón.
  VIALIX_KEY_URL: "https://solucionyservihseq-prog.github.io/vialix-key/",

  // Cómo va puesto el celular. "frente": vertical, en la frente o en el casco,
  // con la pantalla hacia afuera. "nuca": vertical, detrás de la cabeza, con la
  // pantalla hacia afuera (invierte el signo de flexión y de inclinación).
  MONTAJE: "frente"
};

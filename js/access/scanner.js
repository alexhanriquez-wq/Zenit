// Envoltorio de html5-qrcode para la cámara trasera del celular.
// Requiere la librería global Html5Qrcode (assets/vendor/html5-qrcode.min.js).

export class Escaner {
  constructor(elementId, onCodigo) {
    // eslint-disable-next-line no-undef
    this.lib = new Html5Qrcode(elementId, { verbose: false });
    this.onCodigo = onCodigo;
    this.activo = false;
    this.ocupado = false;
  }

  async iniciar() {
    const lado = Math.min(window.innerWidth - 64, 320);
    await this.lib.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: { width: lado, height: lado }, aspectRatio: 1 },
      texto => this._leido(texto),
      () => {} // errores de lectura por cuadro: se ignoran
    );
    this.activo = true;
  }

  _leido(texto) {
    if (this.ocupado) return;   // evita procesar el mismo QR varias veces
    this.ocupado = true;
    try { this.lib.pause(true); } catch { /* algunos navegadores */ }
    this.onCodigo(texto);
  }

  reanudar() {
    this.ocupado = false;
    try { this.lib.resume(); } catch { /* ya activo */ }
  }

  async detener() {
    if (!this.activo) return;
    try { await this.lib.stop(); } catch { /* ignorar */ }
    this.activo = false;
    this.ocupado = false;
  }
}

// Señales de feedback: vibración y tono (no requieren archivos).
let audioCtx;
export function senal(ok) {
  try { navigator.vibrate?.(ok ? 120 : [80, 60, 80, 60, 200]); } catch {}
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.15 : 0.45));
  } catch {}
}

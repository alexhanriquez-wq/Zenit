// Renderizado de la entrada digital: QR, imagen PNG, enlace y WhatsApp.
// Requiere la librería global `qrcode` (assets/vendor/qrcode.min.js).
//
// El QR contiene EXCLUSIVAMENTE el token aleatorio (40 hex), sin datos
// personales. La validez se decide siempre en la puerta contra Firestore.
import { APP } from "../firebase/config.js";
import { fmtFecha, aFecha } from "./ui.js";

function matrizQR(texto) {
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  return qr;
}

/** Dibuja el QR en un canvas (escala en píxeles por módulo). */
export function dibujarQR(canvas, texto, tam = 280) {
  const qr = matrizQR(texto);
  const n = qr.getModuleCount();
  const margen = 4;
  const escala = Math.max(2, Math.floor(tam / (n + margen * 2)));
  const lado = (n + margen * 2) * escala;
  canvas.width = canvas.height = lado;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lado, lado);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect((c + margen) * escala, (r + margen) * escala, escala, escala);
  return canvas;
}

/** Datos mínimos para mostrar el ticket fuera del panel (sin DNI). */
export function datosPublicos(en) {
  return {
    t: en.token || en.id,
    c: en.codigo,
    e: en.eventoNombre,
    f: aFecha(en.eventoFecha)?.getTime() || null,
    n: en.compradorNombre,
    v: en.vendedorNombre
  };
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0)));
}

/**
 * Enlace a entrada.html. Los datos viajan en el fragmento (#), que el
 * navegador nunca envía al servidor: GitHub Pages no los recibe y
 * Firestore no necesita permitir lecturas públicas.
 */
export function enlaceEntrada(en) {
  const base = new URL("entrada.html", location.href);
  base.hash = "d=" + b64urlEncode(JSON.stringify(datosPublicos(en)));
  return base.toString();
}

export function leerFragmento(hash) {
  const m = /d=([A-Za-z0-9_-]+)/.exec(hash || "");
  if (!m) return null;
  try {
    const d = JSON.parse(b64urlDecode(m[1]));
    if (!/^[a-f0-9]{40}$/.test(d.t)) return null;
    return d;
  } catch { return null; }
}

/** Genera la imagen completa de la entrada (PNG) en un canvas. */
export function dibujarTicket(en) {
  const d = datosPublicos(en);
  const W = 720, H = 1180;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // Fondo
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#14121c"); g.addColorStop(1, "#0b0a10");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#a78bfa"; ctx.fillRect(0, 0, W, 10);

  ctx.textAlign = "center";
  ctx.fillStyle = "#a78bfa";
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.fillText(APP.nombre.toUpperCase(), W / 2, 70);
  ctx.fillStyle = "#f4f3f8";
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillText("ENTRADA DIGITAL", W / 2, 122);

  // QR
  const qrCv = dibujarQR(document.createElement("canvas"), d.t, 460);
  const q = 480;
  ctx.fillStyle = "#fff";
  roundRect(ctx, (W - q) / 2 - 10, 160, q + 20, q + 20, 24); ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCv, (W - q) / 2, 170, q, q);

  // Código
  ctx.fillStyle = "#f4f3f8";
  ctx.font = "700 44px ui-monospace, Menlo, monospace";
  ctx.fillText(d.c || "", W / 2, 735);

  // Datos
  const filas = [
    ["Evento", d.e],
    ["Fecha", d.f ? fmtFecha(d.f) : "—"],
    ["Invitado al evento", d.n],
    ["RRPP", d.v]
  ];
  // El precio no se imprime en la entrada (solo lo ven vendedor y admin en sus paneles).
  ctx.textAlign = "left";
  let y = 810;
  const xValor = 330; // deja lugar para la etiqueta más larga ("INVITADO AL EVENTO")
  for (const [k, v] of filas) {
    ctx.fillStyle = "#8f8aa3"; ctx.font = "500 20px system-ui, sans-serif";
    ctx.fillText(recortar(ctx, k.toUpperCase(), xValor - 90), 60, y);
    ctx.fillStyle = "#f4f3f8"; ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText(recortar(ctx, String(v ?? "—"), W - xValor - 50), xValor, y);
    y += 62;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#8f8aa3"; ctx.font = "400 21px system-ui, sans-serif";
  ctx.fillText("Presentá este QR en la puerta. Válido para un solo ingreso.", W / 2, H - 50);
  return cv;
}

function recortar(ctx, txt, max) {
  if (ctx.measureText(txt).width <= max) return txt;
  while (txt.length > 1 && ctx.measureText(txt + "…").width > max) txt = txt.slice(0, -1);
  return txt + "…";
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function aBlob(cv) {
  return new Promise(res => cv.toBlob(res, "image/png"));
}

export async function descargarTicket(en) {
  const blob = await aBlob(dibujarTicket(en));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `entrada-${en.codigo}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function textoCompartir(en) {
  return `🎟️ Tu entrada para *${en.eventoNombre}*\nCódigo: ${en.codigo}\n` +
         `Invitado al evento: ${en.compradorNombre}\nRRPP: ${en.vendedorNombre}\n\n` +
         `Mostrá el QR en la puerta:\n${enlaceEntrada(en)}`;
}

/**
 * Comparte por WhatsApp. En Android usa la hoja nativa de compartir con
 * la imagen adjunta; si no está disponible abre WhatsApp con el enlace.
 */
export async function compartirTicket(en) {
  const texto = textoCompartir(en);
  try {
    const blob = await aBlob(dibujarTicket(en));
    const file = new File([blob], `entrada-${en.codigo}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: texto, title: "Entrada digital" });
      return;
    }
  } catch (e) {
    if (e?.name === "AbortError") return; // el usuario cerró la hoja
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

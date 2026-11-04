// Utilidades de interfaz compartidas por todas las pantallas.
import { APP } from "../firebase/config.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escapa texto antes de insertarlo como HTML (evita XSS con datos de compradores).
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function aFecha(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  return null;
}

export function fmtFecha(v, conHora = true) {
  const d = aFecha(v);
  if (!d) return "—";
  return d.toLocaleString(APP.locale, conHora
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtMoneda(n) {
  if (typeof n !== "number") return "—";
  return n.toLocaleString(APP.locale, { style: "currency", currency: APP.moneda, maximumFractionDigits: 0 });
}

export const ESTADOS = {
  reservada: { txt: "Reservada", cls: "b-warn" },
  vendida:   { txt: "Vendida",   cls: "b-ok" },
  utilizada: { txt: "Utilizada", cls: "b-info" },
  anulada:   { txt: "Anulada",   cls: "b-bad" },
  vencida:   { txt: "Vencida",   cls: "b-mute" },
  cancelada: { txt: "Cancelada", cls: "b-mute" }
};

export function badge(estado) {
  const e = ESTADOS[estado] || { txt: estado || "—", cls: "b-mute" };
  return `<span class="badge ${e.cls}">${esc(e.txt)}</span>`;
}

let toastTimer;
export function toast(msg, tipo = "info") {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.className = `toast show t-${tipo}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
}

// Traduce errores de Firebase a mensajes comprensibles.
export function mensajeError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/wrong-password": "Email o contraseña incorrectos.",
    "auth/user-not-found": "Email o contraseña incorrectos.",
    "auth/email-already-in-use": "Ese email ya está registrado.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-email": "El email no es válido.",
    "auth/too-many-requests": "Demasiados intentos. Probá de nuevo en unos minutos.",
    "auth/network-request-failed": "Sin conexión a internet.",
    "permission-denied": "Operación no permitida por las reglas de seguridad.",
    "unavailable": "Sin conexión con el servidor. Revisá internet.",
    "failed-precondition": "La operación no pudo completarse (precondición).",
    "aborted": "Conflicto con otra operación simultánea. Reintentá."
  };
  return map[code] || err?.message || "Error inesperado.";
}

// Aviso cuando Firebase no fue configurado: no se simula nada.
export function avisoNoConfigurado() {
  document.body.classList.remove("cargando");
  document.body.innerHTML = `
    <main class="center-screen">
      <div class="card narrow">
        <h1>Firebase no está configurado</h1>
        <p class="muted">Completá <code>js/firebase/config.js</code> con los datos de tu proyecto
        Firebase y publicá las reglas de <code>firestore.rules</code>. Las instrucciones están en
        <code>README.md</code>.</p>
        <p class="muted">Esta aplicación no muestra datos simulados.</p>
      </div>
    </main>`;
}

export function setCargando(btn, cargando, texto) {
  if (!btn) return;
  if (cargando) {
    btn.dataset.txt = btn.textContent;
    btn.textContent = texto || "Procesando…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.txt || btn.textContent;
    btn.disabled = false;
  }
}

export function normalizar(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

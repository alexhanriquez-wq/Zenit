// Panel administrativo: estado compartido, suscripciones y pestañas.
import { db } from "../firebase/init.js";
import { collection, query, where, onSnapshot } from "../firebase/sdk.js";
import { requerirRol, cerrarSesion } from "../auth/session.js";
import { $, $$, esc, toast, mensajeError, fmtFecha, aFecha } from "../common/ui.js";
import { liberarVencidas } from "../services/entradas.js";
import { renderResumen } from "./resumen.js";
import { initEntradas, renderEntradas } from "./entradas.js";
import { initUsuarios, renderUsuarios } from "./usuarios.js";
import { initEventos, renderEventos } from "./eventos.js";
import { initHistorial, renderHistorial } from "./historial.js";

const { perfil } = await requerirRol(["admin"]);

export const estado = {
  perfil,
  eventos: [],
  usuarios: [],
  entradas: [],
  ingresos: [],
  eventoSel: null // id de evento o "todos"
};

$("#user-chip").textContent = perfil.nombre;
$("#btn-salir").onclick = cerrarSesion;

// ---------------- Pestañas ----------------
let tabActual = "resumen";
$$(".tab").forEach(t => t.addEventListener("click", () => {
  tabActual = t.dataset.tab;
  $$(".tab").forEach(x => x.classList.toggle("active", x === t));
  $$("[data-panel]").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tabActual));
}));

export function renderTodo() {
  renderResumen(estado);
  renderEntradas(estado);
  renderUsuarios(estado);
  renderEventos(estado);
  renderHistorial(estado);
}

// ---------------- Suscripciones ----------------
const err = e => toast(mensajeError(e), "bad");

onSnapshot(collection(db, "eventos"), snap => {
  estado.eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => aFecha(b.fecha) - aFecha(a.fecha));
  pintarSelectorEvento();
  renderTodo();
}, err);

onSnapshot(collection(db, "usuarios"), snap => {
  estado.usuarios = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  renderTodo();
}, err);

let offEntradas = null, offIngresos = null;
function suscribirEvento() {
  offEntradas?.(); offIngresos?.();
  const filtro = estado.eventoSel && estado.eventoSel !== "todos"
    ? [where("eventoId", "==", estado.eventoSel)] : [];
  offEntradas = onSnapshot(query(collection(db, "entradas"), ...filtro), snap => {
    estado.entradas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (aFecha(b.fechaCreacion) || 0) - (aFecha(a.fechaCreacion) || 0));
    renderTodo();
  }, err);
  offIngresos = onSnapshot(query(collection(db, "ingresos"), ...filtro), snap => {
    estado.ingresos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (aFecha(b.fechaHora) || 0) - (aFecha(a.fechaHora) || 0));
    renderTodo();
  }, err);
}

function pintarSelectorEvento() {
  const sel = $("#sel-evento");
  if (!estado.eventoSel) {
    // Por defecto: el próximo evento activo, o el más reciente.
    const ahora = Date.now();
    const prox = [...estado.eventos].filter(e => e.estado === "activo")
      .sort((a, b) => aFecha(a.fecha) - aFecha(b.fecha))
      .find(e => aFecha(e.fecha) >= ahora - 12 * 3600e3);
    estado.eventoSel = prox?.id || estado.eventos[0]?.id || "todos";
    suscribirEvento();
  }
  sel.innerHTML = `<option value="todos">Todos los eventos</option>` +
    estado.eventos.map(e => `<option value="${e.id}">${esc(e.nombre)} — ${fmtFecha(e.fecha, false)}</option>`).join("");
  sel.value = estado.eventoSel;
}

$("#sel-evento").addEventListener("change", e => {
  estado.eventoSel = e.target.value;
  estado.entradas = []; estado.ingresos = [];
  suscribirEvento();
  renderTodo();
});

// ---------------- Módulos ----------------
initEntradas(estado);
initUsuarios(estado);
initEventos(estado);
initHistorial(estado);

// ---------------- Vencimiento de reservas ----------------
// Sin Cloud Functions, el panel del administrador abierto actúa como
// "proceso periódico" que libera reservas vencidas de todos los vendedores.
async function barrerVencidas() {
  try {
    const n = await liberarVencidas({ uid: perfil.uid });
    if (n) toast(`${n} reserva(s) vencida(s) liberada(s).`);
  } catch (e) { console.warn(e); }
}
barrerVencidas();
setInterval(barrerVencidas, 2 * 60 * 1000);

// Panel del vendedor: venta, confirmación de cobro y consulta de ventas propias.
import { db } from "../firebase/init.js";
import { collection, query, where, onSnapshot } from "../firebase/sdk.js";
import { requerirRol, cerrarSesion } from "../auth/session.js";
import {
  $, esc, toast, mensajeError, setCargando, fmtFecha, fmtMoneda, badge, normalizar, aFecha
} from "../common/ui.js";
import {
  reservarEntrada, confirmarCobro, liberarReserva, liberarVencidas, disponibles, comisionDe, ErrorNegocio
} from "../services/entradas.js";
import { renderTicket } from "../common/ticket-view.js";

const { perfil } = await requerirRol(["vendedor"]);

let eventos = [];        // eventos activos
let ventas = [];         // entradas propias
let cupos = new Map();   // eventoId -> { limite, usadas } asignados por el admin
let reservaActual = null;
let relojTimer = null;

$("#user-chip").textContent = `${perfil.nombre} · ${perfil.codigo || "sin código"}`;
$("#btn-salir").onclick = cerrarSesion;

// Libera reservas propias vencidas al abrir el panel (no hay procesos automáticos en Spark).
liberarVencidas({ uid: perfil.uid, vendedorId: perfil.uid }).catch(() => {});

// ---------------- Eventos (en tiempo real) ----------------
onSnapshot(
  query(collection(db, "eventos"), where("estado", "==", "activo")),
  snap => {
    eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (aFecha(a.fecha) - aFecha(b.fecha)));
    pintarEventos();
  },
  e => toast(mensajeError(e), "bad")
);

// ---------------- Mis límites de venta (en tiempo real) ----------------
onSnapshot(
  query(collection(db, "cupos"), where("vendedorId", "==", perfil.uid)),
  snap => {
    cupos = new Map(snap.docs.map(d => [d.data().eventoId, d.data()]));
    pintarEventos();
  },
  e => console.warn(e)
);

// Cuántas puede vender todavía en un evento (límite propio y del evento).
function puedoVender(ev) {
  const cupo = cupos.get(ev.id);
  const propio = cupo ? Math.max(0, cupo.limite - cupo.usadas) : Infinity;
  return Math.min(disponibles(ev), propio);
}

function textoCupo(ev) {
  const cupo = cupos.get(ev.id);
  if (!cupo) return "";
  return cupo.usadas >= cupo.limite
    ? ` · Límite alcanzado (${cupo.usadas}/${cupo.limite})`
    : ` · Tu límite: ${cupo.usadas}/${cupo.limite}`;
}

function pintarEventos() {
  const sel = $("#evento");
  const previo = sel.value;
  sel.innerHTML = eventos.length
    ? eventos.map(ev => {
        const motivo = disponibles(ev) <= 0 ? " (agotado)" : puedoVender(ev) <= 0 ? " (límite alcanzado)" : "";
        return `<option value="${ev.id}" ${motivo ? "disabled" : ""}>
        ${esc(ev.nombre)} — ${fmtFecha(ev.fecha, false)}${motivo}</option>`;
      }).join("")
    : `<option value="">No hay eventos activos</option>`;
  if (previo && eventos.some(e => e.id === previo)) sel.value = previo;
  actualizarInfoEvento();

  $("#lista-eventos").innerHTML = eventos.length ? eventos.map(ev => {
    const disp = disponibles(ev);
    const pct = ev.limite ? Math.round(((ev.vendidas + ev.reservadas) / ev.limite) * 100) : 0;
    return `<div>
      <div class="row"><strong class="grow">${esc(ev.nombre)}</strong>
        <span class="badge ${disp > 0 ? "b-ok" : "b-bad"}">${disp > 0 ? `${disp} disponibles` : "Agotado"}</span></div>
      <div class="small muted">${fmtFecha(ev.fecha)} · ${fmtMoneda(ev.precio)} · comisión ${ev.comision ?? 0}%
        (${fmtMoneda(Math.round((ev.precio || 0) * (ev.comision || 0) / 100))} por entrada)${esc(textoCupo(ev))}</div>
      <div class="small muted">${ev.vendidas} vendidas · ${ev.reservadas} reservadas · límite del evento ${ev.limite}</div>
      <div class="progress"><span style="width:${(ev.vendidas / ev.limite) * 100}%;background:var(--ok)"></span>
        <span style="width:${(ev.reservadas / ev.limite) * 100}%;background:var(--warn)"></span></div>
      <div class="small muted" style="margin-top:4px">${pct}% ocupado</div>
    </div>`;
  }).join("") : `<p class="muted">No hay eventos activos.</p>`;
}

function actualizarInfoEvento() {
  const ev = eventos.find(e => e.id === $("#evento").value);
  $("#precio").value = ev ? fmtMoneda(ev.precio) : "";
  if (!ev) {
    $("#evento-info").textContent = "";
  } else {
    const cupo = cupos.get(ev.id);
    $("#evento-info").textContent = `Quedan ${disponibles(ev)} de ${ev.limite} entradas en el evento.` +
      (cupo ? ` Tu límite: ${cupo.usadas} de ${cupo.limite}` +
        (cupo.usadas >= cupo.limite ? " — alcanzado, pedile al administrador que lo extienda." : ".") : "");
  }
  $("#btn-vender").disabled = !ev || puedoVender(ev) <= 0;
}
$("#evento").addEventListener("change", actualizarInfoEvento);
$("#dni").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });

// ---------------- Venta ----------------
$("#form-venta").addEventListener("submit", async ev => {
  ev.preventDefault();
  const btn = $("#btn-vender");
  setCargando(btn, true, "Reservando…");
  try {
    await liberarVencidas({ uid: perfil.uid, vendedorId: perfil.uid }).catch(() => {});
    const entrada = await reservarEntrada({
      perfil,
      eventoId: $("#evento").value,
      compradorNombre: $("#comprador").value,
      compradorDni: $("#dni").value
    });
    $("#comprador").value = "";
    $("#dni").value = "";
    abrirCobro(entrada);
  } catch (e) {
    toast(e instanceof ErrorNegocio ? e.message : mensajeError(e), "bad");
  } finally {
    setCargando(btn, false);
    actualizarInfoEvento();
  }
});

// ---------------- Confirmación de cobro ----------------
function abrirCobro(en) {
  reservaActual = en;
  $("#cobro-detalle").innerHTML = `
    <div><span class="muted small">Comprador</span><br><strong>${esc(en.compradorNombre)}</strong> · DNI ${esc(en.compradorDni)}</div>
    <div><span class="muted small">Evento</span><br>${esc(en.eventoNombre)} · ${fmtMoneda(en.precio)}</div>
    <div><span class="muted small">Código</span><br><span class="mono">${esc(en.codigo)}</span></div>`;
  clearInterval(relojTimer);
  const vence = aFecha(en.venceEn);
  const tick = () => {
    const ms = vence - Date.now();
    if (ms <= 0) {
      $("#cobro-reloj").textContent = "vencida";
      $("#btn-confirmar-cobro").disabled = true;
      clearInterval(relojTimer);
      return;
    }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    $("#cobro-reloj").textContent = `${m}:${String(s).padStart(2, "0")}`;
  };
  $("#btn-confirmar-cobro").disabled = false;
  tick(); relojTimer = setInterval(tick, 1000);
  $("#dlg-cobro").showModal();
}

$("#dlg-cobro").addEventListener("close", () => clearInterval(relojTimer));

$("#btn-confirmar-cobro").onclick = async () => {
  const btn = $("#btn-confirmar-cobro");
  setCargando(btn, true, "Confirmando…");
  try {
    await confirmarCobro(reservaActual.id);
    $("#dlg-cobro").close();
    toast("Cobro confirmado. Entrada vendida.", "ok");
    mostrarTicket({ ...reservaActual, estado: "vendida" });
  } catch (e) {
    toast(e instanceof ErrorNegocio ? e.message : mensajeError(e), "bad");
  } finally { setCargando(btn, false); }
};

$("#btn-cancelar-reserva").onclick = async () => {
  if (!confirm("¿Cancelar esta reserva? El cupo vuelve a quedar disponible.")) return;
  try {
    await liberarReserva(reservaActual.id, perfil.uid, "cancelada");
    $("#dlg-cobro").close();
    toast("Reserva cancelada.");
  } catch (e) { toast(mensajeError(e), "bad"); }
};

function mostrarTicket(en) {
  renderTicket($("#ticket-cont"), en, { acciones: true });
  $("#dlg-ticket").showModal();
}
$("#btn-cerrar-ticket").onclick = () => $("#dlg-ticket").close();

// ---------------- Mis ventas (en tiempo real) ----------------
onSnapshot(
  query(collection(db, "entradas"), where("vendedorId", "==", perfil.uid)),
  snap => {
    ventas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (aFecha(b.fechaCreacion) || 0) - (aFecha(a.fechaCreacion) || 0));
    pintarStats();
    pintarVentas();
  },
  e => toast(mensajeError(e), "bad")
);

function pintarStats() {
  const c = estado => ventas.filter(v => v.estado === estado).length;
  const vendidasTotal = c("vendida") + c("utilizada");
  const recaudado = ventas.filter(v => ["vendida", "utilizada"].includes(v.estado))
    .reduce((s, v) => s + (v.precio || 0), 0);
  const comision = ventas.reduce((s, v) => s + comisionDe(v), 0);
  $("#mis-stats").innerHTML = `
    <div class="stat ok"><div class="k">Vendidas</div><div class="v">${vendidasTotal}</div></div>
    <div class="stat warn"><div class="k">Reservadas</div><div class="v">${c("reservada")}</div></div>
    <div class="stat info"><div class="k">Utilizadas</div><div class="v">${c("utilizada")}</div></div>
    <div class="stat"><div class="k">Recaudado</div><div class="v" style="font-size:1.4rem">${fmtMoneda(recaudado)}</div></div>
    <div class="stat ok"><div class="k">Mi comisión</div><div class="v" style="font-size:1.4rem">${fmtMoneda(comision)}</div></div>
    <div class="stat"><div class="k">A entregar</div><div class="v" style="font-size:1.4rem">${fmtMoneda(recaudado - comision)}</div></div>`;
}

function pintarVentas() {
  const q = normalizar($("#buscar").value);
  const est = $("#filtro-estado").value;
  const filas = ventas.filter(v =>
    (!est || v.estado === est) &&
    (!q || normalizar(`${v.compradorNombre} ${v.compradorDni} ${v.codigo} ${v.eventoNombre}`).includes(q)));

  $("#tabla-ventas").innerHTML = filas.length ? filas.map(v => `
    <tr>
      <td>${esc(v.compradorNombre)}</td>
      <td class="hide-sm mono">${esc(v.compradorDni)}</td>
      <td class="hide-sm">${esc(v.eventoNombre)}</td>
      <td class="mono">${esc(v.codigo)}</td>
      <td>${badge(v.estado)}</td>
      <td class="hide-sm small">${fmtFecha(v.fechaVenta || v.fechaCreacion)}</td>
      <td class="actions">
        ${v.estado === "reservada" ? `<button class="btn btn-sm btn-ok" data-cobro="${v.id}">Cobrar</button>` : ""}
        ${["vendida", "utilizada"].includes(v.estado) ? `<button class="btn btn-sm" data-ver="${v.id}">Ver QR</button>` : ""}
      </td>
    </tr>`).join("")
    : `<tr><td colspan="7" class="empty">Sin ventas para mostrar.</td></tr>`;
}

$("#buscar").addEventListener("input", pintarVentas);
$("#filtro-estado").addEventListener("change", pintarVentas);
$("#tabla-ventas").addEventListener("click", e => {
  const id = e.target.dataset.cobro || e.target.dataset.ver;
  if (!id) return;
  const v = ventas.find(x => x.id === id);
  if (!v) return;
  if (e.target.dataset.cobro) {
    if (aFecha(v.venceEn) < Date.now()) {
      toast("Esa reserva ya venció. Se liberará automáticamente.", "bad");
      liberarReserva(v.id, perfil.uid, "vencida").catch(() => {});
      return;
    }
    abrirCobro(v);
  } else {
    mostrarTicket(v);
  }
});

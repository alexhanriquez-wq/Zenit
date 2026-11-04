// Alta, edición y borrado de eventos.
import { db } from "../firebase/init.js";
import { APP } from "../firebase/config.js";
import {
  collection, doc, addDoc, updateDoc, serverTimestamp, Timestamp
} from "../firebase/sdk.js";
import { $, esc, toast, mensajeError, setCargando, fmtFecha, fmtMoneda, aFecha } from "../common/ui.js";
import { disponibles, contarDatosEvento, borrarEvento } from "../services/entradas.js";

let estadoRef;
let editando = null;

const ETIQUETA = { activo: "b-ok", pausado: "b-warn", finalizado: "b-mute" };

export function renderEventos(estado) {
  $("#tabla-eventos").innerHTML = estado.eventos.length ? estado.eventos.map(e => `
    <tr>
      <td><strong>${esc(e.nombre)}</strong></td>
      <td class="small">${fmtFecha(e.fecha)}</td>
      <td>${fmtMoneda(e.precio)}</td>
      <td>${e.comision ?? 0}%</td>
      <td>${e.limite}</td><td>${e.vendidas}</td><td>${e.reservadas}</td><td>${disponibles(e)}</td>
      <td><span class="badge ${ETIQUETA[e.estado] || "b-mute"}">${esc(e.estado)}</span></td>
      <td class="actions">
        <button class="btn btn-sm" data-editar="${e.id}">Editar</button>
        <button class="btn btn-sm btn-bad" data-borrar="${e.id}">Borrar</button>
      </td>
    </tr>`).join("")
    : `<tr><td colspan="10" class="empty">Todavía no hay eventos. Creá el primero.</td></tr>`;
}

// datetime-local <-> Date (hora local del dispositivo)
function aInputLocal(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function infoComision() {
  const precio = Number($("#ev-precio").value) || 0;
  const pct = Number($("#ev-comision").value) || 0;
  $("#ev-comision-info").textContent =
    `El vendedor gana ${fmtMoneda(Math.round(precio * pct / 100))} por cada entrada vendida.` +
    (editando ? " Cambiarla solo afecta a las ventas nuevas." : "");
}

function abrir(ev = null) {
  editando = ev;
  $("#dlg-evento-titulo").textContent = ev ? "Editar evento" : "Nuevo evento";
  $("#ev-nombre").value = ev?.nombre || "";
  $("#ev-fecha").value = ev ? aInputLocal(aFecha(ev.fecha)) : "";
  $("#ev-precio").value = ev?.precio ?? "";
  $("#ev-comision").value = ev?.comision ?? "";
  $("#ev-limite").value = ev?.limite ?? APP.limitePorDefecto;
  $("#ev-estado").value = ev?.estado || "activo";
  $("#ev-aviso").textContent = ev
    ? `Ya hay ${ev.vendidas} vendidas y ${ev.reservadas} reservadas: el límite no puede ser menor a ${ev.vendidas + ev.reservadas}. ` +
      `Cambiar el precio no modifica las entradas ya emitidas.`
    : `Límite predeterminado: ${APP.limitePorDefecto} entradas, compartido entre todos los vendedores.`;
  infoComision();
  $("#dlg-evento").showModal();
}

async function confirmarBorrado(ev) {
  let datos;
  try { datos = await contarDatosEvento(ev.id); }
  catch (e) { return toast(mensajeError(e), "bad"); }

  const nEnt = datos.entradas.length, nIng = datos.ingresos.length;
  if (nEnt === 0) {
    if (!confirm(`¿Borrar el evento "${ev.nombre}"? No tiene entradas.`)) return;
  } else {
    const txt = prompt(
      `ATENCIÓN: el evento "${ev.nombre}" tiene ${nEnt} entrada(s) y ${nIng} ingreso(s) registrados.\n\n` +
      `Se borrará TODO de forma permanente: entradas, historial de ingresos y límites de vendedores. ` +
      `Los QR emitidos dejarán de ser válidos.\n\n` +
      `Te recomendamos exportar el CSV antes (pestaña Entradas).\n\n` +
      `Escribí BORRAR para confirmar:`);
    if (txt === null) return;
    if (txt.trim().toUpperCase() !== "BORRAR") return toast("Borrado cancelado: no escribiste BORRAR.");
  }

  toast("Borrando evento…");
  try {
    const r = await borrarEvento(ev);
    toast(`Evento borrado (${r.entradas} entradas, ${r.ingresos} ingresos).`, "ok");
  } catch (e) {
    toast(`No se pudo terminar el borrado: ${mensajeError(e)} Volvé a intentarlo.`, "bad");
  }
}

export function initEventos(estado) {
  estadoRef = estado;
  $("#btn-nuevo-evento").onclick = () => abrir();
  $("#ev-cancelar").onclick = () => $("#dlg-evento").close();
  $("#ev-precio").addEventListener("input", infoComision);
  $("#ev-comision").addEventListener("input", infoComision);

  $("#tabla-eventos").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    const ev = estadoRef.eventos.find(x => x.id === (b.dataset.editar || b.dataset.borrar));
    if (!ev) return;
    if (b.dataset.editar) abrir(ev);
    else confirmarBorrado(ev);
  });

  $("#form-evento").addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = $("#ev-nombre").value.trim();
    const fecha = new Date($("#ev-fecha").value);
    const precio = Number($("#ev-precio").value);
    const comision = Number($("#ev-comision").value);
    const limite = parseInt($("#ev-limite").value, 10);
    const est = $("#ev-estado").value;

    if (nombre.length < 2) return toast("Ingresá el nombre del evento.", "bad");
    if (isNaN(fecha.getTime())) return toast("Ingresá fecha y hora.", "bad");
    if ($("#ev-precio").value === "" || !(precio >= 0)) return toast("Precio inválido.", "bad");
    if ($("#ev-comision").value === "" || !(comision >= 0 && comision <= 100))
      return toast("La comisión debe ser un porcentaje entre 0 y 100.", "bad");
    if (!(limite > 0 && limite <= 10000)) return toast("Límite inválido.", "bad");
    if (editando && limite < editando.vendidas + editando.reservadas)
      return toast(`El límite no puede ser menor a ${editando.vendidas + editando.reservadas}.`, "bad");

    const btn = $("#ev-guardar");
    setCargando(btn, true, "Guardando…");
    try {
      const datos = {
        nombre, fecha: Timestamp.fromDate(fecha), precio, comision, limite, estado: est,
        actualizadoEn: serverTimestamp()
      };
      if (editando) {
        // updateDoc no toca los contadores: el stock sigue siendo consistente.
        await updateDoc(doc(db, "eventos", editando.id), datos);
        toast("Evento actualizado.", "ok");
      } else {
        await addDoc(collection(db, "eventos"), {
          ...datos, vendidas: 0, reservadas: 0, ultimaEntrada: null, creadoEn: serverTimestamp()
        });
        toast("Evento creado.", "ok");
      }
      $("#dlg-evento").close();
    } catch (err) {
      toast(mensajeError(err), "bad");
    } finally { setCargando(btn, false); }
  });
}

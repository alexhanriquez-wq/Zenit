// Alta, edición y baja de eventos.
import { db } from "../firebase/init.js";
import { APP } from "../firebase/config.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp
} from "../firebase/sdk.js";
import { $, esc, toast, mensajeError, setCargando, fmtFecha, fmtMoneda, aFecha } from "../common/ui.js";
import { disponibles } from "../services/entradas.js";

let estadoRef;
let editando = null;

const ETIQUETA = { activo: "b-ok", pausado: "b-warn", finalizado: "b-mute" };

export function renderEventos(estado) {
  $("#tabla-eventos").innerHTML = estado.eventos.length ? estado.eventos.map(e => `
    <tr>
      <td><strong>${esc(e.nombre)}</strong></td>
      <td class="small">${fmtFecha(e.fecha)}</td>
      <td>${fmtMoneda(e.precio)}</td>
      <td>${e.limite}</td><td>${e.vendidas}</td><td>${e.reservadas}</td><td>${disponibles(e)}</td>
      <td><span class="badge ${ETIQUETA[e.estado] || "b-mute"}">${esc(e.estado)}</span></td>
      <td class="actions">
        <button class="btn btn-sm" data-editar="${e.id}">Editar</button>
        ${e.vendidas + e.reservadas === 0 ? `<button class="btn btn-sm btn-bad" data-borrar="${e.id}">Borrar</button>` : ""}
      </td>
    </tr>`).join("")
    : `<tr><td colspan="9" class="empty">Todavía no hay eventos. Creá el primero.</td></tr>`;
}

// datetime-local <-> Date (hora local del dispositivo)
function aInputLocal(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function abrir(ev = null) {
  editando = ev;
  $("#dlg-evento-titulo").textContent = ev ? "Editar evento" : "Nuevo evento";
  $("#ev-nombre").value = ev?.nombre || "";
  $("#ev-fecha").value = ev ? aInputLocal(aFecha(ev.fecha)) : "";
  $("#ev-precio").value = ev?.precio ?? "";
  $("#ev-limite").value = ev?.limite ?? APP.limitePorDefecto;
  $("#ev-estado").value = ev?.estado || "activo";
  $("#ev-aviso").textContent = ev
    ? `Ya hay ${ev.vendidas} vendidas y ${ev.reservadas} reservadas: el límite no puede ser menor a ${ev.vendidas + ev.reservadas}. ` +
      `Cambiar el precio no modifica las entradas ya emitidas.`
    : `Límite predeterminado: ${APP.limitePorDefecto} entradas, compartido entre todos los vendedores.`;
  $("#dlg-evento").showModal();
}

export function initEventos(estado) {
  estadoRef = estado;
  $("#btn-nuevo-evento").onclick = () => abrir();
  $("#ev-cancelar").onclick = () => $("#dlg-evento").close();

  $("#tabla-eventos").addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    const ev = estadoRef.eventos.find(x => x.id === (b.dataset.editar || b.dataset.borrar));
    if (!ev) return;
    if (b.dataset.editar) abrir(ev);
    else if (confirm(`¿Borrar el evento "${ev.nombre}"?`)) {
      try { await deleteDoc(doc(db, "eventos", ev.id)); toast("Evento borrado."); }
      catch (err) { toast(mensajeError(err), "bad"); }
    }
  });

  $("#form-evento").addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = $("#ev-nombre").value.trim();
    const fecha = new Date($("#ev-fecha").value);
    const precio = Number($("#ev-precio").value);
    const limite = parseInt($("#ev-limite").value, 10);
    const est = $("#ev-estado").value;

    if (nombre.length < 2) return toast("Ingresá el nombre del evento.", "bad");
    if (isNaN(fecha.getTime())) return toast("Ingresá fecha y hora.", "bad");
    if (!(precio >= 0)) return toast("Precio inválido.", "bad");
    if (!(limite > 0 && limite <= 10000)) return toast("Límite inválido.", "bad");
    if (editando && limite < editando.vendidas + editando.reservadas)
      return toast(`El límite no puede ser menor a ${editando.vendidas + editando.reservadas}.`, "bad");

    const btn = $("#ev-guardar");
    setCargando(btn, true, "Guardando…");
    try {
      const datos = {
        nombre, fecha: Timestamp.fromDate(fecha), precio, limite, estado: est,
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

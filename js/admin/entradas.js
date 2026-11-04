// Listado, búsqueda, anulación y exportación de entradas.
import { $, esc, toast, mensajeError, fmtFecha, badge, normalizar, aFecha } from "../common/ui.js";
import { anularEntrada, liberarReserva, ErrorNegocio } from "../services/entradas.js";
import { renderTicket } from "../common/ticket-view.js";

let estadoRef;

function filtradas(estado) {
  const q = normalizar($("#ent-buscar").value);
  const est = $("#ent-estado").value;
  const ven = $("#ent-vendedor").value;
  return estado.entradas.filter(e =>
    (!est || e.estado === est) &&
    (!ven || e.vendedorId === ven) &&
    (!q || normalizar(`${e.compradorNombre} ${e.compradorDni} ${e.vendedorNombre} ${e.vendedorCodigo} ${e.codigo}`).includes(q)));
}

export function renderEntradas(estado) {
  // Selector de vendedores a partir de las entradas cargadas
  const sel = $("#ent-vendedor");
  const previo = sel.value;
  const vendedores = new Map(estado.entradas.map(e => [e.vendedorId, e.vendedorNombre]));
  sel.innerHTML = `<option value="">Todos los vendedores</option>` +
    [...vendedores].sort((a, b) => String(a[1]).localeCompare(b[1]))
      .map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("");
  sel.value = vendedores.has(previo) ? previo : "";

  const filas = filtradas(estado);
  $("#ent-resumen").textContent = `${filas.length} de ${estado.entradas.length} entradas`;
  const ahora = Date.now();
  $("#tabla-entradas").innerHTML = filas.length ? filas.slice(0, 500).map(e => `
    <tr>
      <td>${esc(e.compradorNombre)}</td>
      <td class="mono">${esc(e.compradorDni)}</td>
      <td>${esc(e.vendedorNombre)}<div class="small muted mono">${esc(e.vendedorCodigo)}</div></td>
      <td class="hide-sm">${esc(e.eventoNombre)}</td>
      <td class="mono">${esc(e.codigo)}</td>
      <td>${badge(e.estado)}</td>
      <td class="hide-sm small">${fmtFecha(e.fechaVenta || e.fechaCreacion)}</td>
      <td class="hide-sm small">${e.fechaIngreso ? `${fmtFecha(e.fechaIngreso)}<div class="muted">${esc(e.controladorNombre)}</div>` : "—"}</td>
      <td class="actions">
        <button class="btn btn-sm" data-ver="${e.id}">QR</button>
        ${e.estado === "reservada" && aFecha(e.venceEn) < ahora ? `<button class="btn btn-sm" data-liberar="${e.id}">Liberar</button>` : ""}
        ${["reservada", "vendida"].includes(e.estado) ? `<button class="btn btn-sm btn-bad" data-anular="${e.id}">Anular</button>` : ""}
      </td>
    </tr>`).join("")
    : `<tr><td colspan="9" class="empty">Sin entradas para mostrar.</td></tr>`;
}

function csv(estado) {
  const cols = ["codigo", "estado", "eventoNombre", "compradorNombre", "compradorDni",
    "vendedorNombre", "vendedorCodigo", "precio", "fechaCreacion", "fechaVenta", "fechaIngreso", "controladorNombre"];
  const celda = v => {
    const s = v && typeof v.toDate === "function" ? fmtFecha(v) : String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lineas = [cols.join(";"), ...filtradas(estado).map(e => cols.map(c => celda(e[c])).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `entradas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function initEntradas(estado) {
  estadoRef = estado;
  const repintar = () => renderEntradas(estadoRef);
  $("#ent-buscar").addEventListener("input", repintar);
  $("#ent-estado").addEventListener("change", repintar);
  $("#ent-vendedor").addEventListener("change", repintar);
  $("#ent-csv").addEventListener("click", () => csv(estadoRef));
  $("#btn-cerrar-ticket").onclick = () => $("#dlg-ticket").close();

  $("#tabla-entradas").addEventListener("click", async ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    const id = b.dataset.ver || b.dataset.anular || b.dataset.liberar;
    const en = estadoRef.entradas.find(x => x.id === id);
    if (!en) return;

    if (b.dataset.ver) {
      renderTicket($("#ticket-cont"), en, { acciones: true, mostrarEstado: true, mostrarDni: true });
      $("#dlg-ticket").showModal();
    } else if (b.dataset.liberar) {
      try {
        const ok = await liberarReserva(en.id, estadoRef.perfil.uid, "vencida");
        toast(ok ? "Reserva liberada." : "La reserva ya no estaba pendiente.");
      } catch (e) { toast(mensajeError(e), "bad"); }
    } else if (b.dataset.anular) {
      const motivo = prompt(`Anular la entrada ${en.codigo} de ${en.compradorNombre}.\nMotivo (opcional):`, "");
      if (motivo === null) return;
      try {
        await anularEntrada(en.id, estadoRef.perfil.uid, motivo);
        toast("Entrada anulada. El cupo volvió a quedar disponible.", "ok");
      } catch (e) {
        toast(e instanceof ErrorNegocio ? e.message : mensajeError(e), "bad");
      }
    }
  });
}

// Historial completo de ingresos registrados en la puerta.
import { $, esc, fmtFecha, normalizar } from "../common/ui.js";

let estadoRef;

export function renderHistorial(estado) {
  const q = normalizar($("#his-buscar").value);
  const filas = estado.ingresos.filter(i => !q || normalizar(
    `${i.compradorNombre} ${i.compradorDni} ${i.vendedorNombre} ${i.controladorNombre} ${i.codigo}`).includes(q));
  $("#tabla-historial").innerHTML = filas.length ? filas.slice(0, 1000).map(i => `
    <tr>
      <td class="small">${fmtFecha(i.fechaHora)}</td>
      <td>${esc(i.compradorNombre)}</td>
      <td class="hide-sm mono">${esc(i.compradorDni)}</td>
      <td>${esc(i.vendedorNombre)}</td>
      <td>${esc(i.controladorNombre)}</td>
      <td class="hide-sm mono">${esc(i.codigo)}</td>
    </tr>`).join("")
    : `<tr><td colspan="6" class="empty">Sin ingresos registrados.</td></tr>`;
}

export function initHistorial(estado) {
  estadoRef = estado;
  $("#his-buscar").addEventListener("input", () => renderHistorial(estadoRef));
}

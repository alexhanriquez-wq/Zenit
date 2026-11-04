// Renderiza la tarjeta de la entrada dentro de un contenedor.
import { APP } from "../firebase/config.js";
import { esc, fmtFecha, badge } from "./ui.js";
import { dibujarQR, descargarTicket, compartirTicket } from "./ticket.js";

/**
 * @param {HTMLElement} cont
 * @param {object} en  entrada (al menos token/id, codigo, eventoNombre, compradorNombre, vendedorNombre)
 * @param {object} opts { acciones: bool, mostrarEstado: bool, mostrarDni: bool }
 */
export function renderTicket(cont, en, opts = {}) {
  const { acciones = true, mostrarEstado = false, mostrarDni = false } = opts;
  cont.innerHTML = `
    <div class="ticket">
      <div class="marca">${esc(APP.nombre.toUpperCase())}</div>
      <div class="tit">ENTRADA DIGITAL</div>
      <canvas class="qr" aria-label="Código QR de la entrada"></canvas>
      <div class="codigo">${esc(en.codigo)}</div>
      ${mostrarEstado ? `<div style="margin-bottom:10px">${badge(en.estado)}</div>` : ""}
      <dl>
        <dt>Evento</dt><dd>${esc(en.eventoNombre)}</dd>
        <dt>Fecha</dt><dd>${fmtFecha(en.eventoFecha)}</dd>
        <dt>Invitado al evento</dt><dd>${esc(en.compradorNombre)}</dd>
        ${mostrarDni && en.compradorDni ? `<dt>DNI</dt><dd>${esc(en.compradorDni)}</dd>` : ""}
        <dt>RRPP</dt><dd>${esc(en.vendedorNombre)}</dd>
      </dl>
      <div class="nota">Válida para un solo ingreso. No compartas el QR con otras personas.</div>
    </div>
    ${acciones ? `
      <div class="ticket-actions">
        <button class="btn btn-ok" data-acc="wa">WhatsApp</button>
        <button class="btn" data-acc="png">Descargar</button>
      </div>` : ""}`;

  dibujarQR(cont.querySelector("canvas.qr"), en.token || en.id, 600);

  if (acciones) {
    cont.querySelector('[data-acc="wa"]').onclick = () => compartirTicket(en);
    cont.querySelector('[data-acc="png"]').onclick = () => descargarTicket(en);
  }
}

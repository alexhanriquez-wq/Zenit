// Estadísticas y ranking de vendedores para el evento seleccionado.
import { $, esc, fmtMoneda } from "../common/ui.js";
import { comisionDe } from "../services/entradas.js";

export function eventosSeleccionados(estado) {
  return estado.eventoSel === "todos"
    ? estado.eventos
    : estado.eventos.filter(e => e.id === estado.eventoSel);
}

export function contar(entradas) {
  const c = { reservada: 0, vendida: 0, utilizada: 0, anulada: 0, vencida: 0, cancelada: 0 };
  for (const e of entradas) if (e.estado in c) c[e.estado]++;
  return c;
}

export function ventasPorVendedor(entradas) {
  const m = new Map();
  for (const e of entradas) {
    const r = m.get(e.vendedorId) || { vendidas: 0, utilizadas: 0, reservadas: 0, recaudado: 0,
      comision: 0, nombre: e.vendedorNombre, codigo: e.vendedorCodigo };
    if (e.estado === "vendida" || e.estado === "utilizada") {
      r.vendidas++; r.recaudado += e.precio || 0; r.comision += comisionDe(e);
    }
    if (e.estado === "utilizada") r.utilizadas++;
    if (e.estado === "reservada") r.reservadas++;
    m.set(e.vendedorId, r);
  }
  return m;
}

export function renderResumen(estado) {
  const evs = eventosSeleccionados(estado);
  const limite = evs.reduce((s, e) => s + (e.limite || 0), 0);
  // Los contadores del evento son la fuente de verdad del stock.
  const vendidasEv = evs.reduce((s, e) => s + (e.vendidas || 0), 0);
  const reservadasEv = evs.reduce((s, e) => s + (e.reservadas || 0), 0);
  const disp = Math.max(0, limite - vendidasEv - reservadasEv);
  const c = contar(estado.entradas);
  const ocup = limite ? Math.round((vendidasEv / limite) * 100) : 0;

  $("#stats").innerHTML = `
    <div class="stat"><div class="k">Total entradas</div><div class="v">${limite}</div></div>
    <div class="stat ok"><div class="k">Vendidas</div><div class="v">${vendidasEv}</div></div>
    <div class="stat warn"><div class="k">Reservadas</div><div class="v">${reservadasEv}</div></div>
    <div class="stat info"><div class="k">Utilizadas</div><div class="v">${c.utilizada}</div></div>
    <div class="stat"><div class="k">Disponibles</div><div class="v">${disp}</div></div>
    <div class="stat bad"><div class="k">Anuladas</div><div class="v">${c.anulada}</div></div>
    <div class="stat"><div class="k">Ocupación</div><div class="v">${ocup}%</div></div>`;

  const pct = n => limite ? (n / limite) * 100 : 0;
  $("#barra-ocupacion").innerHTML = `
    <span style="width:${pct(vendidasEv - c.utilizada)}%;background:var(--ok)"></span>
    <span style="width:${pct(c.utilizada)}%;background:var(--info)"></span>
    <span style="width:${pct(reservadasEv)}%;background:var(--warn)"></span>`;

  const ranking = [...ventasPorVendedor(estado.entradas).values()].sort((a, b) => b.vendidas - a.vendidas);
  $("#tabla-ranking").innerHTML = ranking.length ? ranking.map(r => `
    <tr><td>${esc(r.nombre)}</td><td class="mono">${esc(r.codigo)}</td><td>${r.vendidas}</td>
    <td>${r.utilizadas}</td><td>${r.reservadas}</td><td class="hide-sm">${fmtMoneda(r.recaudado)}</td>
    <td>${fmtMoneda(r.comision)}</td><td class="hide-sm">${fmtMoneda(r.recaudado - r.comision)}</td></tr>`).join("")
    : `<tr><td colspan="8" class="empty">Sin ventas.</td></tr>`;
}

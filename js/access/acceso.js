// Panel de control de acceso: escaneo de QR y registro de ingresos.
import { db } from "../firebase/init.js";
import { collection, query, where, onSnapshot } from "../firebase/sdk.js";
import { requerirRol, cerrarSesion } from "../auth/session.js";
import { $, esc, toast, mensajeError, fmtFecha, fmtMoneda, aFecha } from "../common/ui.js";
import { validarIngreso } from "../services/entradas.js";
import { Escaner, senal } from "./scanner.js";

const { perfil } = await requerirRol(["acceso"]);
const CLAVE_EVENTO = "saen.acceso.evento";

let eventos = [];
let eventoSel = null;
let escaner = null;
let offIngresos = null;

$("#user-chip").textContent = perfil.nombre;
$("#btn-salir").onclick = async () => { await escaner?.detener(); cerrarSesion(); };

// ---------------- Selección de evento ----------------
onSnapshot(
  query(collection(db, "eventos"), where("estado", "==", "activo")),
  snap => {
    eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => aFecha(a.fecha) - aFecha(b.fecha));
    let guardado = null;
    try { guardado = localStorage.getItem(CLAVE_EVENTO); } catch {}
    const sel = $("#evento");
    const previo = sel.value || guardado;
    sel.innerHTML = eventos.length
      ? eventos.map(e => `<option value="${e.id}">${esc(e.nombre)} — ${fmtFecha(e.fecha)}</option>`).join("")
      : `<option value="">No hay eventos activos</option>`;
    if (previo && eventos.some(e => e.id === previo)) sel.value = previo;
    $("#btn-comenzar").disabled = !eventos.length;
    if (eventoSel) {
      const act = eventos.find(e => e.id === eventoSel.id);
      if (act) eventoSel = act;
    }
  },
  e => toast(mensajeError(e), "bad")
);

$("#btn-comenzar").onclick = async () => {
  eventoSel = eventos.find(e => e.id === $("#evento").value);
  if (!eventoSel) return;
  try { localStorage.setItem(CLAVE_EVENTO, eventoSel.id); } catch {}
  $("#evento-actual").textContent = eventoSel.nombre;
  $("#paso-evento").classList.add("hidden");
  $("#paso-escaner").classList.remove("hidden");
  escucharIngresos();
  await arrancarCamara();
};

$("#btn-cambiar").onclick = async () => {
  await escaner?.detener();
  offIngresos?.();
  $("#paso-escaner").classList.add("hidden");
  $("#paso-evento").classList.remove("hidden");
};

async function arrancarCamara() {
  try {
    if (!window.Html5Qrcode) throw new Error("No se cargó la librería del escáner.");
    escaner ||= new Escaner("lector", procesar);
    await escaner.iniciar();
    $("#estado-camara").textContent = "Apuntá la cámara al código QR.";
    $("#btn-reanudar").classList.add("hidden");
  } catch (e) {
    console.error(e);
    $("#estado-camara").textContent =
      "No se pudo acceder a la cámara. Verificá los permisos del navegador (la página debe abrirse con https).";
    $("#btn-reanudar").textContent = "Reintentar cámara";
    $("#btn-reanudar").classList.remove("hidden");
    $("#btn-reanudar").onclick = arrancarCamara;
  }
}

// ---------------- Procesamiento del QR ----------------
async function procesar(texto) {
  mostrarProcesando();
  try {
    const { resultado, entrada } = await validarIngreso({
      token: texto, eventoId: eventoSel.id, perfil
    });
    mostrarResultado(resultado, entrada);
  } catch (e) {
    console.error(e);
    mostrarResultado("error", null, mensajeError(e));
  }
}

function mostrarProcesando() {
  const r = $("#resultado");
  r.className = "resultado r-gray";
  r.innerHTML = `<div class="icono">⏳</div><div class="titulo">Verificando…</div>`;
}

const fila = (k, v, grande = false) =>
  `<div class="dato${grande ? " grande" : ""}"><span>${esc(k)}</span><span>${esc(v ?? "—")}</span></div>`;

function bloqueComprador(en) {
  return `<h4>Comprador</h4>${fila("Nombre", en.compradorNombre, true)}${fila("DNI", en.compradorDni, true)}`;
}
function bloqueVendedor(en) {
  return `<h4>Vendedor</h4>${fila("Nombre", en.vendedorNombre)}${fila("Código", en.vendedorCodigo || en.vendedorId)}`;
}
function bloqueEntrada(en) {
  return `<h4>Entrada</h4>${fila("Código", en.codigo)}${fila("Evento", en.eventoNombre)}` +
    `${fila("Precio", fmtMoneda(en.precio))}${fila("Fecha de venta", fmtFecha(en.fechaVenta || en.fechaCreacion))}` +
    `${fila("Estado", (en.estado || "").toUpperCase())}`;
}

function mostrarResultado(resultado, en, detalle = "") {
  const r = $("#resultado");
  let cls, icono, titulo, sub, cuerpo = "";

  switch (resultado) {
    case "valida":
      cls = "r-ok"; icono = "✅"; titulo = "ACCESO AUTORIZADO"; sub = "ENTRADA VÁLIDA";
      cuerpo = bloqueComprador(en) + bloqueVendedor(en) + bloqueEntrada(en);
      break;
    case "utilizada":
      cls = "r-bad"; icono = "⛔"; titulo = "ENTRADA YA UTILIZADA"; sub = "ACCESO DENEGADO";
      cuerpo = bloqueComprador(en) + bloqueVendedor(en) +
        `<h4>Primer ingreso</h4>${fila("Fecha y hora", fmtFecha(en.fechaIngreso), true)}` +
        `${fila("Controlador", en.controladorNombre)}${fila("ID controlador", en.controladorId)}` +
        `<h4>Entrada</h4>${fila("Código", en.codigo)}${fila("Evento", en.eventoNombre)}`;
      break;
    case "no_confirmada":
      cls = "r-warn"; icono = "⚠️"; titulo = "ENTRADA NO CONFIRMADA"; sub = "ACCESO DENEGADO";
      cuerpo = `<p style="text-align:center">El vendedor no confirmó el cobro (${esc(en.estado)}).</p>` +
        bloqueComprador(en) + bloqueVendedor(en) + bloqueEntrada(en);
      break;
    case "anulada":
      cls = "r-bad"; icono = "🚫"; titulo = "ENTRADA ANULADA"; sub = "ACCESO DENEGADO";
      cuerpo = bloqueComprador(en) + bloqueVendedor(en) + bloqueEntrada(en) +
        (en.motivoAnulacion ? `<h4>Motivo</h4><p>${esc(en.motivoAnulacion)}</p>` : "");
      break;
    case "otro_evento":
      cls = "r-bad"; icono = "🚫"; titulo = "ENTRADA DE OTRO EVENTO"; sub = "ACCESO DENEGADO";
      cuerpo = `<p style="text-align:center">Esta entrada es para <strong>${esc(en.eventoNombre)}</strong>.</p>` +
        bloqueComprador(en) + bloqueVendedor(en);
      break;
    case "error":
      cls = "r-gray"; icono = "📡"; titulo = "NO SE PUDO VERIFICAR"; sub = "NO DEJAR PASAR TODAVÍA";
      cuerpo = `<p style="text-align:center">${esc(detalle)}</p>
        <p style="text-align:center">No se registró ningún ingreso. Revisá la conexión y escaneá de nuevo.</p>`;
      break;
    default:
      cls = "r-bad"; icono = "❌"; titulo = "ENTRADA INVÁLIDA"; sub = "ACCESO DENEGADO";
      cuerpo = `<p style="text-align:center">El código no corresponde a ninguna entrada del sistema.</p>`;
  }

  r.className = `resultado ${cls}`;
  r.innerHTML = `
    <div class="icono">${icono}</div>
    <div class="titulo">${titulo}</div>
    <div class="subtitulo">${sub}</div>
    ${cuerpo ? `<div class="datos">${cuerpo}</div>` : ""}
    <button class="btn btn-xl btn-block" id="btn-siguiente">Escanear siguiente</button>`;
  senal(resultado === "valida");
  $("#btn-siguiente").onclick = cerrarResultado;
}

function cerrarResultado() {
  $("#resultado").className = "resultado hidden";
  escaner?.reanudar();
}

// ---------------- Historial propio ----------------
function escucharIngresos() {
  offIngresos?.();
  offIngresos = onSnapshot(
    query(collection(db, "ingresos"),
      where("controladorId", "==", perfil.uid),
      where("eventoId", "==", eventoSel.id)),
    snap => {
      const lista = snap.docs.map(d => d.data())
        .sort((a, b) => (aFecha(b.fechaHora) || 0) - (aFecha(a.fechaHora) || 0));
      $("#contador-ingresos").textContent = lista.length;
      $("#mis-ingresos").innerHTML = lista.slice(0, 15).map(i => `
        <li><strong>${esc(i.compradorNombre)}</strong> · DNI ${esc(i.compradorDni)}<br>
        <span class="muted small">${fmtFecha(i.fechaHora)} · ${esc(i.codigo)} · vend. ${esc(i.vendedorNombre)}</span></li>`
      ).join("") || `<li class="muted">Todavía no registraste ingresos.</li>`;
    },
    e => console.warn(e)
  );
}

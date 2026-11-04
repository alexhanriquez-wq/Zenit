// Vendedores, solicitudes de registro y personal de acceso.
import { db, auth } from "../firebase/init.js";
import { firebaseConfig } from "../firebase/config.js";
import {
  doc, updateDoc, setDoc, getDoc, getDocs, collection, query, where,
  serverTimestamp, sendPasswordResetEmail
} from "../firebase/sdk.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { $, esc, toast, mensajeError, setCargando, fmtFecha, fmtMoneda, normalizar } from "../common/ui.js";
import { generarCodigoVendedor } from "../common/tokens.js";
import { ventasPorVendedor } from "./resumen.js";
import { asignarCupo, extenderCupo, quitarCupo, idCupo, ErrorNegocio } from "../services/entradas.js";

let estadoRef;
let rolNuevo = "vendedor";
// Estado del diálogo de límite (independiente del selector de evento de arriba).
let cupoVendedor = null;  // vendedor
let cupoEventoId = null;  // evento elegido en el diálogo
let cupoActual = null;    // documento de cupo leído, o null si no tiene límite
let cupoUsadas = 0;       // entradas que ya ocupan cupo en ese evento

// Lee de Firestore el cupo y las entradas del vendedor en el evento elegido.
async function cargarCupo() {
  const u = cupoVendedor;
  cupoEventoId = $("#cupo-evento").value;
  const ev = estadoRef.eventos.find(e => e.id === cupoEventoId);
  $("#cupo-info").textContent = "Cargando…";
  $("#cupo-guardar").disabled = true;
  try {
    const [snapCupo, snapEnt] = await Promise.all([
      getDoc(doc(db, "cupos", idCupo(cupoEventoId, u.uid))),
      getDocs(query(collection(db, "entradas"),
        where("eventoId", "==", cupoEventoId), where("vendedorId", "==", u.uid)))
    ]);
    cupoActual = snapCupo.exists() ? snapCupo.data() : null;
    cupoUsadas = snapEnt.docs.filter(d => ["reservada", "vendida", "utilizada"].includes(d.data().estado)).length;
  } catch (e) {
    $("#cupo-info").textContent = mensajeError(e);
    return;
  }
  const cupo = cupoActual;
  $("#form-cupo").reset();
  $("#cupo-evento").value = cupoEventoId;
  $("#cupo-info").innerHTML = cupo
    ? `<strong>${esc(u.nombre)}</strong> lleva <strong>${cupo.usadas}</strong> de <strong>${cupo.limite}</strong> entradas en "${esc(ev?.nombre)}".` +
      (cupo.usadas >= cupo.limite ? ` <span style="color:#fca5a5">Límite alcanzado.</span>` : "")
    : `<strong>${esc(u.nombre)}</strong> no tiene límite en "${esc(ev?.nombre)}" (puede vender hasta agotar el evento). Ya vendió o reservó <strong>${cupoUsadas}</strong>.`;
  $("#cupo-nuevo").classList.toggle("hidden", !!cupo);
  $("#cupo-extender").classList.toggle("hidden", !cupo);
  $("#cupo-quitar").classList.toggle("hidden", !cupo);
  $("#cupo-guardar").disabled = false;
}

function abrirCupo(u) {
  const evs = estadoRef.eventos;
  if (!evs.length) return toast("Primero creá un evento (pestaña Eventos).", "bad");
  cupoVendedor = u;
  // Evento por defecto: el elegido arriba, si no el primero activo.
  const pre = evs.find(e => e.id === estadoRef.eventoSel) || evs.find(e => e.estado === "activo") || evs[0];
  $("#cupo-evento").innerHTML = evs.map(e =>
    `<option value="${e.id}">${esc(e.nombre)} — ${fmtFecha(e.fecha, false)}</option>`).join("");
  $("#cupo-evento").value = pre.id;
  $("#dlg-cupo").showModal();
  cargarCupo();
}

async function guardarCupo(sumar) {
  const u = cupoVendedor;
  const eventoId = cupoEventoId;
  const cupo = cupoActual;
  const btn = $("#cupo-guardar");
  setCargando(btn, true, "Guardando…");
  try {
    if (cupo) {
      const n = sumar ?? parseInt($("#cupo-sumar").value, 10);
      if (!(n > 0)) return toast("Indicá cuántas entradas sumar.", "bad");
      const nuevo = await extenderCupo(eventoId, u.uid, n);
      toast(`Límite de ${u.nombre} extendido a ${nuevo}.`, "ok");
    } else {
      const limite = parseInt($("#cupo-limite").value, 10);
      if (!(limite >= 0)) return toast("Indicá un límite válido.", "bad");
      const usadas = cupoUsadas;
      if (limite < usadas && !confirm(`${u.nombre} ya tiene ${usadas} entradas. Con un límite de ${limite} no podrá vender más. ¿Continuar?`)) return;
      await asignarCupo({ eventoId, vendedor: u, limite, usadas });
      toast(`Límite de ${limite} entradas asignado a ${u.nombre}.`, "ok");
    }
    await cargarCupo(); // muestra el resultado actualizado en el diálogo
  } catch (e) {
    toast(e instanceof ErrorNegocio ? e.message : mensajeError(e), "bad");
  } finally { setCargando(btn, false); }
}

function etiquetaEstado(u) {
  if (u.estado === "pendiente") return `<span class="badge b-warn">Pendiente</span>`;
  if (u.estado === "rechazado") return `<span class="badge b-bad">Rechazado</span>`;
  return u.activo ? `<span class="badge b-ok">Activo</span>` : `<span class="badge b-mute">Inactivo</span>`;
}

export function renderUsuarios(estado) {
  const yo = estado.perfil.uid;
  const stats = ventasPorVendedor(estado.entradas);

  // ---- Vendedores aprobados / inactivos
  const q = normalizar($("#ven-buscar").value);
  const vendedores = estado.usuarios
    .filter(u => u.rol === "vendedor" && u.estado === "aprobado")
    .filter(u => !q || normalizar(`${u.nombre} ${u.email} ${u.codigo}`).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const hayEvento = estado.eventoSel && estado.eventoSel !== "todos";
  const ev = hayEvento ? estado.eventos.find(e => e.id === estado.eventoSel) : null;
  $("#ven-ayuda").textContent = hayEvento
    ? `Límites de venta para "${ev?.nombre ?? ""}". Sin límite asignado, el vendedor puede vender hasta agotar el evento.`
    : "Para ver los límites en la tabla, elegí un evento arriba. Con el botón \"Límite de ventas\" podés asignarlos igual eligiendo el evento.";

  $("#tabla-vendedores").innerHTML = vendedores.length ? vendedores.map(u => {
    const s = stats.get(u.uid) || { vendidas: 0, utilizadas: 0, comision: 0 };
    const cupo = estado.cupos.find(c => c.vendedorId === u.uid);
    let celdaCupo = `<span class="muted small">—</span>`;
    if (hayEvento) {
      celdaCupo = cupo
        ? `<span class="badge ${cupo.usadas >= cupo.limite ? "b-bad" : "b-ok"}">${cupo.usadas} / ${cupo.limite}</span>
           ${cupo.usadas >= cupo.limite ? `<div class="small" style="color:#fca5a5">Límite alcanzado</div>` : ""}`
        : `<span class="muted small">Sin límite</span>`;
    }
    return `<tr>
      <td>${esc(u.nombre)}</td><td class="mono">${esc(u.codigo || "—")}</td>
      <td class="hide-sm small">${esc(u.email)}</td><td>${etiquetaEstado(u)}</td>
      <td>${s.vendidas}</td><td>${s.utilizadas}</td>
      <td>${celdaCupo}</td>
      <td class="hide-sm">${fmtMoneda(s.comision)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-primary" data-cupo="${u.uid}">${hayEvento && cupo ? "Extender límite" : "Límite de ventas"}</button>
        <button class="btn btn-sm ${u.activo ? "btn-bad" : "btn-ok"}" data-toggle="${u.uid}">
        ${u.activo ? "Desactivar" : "Activar"}</button></td></tr>`;
  }).join("") : `<tr><td colspan="9" class="empty">No hay vendedores aprobados.</td></tr>`;

  // ---- Solicitudes
  const solicitudes = estado.usuarios.filter(u => u.rol === "vendedor" && u.estado !== "aprobado")
    .sort((a, b) => (a.estado === "pendiente" ? -1 : 1) - (b.estado === "pendiente" ? -1 : 1));
  const pendientes = solicitudes.filter(u => u.estado === "pendiente").length;
  $("#cnt-solicitudes").textContent = pendientes;
  $("#tabla-solicitudes").innerHTML = solicitudes.length ? solicitudes.map(u => `
    <tr><td>${esc(u.nombre)}</td><td class="small">${esc(u.email)}</td>
    <td class="hide-sm small">${fmtFecha(u.fechaRegistro)}</td><td>${etiquetaEstado(u)}</td>
    <td class="actions">
      <button class="btn btn-sm btn-ok" data-aprobar="${u.uid}">Aprobar</button>
      ${u.estado === "pendiente" ? `<button class="btn btn-sm btn-bad" data-rechazar="${u.uid}">Rechazar</button>` : ""}
    </td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No hay solicitudes.</td></tr>`;

  // ---- Personal de acceso
  const porControlador = new Map();
  for (const i of estado.ingresos) porControlador.set(i.controladorId, (porControlador.get(i.controladorId) || 0) + 1);
  const personal = estado.usuarios.filter(u => u.rol === "acceso").sort((a, b) => a.nombre.localeCompare(b.nombre));
  $("#tabla-personal").innerHTML = personal.length ? personal.map(u => `
    <tr><td>${esc(u.nombre)}</td><td class="hide-sm small">${esc(u.email)}</td><td>${etiquetaEstado(u)}</td>
    <td>${porControlador.get(u.uid) || 0}</td>
    <td class="actions">${u.uid === yo ? "" : `<button class="btn btn-sm ${u.activo ? "btn-bad" : "btn-ok"}" data-toggle="${u.uid}">
      ${u.activo ? "Desactivar" : "Activar"}</button>`}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No hay personal registrado.</td></tr>`;
}

// Las reglas exigen enviar el documento completo de usuario.
function datosCompletos(u, cambios) {
  return {
    nombre: u.nombre, email: u.email, rol: u.rol, estado: u.estado, activo: u.activo,
    codigo: u.codigo ?? null, fechaRegistro: u.fechaRegistro, ...cambios
  };
}

async function actualizar(uid, cambios, msg) {
  const u = estadoRef.usuarios.find(x => x.uid === uid);
  if (!u) return;
  try {
    await updateDoc(doc(db, "usuarios", uid), datosCompletos(u, cambios));
    toast(msg, "ok");
  } catch (e) { toast(mensajeError(e), "bad"); }
}

function codigoUnico() {
  const usados = new Set(estadoRef.usuarios.map(u => u.codigo).filter(Boolean));
  let c;
  do { c = generarCodigoVendedor(); } while (usados.has(c));
  return c;
}

/**
 * Crea una cuenta de Firebase Auth sin cerrar la sesión del administrador,
 * usando una segunda instancia de la app (funciona en el plan Spark).
 */
async function crearCuenta({ nombre, email, pass, rol }) {
  const sec = initializeApp(firebaseConfig, `alta-${Date.now()}`);
  try {
    const secAuth = getAuth(sec);
    const clave = pass || (crypto.randomUUID() + "Aa1!");
    const cred = await createUserWithEmailAndPassword(secAuth, email, clave);
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nombre, email: cred.user.email, rol,
      estado: "aprobado", activo: true,
      codigo: rol === "vendedor" ? codigoUnico() : null,
      fechaRegistro: serverTimestamp()
    });
    await signOut(secAuth);
    // El usuario define su propia contraseña desde el email.
    await sendPasswordResetEmail(auth, email).catch(() => {});
    return cred.user.uid;
  } finally {
    await deleteApp(sec).catch(() => {});
  }
}

export function initUsuarios(estado) {
  estadoRef = estado;
  $("#ven-buscar").addEventListener("input", () => renderUsuarios(estadoRef));

  document.body.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.cupo) {
      const u = estadoRef.usuarios.find(x => x.uid === b.dataset.cupo);
      if (u) abrirCupo(u);
    } else if (b.dataset.sumar) {
      guardarCupo(parseInt(b.dataset.sumar, 10));
    } else if (b.dataset.toggle) {
      const u = estadoRef.usuarios.find(x => x.uid === b.dataset.toggle);
      if (!u) return;
      if (u.activo && !confirm(`¿Desactivar a ${u.nombre}? No podrá operar hasta que lo reactives.`)) return;
      actualizar(u.uid, { activo: !u.activo }, u.activo ? "Usuario desactivado." : "Usuario activado.");
    } else if (b.dataset.aprobar) {
      const u = estadoRef.usuarios.find(x => x.uid === b.dataset.aprobar);
      actualizar(u.uid, { estado: "aprobado", activo: true, codigo: u.codigo || codigoUnico() },
        `${u.nombre} aprobado como vendedor.`);
    } else if (b.dataset.rechazar) {
      const u = estadoRef.usuarios.find(x => x.uid === b.dataset.rechazar);
      if (confirm(`¿Rechazar la solicitud de ${u.nombre}?`))
        actualizar(u.uid, { estado: "rechazado", activo: false }, "Solicitud rechazada.");
    } else if (b.dataset.nuevoUsuario) {
      rolNuevo = b.dataset.nuevoUsuario;
      $("#dlg-usuario-titulo").textContent = rolNuevo === "vendedor" ? "Registrar vendedor" : "Registrar personal de acceso";
      $("#form-usuario").reset();
      $("#dlg-usuario").showModal();
    }
  });

  $("#cupo-cancelar").onclick = () => $("#dlg-cupo").close();
  $("#cupo-evento").addEventListener("change", cargarCupo);
  $("#form-cupo").addEventListener("submit", ev => { ev.preventDefault(); guardarCupo(); });
  $("#cupo-quitar").onclick = async () => {
    const u = cupoVendedor;
    if (!confirm(`¿Quitar el límite de ${u.nombre}? Podrá vender hasta agotar el evento.`)) return;
    try {
      await quitarCupo(cupoEventoId, u.uid);
      toast("Límite quitado.", "ok");
      await cargarCupo();
    } catch (e) { toast(mensajeError(e), "bad"); }
  };

  $("#us-cancelar").onclick = () => $("#dlg-usuario").close();
  $("#form-usuario").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nombre = $("#us-nombre").value.trim().replace(/\s+/g, " ");
    const email = $("#us-email").value.trim();
    const pass = $("#us-pass").value;
    if (nombre.length < 3) return toast("Nombre inválido.", "bad");
    if (!email.includes("@")) return toast("Email inválido.", "bad");
    if (pass && pass.length < 8) return toast("La contraseña debe tener al menos 8 caracteres.", "bad");
    const btn = $("#us-guardar");
    setCargando(btn, true, "Registrando…");
    try {
      await crearCuenta({ nombre, email, pass, rol: rolNuevo });
      $("#dlg-usuario").close();
      toast(`Usuario creado. Se envió un email a ${email} para definir la contraseña.`, "ok");
    } catch (e) {
      toast(mensajeError(e), "bad");
    } finally { setCargando(btn, false); }
  });
}

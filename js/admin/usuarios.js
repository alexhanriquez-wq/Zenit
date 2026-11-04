// Vendedores, solicitudes de registro y personal de acceso.
import { db, auth } from "../firebase/init.js";
import { firebaseConfig } from "../firebase/config.js";
import { doc, updateDoc, setDoc, serverTimestamp, sendPasswordResetEmail } from "../firebase/sdk.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { $, esc, toast, mensajeError, setCargando, fmtFecha, normalizar } from "../common/ui.js";
import { generarCodigoVendedor } from "../common/tokens.js";
import { ventasPorVendedor } from "./resumen.js";

let estadoRef;
let rolNuevo = "vendedor";

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
  $("#tabla-vendedores").innerHTML = vendedores.length ? vendedores.map(u => {
    const s = stats.get(u.uid) || { vendidas: 0, utilizadas: 0 };
    return `<tr>
      <td>${esc(u.nombre)}</td><td class="mono">${esc(u.codigo || "—")}</td>
      <td class="hide-sm small">${esc(u.email)}</td><td>${etiquetaEstado(u)}</td>
      <td>${s.vendidas}</td><td>${s.utilizadas}</td>
      <td class="actions"><button class="btn btn-sm ${u.activo ? "btn-bad" : "btn-ok"}" data-toggle="${u.uid}">
        ${u.activo ? "Desactivar" : "Activar"}</button></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty">No hay vendedores aprobados.</td></tr>`;

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
    if (b.dataset.toggle) {
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

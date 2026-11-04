import { auth, configurado } from "../firebase/init.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "../firebase/sdk.js";
import { $, toast, mensajeError, setCargando, avisoNoConfigurado } from "../common/ui.js";
import { esperarUsuario, leerPerfil, perfilHabilitado, PANEL_POR_ROL } from "./session.js";

if (!configurado) {
  avisoNoConfigurado();
} else {
  iniciar();
}

function mostrarAviso(html, tipo = "warn") {
  const el = $("#aviso");
  el.className = `alert alert-${tipo}`;
  el.innerHTML = html;
}

async function enrutar(user) {
  const p = await leerPerfil(user.uid);
  if (!p) {
    mostrarAviso("Tu cuenta no tiene perfil asignado. Contactá al administrador.", "bad");
  } else if (perfilHabilitado(p) && PANEL_POR_ROL[p.rol]) {
    location.replace(PANEL_POR_ROL[p.rol]);
    return;
  } else if (p.estado === "pendiente") {
    mostrarAviso("<strong>Registro pendiente.</strong> Un administrador debe aprobar tu cuenta antes de que puedas vender.");
  } else if (p.estado === "rechazado") {
    mostrarAviso("Tu solicitud de registro fue rechazada.", "bad");
  } else {
    mostrarAviso("Tu cuenta está desactivada. Contactá al administrador.", "bad");
  }
  $("#form-login").classList.add("hidden");
  $("#pendiente").classList.remove("hidden");
}

async function iniciar() {
  const user = await esperarUsuario();
  if (user) await enrutar(user).catch(e => mostrarAviso(mensajeError(e), "bad"));

  $("#form-login").addEventListener("submit", async ev => {
    ev.preventDefault();
    const btn = $("#btn-login");
    setCargando(btn, true, "Ingresando…");
    try {
      const cred = await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#password").value);
      await enrutar(cred.user);
    } catch (e) {
      toast(mensajeError(e), "bad");
    } finally {
      setCargando(btn, false);
    }
  });

  $("#btn-salir").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("login.html");
  });

  $("#link-reset").addEventListener("click", async ev => {
    ev.preventDefault();
    const email = $("#email").value.trim();
    if (!email) return toast("Escribí tu email arriba y volvé a tocar el enlace.");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Si el email existe, te enviamos un enlace para restablecer la contraseña.", "ok");
    } catch (e) { toast(mensajeError(e), "bad"); }
  });
}

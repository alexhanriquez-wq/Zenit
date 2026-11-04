// Control de sesión y de rol para cada página protegida.
// IMPORTANTE: esta verificación es solo de navegación/UX. La seguridad
// real la aplican las reglas de Firestore en el servidor.
import { auth, db, configurado } from "../firebase/init.js";
import { onAuthStateChanged, signOut, doc, getDoc } from "../firebase/sdk.js";
import { avisoNoConfigurado } from "../common/ui.js";

export const PANEL_POR_ROL = {
  admin: "admin.html",
  vendedor: "vendedor.html",
  acceso: "acceso.html"
};

export function esperarUsuario() {
  return new Promise(resolve => {
    const off = onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
}

export async function leerPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

export function perfilHabilitado(p) {
  return !!p && p.activo === true && p.estado === "aprobado";
}

/**
 * Exige sesión iniciada con uno de los roles indicados.
 * Si no corresponde, redirige. Devuelve { user, perfil }.
 */
export async function requerirRol(roles) {
  if (!configurado) { avisoNoConfigurado(); throw new Error("no-config"); }
  const user = await esperarUsuario();
  if (!user) { location.replace("login.html"); throw new Error("sin-sesion"); }

  let perfil;
  try {
    perfil = await leerPerfil(user.uid);
  } catch (e) {
    const l = document.querySelector(".loader");
    if (l) l.textContent = "No se pudo cargar tu perfil. Revisá la conexión y recargá la página.";
    throw e;
  }
  if (!perfil || !perfilHabilitado(perfil)) {
    location.replace("login.html?estado=pendiente");
    throw new Error("no-habilitado");
  }
  if (!roles.includes(perfil.rol)) {
    location.replace(PANEL_POR_ROL[perfil.rol] || "login.html");
    throw new Error("rol-incorrecto");
  }
  document.body.classList.remove("cargando");
  return { user, perfil };
}

export async function cerrarSesion() {
  await signOut(auth);
  location.replace("login.html");
}

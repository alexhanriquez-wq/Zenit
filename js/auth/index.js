// Página de inicio: si ya hay sesión habilitada, lleva al panel del rol.
import { configurado } from "../firebase/init.js";
import { esperarUsuario, leerPerfil, perfilHabilitado, PANEL_POR_ROL } from "./session.js";

if (configurado) {
  const user = await esperarUsuario();
  if (user) {
    try {
      const p = await leerPerfil(user.uid);
      if (perfilHabilitado(p) && PANEL_POR_ROL[p.rol]) location.replace(PANEL_POR_ROL[p.rol]);
    } catch { /* se queda en el inicio */ }
  }
}

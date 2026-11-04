// Auto-registro de vendedores. Las reglas solo permiten crear el perfil
// propio con rol "vendedor", estado "pendiente" y activo = false.
import { auth, db, configurado } from "../firebase/init.js";
import {
  createUserWithEmailAndPassword, updateProfile, signOut,
  doc, setDoc, serverTimestamp
} from "../firebase/sdk.js";
import { $, toast, mensajeError, setCargando, avisoNoConfigurado } from "../common/ui.js";

if (!configurado) avisoNoConfigurado();
else $("#form-registro").addEventListener("submit", registrar);

async function registrar(ev) {
  ev.preventDefault();
  const nombre = $("#nombre").value.trim().replace(/\s+/g, " ");
  const email = $("#email").value.trim();
  const pass = $("#password").value;

  if (nombre.length < 3) return toast("Ingresá tu nombre completo.", "bad");
  if (pass.length < 8) return toast("La contraseña debe tener al menos 8 caracteres.", "bad");

  const btn = $("#btn-registro");
  setCargando(btn, true, "Registrando…");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: nombre });
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nombre,
      email: cred.user.email,
      rol: "vendedor",
      estado: "pendiente",
      activo: false,
      codigo: null,
      fechaRegistro: serverTimestamp()
    });
    await signOut(auth);
    $("#form-registro").classList.add("hidden");
    $("#listo").classList.remove("hidden");
  } catch (e) {
    toast(mensajeError(e), "bad");
  } finally {
    setCargando(btn, false);
  }
}

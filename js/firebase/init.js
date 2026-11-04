// Inicialización única de Firebase. Todos los módulos importan desde acá.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

// Si la configuración no fue completada no se inicializa nada:
// la interfaz muestra un aviso en lugar de simular datos.
export const configurado =
  !!firebaseConfig.projectId && !String(firebaseConfig.projectId).includes("REEMPLAZAR");

export const app = configurado ? initializeApp(firebaseConfig) : null;
export const auth = configurado ? getAuth(app) : null;
export const db = configurado ? getFirestore(app) : null;

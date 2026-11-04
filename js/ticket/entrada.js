// Muestra la entrada a partir del fragmento de la URL (#d=...).
// No consulta Firestore: el fragmento nunca llega al servidor y no hace
// falta abrir lecturas públicas en la base. Los datos mostrados acá son
// informativos; la puerta valida el token contra Firestore.
import { $ } from "../common/ui.js";
import { leerFragmento } from "../common/ticket.js";
import { renderTicket } from "../common/ticket-view.js";

function mostrar() {
  const d = leerFragmento(location.hash);
  if (!d) {
    $("#ticket-cont").innerHTML = "";
    $("#error").classList.remove("hidden");
    return;
  }
  const entrada = {
    token: d.t,
    codigo: d.c,
    eventoNombre: d.e,
    eventoFecha: d.f,
    compradorNombre: d.n,
    vendedorNombre: d.v
  };
  renderTicket($("#ticket-cont"), entrada, { acciones: true });
}

// La librería QR se carga con defer: esperar a que esté disponible.
if (window.qrcode) mostrar();
else window.addEventListener("load", mostrar);
window.addEventListener("hashchange", mostrar);

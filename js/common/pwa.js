// Instalación de la app (PWA): registra el service worker y muestra el
// botón "Instalar app" cuando el navegador lo permite.

const yaInstalada =
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(e => console.warn("SW no registrado", e));
  });
}

// Botón: usa #btn-instalar si la página lo tiene; si no, lo agrega a la barra superior.
function obtenerBoton() {
  let btn = document.getElementById("btn-instalar");
  if (btn) return btn;
  const barra = document.querySelector(".topbar");
  if (!barra) return null;
  btn = document.createElement("button");
  btn.id = "btn-instalar";
  btn.className = "btn btn-sm hidden";
  btn.textContent = "Instalar app";
  const salir = document.getElementById("btn-salir");
  barra.insertBefore(btn, salir || null);
  return btn;
}

let eventoInstalacion = null;

// Android / Chrome / Edge: el navegador avisa que la app se puede instalar.
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  eventoInstalacion = e;
  const btn = obtenerBoton();
  if (!btn) return;
  btn.classList.remove("hidden");
  btn.onclick = async () => {
    btn.classList.add("hidden");
    eventoInstalacion.prompt();
    await eventoInstalacion.userChoice.catch(() => {});
    eventoInstalacion = null;
  };
});

window.addEventListener("appinstalled", () => {
  document.getElementById("btn-instalar")?.classList.add("hidden");
});

// iPhone / iPad: Safari no tiene botón automático; se muestran instrucciones.
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (esIOS && !yaInstalada) {
  window.addEventListener("DOMContentLoaded", () => {
    const aviso = document.getElementById("aviso-ios");
    if (aviso) aviso.classList.remove("hidden");
  });
}

// =====================================================================
//  CONFIGURACIÓN
// ---------------------------------------------------------------------
//  Pegá acá la configuración web de tu proyecto Firebase
//  (Consola Firebase → Configuración del proyecto → Tus apps → Web).
//
//  Estos valores NO son secretos: identifican el proyecto y son
//  visibles en cualquier app web de Firebase. La protección real la dan
//  Firebase Authentication + las reglas de firestore.rules.
//  Nunca pongas acá claves de cuentas de servicio ni credenciales admin.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyD_RtaOlWqIqRU1RnR1ORHyqXxcGBmKyCI",
  authDomain: "zenit-entradas.firebaseapp.com",
  projectId: "zenit-entradas",
  storageBucket: "zenit-entradas.firebasestorage.app",
  messagingSenderId: "388162963625",
  appId: "1:388162963625:web:9b87e0eff509606fcac1b8"
};

// Ajustes de la aplicación (solo presentación / comportamiento del cliente).
export const APP = {
  nombre: "Zenit",
  // Prefijo del código visible de la entrada (2 a 5 letras mayúsculas).
  prefijoCodigo: "ZEN",
  // Moneda para mostrar precios.
  moneda: "ARS",
  locale: "es-AR",
  // Minutos que una entrada queda RESERVADA antes de vencer.
  // Las reglas aceptan como máximo 120.
  minutosReserva: 30,
  // Límite de entradas por defecto al crear un evento.
  limitePorDefecto: 200
};

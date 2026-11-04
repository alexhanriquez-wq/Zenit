// Generación de identificadores aleatorios con el CSPRNG del navegador
// (crypto.getRandomValues). Nunca se usan contadores ni Math.random.
import { APP } from "../firebase/config.js";

// Token secreto del QR: 160 bits en hexadecimal (40 caracteres).
// Es también el id del documento en /entradas.
export function generarToken() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export const TOKEN_REGEX = /^[a-f0-9]{40}$/;

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L).
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function aleatorio(n) {
  const out = [];
  const buf = new Uint8Array(n * 2);
  crypto.getRandomValues(buf);
  for (let i = 0; out.length < n && i < buf.length; i++) {
    // Rechazo para evitar sesgo de módulo (31 * 8 = 248).
    if (buf[i] < 248) out.push(ALFABETO[buf[i] % ALFABETO.length]);
  }
  while (out.length < n) out.push(aleatorio(1));
  return out.join("");
}

// Código legible de la entrada, p. ej. ZEN-8F29-KX71. Sirve para buscar y
// para leer en voz alta; NO es el secreto (el secreto es el token).
export function generarCodigo() {
  return `${APP.prefijoCodigo}-${aleatorio(4)}-${aleatorio(4)}`;
}

// Código de vendedor asignado por el administrador al aprobarlo.
export function generarCodigoVendedor() {
  return `V-${aleatorio(4)}`;
}

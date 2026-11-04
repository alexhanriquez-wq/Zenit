// =====================================================================
//  Operaciones atómicas sobre entradas y stock.
//  Cada función usa runTransaction: si dos dispositivos operan a la vez
//  sobre el mismo evento o entrada, Firestore reintenta la transacción
//  con los datos actualizados. Las reglas verifican en el servidor que
//  entrada y evento cambien juntos y de forma coherente.
// =====================================================================
import { db } from "../firebase/init.js";
import { APP } from "../firebase/config.js";
import {
  doc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp
} from "../firebase/sdk.js";
import { generarToken, generarCodigo, TOKEN_REGEX } from "../common/tokens.js";

export class ErrorNegocio extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const refEvento = id => doc(db, "eventos", id);
const refEntrada = id => doc(db, "entradas", id);
const refIngreso = id => doc(db, "ingresos", id);

export function disponibles(ev) {
  return Math.max(0, (ev.limite || 0) - (ev.vendidas || 0) - (ev.reservadas || 0));
}

// ---------------------------------------------------------------------
//  VENDEDOR: crear reserva
// ---------------------------------------------------------------------
export async function reservarEntrada({ perfil, eventoId, compradorNombre, compradorDni }) {
  const nombre = String(compradorNombre || "").trim().replace(/\s+/g, " ");
  const dni = String(compradorDni || "").replace(/\D/g, "");
  if (nombre.length < 3 || nombre.length > 80) throw new ErrorNegocio("datos", "Nombre del comprador inválido.");
  if (!/^[0-9]{6,10}$/.test(dni)) throw new ErrorNegocio("datos", "DNI inválido (solo números, 6 a 10 dígitos).");
  if (!perfil.codigo) throw new ErrorNegocio("perfil", "Tu cuenta no tiene código de vendedor asignado.");

  const token = generarToken();
  const codigo = generarCodigo();
  const minutos = Math.min(APP.minutosReserva, 120);

  return runTransaction(db, async tx => {
    const evSnap = await tx.get(refEvento(eventoId));
    if (!evSnap.exists()) throw new ErrorNegocio("evento", "El evento no existe.");
    const ev = evSnap.data();
    if (ev.estado !== "activo") throw new ErrorNegocio("evento", "El evento no está habilitado para la venta.");
    if (disponibles(ev) <= 0) throw new ErrorNegocio("agotado", "No quedan entradas disponibles para este evento.");

    const entrada = {
      token,
      codigo,
      eventoId,
      eventoNombre: ev.nombre,
      eventoFecha: ev.fecha,
      compradorNombre: nombre,
      compradorDni: dni,
      vendedorId: perfil.uid,
      vendedorNombre: perfil.nombre,
      vendedorCodigo: perfil.codigo,
      precio: ev.precio,
      estado: "reservada",
      ingresada: false,
      fechaCreacion: serverTimestamp(),
      venceEn: Timestamp.fromMillis(Date.now() + minutos * 60 * 1000),
      fechaVenta: null,
      fechaIngreso: null,
      controladorId: null,
      controladorNombre: null
    };
    tx.set(refEntrada(token), entrada);
    tx.update(refEvento(eventoId), {
      reservadas: ev.reservadas + 1,
      ultimaEntrada: token
    });
    return { id: token, ...entrada };
  });
}

// ---------------------------------------------------------------------
//  VENDEDOR: confirmar cobro (reservada -> vendida)
// ---------------------------------------------------------------------
export async function confirmarCobro(entradaId) {
  return runTransaction(db, async tx => {
    const enSnap = await tx.get(refEntrada(entradaId));
    if (!enSnap.exists()) throw new ErrorNegocio("entrada", "La entrada no existe.");
    const en = enSnap.data();
    if (en.estado !== "reservada") throw new ErrorNegocio("estado", `La entrada está ${en.estado}.`);
    if (en.venceEn.toMillis() < Date.now()) throw new ErrorNegocio("vencida", "La reserva venció. Generá una nueva entrada.");

    const evSnap = await tx.get(refEvento(en.eventoId));
    const ev = evSnap.data();
    tx.update(refEntrada(entradaId), { estado: "vendida", fechaVenta: serverTimestamp() });
    tx.update(refEvento(en.eventoId), {
      reservadas: ev.reservadas - 1,
      vendidas: ev.vendidas + 1,
      ultimaEntrada: entradaId
    });
  });
}

// ---------------------------------------------------------------------
//  VENDEDOR / ADMIN: liberar reserva (cancelada o vencida)
// ---------------------------------------------------------------------
export async function liberarReserva(entradaId, uid, motivo /* 'cancelada' | 'vencida' */) {
  return runTransaction(db, async tx => {
    const enSnap = await tx.get(refEntrada(entradaId));
    if (!enSnap.exists()) return false;
    const en = enSnap.data();
    if (en.estado !== "reservada") return false; // ya se resolvió por otro lado
    let estado = motivo === "vencida" ? "vencida" : "cancelada";
    if (estado === "vencida" && en.venceEn.toMillis() > Date.now()) return false;

    const evSnap = await tx.get(refEvento(en.eventoId));
    const ev = evSnap.data();
    tx.update(refEntrada(entradaId), {
      estado, fechaLiberacion: serverTimestamp(), liberadaPor: uid
    });
    tx.update(refEvento(en.eventoId), { reservadas: ev.reservadas - 1, ultimaEntrada: entradaId });
    return true;
  });
}

/**
 * Libera las reservas vencidas. Sin Cloud Functions no existe un proceso
 * automático en segundo plano: lo ejecutan los paneles al abrirse y
 * antes de cada venta. Si vendedorId se indica, solo las de ese vendedor.
 */
export async function liberarVencidas({ uid, vendedorId = null }) {
  const filtros = [where("estado", "==", "reservada")];
  if (vendedorId) filtros.unshift(where("vendedorId", "==", vendedorId));
  const snap = await getDocs(query(collection(db, "entradas"), ...filtros));
  const ahora = Date.now() - 5000; // margen por diferencia de reloj
  let liberadas = 0;
  for (const d of snap.docs) {
    if (d.data().venceEn?.toMillis() < ahora) {
      try { if (await liberarReserva(d.id, uid, "vencida")) liberadas++; }
      catch (e) { console.warn("No se pudo liberar", d.id, e); }
    }
  }
  return liberadas;
}

// ---------------------------------------------------------------------
//  ADMIN: anular entrada (reservada|vendida -> anulada) y devolver cupo
// ---------------------------------------------------------------------
export async function anularEntrada(entradaId, uid, motivo) {
  return runTransaction(db, async tx => {
    const enSnap = await tx.get(refEntrada(entradaId));
    if (!enSnap.exists()) throw new ErrorNegocio("entrada", "La entrada no existe.");
    const en = enSnap.data();
    if (!["reservada", "vendida"].includes(en.estado))
      throw new ErrorNegocio("estado", `No se puede anular una entrada ${en.estado}.`);
    const evSnap = await tx.get(refEvento(en.eventoId));
    const ev = evSnap.data();
    const cambiosEv = { ultimaEntrada: entradaId };
    if (en.estado === "reservada") cambiosEv.reservadas = ev.reservadas - 1;
    else cambiosEv.vendidas = ev.vendidas - 1;

    tx.update(refEntrada(entradaId), {
      estado: "anulada",
      fechaAnulacion: serverTimestamp(),
      anuladaPor: uid,
      motivoAnulacion: String(motivo || "").slice(0, 200)
    });
    tx.update(refEvento(en.eventoId), cambiosEv);
  });
}

// ---------------------------------------------------------------------
//  ACCESO: validar QR y registrar ingreso (vendida -> utilizada)
// ---------------------------------------------------------------------
/**
 * Devuelve { resultado, entrada } donde resultado es:
 *  'valida' | 'utilizada' | 'invalida' | 'no_confirmada' | 'anulada' |
 *  'otro_evento'
 * Si dos dispositivos escanean a la vez, la transacción del segundo se
 * reintenta, ve estado 'utilizada' y devuelve 'utilizada'.
 */
export async function validarIngreso({ token, eventoId, perfil }) {
  const t = String(token || "").trim().toLowerCase();
  if (!TOKEN_REGEX.test(t)) return { resultado: "invalida", entrada: null };

  return runTransaction(db, async tx => {
    const snap = await tx.get(refEntrada(t));
    if (!snap.exists()) return { resultado: "invalida", entrada: null };
    const en = { id: snap.id, ...snap.data() };

    if (en.eventoId !== eventoId) return { resultado: "otro_evento", entrada: en };
    if (en.estado === "utilizada" || en.ingresada) return { resultado: "utilizada", entrada: en };
    if (en.estado === "anulada") return { resultado: "anulada", entrada: en };
    if (en.estado === "reservada" || en.estado === "vencida" || en.estado === "cancelada")
      return { resultado: "no_confirmada", entrada: en };
    if (en.estado !== "vendida") return { resultado: "invalida", entrada: en };

    tx.update(refEntrada(t), {
      estado: "utilizada",
      ingresada: true,
      fechaIngreso: serverTimestamp(),
      controladorId: perfil.uid,
      controladorNombre: perfil.nombre
    });
    tx.set(refIngreso(t), {
      entradaId: t,
      eventoId: en.eventoId,
      codigo: en.codigo,
      compradorNombre: en.compradorNombre,
      compradorDni: en.compradorDni,
      vendedorId: en.vendedorId,
      vendedorNombre: en.vendedorNombre,
      controladorId: perfil.uid,
      controladorNombre: perfil.nombre,
      fechaHora: serverTimestamp()
    });
    return {
      resultado: "valida",
      entrada: { ...en, estado: "utilizada", ingresada: true, fechaIngreso: new Date(),
                 controladorId: perfil.uid, controladorNombre: perfil.nombre }
    };
  });
}

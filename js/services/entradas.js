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
  doc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp,
  setDoc, deleteDoc, updateDoc, writeBatch
} from "../firebase/sdk.js";
import { generarToken, generarCodigo, TOKEN_REGEX } from "../common/tokens.js";

export class ErrorNegocio extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const refEvento = id => doc(db, "eventos", id);
const refEntrada = id => doc(db, "entradas", id);
const refIngreso = id => doc(db, "ingresos", id);
export const idCupo = (eventoId, vendedorId) => `${eventoId}_${vendedorId}`;
const refCupo = (eventoId, vendedorId) => doc(db, "cupos", idCupo(eventoId, vendedorId));

export function disponibles(ev) {
  return Math.max(0, (ev.limite || 0) - (ev.vendidas || 0) - (ev.reservadas || 0));
}

// Comisión del vendedor por una entrada (solo vendidas o utilizadas).
// Usa el % guardado en la entrada al momento de la venta.
export function comisionDe(en) {
  if (en.estado !== "vendida" && en.estado !== "utilizada") return 0;
  return Math.round(((en.precio || 0) * (en.comision || 0)) / 100);
}

// Lee el cupo del vendedor dentro de una transacción y prepara su baja.
async function leerCupo(tx, eventoId, vendedorId) {
  const snap = await tx.get(refCupo(eventoId, vendedorId));
  return snap.exists() ? snap.data() : null;
}
function bajarCupo(tx, cupo, eventoId, vendedorId, entradaId) {
  if (cupo && cupo.usadas > 0)
    tx.update(refCupo(eventoId, vendedorId), { usadas: cupo.usadas - 1, ultimaEntrada: entradaId });
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

    const cupo = await leerCupo(tx, eventoId, perfil.uid);
    if (cupo && cupo.usadas >= cupo.limite)
      throw new ErrorNegocio("limite",
        `Alcanzaste tu límite de ${cupo.limite} entradas para este evento. Pedile al administrador que lo extienda.`);

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
      comision: ev.comision ?? 0,
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
    if (cupo) tx.update(refCupo(eventoId, perfil.uid), { usadas: cupo.usadas + 1, ultimaEntrada: token });
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
    const cupo = await leerCupo(tx, en.eventoId, en.vendedorId);
    tx.update(refEntrada(entradaId), {
      estado, fechaLiberacion: serverTimestamp(), liberadaPor: uid
    });
    tx.update(refEvento(en.eventoId), { reservadas: ev.reservadas - 1, ultimaEntrada: entradaId });
    bajarCupo(tx, cupo, en.eventoId, en.vendedorId, entradaId);
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
    const cupo = await leerCupo(tx, en.eventoId, en.vendedorId);
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
    bajarCupo(tx, cupo, en.eventoId, en.vendedorId, entradaId);
  });
}

// ---------------------------------------------------------------------
//  ADMIN: límites de venta por vendedor y por evento
// ---------------------------------------------------------------------
/** Asigna un límite nuevo. "usadas" arranca con lo que ya vendió/reservó. */
export async function asignarCupo({ eventoId, vendedor, limite, usadas }) {
  await setDoc(refCupo(eventoId, vendedor.uid), {
    vendedorId: vendedor.uid,
    eventoId,
    vendedorNombre: vendedor.nombre,
    limite,
    usadas,
    ultimaEntrada: null,
    actualizadoEn: serverTimestamp()
  });
}

/** Suma (o resta, con n negativo) entradas al límite actual. */
export async function extenderCupo(eventoId, vendedorId, n) {
  return runTransaction(db, async tx => {
    const snap = await tx.get(refCupo(eventoId, vendedorId));
    if (!snap.exists()) throw new ErrorNegocio("cupo", "El vendedor no tiene límite asignado.");
    const nuevo = Math.max(0, snap.data().limite + n);
    tx.update(refCupo(eventoId, vendedorId), { limite: nuevo, actualizadoEn: serverTimestamp() });
    return nuevo;
  });
}

export async function quitarCupo(eventoId, vendedorId) {
  await deleteDoc(refCupo(eventoId, vendedorId));
}

// ---------------------------------------------------------------------
//  ADMIN: borrar un evento con todas sus entradas, ingresos y límites
// ---------------------------------------------------------------------
export async function contarDatosEvento(eventoId) {
  const f = where("eventoId", "==", eventoId);
  const [en, ing, cu] = await Promise.all([
    getDocs(query(collection(db, "entradas"), f)),
    getDocs(query(collection(db, "ingresos"), f)),
    getDocs(query(collection(db, "cupos"), f))
  ]);
  return { entradas: en.docs, ingresos: ing.docs, cupos: cu.docs };
}

export async function borrarEvento(ev) {
  const { entradas, ingresos, cupos } = await contarDatosEvento(ev.id);
  // Las reglas solo permiten borrar entradas de eventos que no estén activos.
  if (ev.estado === "activo" && (entradas.length || ev.vendidas || ev.reservadas)) {
    await updateDoc(refEvento(ev.id), { estado: "finalizado", actualizadoEn: serverTimestamp() });
  }
  const refs = [...ingresos, ...entradas, ...cupos].map(d => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => b.delete(r));
    await b.commit();
  }
  await deleteDoc(refEvento(ev.id));
  return { entradas: entradas.length, ingresos: ingresos.length };
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

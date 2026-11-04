# S.A.E.N — Sociedad Anónima Eventos Nocturnos

Entradas digitales con QR.

Plataforma web estática para vender entradas con QR único, controlar el cupo compartido entre vendedores y registrar el ingreso en la puerta.

- **Frontend:** HTML5 + CSS3 + JavaScript puro (módulos ES), sin frameworks ni build.
- **Backend:** Firebase Authentication + Cloud Firestore + Firestore Security Rules (plan **Spark** gratuito).
- **Hosting:** GitHub Pages.
- **QR:** `qrcode-generator` 1.4.4 (generación) y `html5-qrcode` 2.3.8 (escaneo), incluidas en `assets/vendor/`.

No usa Cloud Functions, Cloud Run, Firebase Hosting ni ningún servicio que requiera facturación.

---

## 1. Estructura

```
index.html        Inicio (redirige al panel si hay sesión)
login.html        Inicio de sesión
registro.html     Auto-registro de vendedores (quedan pendientes)
admin.html        Panel del administrador
vendedor.html     Panel del vendedor
acceso.html       Escáner de la puerta
entrada.html      Vista de la entrada para el comprador (sin login)
firestore.rules   Reglas de seguridad (la pieza central de la seguridad)

assets/           Ícono y librerías QR locales (vendor/)
css/              base.css (tema), acceso.css, entrada.css
js/firebase/      config.js (tu configuración), init.js, sdk.js
js/auth/          session.js (control de rol), login, registro, index
js/services/      entradas.js — TODAS las transacciones de stock e ingreso
js/common/        ui.js, tokens.js, ticket.js (QR/PNG/WhatsApp), ticket-view.js
js/admin/         admin.js + resumen, entradas, usuarios, eventos, historial
js/seller/        vendedor.js
js/access/        acceso.js, scanner.js
js/ticket/        entrada.js
```

---

## 2. Modelo de datos (Firestore)

### `usuarios/{uid}`
| campo | tipo | notas |
|---|---|---|
| nombre, email | string | |
| rol | `admin` \| `vendedor` \| `acceso` | solo lo cambia un admin |
| estado | `pendiente` \| `aprobado` \| `rechazado` | |
| activo | bool | desactivar bloquea todas sus operaciones |
| codigo | string \| null | código de vendedor (`V-7KQ2`), lo asigna el admin |
| fechaRegistro | timestamp | |

### `eventos/{eventoId}`
`nombre, fecha, precio, limite (200 por defecto), vendidas, reservadas, estado (activo|pausado|finalizado), ultimaEntrada, creadoEn, actualizadoEn`

- **Disponibles** = `limite − vendidas − reservadas` (se calcula, no se guarda).
- `vendidas` incluye las entradas ya utilizadas.
- `ultimaEntrada` es un campo técnico: indica qué entrada justifica el último cambio de stock (ver §3).

### `entradas/{token}`
El **id del documento es el token secreto del QR** (40 caracteres hex = 160 bits aleatorios).

`token, codigo (SAEN-8F29-KX71), eventoId, eventoNombre, eventoFecha, compradorNombre, compradorDni, vendedorId, vendedorNombre, vendedorCodigo, precio, estado, ingresada, fechaCreacion, venceEn, fechaVenta, fechaIngreso, controladorId, controladorNombre` (+ campos de anulación/liberación cuando corresponda).

Estados: `reservada → vendida → utilizada`, y además `anulada`, `vencida`, `cancelada`.

### `cupos/{eventoId}_{vendedorId}` — límite de ventas por vendedor
`vendedorId, eventoId, vendedorNombre, limite, usadas, ultimaEntrada, actualizadoEn`

- Lo crea el admin desde la pestaña **Vendedores** (con un evento seleccionado) y lo puede **extender** (+5, +10, +20 o la cantidad que quiera) o **quitar**.
- `usadas` cuenta reservadas + vendidas + utilizadas del vendedor en ese evento. Baja cuando una reserva se cancela o vence, o cuando se anula una entrada.
- Si un vendedor no tiene cupo, solo lo limita el cupo general del evento.
- Las reglas exigen que cada reserva sume 1 a `usadas` sin superar `limite`, en la misma transacción que crea la entrada.

### Comisión
Cada evento tiene `comision` (% de 0 a 100). Cada entrada guarda el % vigente al momento de venderse (`entradas.comision`), así que cambiar la comisión de un evento afecta solo a las ventas nuevas. Comisión de una entrada = `precio × comision / 100`, solo para entradas vendidas o utilizadas. El admin ve comisión y monto "a entregar" por vendedor; el vendedor ve su propia comisión.

### `ingresos/{token}`
Un documento por ingreso, con **el mismo id que la entrada**: `entradaId, eventoId, codigo, compradorNombre, compradorDni, vendedorId, vendedorNombre, controladorId, controladorNombre, fechaHora`. Inmutable.

Por qué los ids son el token:
- El personal de puerta puede **leer una entrada solo si conoce su token** (`get`), pero no puede **listar** entradas: no hay forma de enumerarlas.
- Como `ingresos/{token}` solo puede crearse una vez, una entrada no puede tener dos ingresos.

---

## 3. Control de stock

Cada operación es una **transacción de Firestore** (`js/services/entradas.js`) que modifica la entrada y el evento a la vez:

| Operación | Entrada | Evento |
|---|---|---|
| Reservar | se crea `reservada` | `reservadas +1` |
| Confirmar cobro | `reservada → vendida` | `reservadas −1`, `vendidas +1` |
| Cancelar / vencer | `reservada → cancelada/vencida` | `reservadas −1` |
| Anular (admin) | `reservada/vendida → anulada` | devuelve el cupo |

Las **reglas** (no el JavaScript) garantizan:
- `vendidas + reservadas ≤ limite` siempre.
- No se puede crear una entrada sin sumar exactamente 1 a `reservadas` en la misma escritura, ni sumar sin crear la entrada (se cruzan con `getAfter`/`existsAfter` usando `ultimaEntrada`).
- Precio, nombre del evento y datos del vendedor de la entrada se copian del servidor y se verifican.

Si varios vendedores venden a la vez, Firestore serializa las escrituras sobre el documento del evento: las transacciones se reintentan con el valor actualizado y la que excede el límite falla. **Es imposible superar el límite.**

### Vencimiento de reservas
Cada reserva tiene `venceEn` (30 min por defecto, máximo 2 h según las reglas). Pasado ese momento:
- **no se puede confirmar el cobro** (lo impiden las reglas);
- el cupo se libera cuando alguien ejecuta la liberación: el panel del vendedor al abrirse y antes de cada venta (sus propias reservas), y el **panel del admin cada 2 minutos mientras esté abierto** (todas las reservas).

> ⚠️ En Spark no existen tareas programadas. Si nadie abre un panel, una reserva vencida sigue ocupando cupo hasta que alguien lo haga. No genera entradas válidas: solo demora la devolución del cupo.

---

## 4. Roles y seguridad

El rol vive en `usuarios/{uid}`, que **solo un administrador puede modificar**. Las reglas leen ese documento en cada operación. Un usuario desactivado o pendiente no puede hacer nada aunque tenga sesión.

| Acción | Admin | Vendedor | Acceso |
|---|:-:|:-:|:-:|
| Crear / editar eventos | ✅ | ❌ | ❌ |
| Aprobar / activar usuarios | ✅ | ❌ | ❌ |
| Crear entradas | ❌ | ✅ (como sí mismo) | ❌ |
| Confirmar cobro | ❌ | ✅ (solo propias) | ❌ |
| Ver entradas | todas | solo propias | solo por token escaneado |
| Registrar ingreso | ❌ | ❌ | ✅ |
| Anular entradas | ✅ | ❌ | ❌ |
| Ver historial de ingresos | todo | ❌ | solo los propios |

Además:
- `vendedorId` debe ser igual a `request.auth.uid`: un vendedor no puede vender en nombre de otro ni cambiarlo después.
- Las entradas y los ingresos son inmutables y **solo se pueden borrar al borrar su evento**: el admin puede eliminar un evento con ventas, y las reglas solo permiten borrar sus entradas/ingresos si el evento ya no está `activo` (el panel lo pasa a `finalizado` antes de empezar). Pide escribir BORRAR y recomienda exportar el CSV antes.
- El ingreso exige `vendida → utilizada` **y** crear `ingresos/{token}` en la misma transacción. Si dos celulares escanean el mismo QR a la vez, solo uno puede confirmar; Firestore reintenta el segundo, que lee `utilizada` y muestra **ENTRADA YA UTILIZADA**.
- Las fechas (`fechaVenta`, `fechaIngreso`, `fechaHora`) deben ser la hora del servidor (`request.time`).
- El QR contiene solo el token; no lleva datos personales.
- Los tokens y códigos se generan con `crypto.getRandomValues`, nunca con números consecutivos.

### Limitaciones de seguridad de un sistema sin backend privilegiado
Para ser claros sobre lo que las reglas **no** pueden garantizar:

1. **El cobro lo declara el vendedor.** "Recibí el dinero" es una declaración del vendedor; sin pasarela de pago no hay forma de verificarlo. El sistema registra quién confirmó y cuándo.
2. **La aleatoriedad del token la genera el navegador.** Las reglas verifican el formato (40 hex) pero no pueden comprobar que sea aleatorio. Un vendedor que modifique el código podría elegir un token predecible para *sus propias* entradas. Mitigación: los vendedores son usuarios aprobados y todo queda asociado a su cuenta.
3. **El vencimiento no es automático** (ver §3).
4. **No hay límite de frecuencia.** Un vendedor aprobado podría reservar todo el cupo; el admin lo ve en el panel, puede desactivarlo y anular/liberar sus reservas.
5. **El rol no usa custom claims** (requieren el Admin SDK en un servidor). Se usa un documento de Firestore protegido por reglas, que es igual de confiable para Firestore, con un costo de 1 lectura por regla evaluada.
6. **Quien tenga el enlace o la imagen del QR puede entrar** (una sola vez). Es inherente a cualquier entrada QR; el personal ve nombre y DNI del comprador para contrastarlo con su documento.
7. **Desactivar un usuario no borra su cuenta de Authentication**; solo le bloquea todas las operaciones. Para borrarla, usá la consola de Firebase.
8. **El escáner necesita internet.** Sin conexión muestra "NO SE PUDO VERIFICAR" y no registra nada (no hay validación offline, a propósito).

Opcional y gratuito: activar **Firebase App Check** con reCAPTCHA para que solo tu sitio pueda usar el proyecto.

### Página `entrada.html`
El enlace que recibe el comprador lleva los datos en el **fragmento** (`#d=…`), que el navegador nunca envía al servidor. Así **no hace falta abrir lecturas públicas** en Firestore y no se expone el DNI. Lo que muestra esa página es informativo: la validez se decide siempre en la puerta contra Firestore.

---

## 5. Límites del plan Spark

| Recurso | Cuota diaria gratuita | Uso estimado por evento de 200 entradas |
|---|---|---|
| Lecturas | 50.000 | ~2.000–5.000 (paneles en tiempo real + reglas) |
| Escrituras | 20.000 | ~1.000 (2 por reserva, 2 por cobro, 2 por ingreso) |
| Almacenamiento | 1 GiB | < 1 MB |
| Authentication email/contraseña | sin cargo | |

Cada regla que usa `get()` cuenta como una lectura. Para cientos de entradas por noche el plan gratuito sobra.

---

## 6. Puesta en marcha

### 6.1 Crear el proyecto Firebase
1. Entrá a <https://console.firebase.google.com> → **Agregar proyecto** (podés desactivar Analytics).
2. **Build → Authentication → Comenzar → Email/contraseña → Habilitar.**
3. **Build → Firestore Database → Crear base de datos** → modo **producción** → ubicación cercana (p. ej. `southamerica-east1`).
4. **Configuración del proyecto → Tus apps → Web (`</>`)** → registrá la app (sin Firebase Hosting) y copiá el objeto `firebaseConfig`.
5. Pegalo en `js/firebase/config.js`. Ahí también podés cambiar nombre, prefijo de código, moneda y minutos de reserva.

### 6.2 Publicar las reglas
**Firestore → Reglas** → pegá todo el contenido de `firestore.rules` → **Publicar**.
(O con la CLI: `firebase deploy --only firestore:rules`; la CLI también funciona en Spark.)

### 6.3 Crear el primer administrador
El primer admin no puede crearse desde la web (es intencional: nadie puede autoasignarse un rol).
1. Abrí `registro.html` y registrate normalmente.
2. En la consola: **Firestore → usuarios → (tu uid)** y editá:
   - `rol` → `admin`
   - `estado` → `aprobado`
   - `activo` → `true`
3. Iniciá sesión: vas a entrar a `admin.html`.

Desde el panel ya podés crear eventos, aprobar vendedores y registrar personal de acceso.

### 6.4 Autorizar el dominio
**Authentication → Configuración → Dominios autorizados** → agregá `TU-USUARIO.github.io`.

### 6.5 Publicar en GitHub Pages
1. Creá un repositorio y subí todos los archivos (la raíz del proyecto debe contener `index.html`).
2. **Settings → Pages → Build and deployment → Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**.
3. En 1–2 minutos queda en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

GitHub Pages sirve con **HTTPS**, que es obligatorio para usar la cámara en el celular.

### 6.6 Probar localmente
Los módulos ES no funcionan con `file://`. Levantá un servidor local en la carpeta del proyecto:
```bash
python3 -m http.server 8080
```
y abrí <http://localhost:8080>. `localhost` ya está autorizado en Firebase y permite usar la cámara.

---

## 7. Flujo de uso

1. **Admin** crea el evento (límite 200 por defecto) y aprueba vendedores (se les asigna un código `V-XXXX`).
2. **Vendedor** elige evento, carga nombre y DNI → la entrada queda **RESERVADA** con un reloj de vencimiento.
3. Al recibir el dinero toca **"Recibí el dinero"** → pasa a **VENDIDA** y aparece la entrada con el QR.
4. La comparte por **WhatsApp** (en Android adjunta la imagen; si no, envía el enlace) o la **descarga** como PNG.
5. **Acceso** elige el evento, abre la cámara y escanea:
   - 🟢 ACCESO AUTORIZADO — se registra el ingreso.
   - 🔴 ENTRADA YA UTILIZADA — muestra cuándo y quién la registró.
   - 🔴 ENTRADA INVÁLIDA · 🟠 NO CONFIRMADA · 🔴 ANULADA · 🔴 DE OTRO EVENTO.

---

## 7 bis. App instalable (PWA)

- `manifest.webmanifest` define nombre, ícono y colores; `sw.js` es el service worker; `js/common/pwa.js` lo registra y muestra el botón **Instalar app**.
- **Android (Chrome):** botón "📲 Instalar app" en el inicio (o "Instalar app" en la barra de cada panel), o menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** Compartir → *Agregar a inicio* (el inicio muestra estas instrucciones).
- **PC (Chrome/Edge):** ícono de instalar en la barra de direcciones.
- El service worker usa **red primero** para los archivos de la app (siempre se carga la versión nueva si hay internet) y **nunca intercepta Firestore ni Authentication**: ventas y validaciones siempre van al servidor. Sin conexión, la app abre y las entradas ya abiertas se pueden volver a mostrar, pero no se puede vender ni validar.
- Requiere HTTPS (GitHub Pages lo tiene) o `localhost`.

## 8. Datos de demostración

**Este proyecto no incluye datos simulados.** Si `config.js` no está completo, todas las páginas muestran "Firebase no está configurado" en lugar de datos falsos. Para practicar, se recomienda crear **un proyecto Firebase separado** (por ejemplo `saen-pruebas`) y usar ese `config.js` mientras se prueba, para no mezclar datos de prueba con datos reales.

---

## 9. Lista de verificación antes del primer evento

- [ ] Reglas publicadas (la consola muestra la fecha de publicación).
- [ ] Un vendedor de prueba **no** puede ver entradas de otro vendedor.
- [ ] Al llegar al límite, la venta siguiente falla con "No quedan entradas".
- [ ] Una entrada reservada escaneada muestra **NO CONFIRMADA**.
- [ ] Escanear dos veces la misma entrada muestra **YA UTILIZADA** la segunda vez.
- [ ] Escanear con dos celulares a la vez: solo uno muestra **AUTORIZADO**.
- [ ] El dominio de GitHub Pages está en *Dominios autorizados*.
- [ ] La cámara funciona en los celulares del personal (Chrome Android, con permiso concedido).

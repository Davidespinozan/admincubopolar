# Endpoint público de leads — `leads-intake`

Tanda 19. Recibe submits del formulario de la landing
(`cubopolar.com`) y los inserta como filas en `leads` del ERP. Es el
único endpoint del ERP **sin auth** (es público por necesidad del
flujo: usuario anónimo en una landing pública).

---

## URL

```
POST https://sistema.cubopolar.com/.netlify/functions/leads-intake
```

## CORS

Solo se acepta el header `Origin` con uno de estos valores:

- `https://cubopolar.com`
- `https://www.cubopolar.com`

Cualquier otro origen recibe **403 Forbidden** sin headers CORS.
Para testing local desde `file://` o `localhost:5173`, **no se puede
probar contra producción**: el navegador rechaza el preflight.
Hacer pruebas de la landing localmente espera fallo del fetch — el
form de la landing degrada con dignidad (toast de error con fallback
WhatsApp).

## Request body

`Content-Type: application/json`

```jsonc
{
  // REQUERIDOS
  "nombre": "Juan Pérez",
  "telefono": "+52 618 840 5561",   // se normaliza a 10 dígitos

  // OPCIONALES (todos van a leads.mensaje concatenados)
  "negocio": "Hotel Plaza",
  "zona": "Centro",
  "producto": "Bolsa 25 kg",
  "cantidad": "50 bolsas",
  "recurrente": "Sí",                // o "No"
  "frecuencia": "Diario",            // solo si recurrente="Sí"
  "comentarios": "Entrega 7am-11am",

  // TRACKING (opcionales, mejoran el campo `origen`)
  "utm_source": "facebook",          // → leads.origen = "Landing - facebook"
  "utm_medium": "cpc",
  "utm_campaign": "verano",
  "utm_content": "ad-2",
  "cta_origen": "hero",              // hero / card_principal / footer / directo

  // ANTI-SPAM (debe venir vacío de un humano real)
  "company_url": ""                   // honeypot field
}
```

### Validaciones

- `nombre`: requerido, 2-120 caracteres.
- `telefono`: requerido, 10 dígitos mexicanos válidos (lada 2-9).
  Se normaliza removiendo `+52`/`+521`/espacios/guiones/paréntesis.
- `company_url` con valor truthy → bot detectado, respuesta 200
  silenciosa SIN insert.

## Responses

### 200 OK — Lead guardado

```json
{ "ok": true, "id": 42 }
```

### 200 OK — Dedup (mismo teléfono en últimos 5 min)

```json
{ "ok": true, "deduped": true, "id": 41 }
```

El cliente puede haber hecho doble click o regresado al form. NO
genera fila nueva. La UX en la landing se ve como éxito normal.

### 200 OK — Honeypot detectado (silencioso)

```json
{ "ok": true, "received": true }
```

NO se insertó nada. El bot ve "éxito" y se va.

### 400 Bad Request — Validación falla

```json
{ "error": "Nombre requerido (mínimo 2 caracteres)" }
```

Mensajes posibles:
- `"Payload vacío"`
- `"JSON inválido"`
- `"Nombre requerido (mínimo 2 caracteres)"`
- `"Nombre demasiado largo"`
- `"Teléfono mexicano de 10 dígitos requerido"`

### 403 Forbidden — Origin no permitido

```json
{ "error": "Origin no permitido" }
```

### 405 Method Not Allowed — No es POST

Siempre responde a OPTIONS (preflight) con 204.

### 500 Internal Server Error

```json
{ "error": "No se pudo guardar el lead", "details": "..." }
```

Sentry recibe el evento (vía `withSentry` de Tanda 7).

---

## Mapeo a la tabla `leads`

| Campo BD | Origen |
|---|---|
| `nombre` | request body, trimmed |
| `telefono` | request body, normalizado a 10 dígitos |
| `correo` | siempre `null` (la landing no captura email) |
| `mensaje` | concatenación structured de los campos opcionales (ver `formatLeadMensaje` en `src/data/leadsIntakeLogic.js`) |
| `origen` | `'Landing page'` por default; `'Landing - {utm_source}'` si viene UTM |
| `estatus` | `'Nuevo'` |
| `fecha` | hoy (UTC) |

Ejemplo del campo `mensaje`:

```
Producto: Bolsa 25 kg
Cantidad: 50 bolsas
Recurrente: Sí (Diario)
Negocio: Hotel Plaza
Zona: Centro

Comentarios: Recibo de 7am a 11am

─── Tracking ───
CTA: hero
utm_source: facebook
utm_campaign: verano
```

Esto se muestra en `LeadsView` del ERP sin necesidad de columnas
extra en la tabla.

---

## Anti-spam y rate limiting

### Implementado

1. **Honeypot field**: `company_url` invisible en la landing. Bots
   automáticos lo llenan, humanos no lo ven. Servidor responde 200
   sin insertar.
2. **Dedup por teléfono ventana 5 min**: previene doble-submit del
   mismo cliente y ataques de flood básicos con el mismo número.
3. **Origin whitelist**: solo `cubopolar.com` y `www.cubopolar.com`.
   Bots que prueban el endpoint desde otros sitios reciben 403.
4. **Validación estricta**: nombres con 1 char y teléfonos no-mexicanos
   se rechazan.

### NO implementado (aceptado como riesgo)

1. **Rate limit por IP**: Netlify Functions son stateless; un rate
   limit en memoria no es confiable. Implementar con tabla en BD
   tendría costo no justificado para el volumen esperado de Cubo
   Polar (decenas de leads/mes).
2. **CAPTCHA**: añade fricción significativa al usuario. Si más
   adelante hay spam masivo, integrar Cloudflare Turnstile (~30
   min de Tanda chica).
3. **Validación profunda de RFC**: solo se valida formato local
   (10 dígitos, lada válida). No se hace lookup contra catálogo de
   ladas reales.

---

## Cómo probar

### Test manual con curl (cuando el endpoint esté en producción)

```bash
curl -X POST https://sistema.cubopolar.com/.netlify/functions/leads-intake \
  -H "Content-Type: application/json" \
  -H "Origin: https://cubopolar.com" \
  -d '{
    "nombre": "Test Manual",
    "telefono": "6188405561",
    "producto": "Bolsa 25 kg",
    "comentarios": "Lead de prueba — borrar"
  }'
```

Esperado: `{"ok":true,"id":<n>}`. Verificar en LeadsView del ERP que
aparece el row. Borrarlo después con `DELETE FROM leads WHERE id=<n>`
para no contaminar producción.

### Test honeypot

```bash
curl -X POST https://sistema.cubopolar.com/.netlify/functions/leads-intake \
  -H "Content-Type: application/json" \
  -H "Origin: https://cubopolar.com" \
  -d '{
    "nombre": "Bot Test",
    "telefono": "6188405561",
    "company_url": "http://spam.com"
  }'
```

Esperado: `{"ok":true,"received":true}` SIN row nuevo en BD.

### Test origin no permitido

```bash
curl -X POST https://sistema.cubopolar.com/.netlify/functions/leads-intake \
  -H "Content-Type: application/json" \
  -H "Origin: https://malicious.example" \
  -d '{"nombre":"X","telefono":"6188405561"}'
```

Esperado: `403 Forbidden`.

---

## Notas operativas

- Los leads que llegan vía este endpoint tienen `origen` que empieza
  por `Landing`. Filtros en LeadsView del ERP pueden distinguirlos
  de leads capturados manualmente (`origen='Manual'` o similar).
- El campo `mensaje` puede ser largo (varios cientos de caracteres
  con todos los campos llenos + tracking). La columna es TEXT sin
  límite, OK.
- Si Cubo Polar empieza campañas pagadas con UTMs, los leads se
  segmentan automáticamente sin cambio de código.

## Roadmap de mejoras (opcionales, no urgentes)

- **Email de notificación a Santiago al recibir lead nuevo**: hoy
  Santiago tiene que revisar el ERP. Si quiere alerta tiempo real,
  agregar paso de envío de email al final del handler (~30 min).
- **Slack/Discord webhook**: similar al email pero más rápido para
  equipos en línea.
- **Captura de IP del cliente**: requiere columna `ip_origin` en
  `leads` (mig 067). Útil para rate limiting futuro y para detectar
  spam por geografía.
- **Smoke E2E del endpoint**: hoy hay test unitario de los helpers,
  pero no hay test que valide CORS + INSERT contra producción real.
  Agregable a la suite Playwright si se acepta el riesgo de tener
  filas de test en BD.

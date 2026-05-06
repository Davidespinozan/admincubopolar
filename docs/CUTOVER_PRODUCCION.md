# Cutover de Facturama: Sandbox → Producción

Tanda 14 montó un banner permanente "MODO PRUEBA" mientras la app esté
conectada al endpoint sandbox de Facturama. Esta guía explica cómo
hacer el cutover real cuando Cubo Polar esté listo para timbrar
facturas legítimas ante el SAT.

> **Lectura obligatoria antes del cutover.** Saltarse pasos puede
> resultar en CFDI rechazados, timbres consumidos sin emitir factura
> útil, o pérdida de paquete pagado a Facturama.

---

## ¿Qué cambia entre sandbox y producción?

| Aspecto | Sandbox (`apisandbox.facturama.mx`) | Producción (`api.facturama.mx`) |
|---|---|---|
| Reportado al SAT | ❌ NO | ✅ SÍ |
| Validación del RFC del receptor | ⚠️ Laxa (acepta casi todo) | ✅ Estricta (SAT rechaza RFCs mal formados) |
| Validación del régimen fiscal vs RFC | ⚠️ Laxa | ✅ Estricta |
| Costo por timbre | Gratis (ilimitados) | ~$2-3 MXN según paquete |
| CSDs requeridos | Mismos archivos `.cer`/`.key` | Mismos archivos `.cer`/`.key` |
| UUID generado | Válido en Facturama, no en SAT | Válido en SAT |
| Cuenta Facturama | `https://apisandbox.facturama.mx` | `https://app.facturama.mx` |

**Importante**: las cuentas sandbox y producción son **dos cuentas
distintas** en Facturama. Los CFDI emitidos en una NO aparecen en la
otra. No hay migración automática del histórico.

---

## Checklist pre-cutover (15 puntos)

Marca cada uno antes de tocar las env vars.

### Lado Cubo Polar / SAT

- [ ] **CSDs vigentes**: el sello digital de Cubo Polar (.cer + .key
      + contraseña) NO está vencido. Renovar en `siat.sat.gob.mx`
      si expira en menos de 60 días.
- [ ] **Datos fiscales en SAT actualizados**: razón social, régimen
      fiscal, código postal del domicilio coinciden con lo que se va
      a configurar en Facturama. Si Cubo Polar cambió de domicilio,
      actualizar primero en SAT, luego acá.

### Lado Facturama (producción)

- [ ] **Cuenta creada** en `https://app.facturama.mx` (la sandbox no
      sirve, es una cuenta distinta).
- [ ] **Datos fiscales capturados** en la cuenta Facturama (RFC, razón
      social, régimen, código postal). Deben coincidir EXACTAMENTE con
      el SAT.
- [ ] **CSDs subidos** a la cuenta de producción de Facturama
      (Configuración → Certificados).
- [ ] **Test de timbrado en el dashboard de Facturama** (no en el ERP):
      generar 1 CFDI manualmente desde la UI de Facturama con
      `XAXX010101000` (público general) y monto de $1.00. Si funciona,
      la cuenta está bien configurada.
- [ ] **Paquete de timbres comprado**. El paquete chico (100 timbres
      ~$200 MXN) basta para validar el cutover. Sin saldo, los timbres
      reales fallan con "sin saldo".
- [ ] **Credenciales API generadas** en la cuenta de producción
      (NO reutilizar las del sandbox). Username + password nuevos.

### Lado Cubo Polar ERP / BD

- [ ] **`configuracion_empresa.codigo_postal`** capturado en BD con el
      CP fiscal real (no de prueba). Verifica con
      `SELECT codigo_postal FROM configuracion_empresa WHERE id=1;`.
- [ ] **`configuracion_empresa.regimen_fiscal`** capturado con código
      SAT de 3 dígitos válido (ej. `601`, `626`).
- [ ] **Catálogo de clientes limpio**: ningún RFC mal formado. Correr:
      ```sql
      SELECT id, nombre, rfc FROM clientes
       WHERE rfc IS NOT NULL AND TRIM(rfc) <> ''
         AND rfc NOT SIMILAR TO '[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}'
         AND rfc NOT IN ('XAXX010101000', 'XEXX010101000');
      ```
      Esperado: 0 filas. Si devuelve filas, son clientes que fallarán
      el primer timbre real.
- [ ] **Catálogo de productos con `clave_prod_serv` y `clave_unidad`**
      poblados. Correr:
      ```sql
      SELECT sku, nombre FROM productos
       WHERE tipo = 'Producto Terminado' AND clave_prod_serv IS NULL;
      ```
      Esperado: 0 filas (la mig 060 las pobló). Si hay filas, el ERP
      cae al default `50202302` (hielo) — no rompe pero no es ideal.

### Operacional

- [ ] **David presente físicamente o por videollamada** las primeras
      4 horas post-cutover.
- [ ] **Inicio de mes fiscal nuevo** o al menos primer lunes de la
      semana — NO hacer cutover a media semana ocupada.
- [ ] **Comunicado a Santiago + equipo**: nadie debe usar el módulo
      Facturación durante las 2 horas que dura el cutover + smoke
      test. Después del visto bueno, regresan a operación normal.

---

## Ejecución del cutover

Una vez los 15 puntos están marcados:

### Paso 1 — Cambiar las 4 env vars en Netlify

GitHub → Netlify dashboard → Site settings → Environment variables.

| Variable | Valor SANDBOX (actual) | Valor PRODUCCIÓN (cambiar a) |
|---|---|---|
| `FACTURAMA_API_URL` | `https://apisandbox.facturama.mx` | `https://api.facturama.mx` |
| `FACTURAMA_USERNAME` | `Cubopolar` (sandbox) | usuario nuevo de cuenta producción |
| `FACTURAMA_PASSWORD` | `CuboPol@r2025` (sandbox) | password nuevo de cuenta producción |
| `VITE_FACTURAMA_MODE` | (no definida = sandbox) | `production` |

**Cambiar las 4 simultáneamente** y guardar. Si solo cambias 3, queda
en estado inconsistente (ej. backend timbra real pero frontend muestra
banner — confunde al usuario).

### Paso 2 — Trigger redeploy

Netlify auto-redeploya las funciones cuando cambian env vars (~30 seg).
El frontend NO se redeploya automáticamente con cambio de env vars
solo de runtime; **`VITE_FACTURAMA_MODE` requiere un build nuevo**:

- En Netlify dashboard → Deploys → Trigger deploy → "Clear cache and
  deploy site". Tarda ~2-3 minutos.

### Paso 3 — Validar el cutover

1. Abrir la app en producción. **El banner amarillo debe haber
   desaparecido.** Si sigue visible, revisar que `VITE_FACTURAMA_MODE`
   esté en `production` y que el deploy con clear-cache se haya hecho.
2. Login como Admin.
3. Ir al módulo Facturación → tomar una orden de prueba (puede ser
   real, monto chico). Si quieres ser ultra-conservador, crea una
   orden falsa de $1.00 con cliente "público general" (`XAXX010101000`).
4. Click "Timbrar CFDI".
5. **Verificar en `https://app.facturama.mx`** (producción, NO sandbox):
   - El CFDI aparece con UUID real.
   - El estado es "Vigente" en SAT.
6. **Cancelar inmediatamente** ese CFDI desde el ERP con motivo `02`
   ("emitido con errores sin relación") para no dejar basura en SAT.
7. Validar que la cancelación se reporta como exitosa en Facturama.

Si los 7 pasos pasan: cutover exitoso. Avisar a Santiago + equipo que
pueden volver a operar.

---

## Plan de rollback

Si algo falla en el smoke (paso 3.4 en adelante) y hay urgencia
operativa:

1. **Revertir las 4 env vars** en Netlify a sus valores originales
   sandbox.
2. Trigger redeploy.
3. Banner amarillo regresa = todo está de vuelta en sandbox.
4. Diagnosticar la falla en frío sin presión:
   - Si fue rechazo del SAT: revisar el detalle en `invoice_attempts`
     última fila con `status='error'`.
   - Si fue 401 de Facturama: contraseña/usuario mal copiados.
   - Si fue "sin saldo": comprar más timbres.
   - Si fue CSD expirado: renovar en SAT.

El histórico de timbres sandbox sigue intacto en BD. Cuando se hace el
re-cutover, simplemente se cambian las env vars de nuevo y se valida.

---

## Después del cutover

- Las facturas timbradas a partir de ese momento son **válidas ante SAT**.
- El banner "MODO PRUEBA" desaparece. Si reaparece, alguien revertió
  `VITE_FACTURAMA_MODE` o la cuenta Facturama queda mal configurada.
- Las facturas histórico sandbox **NO se migran**. Cualquier cliente
  que pidió "factura" durante el período sandbox necesita pedir una
  nueva — y solo se le puede emitir con la fecha del momento real
  del re-timbre, no con la fecha de la venta original (SAT no acepta
  facturas extemporáneas más allá de 72 hrs).
- Smoke E2E `smoke-admin` actualmente verifica que el banner SÍ está
  visible. Tras el cutover, ese test fallará y debe actualizarse para
  verificar lo opuesto (el banner debe estar AUSENTE). Es una tarea
  de ~1 minuto post-cutover.

---

## Riesgos comunes

| Riesgo | Síntoma | Mitigación |
|---|---|---|
| Facturas extemporáneas | Cliente pide factura de venta de hace 1 mes | Política Opción A documentada: no se ofrecen facturas durante sandbox |
| CSD expira a medio cutover | Timbre real falla con 401 al CSD | Renovar CSDs antes del cutover |
| Saldo de timbres se acaba | Timbres fallan con "sin saldo" | Habilitar autorenovación en Facturama o monitor manual |
| RFC de cliente inválido | Timbre falla con `Receiver.Rfc inválido` | Limpiar catálogo pre-cutover (query del checklist) |
| Régimen fiscal del cliente no coincide con SAT | Timbre falla con `FiscalRegime no aplica` | Verificar régimen en Constancia de Situación Fiscal del cliente |
| Cliente quiere dirección/email distinto | Recapturar en Clientes y re-timbrar | Esperado; bug del cliente, no del sistema |

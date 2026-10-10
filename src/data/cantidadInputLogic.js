// Cantidad de una línea de venta mientras el usuario la escribe.
//
// Antes, cada tecla se convertía a número con `Math.max(1, parseInt(v) || 1)`: al borrar el 1
// para escribir otra cantidad el campo quedaba vacío, se forzaba a 1 y el usuario terminaba
// con "15" en lugar de "5" (o no podía escribir nada). Mientras se escribe se conserva el texto
// (solo dígitos, puede quedar vacío); al salir del campo se normaliza a un entero >= 1.

export const cantidadEnEdicion = (v) => String(v ?? '').replace(/\D/g, '');

export const cantidadNormalizada = (v) => {
  const k = parseInt(cantidadEnEdicion(v), 10);
  return Number.isFinite(k) && k >= 1 ? k : 1;
};

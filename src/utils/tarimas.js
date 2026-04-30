import { s, n } from './safe';

// Calcula cuántas tarimas (fraccional) ocupa una cantidad de un SKU
export function bolsasATarimas(cantidad, tarimaSize) {
  const cant = n(cantidad);
  const size = n(tarimaSize);
  if (size <= 0) return 0;
  return cant / size;
}

// Calcula tarimas ocupadas en un cuarto frío sumando todos los SKUs presentes
// cuarto: { stock: { 'HPC-5K': 100, 'HPC-25K': 36, ... } }
// productos: array con { sku, tarima_size }
export function tarimasOcupadasEnCuarto(cuarto, productos) {
  const stock = (cuarto?.stock && typeof cuarto.stock === 'object') ? cuarto.stock : {};
  let total = 0;
  for (const [sku, cantidad] of Object.entries(stock)) {
    const prod = (productos || []).find(p => s(p.sku) === s(sku));
    const tarimaSize = n(prod?.tarima_size);
    if (tarimaSize > 0) {
      total += bolsasATarimas(cantidad, tarimaSize);
    }
  }
  return total;
}

// Verifica si meter X cantidades de un SKU al cuarto excede la capacidad
// Retorna { puede: bool, ocupadoActual: number, ocupadoFuturo: number, capacidad: number }
export function puedeAgregarAlCuarto(cuarto, productos, sku, cantidadAgregar) {
  const capacidad = n(cuarto?.capacidad_tarimas);
  if (capacidad <= 0) {
    // Sin capacidad configurada: permitir (modo legacy)
    return { puede: true, ocupadoActual: 0, ocupadoFuturo: 0, capacidad: 0, sinConfigurar: true };
  }
  const prod = (productos || []).find(p => s(p.sku) === s(sku));
  const tarimaSize = n(prod?.tarima_size);
  if (tarimaSize <= 0) {
    // SKU sin tarima_size: permitir (modo legacy)
    const ocupado = tarimasOcupadasEnCuarto(cuarto, productos);
    return { puede: true, ocupadoActual: ocupado, ocupadoFuturo: ocupado, capacidad, sinTarimaSize: true };
  }
  const ocupadoActual = tarimasOcupadasEnCuarto(cuarto, productos);
  const tarimasAgregar = bolsasATarimas(cantidadAgregar, tarimaSize);
  const ocupadoFuturo = ocupadoActual + tarimasAgregar;
  return {
    puede: ocupadoFuturo <= capacidad,
    ocupadoActual,
    ocupadoFuturo,
    capacidad,
  };
}

// Color según porcentaje de uso
export function colorTarimasUso(ocupado, capacidad) {
  if (capacidad <= 0) return 'slate';
  const pct = (ocupado / capacidad) * 100;
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'amber';
  return 'emerald';
}

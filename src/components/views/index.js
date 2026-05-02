// Re-export all views from ModuleViews
// This index enables future lazy loading by replacing individual exports
// with lazy(() => import('./ViewName')) without changing consumers

export {
  ClientesView,
  ProductosView,
  PreciosView,
  ProduccionView,
  InventarioView,
  OrdenesView,
  RutasView,
  FacturacionView,
  ConciliacionView,
  AuditoriaView,
  ConfiguracionView,
  AlmacenBolsasView,
  EmpleadosView,
  NominaView,
  ContabilidadView,
  CobrosView,
  CostosView,
  CuentasPorPagarView,
  DevolucionesView,
} from './ModuleViews';

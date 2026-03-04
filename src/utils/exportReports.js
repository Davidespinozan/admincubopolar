/**
 * Utilidades para exportar reportes a Excel y PDF
 * CuboPolar ERP
 */
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Exporta datos a un archivo Excel
 * @param {Object[]} data - Array de objetos a exportar
 * @param {string} filename - Nombre del archivo (sin extensión)
 * @param {string} sheetName - Nombre de la hoja
 * @param {Object} options - Opciones adicionales
 */
export function exportToExcel(data, filename, sheetName = 'Datos', options = {}) {
  if (!data || data.length === 0) {
    alert('No hay datos para exportar');
    return;
  }

  // Crear workbook y worksheet
  const wb = XLSX.utils.book_new();
  
  // Si hay columnas personalizadas, usarlas
  let ws;
  if (options.columns) {
    const headers = options.columns.map(c => c.header);
    const keys = options.columns.map(c => c.key);
    const rows = data.map(row => keys.map(k => row[k] ?? ''));
    ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  } else {
    ws = XLSX.utils.json_to_sheet(data);
  }

  // Ajustar anchos de columna
  const colWidths = [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxWidth = 10;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v) {
        const len = String(cell.v).length;
        if (len > maxWidth) maxWidth = Math.min(len, 50);
      }
    }
    colWidths.push({ wch: maxWidth + 2 });
  }
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Descargar
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
}

/**
 * Exporta múltiples hojas a un archivo Excel
 * @param {Object[]} sheets - Array de { name, data, columns? }
 * @param {string} filename - Nombre del archivo
 */
export function exportMultiSheetExcel(sheets, filename) {
  if (!sheets || sheets.length === 0) {
    alert('No hay datos para exportar');
    return;
  }

  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    let ws;
    if (sheet.columns) {
      const headers = sheet.columns.map(c => c.header);
      const keys = sheet.columns.map(c => c.key);
      const rows = (sheet.data || []).map(row => keys.map(k => row[k] ?? ''));
      ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    } else {
      ws = XLSX.utils.json_to_sheet(sheet.data || []);
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)); // Excel limit 31 chars
  }

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
}

// ══════════════════════════════════════════════════════════════
// PDF EXPORT
// ══════════════════════════════════════════════════════════════

/**
 * Exporta datos a PDF con formato de tabla
 * @param {Object[]} data - Array de objetos
 * @param {string} filename - Nombre del archivo
 * @param {Object} options - Opciones de configuración
 */
export function exportToPDF(data, filename, options = {}) {
  if (!data || data.length === 0) {
    alert('No hay datos para exportar');
    return;
  }

  const {
    title = 'Reporte',
    subtitle = '',
    columns = null,
    orientation = 'portrait', // 'portrait' | 'landscape'
    pageSize = 'letter',
  } = options;

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: pageSize,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const today = new Date().toLocaleDateString('es-MX', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });

  // Header con logo/título
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CUBO POLAR', 14, 15);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 14, 23);
  
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subtitle, 14, 29);
    doc.setTextColor(0);
  }

  // Fecha
  doc.setFontSize(9);
  doc.text(today, pageWidth - 14, 15, { align: 'right' });

  // Preparar datos para la tabla
  let headers, rows;
  if (columns) {
    headers = columns.map(c => c.header);
    const keys = columns.map(c => c.key);
    rows = data.map(row => keys.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number') return val.toLocaleString('es-MX');
      return String(val);
    }));
  } else {
    headers = Object.keys(data[0]);
    rows = data.map(row => Object.values(row).map(v => 
      v === null || v === undefined ? '' : 
      typeof v === 'number' ? v.toLocaleString('es-MX') : String(v)
    ));
  }

  // Generar tabla
  doc.autoTable({
    head: [headers],
    body: rows,
    startY: subtitle ? 35 : 30,
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [37, 99, 235], // blue-600
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer con número de página
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    },
  });

  // Descargar
  const todayStr = new Date().toISOString().slice(0, 10);
  doc.save(`${filename}_${todayStr}.pdf`);
}

// ══════════════════════════════════════════════════════════════
// REPORTES PREDEFINIDOS
// ══════════════════════════════════════════════════════════════

/**
 * Reporte de ventas del día/periodo
 */
export function reporteVentas(ordenes, formato = 'excel') {
  const columns = [
    { key: 'folio', header: 'Folio' },
    { key: 'fecha', header: 'Fecha' },
    { key: 'cliente', header: 'Cliente' },
    { key: 'productos', header: 'Productos' },
    { key: 'total', header: 'Total' },
    { key: 'estatus', header: 'Estatus' },
    { key: 'metodoPago', header: 'Método Pago' },
  ];

  const data = ordenes.map(o => ({
    folio: o.folio || `ORD-${o.id}`,
    fecha: o.fecha || '',
    cliente: o.cliente || '',
    productos: o.productos || '',
    total: typeof o.total === 'number' ? o.total : parseFloat(o.total) || 0,
    estatus: o.estatus || '',
    metodoPago: o.metodoPago || o.metodo_pago || '',
  }));

  const totalVentas = data.reduce((s, o) => s + o.total, 0);

  if (formato === 'pdf') {
    exportToPDF(data, 'Ventas_CuboPolar', {
      title: 'Reporte de Ventas',
      subtitle: `Total: $${totalVentas.toLocaleString('es-MX')}`,
      columns,
      orientation: 'landscape',
    });
  } else {
    exportToExcel(data, 'Ventas_CuboPolar', 'Ventas', { columns });
  }
}

/**
 * Reporte de producción
 */
export function reporteProduccion(produccion, formato = 'excel') {
  const columns = [
    { key: 'fecha', header: 'Fecha' },
    { key: 'turno', header: 'Turno' },
    { key: 'maquina', header: 'Máquina' },
    { key: 'sku', header: 'Producto' },
    { key: 'cantidad', header: 'Cantidad' },
    { key: 'operador', header: 'Operador' },
  ];

  const data = produccion.map(p => ({
    fecha: p.fecha || '',
    turno: p.turno || '',
    maquina: p.maquina || '',
    sku: p.sku || '',
    cantidad: typeof p.cantidad === 'number' ? p.cantidad : parseInt(p.cantidad) || 0,
    operador: p.operador || p.usuario || '',
  }));

  const totalProducido = data.reduce((s, p) => s + p.cantidad, 0);

  if (formato === 'pdf') {
    exportToPDF(data, 'Produccion_CuboPolar', {
      title: 'Reporte de Producción',
      subtitle: `Total producido: ${totalProducido.toLocaleString()} unidades`,
      columns,
    });
  } else {
    exportToExcel(data, 'Produccion_CuboPolar', 'Producción', { columns });
  }
}

/**
 * Reporte de inventario (cuartos fríos + productos)
 */
export function reporteInventario(productos, cuartosFrios, formato = 'excel') {
  // Hoja 1: Productos
  const colsProductos = [
    { key: 'sku', header: 'SKU' },
    { key: 'nombre', header: 'Nombre' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'stock', header: 'Stock' },
    { key: 'precio', header: 'Precio' },
  ];

  const dataProductos = productos.map(p => ({
    sku: p.sku || '',
    nombre: p.nombre || '',
    tipo: p.tipo || '',
    stock: typeof p.stock === 'number' ? p.stock : parseInt(p.stock) || 0,
    precio: typeof p.precio === 'number' ? p.precio : parseFloat(p.precio) || 0,
  }));

  // Hoja 2: Cuartos fríos
  const dataCuartos = [];
  for (const cf of cuartosFrios || []) {
    const stock = cf.stock || {};
    for (const [sku, qty] of Object.entries(stock)) {
      dataCuartos.push({
        cuarto: cf.nombre || cf.id,
        sku,
        cantidad: parseInt(qty) || 0,
        temp: cf.temp || '',
      });
    }
  }

  const colsCuartos = [
    { key: 'cuarto', header: 'Cuarto Frío' },
    { key: 'sku', header: 'SKU' },
    { key: 'cantidad', header: 'Cantidad' },
    { key: 'temp', header: 'Temperatura' },
  ];

  if (formato === 'pdf') {
    // Para PDF, combinar en una sola tabla
    exportToPDF(dataProductos, 'Inventario_CuboPolar', {
      title: 'Reporte de Inventario',
      subtitle: `${productos.length} productos registrados`,
      columns: colsProductos,
    });
  } else {
    exportMultiSheetExcel([
      { name: 'Productos', data: dataProductos, columns: colsProductos },
      { name: 'Cuartos Fríos', data: dataCuartos, columns: colsCuartos },
    ], 'Inventario_CuboPolar');
  }
}

/**
 * Reporte de clientes con saldos
 */
export function reporteClientes(clientes, formato = 'excel') {
  const columns = [
    { key: 'nombre', header: 'Cliente' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'contacto', header: 'Contacto' },
    { key: 'rfc', header: 'RFC' },
    { key: 'saldo', header: 'Saldo Pendiente' },
    { key: 'estatus', header: 'Estatus' },
  ];

  const data = clientes.map(c => ({
    nombre: c.nombre || '',
    tipo: c.tipo || '',
    contacto: c.contacto || '',
    rfc: c.rfc || '',
    saldo: typeof c.saldo === 'number' ? c.saldo : parseFloat(c.saldo) || 0,
    estatus: c.estatus || 'Activo',
  }));

  const totalSaldo = data.reduce((s, c) => s + c.saldo, 0);

  if (formato === 'pdf') {
    exportToPDF(data, 'Clientes_CuboPolar', {
      title: 'Reporte de Clientes',
      subtitle: `Saldo total por cobrar: $${totalSaldo.toLocaleString('es-MX')}`,
      columns,
    });
  } else {
    exportToExcel(data, 'Clientes_CuboPolar', 'Clientes', { columns });
  }
}

/**
 * Reporte de rutas del día
 */
export function reporteRutas(rutas, formato = 'excel') {
  const columns = [
    { key: 'fecha', header: 'Fecha' },
    { key: 'nombre', header: 'Ruta' },
    { key: 'chofer', header: 'Chofer' },
    { key: 'vehiculo', header: 'Vehículo' },
    { key: 'estatus', header: 'Estatus' },
    { key: 'totalCobrado', header: 'Cobrado' },
    { key: 'totalCredito', header: 'Crédito' },
  ];

  const data = rutas.map(r => ({
    fecha: r.fecha || '',
    nombre: r.nombre || '',
    chofer: r.choferNombre || r.chofer_nombre || '',
    vehiculo: r.vehiculo || '',
    estatus: r.estatus || '',
    totalCobrado: typeof r.totalCobrado === 'number' ? r.totalCobrado : parseFloat(r.total_cobrado) || 0,
    totalCredito: typeof r.totalCredito === 'number' ? r.totalCredito : parseFloat(r.total_credito) || 0,
  }));

  if (formato === 'pdf') {
    exportToPDF(data, 'Rutas_CuboPolar', {
      title: 'Reporte de Rutas',
      columns,
      orientation: 'landscape',
    });
  } else {
    exportToExcel(data, 'Rutas_CuboPolar', 'Rutas', { columns });
  }
}

/**
 * Reporte financiero (ingresos, egresos, CxC, CxP)
 */
export function reporteFinanciero(data, formato = 'excel') {
  const { contabilidad, cxc, cxp } = data;

  // Hoja 1: Movimientos contables
  const colsContab = [
    { key: 'fecha', header: 'Fecha' },
    { key: 'tipo', header: 'Tipo' },
    { key: 'concepto', header: 'Concepto' },
    { key: 'monto', header: 'Monto' },
    { key: 'categoria', header: 'Categoría' },
  ];

  const dataContab = (contabilidad || []).map(c => ({
    fecha: c.fecha || '',
    tipo: c.tipo || '',
    concepto: c.concepto || '',
    monto: typeof c.monto === 'number' ? c.monto : parseFloat(c.monto) || 0,
    categoria: c.categoria || '',
  }));

  // Hoja 2: Cuentas por cobrar
  const colsCxC = [
    { key: 'cliente', header: 'Cliente' },
    { key: 'monto', header: 'Monto' },
    { key: 'fechaVenc', header: 'Vencimiento' },
    { key: 'estatus', header: 'Estatus' },
  ];

  const dataCxC = (cxc || []).map(c => ({
    cliente: c.cliente || c.clienteNombre || '',
    monto: typeof c.monto === 'number' ? c.monto : parseFloat(c.monto) || 0,
    fechaVenc: c.fechaVencimiento || c.fecha_vencimiento || '',
    estatus: c.estatus || '',
  }));

  // Hoja 3: Cuentas por pagar
  const colsCxP = [
    { key: 'proveedor', header: 'Proveedor' },
    { key: 'concepto', header: 'Concepto' },
    { key: 'monto', header: 'Monto' },
    { key: 'fechaVenc', header: 'Vencimiento' },
    { key: 'estatus', header: 'Estatus' },
  ];

  const dataCxP = (cxp || []).map(c => ({
    proveedor: c.proveedor || '',
    concepto: c.concepto || '',
    monto: typeof c.monto === 'number' ? c.monto : parseFloat(c.monto) || 0,
    fechaVenc: c.fechaVencimiento || c.fecha_vencimiento || '',
    estatus: c.estatus || '',
  }));

  if (formato === 'pdf') {
    const totalIngresos = dataContab.filter(c => c.tipo === 'Ingreso').reduce((s, c) => s + c.monto, 0);
    const totalEgresos = dataContab.filter(c => c.tipo === 'Egreso').reduce((s, c) => s + c.monto, 0);
    exportToPDF(dataContab, 'Financiero_CuboPolar', {
      title: 'Reporte Financiero',
      subtitle: `Ingresos: $${totalIngresos.toLocaleString()} | Egresos: $${totalEgresos.toLocaleString()}`,
      columns: colsContab,
    });
  } else {
    exportMultiSheetExcel([
      { name: 'Contabilidad', data: dataContab, columns: colsContab },
      { name: 'Cuentas por Cobrar', data: dataCxC, columns: colsCxC },
      { name: 'Cuentas por Pagar', data: dataCxP, columns: colsCxP },
    ], 'Financiero_CuboPolar');
  }
}

/**
 * Reporte de nómina
 */
export function reporteNomina(empleados, nominas, formato = 'excel') {
  const columns = [
    { key: 'nombre', header: 'Empleado' },
    { key: 'puesto', header: 'Puesto' },
    { key: 'salarioBase', header: 'Salario Base' },
    { key: 'periodo', header: 'Período' },
    { key: 'monto', header: 'Monto Pagado' },
    { key: 'estatus', header: 'Estatus' },
  ];

  // Combinar empleados con sus nóminas
  const data = (nominas || []).map(n => {
    const emp = (empleados || []).find(e => e.id === n.empleadoId || e.id === n.empleado_id);
    return {
      nombre: emp?.nombre || n.empleadoNombre || '',
      puesto: emp?.puesto || '',
      salarioBase: emp?.salario || 0,
      periodo: n.periodo || '',
      monto: typeof n.monto === 'number' ? n.monto : parseFloat(n.monto) || 0,
      estatus: n.estatus || '',
    };
  });

  const totalNomina = data.reduce((s, n) => s + n.monto, 0);

  if (formato === 'pdf') {
    exportToPDF(data, 'Nomina_CuboPolar', {
      title: 'Reporte de Nómina',
      subtitle: `Total: $${totalNomina.toLocaleString('es-MX')}`,
      columns,
    });
  } else {
    exportToExcel(data, 'Nomina_CuboPolar', 'Nómina', { columns });
  }
}

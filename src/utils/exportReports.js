/**
 * Utilidades para exportar reportes a Excel y PDF
 * CuboPolar ERP
 */
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ══════════════════════════════════════════════════════════════

// Sanitizar valores para prevenir formula injection en Excel
// Celdas que empiezan con =, +, -, @ son interpretadas como fórmulas
const sanitizeCell = (v) => {
  if (typeof v !== 'string') return v;
  if (/^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
};

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
    const rows = data.map(row => keys.map(k => sanitizeCell(row[k] ?? '')));
    ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  } else {
    const sanitized = data.map(row => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[k] = sanitizeCell(v);
      return out;
    });
    ws = XLSX.utils.json_to_sheet(sanitized);
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
  autoTable(doc,{
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

/**
 * Reporte de Ruta Diaria — formato estilo hoja física Cubopolar
 * Para una ruta específica con todas sus entregas, mermas, carga y cierre
 */
export function reporteRutaDiaria(ruta, ordenes, mermas, productos, clientes, notas = '') {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Helpers
  const s = v => (v ?? '').toString();
  const n = v => Number(v) || 0;
  const findProd = sku => productos?.find(p => s(p.sku) === s(sku));
  const findCli = id => clientes?.find(c => String(c.id) === String(id));

  // ── HEADER ──
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('CUBO POLAR', 14, 15);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text('FÁBRICA DE HIELO', 14, 20);
  doc.setTextColor(0);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORTE DE RUTA DIARIA', pageWidth / 2, 18, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Folio: ${s(ruta.folio)}`, pageWidth - 14, 15, { align: 'right' });
  const fechaFormat = ruta.fecha_fin || ruta.cierre_at || ruta.fecha || new Date().toISOString().slice(0, 10);
  const fechaShort = fechaFormat.slice(0, 10);
  doc.text(`Fecha: ${fechaShort}`, pageWidth - 14, 21, { align: 'right' });

  // Línea separadora
  doc.setDrawColor(200);
  doc.line(14, 26, pageWidth - 14, 26);

  // ── INFO DE LA RUTA ──
  let y = 32;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Ruta:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(s(ruta.nombre), 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Chofer:', pageWidth / 2, y);
  doc.setFont('helvetica', 'normal');
  doc.text(s(ruta.choferNombre || ruta.chofer_nombre || ruta.chofer), pageWidth / 2 + 20, y);

  y += 6;
  if (ruta.ayudanteNombre || ruta.ayudante_nombre) {
    doc.setFont('helvetica', 'bold');
    doc.text('Ayudante:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(s(ruta.ayudanteNombre || ruta.ayudante_nombre), 35, y);
    y += 6;
  }
  if (ruta.camionNombre || ruta.camion_nombre) {
    doc.setFont('helvetica', 'bold');
    doc.text('Camión:', 14, y);
    doc.setFont('helvetica', 'normal');
    const camionTxt = s(ruta.camionNombre || ruta.camion_nombre) + (ruta.camionPlacas || ruta.camion_placas ? ` — placas ${s(ruta.camionPlacas || ruta.camion_placas)}` : '');
    doc.text(camionTxt, 35, y);
    y += 6;
  }

  // ── TABLA DE CARGA ──
  const carga = (ruta.carga && typeof ruta.carga === 'object') ? ruta.carga : {};
  const cargaAuth = (ruta.carga_autorizada && typeof ruta.carga_autorizada === 'object') ? ruta.carga_autorizada : carga;
  const devolucion = (ruta.devolucion && typeof ruta.devolucion === 'object') ? ruta.devolucion : {};

  const rutaOrdenes = (ordenes || []).filter(o => String(o.rutaId || o.ruta_id) === String(ruta.id));

  // Calcular vendido por SKU desde las órdenes entregadas
  const vendidoPorSku = {};
  for (const o of rutaOrdenes) {
    if (s(o.estatus).toLowerCase() !== 'entregada') continue;
    if (Array.isArray(o.preciosSnapshot) && o.preciosSnapshot.length > 0) {
      for (const ln of o.preciosSnapshot) {
        const sku = s(ln.sku);
        vendidoPorSku[sku] = (vendidoPorSku[sku] || 0) + n(ln.qty || ln.cantidad);
      }
    } else {
      s(o.productos).split(',').forEach(part => {
        const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
        if (!mt) return;
        const sku = s(mt[2]);
        vendidoPorSku[sku] = (vendidoPorSku[sku] || 0) + Number(mt[1] || 0);
      });
    }
  }

  // Calcular merma por SKU
  const mermasRuta = (mermas || []).filter(m => s(m.origen).toLowerCase().includes(s(ruta.choferNombre || ruta.chofer_nombre || '').toLowerCase()));
  const mermaPorSku = {};
  for (const m of mermasRuta) {
    const sku = s(m.sku);
    mermaPorSku[sku] = (mermaPorSku[sku] || 0) + n(m.cantidad || m.cant);
  }

  const cargaRows = [];
  const skusUnicos = new Set([...Object.keys(carga), ...Object.keys(cargaAuth), ...Object.keys(vendidoPorSku), ...Object.keys(devolucion), ...Object.keys(mermaPorSku)]);
  for (const sku of skusUnicos) {
    const prod = findProd(sku);
    const nombreProd = prod ? s(prod.nombre) : sku;
    const cargado = n(carga[sku] || cargaAuth[sku]);
    const dev = n(devolucion[sku]);
    const merma = n(mermaPorSku[sku]);
    const vendido = n(vendidoPorSku[sku]);
    cargaRows.push([nombreProd, sku, cargado, dev, merma, vendido]);
  }

  if (cargaRows.length > 0) {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('CARGA Y MOVIMIENTO', 14, y);
    y += 2;

    autoTable(doc,{
      head: [['Producto', 'SKU', 'Cargado', 'Devuelto', 'Merma', 'Vendido']],
      body: cargaRows,
      startY: y + 2,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'center', fontStyle: 'bold' },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── TABLA DE ENTREGAS ──
  if (rutaOrdenes.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`ENTREGAS DEL DÍA (${rutaOrdenes.length})`, 14, y);
    y += 2;

    const entregasRows = rutaOrdenes.map((o, i) => {
      const cli = findCli(o.clienteId || o.cliente_id);
      return [
        i + 1,
        s(o.folio || `ORD-${o.id}`),
        s(o.cliente || o.cliente_nombre || cli?.nombre || 'Público'),
        s(o.metodoPago || o.metodo_pago || 'Efectivo'),
        `$${n(o.total).toLocaleString('es-MX')}`,
        s(o.estatus),
      ];
    });

    autoTable(doc,{
      head: [['#', 'Folio', 'Cliente', 'Pago', 'Total', 'Estatus']],
      body: entregasRows,
      startY: y + 2,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        4: { halign: 'right', fontStyle: 'bold' },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── RESUMEN ECONÓMICO ──
  const totalCobrado = n(ruta.total_cobrado || ruta.totalCobrado);
  const totalCredito = n(ruta.total_credito || ruta.totalCredito);
  const totalGeneral = totalCobrado + totalCredito;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('RESUMEN ECONÓMICO', 14, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Total cobrado (efectivo + transferencia):', 14, y);
  doc.setFont('helvetica', 'bold');
  doc.text(`$${totalCobrado.toLocaleString('es-MX')}`, pageWidth - 14, y, { align: 'right' });
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.text('Total a crédito:', 14, y);
  doc.setFont('helvetica', 'bold');
  doc.text(`$${totalCredito.toLocaleString('es-MX')}`, pageWidth - 14, y, { align: 'right' });
  y += 5;

  doc.setDrawColor(200);
  doc.line(14, y, pageWidth - 14, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL GENERAL:', 14, y);
  doc.text(`$${totalGeneral.toLocaleString('es-MX')}`, pageWidth - 14, y, { align: 'right' });
  y += 10;

  // ── MERMAS ──
  if (mermasRuta.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`MERMAS REPORTADAS (${mermasRuta.length})`, 14, y);
    y += 2;

    const mermasRows = mermasRuta.map(m => {
      const prod = findProd(m.sku);
      return [
        s(m.sku),
        prod ? s(prod.nombre) : '',
        n(m.cantidad || m.cant),
        s(m.causa || 'Sin causa'),
      ];
    });

    autoTable(doc,{
      head: [['SKU', 'Producto', 'Cantidad', 'Causa']],
      body: mermasRows,
      startY: y + 2,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [254, 242, 242] },
      margin: { left: 14, right: 14 },
      columnStyles: { 2: { halign: 'center' } },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ── NOTAS DEL ADMINISTRADOR ──
  if (notas && notas.trim()) {
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 30;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('NOTAS ADICIONALES', 14, y);
    y += 4;
    doc.setDrawColor(200);
    doc.setFillColor(254, 252, 232);
    const notasLines = doc.splitTextToSize(notas.trim(), pageWidth - 32);
    const notasHeight = (notasLines.length * 4.5) + 6;
    doc.rect(14, y, pageWidth - 28, notasHeight, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(notasLines, 18, y + 5);
    y += notasHeight + 8;
  }

  // ── FIRMAS ──
  // Si no hay espacio, página nueva
  if (y > pageHeight - 50) {
    doc.addPage();
    y = 30;
  } else {
    y = pageHeight - 45;
  }

  doc.setDrawColor(0);
  const firmaWidth = (pageWidth - 40) / 2;
  doc.line(14, y, 14 + firmaWidth, y);
  doc.line(pageWidth - 14 - firmaWidth, y, pageWidth - 14, y);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('FIRMA DEL CHOFER', 14 + firmaWidth / 2, y + 5, { align: 'center' });
  doc.text('FIRMA RESPONSABLE PRODUCCIÓN', pageWidth - 14 - firmaWidth / 2, y + 5, { align: 'center' });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Generado: ${new Date().toLocaleString('es-MX')}`, pageWidth / 2, pageHeight - 8, { align: 'center' });

  // Guardar
  const fileDate = fechaShort.replace(/-/g, '');
  doc.save(`Reporte_Ruta_${s(ruta.folio)}_${fileDate}.pdf`);
}

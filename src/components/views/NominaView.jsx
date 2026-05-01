import { useState, useMemo, Modal, FormBtn, EmptyState, s, n, fmtMoney, useToast } from './viewsCommon';

export function NominaView({ data, actions }) {
  const toast = useToast();
  const emps = data.empleados || [];
  const periodos = data.nominaPeriodos || [];
  const recibos = data.nominaRecibos || [];
  const deptos = ["Ventas y Distribución", "Producción", "Administración", "Staff"];
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState(null);

  const empsPorDepto = {};
  for (const d of deptos) empsPorDepto[d] = emps.filter(e => s(e.depto) === d && s(e.estatus) === "Activo");
  const totalSemanal = emps.filter(e => s(e.estatus) === "Activo").reduce((s, e) => s + n(e.salarioDiario) * 7, 0);

  const periodosPendientes = periodos.filter(p => s(p.estatus) !== "Pagado");
  const periodosPagados = periodos.filter(p => s(p.estatus) === "Pagado").slice(0, 10);

  // Recibos del período seleccionado
  const recibosPeriodo = useMemo(() => {
    if (!periodoSeleccionado) return [];
    return recibos.filter(r => n(r.periodoId) === n(periodoSeleccionado.id));
  }, [recibos, periodoSeleccionado]);

  const empsConRecibo = useMemo(() => {
    const ids = new Set(recibosPeriodo.map(r => n(r.empleadoId)));
    return ids;
  }, [recibosPeriodo]);

  const generarNuevaSemana = async () => {
    const hoy = new Date();
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - hoy.getDay()); // Domingo
    const finSemana = new Date(inicioSemana);
    finSemana.setDate(inicioSemana.getDate() + 6); // Sábado

    // Calcular número de semana y ejercicio (año)
    const startOfYear = new Date(hoy.getFullYear(), 0, 1);
    const daysSinceStart = Math.floor((inicioSemana - startOfYear) / (24 * 60 * 60 * 1000));
    const numeroSemana = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
    const ejercicio = hoy.getFullYear();

    // Verificar si ya existe período de esta semana
    const existente = periodos.find(p => n(p.numeroSemana) === numeroSemana && n(p.ejercicio) === ejercicio);
    if (existente) {
      toast?.error("Ya existe un período para esta semana");
      return;
    }

    // Crear período de nómina con empleados activos
    const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
    const nuevoTotal = empsActivos.reduce((sum, e) => sum + n(e.salarioDiario) * 7, 0);
    const result = await actions.addNominaPeriodo({
      numero_semana: numeroSemana,
      ejercicio: ejercicio,
      fecha_inicio: inicioSemana.toISOString().slice(0, 10),
      fecha_fin: finSemana.toISOString().slice(0, 10),
      fecha_pago: finSemana.toISOString().slice(0, 10), // Pagas el sábado
      dias_pago: 7,
      total_percepciones: nuevoTotal,
      total_deducciones: 0,
      total_neto: nuevoTotal,
      estatus: "Borrador", // Enum: Borrador, Calculada, Pagado
    });
    if (result !== null) return; // Error toast ya mostrado en store
    toast?.success(`Nómina semana ${numeroSemana} generada: ${fmtMoney(nuevoTotal)}`);
  };

  const pagarPeriodo = async (p) => {
    await actions.pagarNomina(p.id);
  };

  const generarRecibosEmpleados = async (periodo) => {
    const empsActivos = emps.filter(e => s(e.estatus) === "Activo");
    let generados = 0;
    for (const emp of empsActivos) {
      // Verificar si ya tiene recibo para este período
      const yaExiste = recibos.some(r => n(r.periodoId) === n(periodo.id) && n(r.empleadoId) === n(emp.id));
      if (yaExiste) continue;

      const dias = n(periodo.diasPago) || 7;
      const percepciones = n(emp.salarioDiario) * dias;
      const deducciones = Math.round(percepciones * 0.02 * 100) / 100; // 2% IMSS estimado
      const neto = percepciones - deducciones;

      await actions.addNominaRecibo({
        periodo_id: periodo.id,
        empleado_id: emp.id,
        dias_pagados: dias,
        salario_base: n(emp.salarioDiario),
        percepciones: percepciones,
        isr: 0,
        imss: deducciones,
        otras_deducciones: 0,
        neto_a_pagar: neto,
      });
      generados++;
    }
    if (generados > 0) {
      toast?.success(`${generados} recibos generados`);
    } else {
      toast?.info("Todos los empleados ya tienen recibo");
    }
  };

  return (<div className="space-y-4">
    <div className="flex justify-between items-center">
      <h2 className="text-lg font-bold text-slate-800">Nómina</h2>
      <button onClick={generarNuevaSemana} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-semibold">+ Generar nómina semana</button>
    </div>
    <div className="bg-white rounded-xl p-5 border border-slate-100">
      <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Total semanal estimado</p>
      <p className="text-3xl font-extrabold text-slate-800">{fmtMoney(totalSemanal, { decimals: 2 })}</p>
      <p className="text-xs text-slate-400 mt-1">{emps.filter(e => s(e.estatus) === "Activo").length} empleados activos · Salario × 7 días</p>
    </div>

    {/* Períodos pendientes de pago */}
    {periodosPendientes.length > 0 && (<div>
      <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mt-4 mb-2">Períodos pendientes de pago</h3>
      <div className="space-y-2">
        {periodosPendientes.map(p => {
          const recibosP = recibos.filter(r => n(r.periodoId) === n(p.id));
          const empsActivos = emps.filter(e => s(e.estatus) === "Activo").length;
          return (
          <div key={p.id} className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-slate-800">Semana {n(p.numeroSemana)} — {n(p.ejercicio)}</p>
                <p className="text-xs text-slate-500">{s(p.fechaInicio)} al {s(p.fechaFin)} · {fmtMoney(p.totalNeto)}</p>
                <p className="text-xs text-slate-400 mt-1">{recibosP.length}/{empsActivos} recibos generados</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => generarRecibosEmpleados(p)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Generar recibos</button>
                <button onClick={() => setPeriodoSeleccionado(p)} className="bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Ver</button>
                <button onClick={() => pagarPeriodo(p)} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-semibold">Pagar</button>
              </div>
            </div>
          </div>
        );})}
      </div>
    </div>)}

    {/* Períodos pagados recientes */}
    {periodosPagados.length > 0 && (<div>
      <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mt-4 mb-2">Pagados recientemente</h3>
      <div className="space-y-1.5">
        {periodosPagados.map(p => (
          <div key={p.id} className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-slate-800">Semana {n(p.numeroSemana)} — {n(p.ejercicio)}</p>
              <p className="text-xs text-slate-400">{s(p.fechaInicio)} al {s(p.fechaFin)}</p>
            </div>
            <p className="text-sm font-bold text-emerald-700">{fmtMoney(p.totalNeto)}</p>
          </div>
        ))}
      </div>
    </div>)}

    {/* Empleados por departamento */}
    {deptos.map(d => {
      const dEmps = empsPorDepto[d] || [];
      if (dEmps.length === 0) return null;
      const totalDepto = dEmps.reduce((s, e) => s + n(e.salarioDiario) * 7, 0);
      return (<div key={d}>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">{d} — {dEmps.length} empleados · {fmtMoney(totalDepto)}/sem</h3>
        <div className="space-y-1.5">
          {dEmps.map(e => (
            <div key={e.id} className="bg-white rounded-lg p-3 border border-slate-100 flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-slate-800">{s(e.nombre)}</p>
                <p className="text-xs text-slate-400">{s(e.puesto)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-800">{fmtMoney(n(e.salarioDiario) * 7)}</p>
                <p className="text-[10px] text-slate-400">{fmtMoney(e.salarioDiario, { decimals: 2 })}/día</p>
              </div>
            </div>
          ))}
        </div>
      </div>);
    })}

    {/* Modal de recibos del período */}
    {periodoSeleccionado && (
      <Modal onClose={() => setPeriodoSeleccionado(null)} title={`Recibos Semana ${n(periodoSeleccionado.numeroSemana)}`}>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {recibosPeriodo.length === 0 ? (
            <EmptyState
              message="Aún no hay recibos generados"
              hint="Usa el botón 'Generar recibos' para crear los del período actual"
            />
          ) : (
            recibosPeriodo.map(r => {
              const emp = emps.find(e => n(e.id) === n(r.empleadoId));
              return (
                <div key={r.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{emp ? s(emp.nombre) : `Empleado #${r.empleadoId}`}</p>
                      <p className="text-xs text-slate-400">{emp ? s(emp.puesto) : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-600">{fmtMoney(r.netoAPagar || r.neto_a_pagar)}</p>
                      <p className="text-[10px] text-slate-400">Neto a pagar</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Días</p>
                      <p className="font-bold text-slate-700">{n(r.diasPagados || r.dias_pagados)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Percepciones</p>
                      <p className="font-bold text-blue-600">{fmtMoney(r.percepciones)}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-slate-400">Deducciones</p>
                      <p className="font-bold text-red-600">{fmtMoney(r.imss)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => generarRecibosEmpleados(periodoSeleccionado)} className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl">Generar faltantes</button>
          <button onClick={() => setPeriodoSeleccionado(null)} className="flex-1 py-3 bg-slate-200 text-slate-700 font-semibold rounded-xl">Cerrar</button>
        </div>
      </Modal>
    )}
  </div>);
}

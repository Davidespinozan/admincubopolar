-- Fix: remove anonymous access from all operational tables.
-- Migration 015 targeted wrong policy names (anon_all vs allow_all_*).

DROP POLICY IF EXISTS "allow_all_auditoria"          ON auditoria;
DROP POLICY IF EXISTS "allow_all_clientes"           ON clientes;
DROP POLICY IF EXISTS "allow_all_comodatos"          ON comodatos;
DROP POLICY IF EXISTS "allow_all_cuartos_frios"      ON cuartos_frios;
DROP POLICY IF EXISTS "allow_all_empleados"          ON empleados;
DROP POLICY IF EXISTS "allow_all_inventario_mov"     ON inventario_mov;
DROP POLICY IF EXISTS "allow_all_leads"              ON leads;
DROP POLICY IF EXISTS "allow_all_mermas"             ON mermas;
DROP POLICY IF EXISTS "allow_all_movimientos_contables" ON movimientos_contables;
DROP POLICY IF EXISTS "allow_all_nomina_periodos"    ON nomina_periodos;
DROP POLICY IF EXISTS "allow_all_nomina_recibos"     ON nomina_recibos;
DROP POLICY IF EXISTS "allow_all_orden_lineas"       ON orden_lineas;
DROP POLICY IF EXISTS "allow_all_ordenes"            ON ordenes;
DROP POLICY IF EXISTS "allow_all_pagos"              ON pagos;
DROP POLICY IF EXISTS "allow_all_precios_esp"        ON precios_esp;
DROP POLICY IF EXISTS "allow_all_produccion"         ON produccion;
DROP POLICY IF EXISTS "allow_all_productos"          ON productos;
DROP POLICY IF EXISTS "allow_all_rutas"              ON rutas;
DROP POLICY IF EXISTS "allow_all_umbrales"           ON umbrales;
DROP POLICY IF EXISTS "allow_all_usuarios"           ON usuarios;

-- Re-create policies allowing only authenticated users.
CREATE POLICY "auth_all_auditoria"          ON auditoria             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_clientes"           ON clientes              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_comodatos"          ON comodatos             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_cuartos_frios"      ON cuartos_frios         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_empleados"          ON empleados             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_inventario_mov"     ON inventario_mov        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_leads"              ON leads                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_mermas"             ON mermas                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_movimientos_contables" ON movimientos_contables FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_nomina_periodos"    ON nomina_periodos       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_nomina_recibos"     ON nomina_recibos        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_orden_lineas"       ON orden_lineas          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_ordenes"            ON ordenes               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_pagos"              ON pagos                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_precios_esp"        ON precios_esp           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_produccion"         ON produccion            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_productos"          ON productos             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_rutas"              ON rutas                 FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_umbrales"           ON umbrales              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_usuarios"           ON usuarios              FOR ALL TO authenticated USING (true) WITH CHECK (true);

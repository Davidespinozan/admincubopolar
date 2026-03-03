-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Limpieza de datos DEMO
-- Borra DEMO-HC-10K, DEMO-HT-10K y ruta DEMO-R-001 sin tocar datos reales
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Quitar referencias en cuartos fríos JSONB (si existen)
DO $$
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cuartos_frios' AND column_name = 'stock'
   ) THEN
      EXECUTE 'UPDATE cuartos_frios
                   SET stock = stock - ''DEMO-HC-10K'' - ''DEMO-HT-10K''
                   WHERE stock ? ''DEMO-HC-10K'' OR stock ? ''DEMO-HT-10K''';
   END IF;
END $$;

-- Borrar movimientos demo relacionados
DO $$
DECLARE
   has_producto boolean;
   has_sku boolean;
   has_origen boolean;
   sql_txt text;
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'inventario_mov'
   ) THEN
      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'inventario_mov' AND column_name = 'producto'
      ) INTO has_producto;

      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'inventario_mov' AND column_name = 'sku'
      ) INTO has_sku;

      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'inventario_mov' AND column_name = 'origen'
      ) INTO has_origen;

      sql_txt := 'DELETE FROM inventario_mov WHERE false';

      IF has_producto THEN
         sql_txt := sql_txt || ' OR producto IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
      END IF;
      IF has_sku THEN
         sql_txt := sql_txt || ' OR sku IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
      END IF;
      IF has_origen THEN
         sql_txt := sql_txt || ' OR origen LIKE ''%DEMO%''';
      END IF;

      EXECUTE sql_txt;
   END IF;
END $$;

-- Borrar líneas y órdenes demo
DO $$
DECLARE
   ol_has_sku boolean;
   ol_has_orden_id boolean;
   o_has_folio boolean;
   o_has_productos boolean;
   sql_txt text;
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ordenes'
   ) THEN
      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ordenes' AND column_name = 'folio'
      ) INTO o_has_folio;

      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ordenes' AND column_name = 'productos'
      ) INTO o_has_productos;

      IF EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'orden_lineas'
      ) THEN
         SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'orden_lineas' AND column_name = 'sku'
         ) INTO ol_has_sku;

         SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'orden_lineas' AND column_name = 'orden_id'
         ) INTO ol_has_orden_id;

         sql_txt := 'DELETE FROM orden_lineas WHERE false';

         IF ol_has_sku THEN
            sql_txt := sql_txt || ' OR sku IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
         END IF;

         IF ol_has_orden_id AND (o_has_folio OR o_has_productos) THEN
            sql_txt := sql_txt || ' OR orden_id IN (SELECT id FROM ordenes WHERE false';
            IF o_has_folio THEN
               sql_txt := sql_txt || ' OR folio LIKE ''DEMO-%''';
            END IF;
            IF o_has_productos THEN
               sql_txt := sql_txt || ' OR productos LIKE ''%DEMO-%''';
            END IF;
            sql_txt := sql_txt || ')';
         END IF;

         EXECUTE sql_txt;
      END IF;

      sql_txt := 'DELETE FROM ordenes WHERE false';
      IF o_has_folio THEN
         sql_txt := sql_txt || ' OR folio LIKE ''DEMO-%''';
      END IF;
      IF o_has_productos THEN
         sql_txt := sql_txt || ' OR productos LIKE ''%DEMO-%''';
      END IF;
      EXECUTE sql_txt;
   END IF;
END $$;

-- Borrar producción demo
DO $$
DECLARE
   p_has_folio boolean;
   p_has_sku boolean;
   sql_txt text;
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'produccion'
   ) THEN
      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'produccion' AND column_name = 'folio'
      ) INTO p_has_folio;

      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'produccion' AND column_name = 'sku'
      ) INTO p_has_sku;

      sql_txt := 'DELETE FROM produccion WHERE false';
      IF p_has_folio THEN
         sql_txt := sql_txt || ' OR folio LIKE ''DEMO-%''';
      END IF;
      IF p_has_sku THEN
         sql_txt := sql_txt || ' OR sku IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
      END IF;

      EXECUTE sql_txt;
   END IF;
END $$;

-- Borrar precios especiales demo
DO $$
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'precios_esp' AND column_name = 'sku'
   ) THEN
      EXECUTE 'DELETE FROM precios_esp WHERE sku IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
   END IF;
END $$;

-- Finalmente borrar productos demo
DO $$
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'sku'
   ) THEN
      EXECUTE 'DELETE FROM productos WHERE sku IN (''DEMO-HC-10K'', ''DEMO-HT-10K'')';
   END IF;
END $$;

-- Borrar ruta demo DEMO-R-001 (y desasignar órdenes ligadas si aplica)
DO $$
DECLARE
   has_ruta_folio boolean;
   has_ruta_nombre boolean;
   has_ord_ruta_id boolean;
BEGIN
   IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'rutas'
   ) THEN
      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'rutas' AND column_name = 'folio'
      ) INTO has_ruta_folio;

      SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'rutas' AND column_name = 'nombre'
      ) INTO has_ruta_nombre;

      IF EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'ordenes'
      ) THEN
         SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'ordenes' AND column_name = 'ruta_id'
         ) INTO has_ord_ruta_id;

         IF has_ord_ruta_id AND (has_ruta_folio OR has_ruta_nombre) THEN
            EXECUTE 'UPDATE ordenes
                     SET ruta_id = NULL
                     WHERE ruta_id IN (
                       SELECT id FROM rutas WHERE false'
              || CASE WHEN has_ruta_folio THEN ' OR folio = ''DEMO-R-001''' ELSE '' END
              || CASE WHEN has_ruta_nombre THEN ' OR nombre ILIKE ''%DEMO%''' ELSE '' END
              || ')';
         END IF;
      END IF;

      IF has_ruta_folio OR has_ruta_nombre THEN
         EXECUTE 'DELETE FROM rutas WHERE false'
           || CASE WHEN has_ruta_folio THEN ' OR folio = ''DEMO-R-001''' ELSE '' END
           || CASE WHEN has_ruta_nombre THEN ' OR nombre ILIKE ''%DEMO%''' ELSE '' END;
      END IF;
   END IF;
END $$;

COMMIT;

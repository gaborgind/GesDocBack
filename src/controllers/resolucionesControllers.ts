import { Request, Response } from 'express'
import {pool} from '../config/db' // PostgreSQL
import { sendResponse } from '../utils/responseHandler'

export const getCargos = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM cargos_dedicacion ')
   sendResponse(res, 200, true, 'Lista de cargos obtenida', result.rows)
  } catch (error: any) {
    sendResponse(res, 500, false, 'Error al cargar cargos', null, error.message)
  }
}

export const getAreas = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM areas ')
    sendResponse(res, 200, true, 'Lista de áreas obtenida', result.rows)
  } catch (error: any) {
    sendResponse(res, 500, false, 'Error al cargar áreas', null, error.message)
  }
}

export const getTipos = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_resoluciones WHERE activo = true ')
    sendResponse(res, 200, true, 'Lista de tipos de resoluciones obtenida', result.rows)
  } catch (error: any) {
    sendResponse(res, 500, false, 'Error al cargar tipos de resoluciones', null, error.message)
  }
}


export const guardarResolucion = async (req: Request, res: Response) => {
    const { 
        fecha, 
        tri, 
        n_minuta, 
        autor_id, 
        // Campos específicos de la resolución
        tipo_resolucion_id, 
        origen, // 'CDI' o 'DI'
        tema, 
        cargo_id, 
        catedra, 
        area_id 
    } = req.body;

    // --- VALIDACIÓN DE CAMPOS OBLIGATORIOS ---
    const camposObligatorios = { 
        fecha, autor_id, tipo_resolucion_id, origen, tema, cargo_id, catedra, area_id 
    };

    for (const [campo, valor] of Object.entries(camposObligatorios)) {
        if (!valor || valor === '') {
            return sendResponse(res, 400, false, `El campo ${campo} es obligatorio.`);
        }
    }

    const client = await pool.connect();
    const anioDocumento = new Date(fecha).getFullYear();

    try {
        await client.query('BEGIN');

        // 1. OBTENER EL SECUENCIAL BLOQUEANDO LA FILA
        // Usamos el 'origen' (CDI/DI) como tipo para el numerador
        const numQuery = `
            INSERT INTO numeradores (tipo, anio, ultimo_numero)
            VALUES ($1, $2, 1)
            ON CONFLICT (tipo, anio) 
            DO UPDATE SET ultimo_numero = numeradores.ultimo_numero + 1
            RETURNING ultimo_numero`;

        const resNum = await client.query(numQuery, [origen, anioDocumento]);
        const nuevoSecuencial = resNum.rows[0].ultimo_numero;
        
        // Formato de ejemplo: "CDI-001/2026"
       const numero_completo = `${origen}-${nuevoSecuencial.toString().padStart(3, '0')}/${anioDocumento}`;

        // 2. INSERTAR EN documentos_master
        const masterRes = await client.query(`
            INSERT INTO documentos_master 
            (numero_completo, numero_secuencial, anio, categoria, fecha, tri, n_minuta, autor_id)
            VALUES ($1, $2, $3, 'RESOLUCION', $4, $5, $6, $7)
            RETURNING id`, 
            [numero_completo, nuevoSecuencial, anioDocumento, fecha, tri || null, n_minuta || null, autor_id]
        );

        const masterId = masterRes.rows[0].id;

        // 3. INSERTAR EN resoluciones_detalles
        await client.query(`
            INSERT INTO resoluciones_detalles 
            (documento_id, tipo_resolucion_id, origen, tema, cargo_id, catedra, area_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [masterId, tipo_resolucion_id, origen, tema, cargo_id, catedra, area_id]
        );

        await client.query('COMMIT');
        
        return sendResponse(res, 201, true, 'Resolución generada correctamente', { 
            id: masterId, 
            numero: numero_completo 
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error al guardar resolución:", e);
        const systemMessage = e instanceof Error ? e.message : "Error desconocido";
        return sendResponse(res, 500, false, 'Error al procesar el guardado', null, systemMessage);
    } finally {
        client.release();
    }
}

// Ejemplo de cómo debería quedar tu consulta en el backend
export const getResolucionesByFilter = async (req: Request, res: Response) => {
    try {
        const { busqueda, origen, tipo, desde, hasta } = req.query;
        let values: any[] = [];
        let conditions: string[] = [];

        const limpiar = (val: any) => (val === 'undefined' || val === 'null' || val === 'Seleccione...' || val === 'Todos' || !val) ? null : val;

        const _busqueda = limpiar(busqueda);
        const _origen = limpiar(origen);
        const _tipo = limpiar(tipo);
        const _desde = limpiar(desde);
        const _hasta = limpiar(hasta);

        // Siempre filtramos por categoría 'RESOLUCION'
        // IMPORTANTE: Usamos el alias "m" que es el que definimos en el query abajo
        conditions.push("m.categoria = 'RESOLUCION'");

        if (_busqueda) {
            values.push(`%${_busqueda}%`);
            // Usamos alias "m" para master y "r" para resoluciones_detalles
            conditions.push(`(m.numero_completo ILIKE $${values.length} OR r.tema ILIKE $${values.length} OR m.anio::text ILIKE $${values.length})`);
        }

        if (_origen) {
            values.push(_origen);
            conditions.push(`r.origen = $${values.length}`);
        }

        if (_tipo) {
            values.push(_tipo);
            conditions.push(`tr.nombre ILIKE $${values.length}`);
        }

        if (_desde && _hasta) {
            values.push(_desde, _hasta);
            conditions.push(`m.fecha BETWEEN $${values.length - 1} AND $${values.length}`);
        }

        // Armamos el WHERE dinámico
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Query con el WHERE dinámico inyectado
        const query = `
          SELECT 
              m.*, 
              r.tema, r.catedra, r.origen,
              tr.nombre AS tipo_nombre,
              c.nombre AS cargo_nombre,
              a.nombre AS area_nombre             
          FROM documentos_master m
          INNER JOIN resoluciones_detalles r ON m.id = r.documento_id 
          LEFT JOIN tipos_resoluciones tr ON r.tipo_resolucion_id = tr.id
          LEFT JOIN cargos_dedicacion c ON r.cargo_id = c.id
          LEFT JOIN areas a ON r.area_id = a.id
          ${whereClause} 
          ORDER BY m.fecha DESC, m.id DESC;
      `;

        const result = await pool.query(query, values);
        return sendResponse(res, 200, true, 'Resoluciones obtenidas', result.rows);

    } catch (error: any) {
        console.error("ERROR SQL:", error.message);
        return sendResponse(res, 500, false, 'Error al filtrar', null, error.message);
    }
}

export const deleteResolucion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const client = await pool.connect(); // Usamos cliente para transacción

    try {
        await client.query('BEGIN');

        // 1. Borramos primero el detalle de la resolución
        await client.query('DELETE FROM resoluciones_detalles WHERE documento_id = $1', [id]);

        // 2. Borramos el registro maestro
        const result = await client.query('DELETE FROM documentos_master WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return sendResponse(res, 404, false, 'No se encontró la resolución');
        }

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Resolución eliminada correctamente');

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("ERROR DELETE:", error.message);
        return sendResponse(res, 500, false, 'Error al eliminar', null, error.message);
    } finally {
        client.release();
    }
}

export const updateResolucion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { 
        fecha, 
        tri, 
        n_minuta, 
        origen, 
        tema, 
        tipo_resolucion_id, 
        cargo_id, 
        area_id, 
        catedra 
    } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Actualizamos la tabla Maestra (Master)
        // Nota: El número y año no solemos editarlos por seguridad, pero podrías sumarlos
        const masterRes = await client.query(
             `UPDATE documentos_master 
             SET tri = $1, 
                 n_minuta = $2, 
                 fecha = $3, 
                 anio = EXTRACT(YEAR FROM $3::date)
             WHERE id = $4`,
            [tri, n_minuta, fecha, id]
        )

         if (masterRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return sendResponse(res, 404, false, 'El documento maestro no existe');
        }
        // 2. Actualizamos la tabla de Detalle
        await client.query(`
            UPDATE resoluciones_detalles 
            SET origen = $1, 
              tema = $2, 
              tipo_resolucion_id = $3, 
              cargo_id = $4, 
              area_id = $5, 
              catedra = $6
            WHERE documento_id = $7
        `, [origen, tema, tipo_resolucion_id, cargo_id, area_id, catedra, id]);

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Resolución actualizada con éxito');

    } catch (error: any) {
        await client.query('ROLLBACK');        
        return sendResponse(res, 500, false, 'Error al actualizar', null, error.message);
    } finally {
        client.release();
    }
}
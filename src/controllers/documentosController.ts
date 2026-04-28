import { Request, Response } from 'express'
import {pool} from '../config/db' // PostgreSQL
import { sendResponse } from '../utils/responseHandler'



// FILTRO AVANZADO: Permite buscar por texto, tipo, destino y rango de fechas
export const getDocumentosByFilter = async (req: Request, res: Response) => {
    try {
        const { q, tipo, destino, desde, hasta } = req.query;
        let values: any[] = [];
        let conditions: string[] = [];
        
        // Construcción dinámica de condiciones
        if (q) {
            values.push(`%${q}%`);
            conditions.push(`(m.numero_completo ILIKE $${values.length} OR d.detalle ILIKE $${values.length})`);
        }
        // Si es 'Todos', no entra al IF y no filtra, trayendo todo.
        if (tipo && tipo !== 'Todos' && tipo !== '') {
            values.push(`%${tipo}%`);
            conditions.push(`td.nombre ILIKE $${values.length}`);
        }
        if (destino) {
            values.push(`%${destino}%`);
            conditions.push(`d.destino ILIKE $${values.length}`);
        }
        if (desde && hasta) {
            values.push(desde, hasta);
            conditions.push(`m.fecha BETWEEN $${values.length - 1} AND $${values.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // El ORDER BY m.fecha DESC garantiza que lo más nuevo esté arriba.
        // Agregamos m.id DESC como segundo criterio por si hay varios documentos el mismo día.
        const query = `
            SELECT 
                m.*, 
                d.destino, d.archivado_en, d.detalle,
                td.nombre AS tipo_documento_nombre
            FROM documentos_master m
            LEFT JOIN documentos_detalles d ON m.id = d.documento_id
            LEFT JOIN tipos_documentos td ON d.tipo_documento_id = td.id
            ${whereClause}
            ORDER BY m.fecha DESC, m.id DESC;
        `;

        const result = await pool.query(query, values);
        
        // Si no hay resultados, result.rows será un array vacío [], lo cual es perfecto para el front.
        return sendResponse(res, 200, true, 'Lista filtrada obtenida', result.rows);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al filtrar documentos', null, error.message);
    }
}

// Obtener un solo documento completo por ID
export const getDocumentoById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                m.*, 
                d.destino, d.archivado_en, d.detalle,
                r.origen, r.tema, r.catedra,
                tr.nombre AS tipo_resolucion_nombre,
                td.nombre AS tipo_documento_nombre,
                c.nombre AS cargo_nombre,
                a.nombre AS area_nombre
            FROM documentos_master m
            LEFT JOIN documentos_detalles d ON m.id = d.documento_id
            LEFT JOIN resoluciones_detalles r ON m.id = r.documento_id
            LEFT JOIN tipos_resoluciones tr ON r.tipo_resolucion_id = tr.id
            LEFT JOIN tipos_documentos td ON d.tipo_documento_id = td.id
            LEFT JOIN cargos_dedicacion c ON r.cargo_id = c.id
            LEFT JOIN areas a ON r.area_id = a.id
            WHERE m.id = $1;
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return sendResponse(res, 404, false, 'Documento no encontrado', null);
        }
        return sendResponse(res, 200, true, 'Documento obtenido con éxito', result.rows[0]);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al obtener el documento', null, error.message);
    }
}

export const getTiposDocumentoGenerales = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre FROM tipos_documentos WHERE activo = TRUE ORDER BY nombre ASC'
        );       
        
        return sendResponse(res, 200, true, 'Tipos de documentos obtenidos correctamente', result.rows);
    } catch (error: unknown) {
        // 2. La lógica del mensaje debe ir DENTRO del catch
        const systemMsg = error instanceof Error ? error.message : 'Error al obtener los datos de tabla tipos_documentos';
        
        return sendResponse(res, 500, false, 'Error al obtener tipos', null, systemMsg);
    }
}

export const createDocumento = async (req: Request, res: Response) => {
    // 1. Pedimos una conexión exclusiva al pool para la transacción
    const client = await pool.connect();
    
    try {
        // 2. Iniciamos la transacción. 
        // Si algo falla de acá en adelante, nada se guarda en la DB (seguridad total).
        await client.query('BEGIN');

        // 3. Recibimos los datos del formulario (req.body)
        const { 
            fecha, tri, n_minuta, autor_id, fichero_url,
            destino, archivado_en, detalle, tipo_documento_id,
            origen, // Aquí viene "CDI", "DI" o puede venir vacío/null
            tema, catedra, tipo_resolucion_id, cargo_id, area_id
        } = req.body;
        console.log("Body", req.body)     
        // Extraemos el año de la fecha para saber en qué numerador buscar
        const anioDocumento = new Date(fecha).getFullYear();

        // 4. LÓGICA DE CLASIFICACIÓN
        // Definimos la clave para la tabla de numeradores (CDI, DI o GENERAL)
       // 4. LÓGICA DE CLASIFICACIÓN
        const claveNumerador = (origen && (origen.toUpperCase() === 'CDI' || origen.toUpperCase() === 'DI')) 
                            ? origen.toUpperCase() 
                            : 'GENERAL';
        console.log("Clave Numerodaor", claveNumerador)     
        // Forzamos que siempre sea uno de los dos valores exactos que espera tu CHECK
        const categoriaMaster = (claveNumerador === 'GENERAL') ? 'GENERAL' : 'RESOLUCION'
        console.log("Categoria master", categoriaMaster)     
           // 5. OBTENCIÓN DEL NÚMERO (Uso de la tabla numeradores)
        // UPDATE ... RETURNING aumenta el contador y nos da el nuevo número al instante.
        const queryNum = `
            UPDATE numeradores 
            SET ultimo_numero = ultimo_numero + 1 
            WHERE tipo = $1 AND anio = $2 
            RETURNING ultimo_numero`
        console.log("query Num", queryNum)     
        const resNum = await client.query(queryNum, [claveNumerador, anioDocumento]);

        // Si no existe el renglón en la tabla numeradores, lanzamos error
        if (resNum.rows.length === 0) {
            throw new Error(`No existe numerador para ${claveNumerador} en el año ${anioDocumento}`);
        }

        const nuevoSecuencial = resNum.rows[0].ultimo_numero;

        // 6. ARMADO DEL "NÚMERO COMPLETO"
        // Ejemplo: "CDI 15/2024" o "15/2024"
        const prefijo = (claveNumerador !== 'GENERAL') ? `${claveNumerador} ` : ''
        const numeroCompleto = `${prefijo}${nuevoSecuencial}/${anioDocumento}`
        console.log("Prefijo ", prefijo)   
        console.log("Numero completo", numeroCompleto)   
        // 7. PRIMER INSERT: Tabla documentos_master
        const masterRes = await client.query(
            `INSERT INTO documentos_master 
            (numero_completo, numero_secuencial, anio, categoria, fecha, tri, n_minuta, autor_id, fichero_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [numeroCompleto, nuevoSecuencial, anioDocumento, categoriaMaster, fecha, tri, n_minuta, autor_id, fichero_url]
        );
         console.log("mARTER RES ", masterRes.rows[0])           
        const newId = masterRes.rows[0].id; // El ID que generó Postgres

        // 8. SEGUNDO INSERT: Tabla de detalles (Bifurcación)
        if (categoriaMaster === 'GENERAL') {
            // Se va a la tabla de Notas comunes
            await client.query(
                `INSERT INTO documentos_detalles (documento_id, tipo_documento_id, destino, archivado_en, detalle) 
                VALUES ($1, $2, $3, $4, $5)`,
                [newId, tipo_documento_id, destino, archivado_en, detalle]
            );
        } else {
            // Se va a la tabla de Resoluciones (CDI/DI)
            await client.query(
                `INSERT INTO resoluciones_detalles (documento_id, tipo_resolucion_id, origen, tema, cargo_id, catedra, area_id) 
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [newId, tipo_resolucion_id, origen, tema, cargo_id, catedra, area_id]
            );
        }

        // 9. Si llegamos acá sin errores, confirmamos todos los cambios en la DB
        await client.query('COMMIT');
        
        // 10. Respondemos al Front con el éxito y el número que se autogeneró
        return sendResponse(res, 201, true, 'Documento creado', { 
            id: newId, 
            numero: numeroCompleto 
        });

    } catch (error: any) {
        // Si algo falló (ej: se cortó la luz o el servidor), deshacemos todo
        await client.query('ROLLBACK');
        console.error('ERROR EN CREATE:', error.message);
        return sendResponse(res, 500, false, 'Error al crear documento', null, error.message);
    } finally {
        // Liberamos la conexión para que otro usuario la pueda usar
        client.release();
    }
}

// Ejemplo de lógica en tu API Node.js

export const guardarDocumentoGeneral = async (req: Request, res: Response) => {
    const { 
        tipo_documento_id, 
        tipo_documento_nombre, 
        fecha, 
        tri, 
        n_minuta, 
        autor_id, 
        detalle, 
        destino, 
        archivado_en 
    } = req.body;

    const client = await pool.connect();
    const anioDocumento = new Date(fecha).getFullYear();

    try {
        await client.query('BEGIN');

        // 1. GESTIÓN DEL NUMERADOR ÚNICO PARA 'GENERAL'
        // No importa si es Nota o Memo, buscamos el contador de la categoría 'GENERAL'
        const numQuery = `
            INSERT INTO numeradores (tipo, anio, ultimo_numero)
            VALUES ('GENERAL', $1, 1)
            ON CONFLICT (tipo, anio) 
            DO UPDATE SET ultimo_numero = numeradores.ultimo_numero + 1
            RETURNING ultimo_numero`;

        const resNum = await client.query(numQuery, [anioDocumento]);
        const nuevoSecuencial = resNum.rows[0].ultimo_numero;
        
        // Formato: "1/2026", "2/2026", etc.
        const numero_completo = `${nuevoSecuencial}/${anioDocumento}`;

        // 2. INSERTAR EN MASTER (Usamos 'GENERAL' como categoría)
        const masterRes = await client.query(`
            INSERT INTO documentos_master 
            (numero_completo, numero_secuencial, anio, categoria, fecha, tri, n_minuta, autor_id)
            VALUES ($1, $2, $3, 'GENERAL', $4, $5, $6, $7)
            RETURNING id`, 
            [numero_completo, nuevoSecuencial, anioDocumento, fecha, tri || null, n_minuta || null, autor_id]
        );

        const masterId = masterRes.rows[0].id;

        // 3. INSERTAR EN DETALLES 
        // (Aquí sí guardamos si es Nota/Memo/Providencia mediante el tipo_documento_id)
        await client.query(`
            INSERT INTO documentos_detalles 
            (documento_id, tipo_documento_id, detalle, destino, archivado_en)
            VALUES ($1, $2, $3, $4, $5)`,
            [masterId, tipo_documento_id, detalle, destino, archivado_en]
        );

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Documento guardado', { id: masterId, numero: numero_completo });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error en DB:", e);
        const systemMessage = e instanceof Error ? e.message : "Error desconocido";
        return sendResponse(res, 500, false, 'Error al procesar el guardado', null, systemMessage);
    } finally {
        client.release();
    }
};

export const updateDocumentoGeneral = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { tri, n_minuta, detalle, destino, archivado_en } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Actualizamos la tabla MASTER (tri y n_minuta)
        await client.query(
            `UPDATE documentos_master 
             SET tri = $1, n_minuta = $2 
             WHERE id = $3`,
            [tri, n_minuta, id]
        );

        // Actualizamos la tabla DETALLES (detalle, destino, archivado_en)
        await client.query(
            `UPDATE documentos_detalles 
             SET detalle = $1, destino = $2, archivado_en = $3 
             WHERE documento_id = $4`,
            [detalle, destino, archivado_en, id]
        );

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Documento actualizado con éxito');
    } catch (error: any) {
        await client.query('ROLLBACK');
        return sendResponse(res, 500, false, 'Error al actualizar documento', null, error.message);
    } finally {
        client.release();
    }
};
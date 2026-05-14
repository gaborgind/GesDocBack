import { Request, Response } from 'express'
import {pool} from '../config/db' // PostgreSQL
import { sendResponse } from '../utils/responseHandler'
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import fs from "fs";
import path from "path";
import libre from 'libreoffice-convert';
import { promisify } from 'util';



// FILTRO AVANZADO: Permite buscar por texto, tipo, destino y rango de fechas
export const getDocumentosByFilter = async (req: Request, res: Response) => {
    try {
        const { busqueda, tipo, destino, desde, hasta } = req.query;
        let values: any[] = [];       
        // FILTRO CLAVE: Solo traer lo que sea categoría GENERAL
        let conditions: string[] = ["m.categoria = 'GENERAL'"]; 
        
        // Construcción dinámica de condiciones
        if (busqueda) {
            values.push(`%${busqueda}%`);
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
        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const query = `
            SELECT 
                m.*, 
                d.destino, d.archivado_en, d.detalle,
                td.nombre AS tipo_documento_nombre
            FROM documentos_master m
            INNER JOIN documentos_detalles d ON m.id = d.documento_id -- Cambiamos a INNER para mayor seguridad
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

// export const guardarDocumentoGeneral = async (req: Request, res: Response) => {
//     const { 
//         tipo_documento_id, 
//         tipo_documento_nombre, 
//         fecha, 
//         tri, 
//         n_minuta, 
//         autor_id, 
//         detalle, 
//         destino, 
//         archivado_en 
//     } = req.body;

//     const client = await pool.connect();
//     const anioDocumento = new Date(fecha).getFullYear();

//     try {
//         await client.query('BEGIN');

//         // 1. GESTIÓN DEL NUMERADOR ÚNICO PARA 'GENERAL'
//         // No importa si es Nota o Memo, buscamos el contador de la categoría 'GENERAL'
//         const numQuery = `
//             INSERT INTO numeradores (tipo, anio, ultimo_numero)
//             VALUES ('GENERAL', $1, 1)
//             ON CONFLICT (tipo, anio) 
//             DO UPDATE SET ultimo_numero = numeradores.ultimo_numero + 1
//             RETURNING ultimo_numero`;

//         const resNum = await client.query(numQuery, [anioDocumento]);
//         const nuevoSecuencial = resNum.rows[0].ultimo_numero;
        
//         // Formato: "1/2026", "2/2026", etc.
//         const numero_completo = `${nuevoSecuencial}/${anioDocumento}`;

//         // 2. INSERTAR EN MASTER (Usamos 'GENERAL' como categoría)
//         const masterRes = await client.query(`
//             INSERT INTO documentos_master 
//             (numero_completo, numero_secuencial, anio, categoria, fecha, tri, n_minuta, autor_id)
//             VALUES ($1, $2, $3, 'GENERAL', $4, $5, $6, $7)
//             RETURNING id`, 
//             [numero_completo, nuevoSecuencial, anioDocumento, fecha, tri || null, n_minuta || null, autor_id]
//         );

//         const masterId = masterRes.rows[0].id;

//         // 3. INSERTAR EN DETALLES 
//         // (Aquí sí guardamos si es Nota/Memo/Providencia mediante el tipo_documento_id)
//         await client.query(`
//             INSERT INTO documentos_detalles 
//             (documento_id, tipo_documento_id, detalle, destino, archivado_en)
//             VALUES ($1, $2, $3, $4, $5)`,
//             [masterId, tipo_documento_id, detalle, destino, archivado_en]
//         );

//         await client.query('COMMIT');
//         return sendResponse(res, 201, true, 'Documento guardado', { id: masterId, numero: numero_completo });

//     } catch (e) {
//         await client.query('ROLLBACK');
//         console.error("Error en DB:", e);
//         const systemMessage = e instanceof Error ? e.message : "Error desconocido";
//         return sendResponse(res, 500, false, 'Error al procesar el guardado', null, systemMessage);
//     } finally {
//         client.release();
//     }
// };
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
        archivado_en,
        plantilla_id // <--- Agregamos la referencia a la plantilla seleccionada
    } = req.body;

    const client = await pool.connect();
    const anioDocumento = new Date(fecha).getFullYear();

    try {
        await client.query('BEGIN');

        // 1. GESTIÓN DEL NUMERADOR ÚNICO PARA 'GENERAL'
        const numQuery = `
            INSERT INTO numeradores (tipo, anio, ultimo_numero)
            VALUES ('GENERAL', $1, 1)
            ON CONFLICT (tipo, anio) 
            DO UPDATE SET ultimo_numero = numeradores.ultimo_numero + 1
            RETURNING ultimo_numero`;

        const resNum = await client.query(numQuery, [anioDocumento]);
        const nuevoSecuencial = resNum.rows[0].ultimo_numero;
        
        const numero_completo = `${nuevoSecuencial}/${anioDocumento}`;

        // 2. INSERTAR EN MASTER (Ahora con plantilla_id)
        // Agregamos la columna plantilla_id y el parámetro $8
        const masterRes = await client.query(`
            INSERT INTO documentos_master 
            (numero_completo, numero_secuencial, anio, categoria, fecha, tri, n_minuta, autor_id, plantilla_id)
            VALUES ($1, $2, $3, 'GENERAL', $4, $5, $6, $7, $8)
            RETURNING id`, 
            [
                numero_completo, 
                nuevoSecuencial, 
                anioDocumento, 
                fecha, 
                tri || null, 
                n_minuta || null, 
                autor_id,
                plantilla_id || null // <--- Guardamos la relación
            ]
        );

        const masterId = masterRes.rows[0].id;

        // 3. INSERTAR EN DETALLES 
        await client.query(`
            INSERT INTO documentos_detalles 
            (documento_id, tipo_documento_id, detalle, destino, archivado_en)
            VALUES ($1, $2, $3, $4, $5)`,
            [masterId, tipo_documento_id, detalle, destino, archivado_en]
        );

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Documento guardado correctamente', { id: masterId, numero: numero_completo });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error en DB:", e);
        const systemMessage = e instanceof Error ? e.message : "Error desconocido";
        return sendResponse(res, 500, false, 'Error al procesar el guardado', null, systemMessage);
    } finally {
        client.release();
    }
}
// export const actualizarDocumento = async (req: Request, res: Response) => {
//     const { id } = req.params;
//     const { 
//         fecha, 
//         tri, 
//         n_minuta, 
//         detalle, 
//         destino, 
//         archivado_en, 
//         tipo_documento_id 
//     } = req.body;

//     const client = await pool.connect();

//     try {
//         await client.query('BEGIN');

//         // 1. Actualizamos documentos_master
//         // Solo los campos que pertenecen a esta tabla según tu esquema
//         const masterRes = await client.query(
//             `UPDATE documentos_master 
//              SET tri = $1, 
//                  n_minuta = $2, 
//                  fecha = $3, 
//                  anio = EXTRACT(YEAR FROM $3::date)
//              WHERE id = $4`,
//             [tri, n_minuta, fecha, id]
//         );

//         if (masterRes.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return sendResponse(res, 404, false, 'El documento maestro no existe');
//         }

//         // 2. Actualizamos documentos_detalles
//         // Aquí es donde movemos el tipo_documento_id según tu esquema
//         await client.query(
//             `UPDATE documentos_detalles 
//              SET detalle = $1, 
//                  destino = $2, 
//                  archivado_en = $3,
//                  tipo_documento_id = $4
//              WHERE documento_id = $5`,
//             [detalle, destino, archivado_en, tipo_documento_id, id]
//         );

//         await client.query('COMMIT');
//         return sendResponse(res, 200, true, 'Documento actualizado con éxito');

//     } catch (error: any) {
//         await client.query('ROLLBACK');
//         console.error("Error en Transacción:", error);
//         return sendResponse(res, 500, false, 'Error al actualizar documento', null, error.message);
//     } finally {
//         client.release();
//     }
// }
export const actualizarDocumento = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { 
        fecha, 
        tri, 
        n_minuta, 
        detalle, 
        destino, 
        archivado_en, 
        tipo_documento_id,
        plantilla_id // <--- Nuevo campo recibido del body
    } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Actualizamos documentos_master
        // Incluimos plantilla_id en la actualización
        const masterRes = await client.query(
            `UPDATE documentos_master 
             SET tri = $1, 
                 n_minuta = $2, 
                 fecha = $3, 
                 anio = EXTRACT(YEAR FROM $3::date),
                 plantilla_id = $4
             WHERE id = $5`,
            [tri, n_minuta, fecha, plantilla_id || null, id]
        );

        if (masterRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return sendResponse(res, 404, false, 'El documento maestro no existe');
        }

        // 2. Actualizamos documentos_detalles
        await client.query(
            `UPDATE documentos_detalles 
             SET detalle = $1, 
                 destino = $2, 
                 archivado_en = $3,
                 tipo_documento_id = $4
             WHERE documento_id = $5`,
            [detalle, destino, archivado_en, tipo_documento_id, id]
        );

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Documento actualizado con éxito');

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("Error en Transacción:", error);
        return sendResponse(res, 500, false, 'Error al actualizar documento', null, error.message);
    } finally {
        client.release();
    }
}
export const borrarDocumentoId = async (req: Request, res: Response) => {
    const { id } = req.params;

    // Validación básica: asegurarse de que el ID sea un número
    if (!id || isNaN(Number(id))) {
        return sendResponse(res, 400, false, 'ID de documento no válido');
    }

    try {
        // Ejecutamos el DELETE en la tabla MASTER
        // El ON DELETE CASCADE borrará automáticamente en documentos_detalles
        const result = await pool.query(
            'DELETE FROM documentos_master WHERE id = $1 RETURNING *',
            [id]
        );

        // Si no se afectó ninguna fila, el documento no existía
        if (result.rowCount === 0) {
            return sendResponse( res, 404, false, 'El documento que intenta eliminar no existe');
        }

        // Respuesta exitosa
        return sendResponse( res, 200, true, 'Documento eliminado correctamente del sistema');

    } catch (error: any) {
        console.error('Error al eliminar documento:', error);
        
        // Manejo de errores específicos de base de datos si fuera necesario
        return sendResponse(res, 500,false,'Error interno al intentar eliminar el registro', null, error.message);
    } 
}
export const getDestinos = async (req: Request, res: Response) => {
    try {
        // Ordenamos alfabéticamente para que el select sea fácil de usar       
        const { rows } = await pool.query('SELECT id, nombre FROM destino ORDER BY nombre ASC');
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener destinos' });
    }
}
export const guardarDestinos = async (req: Request, res: Response) => {
    const { nombre } = req.body;

    if (!nombre) {
        return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    }

    try {
        // 1. Buscamos si ya existe (sin importar mayúsculas/minúsculas)
        const [existe]: any = await pool.query(
            'SELECT id, nombre FROM destino WHERE LOWER(nombre) = LOWER(?)', 
            [nombre.trim()]
        );

        if (existe.length > 0) {
            // Si ya existe, devolvemos el que encontramos para que React lo seleccione
            return res.json({ 
                success: true, 
                message: 'El destino ya existía, se seleccionó automáticamente.',
                data: existe[0], // Devolvemos {id, nombre} del existente
                existia: true 
            });
        }

        // 2. Si no existe, lo insertamos
        const [result]: any = await pool.query(
            'INSERT INTO destino (nombre) VALUES (?)', 
            [nombre.trim()]
        );

        res.json({ 
            success: true, 
            data: { id: result.insertId, nombre: nombre.trim() },
            existia: false
        });

    } catch (error: any) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Este destino ya existe' });
        }
        res.status(500).json({ success: false, message: 'Error al procesar el destino' });
    }
}
export const getArchivadoEn = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM archivado_en ORDER BY nombre ASC');
        res.json({ 
            success: true, 
            data: result.rows 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener lugares de archivo' });
    }
}

export const getPlantillas = async (req: Request, res: Response) => {
    
    const { categoria } = req.query;

    try {
        let query = `
            SELECT id, nombre, archivo_path, campos_disponibles, categoria 
            FROM plantillas 
            WHERE 1=1
        `;
        const params: any[] = [];

        // Si el usuario envía una categoría, filtramos los resultados
        if (categoria) {
            query += ` AND categoria = $1`;
            params.push(categoria);
        }

        query += ` ORDER BY nombre ASC`;

        const { rows } = await pool.query(query, params);

        return sendResponse(res, 200, true, 'Plantillas obtenidas con éxito', rows);
    } catch (error: any) {
        console.error("Error al obtener plantillas:", error);
        return sendResponse(res, 500, false, 'Error al obtener la lista de plantillas', null, error.message);
    }
}

const convertAsync = promisify(libre.convert);

export const generarPdfDocumento = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT m.*, d.detalle, d.destino, p.archivo_path, p.campos_disponibles
            FROM documentos_master m
            LEFT JOIN documentos_detalles d ON m.id = d.documento_id
            LEFT JOIN plantillas p ON m.plantilla_id = p.id
            WHERE m.id = $1`;
        
        const { rows } = await pool.query(query, [req.params.id]);
        const doc = rows[0];

        if (!doc) return sendResponse(res, 404, false, "El registro no existe");
        if (!doc.plantilla_id) return sendResponse(res, 400, false, "Este registro no tiene una plantilla asignada");

        const rutaRelativa = doc.archivo_path.startsWith('/') ? doc.archivo_path.substring(1) : doc.archivo_path;
        const pathFinal = path.join(process.cwd(), '..', rutaRelativa);

        if (!fs.existsSync(pathFinal)) {
            return sendResponse(res, 500, false, "No se encuentra el archivo de la plantilla", null, { pathIntentado: pathFinal });
        }

        // --- FORMATEO DE FECHA FORMAL (Ej: 15 de Abril de 2026) ---
        const fechaObj = new Date(doc.fecha);
        const fechaFormateada = new Intl.DateTimeFormat('es-AR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }).format(fechaObj).replace(/ de /g, ' de ').replace(/^./, str => str.toUpperCase()); 
        // El replace de arriba asegura el formato "15 de Abril de 2026"

        const content = fs.readFileSync(pathFinal, "binary");
        const zip = new PizZip(content);
        const docx = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        docx.render({
            numero: doc.numero_completo,
            fecha: fechaFormateada, // Enviamos la fecha larga a la plantilla
            detalle: doc.detalle || "",
            destino: doc.destino || ""
        });

        const bufferDocx = docx.getZip().generate({ type: "nodebuffer" });

        // --- NOMBRE DE ARCHIVO (Solo número completo) ---
        const nombreArchivo = doc.numero_completo.toUpperCase().replace(/\//g, '-');
        const fileNameEncoded = encodeURIComponent(nombreArchivo);

        try {
            const bufferPdf = await convertAsync(bufferDocx, '.pdf', undefined);            
            
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${nombreArchivo}.pdf"; filename*=UTF-8''${fileNameEncoded}.pdf`,
                'Access-Control-Expose-Headers': 'Content-Disposition'
            });
            return res.send(bufferPdf);

        } catch (err) {            
            console.warn("Motor LibreOffice no disponible. Enviando .docx");            
            
            res.set({
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': `attachment; filename="${nombreArchivo}.docx"; filename*=UTF-8''${fileNameEncoded}.docx`,
                'Access-Control-Expose-Headers': 'Content-Disposition'
            });
            
            return res.send(bufferDocx);
        }

    } catch (error: any) {
        console.error("Error completo:", error);
        return sendResponse(res, 500, false, "Error interno", null, error.message);
    }
}
import { Request, Response } from 'express'
import {pool} from '../config/db' // PostgreSQL
import { sendResponse } from '../utils/responseHandler'


//Tomar los datos de Tipos_documentos  - para los desplegables 
export const getTiposDocumentos = async (res: Response) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM tipos_documentos ORDER BY id ASC');
        return sendResponse(res, 200, true, 'Tipos de documentos obtenidos con éxito', result.rows);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al obtener tipos de documentos', null, error.message);
    }
};
//Tomar los datos de Tipos_resoluciones - para los desplegables 
export const getTiposResoluciones = async (res: Response) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM tipos_resoluciones ORDER BY id ASC');
        return sendResponse(res, 200, true, 'Tipos de resoluciones obtenidos con éxito', result.rows);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al obtener tipos de resoluciones', null, error.message);
    }
};
//Tomar los datos de areas - para los desplegables 
export const getAreas = async (res: Response) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM areas ORDER BY id ASC');
        return sendResponse(res, 200, true, 'Áreas obtenidas con éxito', result.rows);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al obtener áreas', null, error.message);
    }
};
//Tomar los datos de cargos_dedicaicon - para los desplegables 
export const getCargos = async (res: Response) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM cargos_dedicacion ORDER BY id ASC');
        return sendResponse(res, 200, true, 'Cargos obtenidos con éxito', result.rows);
    } catch (error: any) {
        return sendResponse(res, 500, false, 'Error al obtener cargos', null, error.message);
    }
};



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
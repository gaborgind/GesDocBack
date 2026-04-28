import { Response } from 'express';

/**
 * Estructura única de respuesta para toda la API
 */
export const sendResponse = (
  res: Response,
  status: number,
  success: boolean,
  message: string,
  data: any = null,
  errorDetail: any = null
) => {
  return res.status(status).json({
    success,
    message,
    data,
    error: !success ? {
      userMessage: message,
      systemMessage: errorDetail || 'No hay detalles adicionales'
    } : null
  });
};
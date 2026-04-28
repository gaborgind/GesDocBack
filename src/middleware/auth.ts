import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendResponse } from '../utils/responseHandler';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 1. Obtener el token del header 'Authorization'
  // El estándar es: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return sendResponse(res, 401, false, 'Acceso denegado. No se proporcionó un token de sesión.');
  }

  try {
    // 2. Verificar el token con tu clave secreta
    const secret = process.env.JWT_SECRET || 'clave_secreta_segura';
    const decoded = jwt.verify(token, secret) as any;

    // 3. Guardar los datos del usuario dentro de la petición (req)
    // Esto nos permite saber quién está operando en los controladores
    (req as any).user = decoded;

    // 4. Continuar con la ejecución
    next();
  } catch (error) {
    return sendResponse(res, 403, false, 'Sesión inválida o expirada. Por favor, vuelva a ingresar.');
  }
}
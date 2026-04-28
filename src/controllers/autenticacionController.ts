import { Request, Response } from 'express'
import { pool } from '../config/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { transporter } from '../config/mailer'
import { sendResponse } from '../utils/responseHandler'

// --- REGISTRO --- REGISTRAR NUEVO USUARIO
export const register = async (req: Request, res: Response) => {
  const { nombre, apellido, email, password } = req.body
  const requiredDomain = "@uns.edu.ar"
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@%&$.,])[A-Za-z\d@%&$.,]{8,}$/;

  // console.log('1. BACKENDS Registro para:', { nombre, apellido, email });

  try {
     // Validar campos obligatorios
    if (!nombre || !apellido || !email || !password) {
      return sendResponse(res, 400, false, 'Todos los campos son obligatorios.');
    }

    if (!email || !email.toLowerCase().endsWith(requiredDomain)) {
      return sendResponse(res, 400, false, "Acceso denegado: el correo debe terminar en @uns.edu.ar", null, "Fallo la validacion del dominio: el correo no termina en @uns.edu.ar" // Detalle técnico
      )  
    }  
    if (!password || !passwordRegex.test(password)) {
       return sendResponse(res, 400,false, "La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial (@%&$.,)",
        null,"Fallo la politica de privacidad: La contraseña no cumple con los requisitos")
  }  
    
    const emailLower = email.toLowerCase().trim()

    // console.log(`2. Verificando disponibilidad de: ${emailLower}`)

    // 💡 CONSULTA DE EXISTENCIA (Rápida y segura)
    const checkResult = await pool.query('SELECT EXISTS(SELECT 1 FROM usuarios WHERE email = $1)', [emailLower] )

    if (checkResult.rows[0].exists) { return sendResponse(res, 400, false, 'El correo electrónico ya está registrado')}

    // Si no existe, procedemos   

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const rol = 'operador';

    // Inserción en Base de Datos
    console.log('4. Insertando nuevo usuario...');
    const newUser = await pool.query(
      `INSERT INTO usuarios (nombre, apellido, email, password_hash, rol, activo) 
       VALUES ($1, $2, $3, $4, $5, TRUE) 
       RETURNING id, nombre, apellido, email, rol`,
      [nombre, apellido, emailLower, hashedPassword, rol]
    )

    return sendResponse(res, 201, true, 'Usuario creado con éxito', { user: newUser.rows[0] });

  } catch (error: any) {    
    return sendResponse(res, 500, false, 'Error interno al crear el usuario', null, error.message);
  }
}

// --- LOGIN ---INICIO DE SESION
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body
  const requiredDomain = "@uns.edu.ar"

  // console.log('2. BACKENDS Inicio de sesión para:', { email, password });

  try {

     // Validar campos obligatorios
    if ( !email || !password) {
      return sendResponse(res, 400, false, 'Todos los campos son obligatorios.');
    }

    if (!email || !email.toLowerCase().endsWith(requiredDomain)) {
      return sendResponse(res, 400, false, "Acceso denegado: el correo debe terminar en @uns.edu.ar", null, "Fallo la validacion del dominio: el correo no termina en @uns.edu.ar" // Detalle técnico
      )  
    }    

    const result = await pool.query(
      'SELECT id, nombre, apellido, email, password_hash, rol FROM usuarios WHERE email = $1 AND activo = TRUE', 
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return sendResponse(res, 401, false, 'Credenciales Inválidas');
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash.trim());
    if (!validPassword) {
      return sendResponse(res, 401, false, 'Credenciales Inválidas');
    }

    const token = jwt.sign(
      { id: user.id, rol: user.rol, email: user.email },
      process.env.JWT_SECRET || 'clave_secreta_segura',
      { expiresIn: '8h' }
    );

    return sendResponse(res, 200, true, 'Bienvenido al sistema', {
      token,
      user: { 
        id: user.id,
        nombre: user.nombre, 
        apellido: user.apellido,
        email: user.email,
        rol: user.rol 
      }
    });

  } catch (error: any) {   
    return sendResponse(res, 500, false, 'Error interno del servidor', null, error.message);
  }
}

// --- SOLICITAR RECUPERACIÓN DE USUSARIO -- ENVIO DE MAIL--- RESETEAR-CONTRASEÑA
export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body
  const requiredDomain = "@uns.edu.ar"

  // console.log('3. BACKENDS Solicitando recuperación de contraseña para:', { email });

  try {

    if (!email || !email.toLowerCase().endsWith(requiredDomain)) {
      return sendResponse(res, 400, false, "Acceso denegado: el correo debe terminar en @uns.edu.ar", null, "Fallo la validacion del dominio: el correo no termina en @uns.edu.ar" // Detalle técnico
      )  
    }    

    const user = await pool.query('SELECT id, nombre FROM usuarios WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return sendResponse(res, 404, false, 'No existe un usuario con ese correo institucional.');
    }
  
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60000); 

    await pool.query(
      'UPDATE usuarios SET reset_codigo = $1, reset_codigo_expires = $2 WHERE email = $3',
      [codigo, expires, email]
    );

    await transporter.sendMail({
      from: `"Dep. Ingeneiria - Sistema Gestión Documental " <${process.env.EMAIL_USER}>`,
      to: email, 
      subject: "Código de Recuperación - Sistema de Gestión Documental",
      html: `<h2>Código: ${codigo}</h2><p> Vence en 15 minutos.</p>`,
    });

    return sendResponse(res, 200, true, 'Código enviado con éxito.');

  } catch (error: any) {
    return sendResponse(res, 500, false, 'Error al procesar la solicitud.', null, error.message);
  }
}

// --- VERIFICAR CÓDIGO   --- INGRESAR CODIGO DE RECUPERACION PARA VER SI ES VALIDO O NO
export const verificarCodigo = async (req: Request, res: Response) => {
  const { email, codigo } = req.body;
  
  // console.log('4. BACKENDS Verificando código para:', { email, codigo });

  try {
    const result = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND reset_codigo = $2 AND reset_codigo_expires > NOW()',
      [email, codigo]
    );

    if (result.rows.length === 0) return sendResponse(res, 400, false, 'Código incorrecto o expirado.');
    return sendResponse(res, 200, true, 'Código verificado con éxito.');
  } catch (error: any) {
    return sendResponse(res, 500, false, 'Error al verificar el código.', null, error.message);
  }
}

// --- RESETEAR CONTRASEÑA --- INGRESAR NUEVA CONTRASEÑA 
export const resetPassword = async (req: Request, res: Response) => {
  const { email, codigo, nuevaPassword } = req.body;

  // console.log('5. BACKENDS Resetear contraseña para:', { email, codigo, nuevaPassword });

  try {
    if (!email || !codigo || !nuevaPassword) {
      return sendResponse(res, 400, false, 'Todos los campos son obligatorios.');
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(nuevaPassword)) {
      return sendResponse(res, 400, false, 'Contraseña débil.');
    }

    const userQuery = await pool.query(
      `SELECT id, nombre, apellido, email, rol FROM usuarios 
       WHERE email = $1 AND reset_codigo = $2 AND reset_codigo_expires > NOW()`,
      [email, codigo]
    );

    if (userQuery.rows.length === 0) {
      return sendResponse(res, 401, false, 'El código es inválido o ha expirado.');
    }

    const usuario = userQuery.rows[0];
    const hashedPassword = await bcrypt.hash(nuevaPassword, 12);

    await pool.query(
      'UPDATE usuarios SET password_hash = $1, reset_codigo = NULL, reset_codigo_expires = NULL WHERE id = $2',
      [hashedPassword, usuario.id]
    )

    const sessionToken = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET || 'clave_secreta_segura',
      { expiresIn: '8h' }
    )

    return sendResponse(res, 200, true, 'Contraseña actualizada!', {
      token: sessionToken,
      user: { 
        id: usuario.id, 
        nombre: usuario.nombre, 
        apellido: usuario.apellido, 
        email: usuario.email, 
        rol: usuario.rol 
      }
    })

  } catch (error: any) {
    return sendResponse(res, 500, false, 'Error al resetear la contraseña.', null, error.message);
  }
}
import { Router } from 'express';
import { login, register, resetPassword, forgotPassword,verificarCodigo } from '../controllers/autenticacionController';


const router = Router();

router.post('/inicio-sesion', login);
router.post('/registro', register);
router.post('/recuperar-contrasena', forgotPassword);
router.post('/verificar-codigo', verificarCodigo);
router.post('/resetear-contrasena', resetPassword);



export default router;
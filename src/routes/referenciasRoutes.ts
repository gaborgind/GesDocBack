import { Router } from 'express';
import * as refCtrl from '../controllers/referenciasController';

const router = Router();

router.get('/areas', (req, res) => refCtrl.getAreas(res));
router.get('/cargos', (req, res) => refCtrl.getCargos(res));
router.get('/tipos-documentos', (req, res) => refCtrl.getTiposDocumentos(res));
router.get('/tipos-resoluciones', (req, res) => refCtrl.getTiposResoluciones(res));

export default router;
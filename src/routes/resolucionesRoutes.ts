import { Router } from 'express'
import { getCargos, getAreas, getTipos } from '../controllers/resolucionesControllers'


const router = Router()
router.get('/cargos', getCargos)    // http://localhost:3000/api/resoluciones/cargos
router.get('/areas', getAreas) 
router.get('/tipos', getTipos) 


export default router

import { Router } from 'express'
import { getCargos, getAreas, getTipos,guardarResolucion, getResolucionesByFilter , updateResolucion, deleteResolucion} from '../controllers/resolucionesControllers'


const router = Router()
router.get('/cargos', getCargos)    // http://localhost:3000/api/resoluciones/cargos
router.get('/areas', getAreas) 
router.get('/tipos', getTipos) 
router.post('/', guardarResolucion) 
router.get('/',getResolucionesByFilter)
router.put('/:id',  updateResolucion);
router.delete('/:id', deleteResolucion);


export default router

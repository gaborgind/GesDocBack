import { Router } from 'express'
import {  getDocumentoById ,guardarDocumentoGeneral,getTiposDocumentoGenerales,getDocumentosByFilter, updateDocumentoGeneral} from '../controllers/documentosController'

const router = Router();

router.get('/', getDocumentosByFilter)    // http://localhost:3000/api/documentos
router.post('/', guardarDocumentoGeneral) 
router.get('/tipos-documentos', getTiposDocumentoGenerales) // http://localhost:3000/api/documentos/tipo-documentos
router.put('/:id', updateDocumentoGeneral)
router.get('/:id', getDocumentoById) 


export default router;
import { Router } from 'express'
import {  getDocumentoById ,guardarDocumentoGeneral,getTiposDocumentoGenerales,getDocumentosByFilter, actualizarDocumento, borrarDocumentoId, getDestinos, guardarDestinos,getArchivadoEn} from '../controllers/documentosController'

const router = Router();

router.get('/', getDocumentosByFilter)    // http://localhost:3000/api/documentos
router.post('/', guardarDocumentoGeneral) 
router.get('/tipos-documentos', getTiposDocumentoGenerales) // http://localhost:3000/api/documentos/tipo-documentos
router.get('/destinos', getDestinos) 
router.post('/destinos', guardarDestinos) 
router.get('/archivado', getArchivadoEn) 
router.put('/:id', actualizarDocumento);
router.get('/:id', getDocumentoById) 
router.delete('/:id', borrarDocumentoId) 


export default router;
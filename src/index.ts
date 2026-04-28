import express from 'express'
import cors from 'cors'
import autentificacionRoutes from './routes/autentificacionRoutes'
import referenciasRoutes from './routes/referenciasRoutes'
import documentosRoutes from './routes/documentosRoutes'
import { authMiddleware } from './middleware/auth'


const app = express();

app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', autentificacionRoutes) 
app.use('/api/referencias', referenciasRoutes)
app.use('/api/inicio',authMiddleware, documentosRoutes)
app.use('/api/documentos',authMiddleware, documentosRoutes)


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});


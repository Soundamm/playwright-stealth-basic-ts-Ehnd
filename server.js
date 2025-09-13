const express = require('express');
const app = express();

// Endpoint de prueba para saber si funciona
app.get('/', (req, res) => {
  res.send('Servidor Express funcionando en Railway');
});

// Para exponer Playwright, puedes añadir un endpoint como este:
app.post('/playwright', async (req, res) => {
  // Aquí pondrías tu lógica con Playwright, por ejemplo lanzar un test y devolver el resultado.
  // res.json({ status: 'ok', ...datosPlaywright });
});

// Railway usa la variable de entorno PORT para asignar el puerto.
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});

// routes/pemutihan.js
const express = require('express');
const { 
  getDataForPemutihan,
  prosesPemutihan,
  batalkanPemutihan,
  getRiwayatPemutihan,
  
} = require('../controllers/pemutihanController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk pemutihan
router.get('/data', authenticate, authorize('admin','atasan'), getDataForPemutihan);
router.post('/proses', authenticate, authorize('admin','atasan'), prosesPemutihan);
router.post('/batal', authenticate, authorize('admin','atasan'), batalkanPemutihan);
router.get('/riwayat', authenticate, authorize('admin','atasan'), getRiwayatPemutihan);

module.exports = router;
const express = require('express');
const {
  // Hari Kerja
  getAllHariKerja,
  createHariKerja,
  updateHariKerja,
  deleteHariKerja,
  bulkCreateHariKerja,

  // Hari Libur
  getAllHariLibur,
  createHariLibur,
  updateHariLibur,
  deleteHariLibur,

  // Kalender
  getKalender
} = require('../controllers/hariController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Hari Kerja Routes
router.get('/hari-kerja', authenticate, authorize('admin','atasan'), getAllHariKerja);
router.post('/hari-kerja', authenticate, authorize('admin','atasan'), createHariKerja);
router.post('/hari-kerja/bulk', authenticate, authorize('admin','atasan'), bulkCreateHariKerja);
router.put('/hari-kerja/:id', authenticate, authorize('admin','atasan'), updateHariKerja);
router.delete('/hari-kerja/:id', authenticate, authorize('admin','atasan'), deleteHariKerja);

// Hari Libur Routes
router.get('/hari-libur', authenticate, authorize('admin','atasan'), getAllHariLibur);
router.post('/hari-libur', authenticate, authorize('admin','atasan'), createHariLibur);
router.put('/hari-libur/:id', authenticate, authorize('admin','atasan'), updateHariLibur);
router.delete('/hari-libur/:id', authenticate, authorize('admin','atasan'), deleteHariLibur);

// Kalender Routes
router.get('/kalender', authenticate, getKalender);

module.exports = router;
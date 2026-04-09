const express = require('express');
const {
  getAllWilayah,
  getWilayahById,
  createWilayah,
  updateWilayah,
  deleteWilayah,
  getUsersByWilayah,
  assignWilayahToUser,
  getWilayahStats,
  getAllPegawai
} = require('../controllers/wilayahController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk wilayah management
router.get('/', authenticate, authorize('admin','atasan'), getAllWilayah);
router.get('/userswilayah', authenticate, authorize('admin','atasan'), getAllWilayah);
router.get('/stats', authenticate, authorize('admin','atasan'), getWilayahStats);
router.get('/pegawai', authenticate, authorize('admin','atasan'), getAllPegawai);
router.get('/:id', authenticate, authorize('admin','atasan'), getWilayahById);
router.post('/', authenticate, authorize('admin','atasan'), createWilayah);
router.put('/:id', authenticate, authorize('admin','atasan'), updateWilayah);
router.delete('/:id', authenticate, authorize('admin','atasan'), deleteWilayah);

// Routes untuk user wilayah assignment
router.get('/:wilayah_id/users', authenticate, authorize('admin','atasan'), getUsersByWilayah);
router.put('/user/:user_id/assign', authenticate, authorize('admin','atasan'), assignWilayahToUser);

module.exports = router;
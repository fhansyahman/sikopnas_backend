const express = require('express');
const { 
  getAllJamKerja,
  getJamKerjaById,
  getJamKerjaAktif,
  createJamKerja,
  updateJamKerja,
  deleteJamKerja, // ✅ PERBAIKI: setJamKerjaAktif bukan setJamKerjaAktif
  assignJamKerjaToUser
} = require('../controllers/jamKerjaController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes public - bisa diakses semua user yang login
router.get('/aktif', authenticate, getJamKerjaAktif);

// Routes admin only
router.get('/', authenticate, authorize('admin','atasan'), getAllJamKerja);
router.get('/:id', authenticate, authorize('admin','atasan'), getJamKerjaById);
router.post('/', authenticate, authorize('admin','atasan'), createJamKerja);
router.put('/:id', authenticate, authorize('admin','atasan'), updateJamKerja);
router.delete('/:id', authenticate, authorize('admin','atasan'), deleteJamKerja);
router.post('/assign', authenticate, authorize('admin','atasan'), assignJamKerjaToUser);

module.exports = router;
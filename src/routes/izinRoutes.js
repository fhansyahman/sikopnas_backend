const express = require('express');
const { 
  getAllIzin,
  getIzinById,
  getMyIzin,
  getMyIzinPerBulan,
  getIzinPerTanggal, // TAMBAHKAN INI
  getIzinTanggalOptions, // TAMBAHKAN INI
  createIzin,
  updateIzinStatus,
  deleteIzin,
  createIzinByAdmin,
  downloadDokumen, // TAMBAHKAN INI
} = require('../controllers/izinController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk pegawai
router.get('/saya', authenticate, getMyIzin);
router.get('/perbulan', authenticate, getMyIzinPerBulan);
router.post('/ajukan', authenticate, createIzin);
router.delete('/:id', authenticate, deleteIzin);

// Admin routes
router.get('/all', authenticate, authorize('admin','atasan'), getAllIzin);
router.get('/per-tanggal', authenticate, authorize('admin','atasan'), getIzinPerTanggal); // TAMBAHKAN INI
router.get('/tanggal-options', authenticate, authorize('admin','atasan'), getIzinTanggalOptions); // TAMBAHKAN INI
router.get('/:id', authenticate, authorize('admin','atasan'), getIzinById);
router.patch('/:id/status', authenticate, authorize('admin','atasan'), updateIzinStatus);
router.post('/admin-create', authenticate, authorize('admin','atasan'), createIzinByAdmin);
router.get('/download/:filename', authenticate, authorize('admin','atasan'), downloadDokumen); // TAMBAHKAN INI
module.exports = router;
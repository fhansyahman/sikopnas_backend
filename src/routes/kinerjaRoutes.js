// src/routes/kinerjaRoutes.js
const express = require('express');
const {
  createKinerja,
  createKinerjaWithCamera,
  getKinerjaUser,
  getKinerjaUserPerBulan, // IMPORT fungsi baru
  getKinerjaById,
  updateKinerja,
  deleteKinerja,
  getAllKinerja,
  getKinerjaStatistik,
  generatePDF,
  generateRekapWilayah,
  downloadAllWilayah,
  getKinerjaPerTanggal, // TAMBAHKAN INI
  getAllKinerjaPerBulan // TAMBAHKAN INI
} = require('../controllers/kinerjaController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk user
router.post('/', authenticate, createKinerja);
router.post('/camera', authenticate, createKinerjaWithCamera);
router.get('/my', authenticate, getKinerjaUser);
router.get('/perbulan', authenticate, getKinerjaUserPerBulan); // TAMBAHKAN ROUTE INI
router.get('/:id', authenticate, getKinerjaById);
router.put('/:id', authenticate, updateKinerja);
router.delete('/:id', authenticate, deleteKinerja);

// Routes untuk admin
router.get('/admin/all', authenticate, authorize('admin', 'atasan'), getAllKinerja);
router.get('/admin/per-tanggal', authenticate, authorize('admin', 'atasan'), getKinerjaPerTanggal); // TAMBAHKAN INIrouter.get('/admin/statistik', authenticate, authorize('admin', 'atasan'), getKinerjaStatistik);
router.post('/admin/:id/generate-pdf', authenticate, authorize('admin', 'atasan'), generatePDF);
router.post('/admin/generate-rekap-wilayah', authenticate, authorize('admin', 'atasan'), generateRekapWilayah);
router.get('/admin/download-all-wilayah', authenticate, authorize('admin', 'atasan'), downloadAllWilayah);
router.get('/admin/perbulan', authenticate, authorize('admin', 'atasan'), getAllKinerjaPerBulan); // TAMBAHKAN INI

// Routes untuk atasan
router.get('/atasan/all', authenticate, authorize('atasan'), getAllKinerja);
router.get('/atasan/statistik', authenticate, authorize('atasan'), getKinerjaStatistik);
router.post('/atasan/:id/generate-pdf', authenticate, authorize('atasan'), generatePDF);
router.post('/atasan/generate-rekap-wilayah', authenticate, authorize('atasan'), generateRekapWilayah);
router.get('/atasan/download-all-wilayah', authenticate, authorize('atasan'), downloadAllWilayah);

module.exports = router;
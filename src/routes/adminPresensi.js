const express = require('express');
const { 
  getAllPresensi,
  getPresensiHariIni,
  getPresensiBulanan,
  getPresensiById,
  updatePresensi,
  deletePresensi,
  generatePresensiHariIni,
  getStatistikPresensi,
  getStatistikHarian,
  getStatistikBulanan,
  getDashboardSummary,
  getRekapKehadiranBulanan, // TAMBAHKAN INI
  exportRekapKehadiranExcel  // TAMBAHKAN INI (opsional)
} = require('../controllers/adminPresensiController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin','atasan'));
router.get('/hari-ini', getPresensiHariIni);
router.get('/bulanan', getPresensiBulanan);
router.get('/', getAllPresensi);
router.get('/statistik', getStatistikPresensi);
router.get('/:id', getPresensiById);
router.put('/:id', updatePresensi);
router.delete('/:id', deletePresensi);
router.post('/generate-hari-ini', generatePresensiHariIni);
router.get('/statistik/harian', getStatistikHarian);
router.get('/statistik/bulanan', getStatistikBulanan);
router.get('/dashboard/summary', getDashboardSummary);
// Di routes/presensiRoutes.js
router.get('/rekap-bulanan', authenticate, authorize('admin', 'atasan'), getRekapKehadiranBulanan);
router.get('/export-rekap-excel', authenticate, authorize('admin', 'atasan'), exportRekapKehadiranExcel);
module.exports = router;
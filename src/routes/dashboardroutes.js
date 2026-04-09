const express = require('express');
const { 
   getDashboardHariIni,
  getGrafikHadirBulanan,
  getPegawaiBelumAbsen,
  getDaftarWilayah,
  getDashboardKinerjaHariIni,
  getGrafikKinerjaBulanan
} = require('../controllers/dashboarController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin', 'atasan'));

// Kehadiran
router.get('/kehadiran-hari-ini', getDashboardHariIni);

// Kinerja
router.get('/kehadiran-bulanan', getGrafikHadirBulanan);

router.get('/kinerja-hari-ini', getDashboardKinerjaHariIni);
router.get('/kinerja-bulanan', getGrafikKinerjaBulanan);
router.get('/pegawai-belum-absen', getPegawaiBelumAbsen);
router.get('/daftar-wilayah', getDaftarWilayah);

module.exports = router;
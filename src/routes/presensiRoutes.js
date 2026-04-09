const express = require('express');
const { 
  // Fungsi utama presensi
  presensiMasuk,
  presensiPulang,
  getPresensiHariIni,
  getPresensiUser,
  getAllPresensi,
  getRekapPresensi,
  getPresensiUserPerBulan,
  getAllPresensiPerBulan, // PASTIKAN INI DI IMPORT
  // Fungsi generate yang baru
  generatePresensiForDate,
  generatePresensiHariIniOnStartup,
  updatePresensiStatusAkhirHari,
  
  // Fungsi generate untuk admin
  generatePresensiManual,
  generatePresensiHariIni,
  
  // Fungsi legacy (untuk compatibility)
  generatePresensiOtomatis,
  fixPresensiData,
  getGenerateStats,
  
  // System functions
  getSystemStatus
} = require('../controllers/presensiController');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();

// ==================== ROUTES UNTUK SEMUA USER ====================

// Presensi manual
router.post('/masuk', authenticate, presensiMasuk);
router.post('/pulang', authenticate, presensiPulang);

// Get data presensi
router.get('/hari-ini', authenticate, getPresensiHariIni);
router.get('/user', authenticate, getPresensiUser);
router.get('/perbulan', authenticate, getPresensiUserPerBulan);

// ==================== ROUTES UNTUK ADMIN SAJA ====================

// GET data presensi admin
router.get('/admin/all', authenticate, authorize('admin','atasan'), getAllPresensi);
router.get('/admin/rekap', authenticate, authorize('admin','atasan'), getRekapPresensi);
router.get('/admin/perbulan', authenticate, authorize('admin','atasan'), getAllPresensiPerBulan); // ROUTE INI

// Generate presensi (multiple options)
router.post('/admin/generate', authenticate, authorize('admin'), generatePresensiOtomatis);
router.post('/admin/generate-manual', authenticate, authorize('admin'), generatePresensiManual);
router.post('/admin/generate-hari-ini', authenticate, authorize('admin'), generatePresensiHariIni);
router.post('/admin/generate-for-date', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { tanggal } = req.body;
    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal wajib diisi'
      });
    }
    
    const { generatePresensiForDate } = require('../controllers/presensiController');
    const result = await generatePresensiForDate(tanggal);
    
    res.json({
      success: true,
      message: `Berhasil generate ${result.generated_count} presensi untuk ${tanggal}`,
      data: result
    });
  } catch (error) {
    console.error('Generate for date error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

// Maintenance & stats
router.post('/admin/fix-data', authenticate, authorize('admin'), fixPresensiData);
router.get('/admin/generate-stats', authenticate, authorize('admin'), getGenerateStats);
router.get('/admin/system-status', authenticate, authorize('admin'), getSystemStatus);

// Manual trigger update status akhir hari (untuk testing/emergency)
router.post('/admin/trigger-update-end-day', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { updatePresensiStatusAkhirHari } = require('../controllers/presensiController');
    const result = await updatePresensiStatusAkhirHari();
    
    res.json({
      success: true,
      message: `Berhasil update ${result.updated_count} presensi`,
      data: result
    });
  } catch (error) {
    console.error('Trigger update end day error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

// Check hari kerja untuk tanggal tertentu
router.get('/admin/check-hari-kerja/:tanggal', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { tanggal } = req.params;
    const { checkHariKerja } = require('../controllers/presensiController');
    const result = await checkHariKerja(tanggal);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Check hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

// Get count presensi untuk tanggal tertentu
router.get('/admin/count/:tanggal', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { tanggal } = req.params;
    const { pool } = require('../config/database');
    
    const [count] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [tanggal]
    );
    
    const [izinCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM presensi 
       WHERE tanggal = ? AND izin_id IS NOT NULL`,
      [tanggal]
    );
    
    const [hadirCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM presensi 
       WHERE tanggal = ? AND jam_masuk IS NOT NULL`,
      [tanggal]
    );
    
    const [tanpaKeteranganCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM presensi 
       WHERE tanggal = ? AND status_masuk = 'Tanpa Keterangan'`,
      [tanggal]
    );
    
    res.json({
      success: true,
      data: {
        tanggal,
        total: count[0].total,
        dengan_izin: izinCount[0].total,
        sudah_hadir: hadirCount[0].total,
        tanpa_keterangan: tanpaKeteranganCount[0].total,
        belum_presensi: count[0].total - (hadirCount[0].total + tanpaKeteranganCount[0].total + izinCount[0].total)
      }
    });
  } catch (error) {
    console.error('Get count error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
});

module.exports = router;
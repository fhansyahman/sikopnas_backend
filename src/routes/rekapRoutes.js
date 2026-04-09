const express = require('express');
const {
  getRekapKehadiran,
  getDetailKehadiranUser,
  getRekapHarian
} = require('../controllers/rekapController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk semua user
router.get('/detail-user', authenticate, getDetailKehadiranUser);

// Routes untuk admin
router.get('/kehadiran', authenticate, authorize('admin','atasan'), getRekapKehadiran);
router.get('/harian', authenticate, authorize('admin','atasan'), getRekapHarian);

// Routes untuk atasan
router.get('/atasan/kehadiran', authenticate, authorize('atasan','atasan'), getRekapKehadiran);
router.get('/harian', authenticate, authorize('atasan','atasan'), getRekapHarian);

module.exports = router;
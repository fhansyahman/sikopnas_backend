const express = require('express');
const { login, getProfile, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.put('/reset-password', authenticate, resetPassword);
router.get('/profile', authenticate, getProfile);

module.exports = router;
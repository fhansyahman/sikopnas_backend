const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

// Helper function untuk base64
const getBase64FromFile = (filePath) => {
  if (!filePath) {
    return null;
  }
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    const fileBuffer = fs.readFileSync(fullPath);
    const fileType = path.extname(filePath).toLowerCase().substring(1);
    
    const mimeTypes = {
      'jpg': 'jpeg',
      'jpeg': 'jpeg',
      'png': 'png',
      'gif': 'gif',
      'webp': 'webp'
    };
    
    const mimeType = mimeTypes[fileType] || 'png';
    const base64 = fileBuffer.toString('base64');
    
    return `data:image/${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('Login attempt for:', username);

    // Validation - return JSON dengan success: false, bukan throw error
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan password wajib diisi'
      });
    }

    // Find user
    const [users] = await pool.execute(
      `SELECT u.*, jk.jam_masuk_standar, jk.jam_pulang_standar 
       FROM users u 
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id 
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );

    if (users.length === 0) {
      return res.status(200).json({ // ✅ Ubah ke 200 agar frontend tidak throw error
        success: false,
        message: 'Username atau password salah'
      });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(200).json({ // ✅ Ubah ke 200
        success: false,
        message: 'Username atau password salah'
      });
    }

    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        role: user.roles,
        nama: user.nama,
        jabatan: user.jabatan
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Response data user (tanpa password)
    const userResponse = {
      id: user.id,
      nama: user.nama,
      username: user.username,
      alamat: user.alamat,
      jenis_kelamin: user.jenis_kelamin,
      roles: user.roles,
      jabatan: user.jabatan,
      foto: user.foto,
      wilayah_penugasan: user.wilayah_penugasan,
      telegram_id: user.telegram_id,
      jam_kerja_id: user.jam_kerja_id,
      jam_masuk_standar: user.jam_masuk_standar,
      jam_pulang_standar: user.jam_pulang_standar,
      is_active: user.is_active,
      created_at: user.created_at
    };

    // Konversi foto ke base64 jika ada
    if (userResponse.foto) {
      userResponse.foto = getBase64FromFile(userResponse.foto);
    }

    res.status(200).json({
      success: true,
      message: 'Login berhasil',
      data: {
        token,
        user: userResponse
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    // ✅ Tetap return JSON meski error 500
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, nama, username, no_hp, jabatan, roles, 
              foto, wilayah_penugasan, telegram_id, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = users[0];
    
    let fotoBase64 = null;
    if (user.foto) {
      fotoBase64 = getBase64FromFile(user.foto);
    }

    const responseData = {
      ...user,
      foto: fotoBase64 || user.foto
    };

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
const resetPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id; // Dari middleware authenticate

    console.log('Reset password attempt for user:', userId);

    // Validasi input
    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password lama, password baru, dan konfirmasi password wajib diisi'
      });
    }

    // Validasi password baru dan konfirmasi
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password baru dan konfirmasi password tidak cocok'
      });
    }

    // Validasi panjang password minimal 6 karakter
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 6 karakter'
      });
    }

    // Ambil data user dari database
    const [users] = await pool.execute(
      'SELECT id, username, password FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = users[0];

    // Verifikasi password lama
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isOldPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Password lama tidak sesuai'
      });
    }

    // Cek apakah password baru sama dengan password lama
    if (oldPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password baru tidak boleh sama dengan password lama'
      });
    }

    // Hash password baru
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password di database
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedNewPassword, userId]
    );

    // Log aktivitas (opsional)
    console.log(`Password berhasil direset untuk user: ${user.username} (ID: ${userId})`);

    res.status(200).json({
      success: true,
      message: 'Password berhasil direset'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server saat mereset password'
    });
  }
};

module.exports = { login, getProfile, resetPassword };
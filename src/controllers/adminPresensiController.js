// src/controllers/presensiController.js
const { pool } = require('../config/database');
const fs = require('fs');
const { get } = require('http');
const path = require('path');

// File Utility Functions
const ensureUploadsDir = () => {
  const uploadsDir = path.join(__dirname, '../uploads/presensi');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
};

const saveBase64Image = (base64String, jenis = 'masuk', userId = null, tanggal = null) => {
  if (!base64String) return null;
  
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 string');
    }

    const imageType = matches[1];
    const imageData = matches[2];
    
    const ext = imageType.split('/')[1] || 'jpg';
    
    const timestamp = Date.now();
    const filename = `${jenis}_${userId || 'unknown'}_${tanggal || new Date().toISOString().split('T')[0]}_${timestamp}.${ext}`;
    
    const uploadsDir = ensureUploadsDir();
    const filePath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(imageData, 'base64');
    
    fs.writeFileSync(filePath, buffer);
    
    return filename;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

const deleteFile = (filename) => {
  if (!filename) return;
  
  try {
    const uploadsDir = path.join(__dirname, '../uploads/presensi');
    const filePath = path.join(uploadsDir, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

const getBase64FromFile = (filename) => {
  if (!filename) return null;
  
  try {
    const uploadsDir = path.join(__dirname, '../uploads/presensi');
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileType = path.extname(filePath).substring(1) || 'jpg';
    const base64 = fileBuffer.toString('base64');
    
    return `data:image/${fileType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
};

// Get all presensi dengan filter berdasarkan roles
const getAllPresensi = async (req, res) => {
  try {
    const { tanggal, bulan, tahun, user_id } = req.query;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    
    let query = `
      SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
             jk.jam_masuk_standar, jk.jam_pulang_standar
      FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE 1=1
    `;
    const params = [];

    // Filter berdasarkan roles
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Jika hanya pegawai, hanya bisa lihat presensi sendiri
      query += ' AND p.user_id = ?';
      params.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor bisa lihat bawahannya
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    }

    if (tanggal) {
      query += ' AND p.tanggal = ?';
      params.push(tanggal);
    }

    if (bulan && tahun) {
      query += ' AND MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?';
      params.push(bulan, tahun);
    }

    if (user_id && (userRoles.includes('admin') || userRoles.includes('supervisor'))) {
      query += ' AND p.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY p.tanggal DESC, u.nama ASC';

    const [presensi] = await pool.execute(query, params);

    // Convert filename to base64 untuk response
    const parsedPresensi = presensi.map((item) => ({
      ...item,
      foto_masuk: item.foto_masuk ? getBase64FromFile(item.foto_masuk) : null,
      foto_pulang: item.foto_pulang ? getBase64FromFile(item.foto_pulang) : null
    }));

    res.json({
      success: true,
      data: parsedPresensi
    });

  } catch (error) {
    console.error('Get all presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get presensi by ID dengan pengecekan roles
const getPresensiById = async (req, res) => {
  try {
    const { id } = req.params;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
              jk.jam_masuk_standar, jk.jam_pulang_standar
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE p.id = ?`,
      [id]
    );

    if (presensi.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // Cek hak akses berdasarkan roles
    const presensiData = presensi[0];
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Pegawai hanya bisa lihat presensi sendiri
      if (presensiData.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk melihat presensi ini'
        });
      }
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor hanya bisa lihat presensi di wilayahnya
      if (presensiData.wilayah_penugasan !== req.user.wilayah_penugasan) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk melihat presensi ini'
        });
      }
    }

    // Convert filename to base64
    const data = {
      ...presensiData,
      foto_masuk: presensiData.foto_masuk ? getBase64FromFile(presensiData.foto_masuk) : null,
      foto_pulang: presensiData.foto_pulang ? getBase64FromFile(presensiData.foto_pulang) : null
    };

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get presensi by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Update presensi manual berdasarkan roles
const updatePresensi = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const { id } = req.params;
    const { 
      jam_masuk, 
      jam_pulang, 
      status_masuk, 
      status_pulang, 
      keterangan,
      is_lembur,
      jam_lembur,
      foto_masuk,
      foto_pulang
    } = req.body;

    // Check if presensi exists dan dapatkan data lama
    const [existing] = await pool.execute(
      `SELECT p.*, u.wilayah_penugasan 
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    const oldData = existing[0];

    // Cek hak akses berdasarkan roles
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Pegawai hanya bisa update presensi sendiri
      if (oldData.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengupdate presensi ini'
        });
      }
      
      // Pegawai hanya bisa update keterangan dan jam lembur
      // Tidak bisa update jam_masuk, jam_pulang, status_masuk, status_pulang
      const allowedFields = ['keterangan', 'is_lembur', 'jam_lembur'];
      const updateData = {};
      
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Tidak ada data yang diizinkan untuk diupdate'
        });
      }
      
      // Update hanya field yang diizinkan
      await pool.execute(
        `UPDATE presensi 
         SET ${Object.keys(updateData).map(field => `${field} = ?`).join(', ')}, updated_at = NOW()
         WHERE id = ?`,
        [...Object.values(updateData), id]
      );

      // Log activity untuk pegawai
      await pool.execute(
        'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
        ['UPDATE_PRESENSI_PEGAWAI', `Pegawai mengupdate presensi ID ${id}`, userId]
      );

      return res.json({
        success: true,
        message: 'Data presensi berhasil diupdate'
      });
      
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor hanya bisa update presensi di wilayahnya
      if (oldData.wilayah_penugasan !== req.user.wilayah_penugasan) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengupdate presensi ini'
        });
      }
    }

    // Jika admin atau supervisor dengan akses penuh
    // Handle gambar - simpan yang baru, hapus yang lama jika diupdate
    let fotoMasukFilename = oldData.foto_masuk;
    let fotoKeluarFilename = oldData.foto_pulang;

    // Jika ada foto masuk baru, simpan dan hapus yang lama
    if (foto_masuk && foto_masuk !== 'keep') {
      if (fotoMasukFilename) {
        deleteFile(fotoMasukFilename);
      }
      
      fotoMasukFilename = saveBase64Image(
        foto_masuk, 
        'masuk', 
        oldData.user_id, 
        oldData.tanggal
      );
    }

    // Jika ada foto keluar baru, simpan dan hapus yang lama
    if (foto_pulang && foto_pulang !== 'keep') {
      if (fotoKeluarFilename) {
        deleteFile(fotoKeluarFilename);
      }
      
      fotoKeluarFilename = saveBase64Image(
        foto_pulang, 
        'pulang', 
        oldData.user_id, 
        oldData.tanggal
      );
    }

    // Update presensi
    await pool.execute(
      `UPDATE presensi 
       SET jam_masuk = ?, jam_pulang = ?, status_masuk = ?, status_pulang = ?,
           foto_masuk = ?, foto_pulang = ?,
           is_lembur = ?, jam_lembur = ?, keterangan = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        jam_masuk, 
        jam_pulang, 
        status_masuk, 
        status_pulang,
        fotoMasukFilename,
        fotoKeluarFilename,
        is_lembur ? 1 : 0, 
        jam_lembur, 
        keterangan, 
        id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_PRESENSI', `${userRoles.includes('admin') ? 'Admin' : 'Supervisor'} mengupdate presensi ID ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data presensi berhasil diupdate'
    });

  } catch (error) {
    console.error('Update presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Delete presensi berdasarkan roles
const deletePresensi = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const { id } = req.params;

    // Check if presensi exists dan dapatkan filename
    const [presensi] = await pool.execute(
      `SELECT p.*, u.wilayah_penugasan 
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (presensi.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // Cek hak akses berdasarkan roles
    if (userRoles.includes('pegawai') || userRoles.includes('supervisor')) {
      // Pegawai dan Supervisor tidak boleh menghapus presensi
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk menghapus presensi'
      });
    }

    // Hanya admin yang bisa menghapus
    if (!userRoles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Hanya admin yang bisa menghapus presensi'
      });
    }

    // Hapus file-file gambar
    if (presensi[0].foto_masuk) {
      deleteFile(presensi[0].foto_masuk);
    }
    
    if (presensi[0].foto_pulang) {
      deleteFile(presensi[0].foto_pulang);
    }

    // Delete presensi
    await pool.execute('DELETE FROM presensi WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_PRESENSI', `Admin menghapus presensi ID ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data presensi berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Generate presensi kosong untuk hari ini - hanya admin
const generatePresensiHariIni = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    // Cek hak akses
    if (!userRoles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Hanya admin yang bisa generate presensi'
      });
    }

    const today = new Date().toISOString().split('T')[0];

    // Get all active users
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE is_active = 1 AND status = "Aktif"'
    );

    let generatedCount = 0;

    // Generate presensi untuk setiap user
    for (const user of users) {
      // Check if presensi already exists for today
      const [existing] = await pool.execute(
        'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
        [user.id, today]
      );

      if (existing.length === 0) {
        await pool.execute(
          `INSERT INTO presensi 
           (user_id, tanggal, status_masuk, status_pulang, is_system_generated) 
           VALUES (?, ?, 'Tanpa Keterangan', 'Belum Pulang', 1)`,
          [user.id, today]
        );
        generatedCount++;
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, records_affected) VALUES (?, ?, ?, ?)',
      ['GENERATE_PRESENSI', `Admin generate presensi kosong untuk hari ini`, userId, generatedCount]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${generatedCount} presensi kosong untuk hari ini`,
      data: {
        generated_count: generatedCount
      }
    });

  } catch (error) {
    console.error('Generate presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get statistik presensi berdasarkan roles
const getStatistikPresensi = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();

    let query = `
      SELECT 
        u.id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        COUNT(p.id) as total_hari,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_tanpa_keterangan,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'
    `;
    
    const params = [targetBulan, targetTahun];
    
    // Filter berdasarkan roles
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Pegawai hanya bisa lihat statistik sendiri
      query += ' AND u.id = ?';
      params.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor bisa lihat statistik wilayahnya
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    }
    
    query += ' GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan ORDER BY u.nama ASC';

    const [statistik] = await pool.execute(query, params);

    // Statistik keseluruhan hanya untuk admin
    let overall = {};
    if (userRoles.includes('admin')) {
      const [overallData] = await pool.execute(
        `SELECT 
          COUNT(DISTINCT p.user_id) as total_pegawai,
          COUNT(p.id) as total_presensi,
          SUM(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
          SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
          SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_tanpa_keterangan,
          SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur
         FROM presensi p
         WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?`,
        [targetBulan, targetTahun]
      );
      overall = overallData[0] || {};
    }

    res.json({
      success: true,
      data: {
        statistik_per_user: statistik,
        statistik_overall: overall
      }
    });

  } catch (error) {
    console.error('Get statistik presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get statistik harian untuk dashboard berdasarkan roles
const getStatistikHarian = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const { tanggal } = req.query;
    const targetTanggal = tanggal || new Date().toISOString().split('T')[0];

    // Get total active users berdasarkan roles
    let totalUsersQuery = `SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND status = 'Aktif'`;
    let totalUsersParams = [];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      totalUsersQuery += ' AND id = ?';
      totalUsersParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      totalUsersQuery += ' AND wilayah_penugasan = ?';
      totalUsersParams.push(req.user.wilayah_penugasan || '');
    }

    const [totalUsers] = await pool.execute(totalUsersQuery, totalUsersParams);

    // Get statistik presensi hari ini dengan filter berdasarkan roles
    let statistikQuery = `
      SELECT 
        COUNT(*) as total_presensi,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tepat Waktu' AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tepat_waktu,
        SUM(CASE WHEN (p.status_masuk = 'Tanpa Keterangan' OR p.jam_masuk IS NULL) AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tanpa_keterangan,
        SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.tanggal = ?
    `;
    
    let statistikParams = [targetTanggal];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      statistikQuery += ' AND p.user_id = ?';
      statistikParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      statistikQuery += ' AND u.wilayah_penugasan = ?';
      statistikParams.push(req.user.wilayah_penugasan || '');
    }

    const [statistik] = await pool.execute(statistikQuery, statistikParams);

    const totalPegawai = totalUsers[0]?.total || 0;
    const dataStatistik = statistik[0] || {
      total_presensi: 0,
      hadir: 0,
      terlambat: 0,
      tepat_waktu: 0,
      tanpa_keterangan: 0,
      izin: 0,
      lembur: 0
    };

    // Calculate percentages
    const persenHadir = totalPegawai > 0 ? Math.round((dataStatistik.hadir / totalPegawai) * 100) : 0;
    const persenTerlambat = totalPegawai > 0 ? Math.round((dataStatistik.terlambat / totalPegawai) * 100) : 0;
    const persenTepatWaktu = totalPegawai > 0 ? Math.round((dataStatistik.tepat_waktu / totalPegawai) * 100) : 0;
    const persenTanpaKeterangan = totalPegawai > 0 ? Math.round((dataStatistik.tanpa_keterangan / totalPegawai) * 100) : 0;
    const persenIzin = totalPegawai > 0 ? Math.round((dataStatistik.izin / totalPegawai) * 100) : 0;

    // Get statistik per wilayah hanya untuk admin dan supervisor
    let wilayahStatistik = [];
    let wilayah = {};
    
    if (userRoles.includes('admin') || userRoles.includes('supervisor')) {
      let wilayahQuery = `
        SELECT 
          u.wilayah_penugasan,
          COUNT(p.id) as total,
          SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as hadir,
          SUM(CASE WHEN p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL THEN 1 ELSE 0 END) as terlambat,
          SUM(CASE WHEN p.status_masuk = 'Tepat Waktu' AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tepat_waktu,
          SUM(CASE WHEN (p.status_masuk = 'Tanpa Keterangan' OR p.jam_masuk IS NULL) AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tanpa_keterangan,
          SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin,
          SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur
         FROM presensi p
         LEFT JOIN users u ON p.user_id = u.id
         WHERE p.tanggal = ?
      `;
      
      let wilayahParams = [targetTanggal];
      
      if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
        wilayahQuery += ' AND u.wilayah_penugasan = ?';
        wilayahParams.push(req.user.wilayah_penugasan || '');
      }
      
      wilayahQuery += ' GROUP BY u.wilayah_penugasan ORDER BY u.wilayah_penugasan';
      
      const [wilayahData] = await pool.execute(wilayahQuery, wilayahParams);
      wilayahStatistik = wilayahData;

      // Format wilayah data
      wilayahStatistik.forEach(item => {
        wilayah[item.wilayah_penugasan || 'Unknown'] = {
          total: item.total,
          hadir: item.hadir,
          terlambat: item.terlambat,
          tepat_waktu: item.tepat_waktu,
          tanpa_keterangan: item.tanpa_keterangan,
          izin: item.izin,
          lembur: item.lembur
        };
      });
    }

    // Siapkan response data berdasarkan roles
    const responseData = {
      tanggal: targetTanggal,
      total_pegawai: totalPegawai,
      hadir_hari_ini: dataStatistik.hadir,
      total_hadir: dataStatistik.hadir,
      total_terlambat: dataStatistik.terlambat,
      total_tepat_waktu: dataStatistik.tepat_waktu,
      total_tanpa_keterangan: dataStatistik.tanpa_keterangan,
      total_izin: dataStatistik.izin,
      total_lembur: dataStatistik.lembur,
      
      persen_hadir: persenHadir,
      persen_tepat_waktu: persenTepatWaktu,
      persen_terlambat: persenTerlambat,
      persen_tanpa_keterangan: persenTanpaKeterangan,
      persen_izin: persenIzin,
    };

    // Tambahkan wilayah data hanya untuk admin dan supervisor
    if (userRoles.includes('admin') || userRoles.includes('supervisor')) {
      responseData.wilayah = wilayah;
      
      // Tambahkan chart data hanya jika ada data wilayah
      if (Object.keys(wilayah).length > 0) {
        responseData.chart_data = {
          labels: ['Hadir', 'Terlambat', 'Izin', 'Tanpa Keterangan'],
          datasets: [
            {
              data: [dataStatistik.hadir, dataStatistik.terlambat, dataStatistik.izin, dataStatistik.tanpa_keterangan],
              backgroundColor: ['#10B981', '#F59E0B', '#8B5CF6', '#EF4444'],
              borderColor: ['#0DA675', '#D97706', '#7C3AED', '#DC2626'],
              borderWidth: 1
            }
          ]
        };
      }
    }

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get statistik harian error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get statistik bulanan untuk dashboard berdasarkan roles
const getStatistikBulanan = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();
    const daysInMonth = new Date(targetTahun, targetBulan, 0).getDate();

    // Get statistik per hari dengan filter berdasarkan roles
    let statistikQuery = `
      SELECT 
        DAY(p.tanggal) as hari,
        COUNT(*) as total,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tepat Waktu' AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tepat_waktu,
        SUM(CASE WHEN (p.status_masuk = 'Tanpa Keterangan' OR p.jam_masuk IS NULL) AND p.izin_id IS NULL THEN 1 ELSE 0 END) as tanpa_keterangan,
        SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?
    `;
    
    let statistikParams = [targetBulan, targetTahun];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      statistikQuery += ' AND p.user_id = ?';
      statistikParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      statistikQuery += ' AND u.wilayah_penugasan = ?';
      statistikParams.push(req.user.wilayah_penugasan || '');
    }
    
    statistikQuery += ' GROUP BY DAY(p.tanggal) ORDER BY hari';

    const [statistikPerHari] = await pool.execute(statistikQuery, statistikParams);

    // Format data per hari
    const perHari = {};
    let totalHadir = 0;
    let totalTerlambat = 0;
    let totalIzin = 0;
    let totalTanpaKeterangan = 0;
    let hariDenganData = 0;

    // Inisialisasi semua hari dengan 0
    for (let i = 1; i <= daysInMonth; i++) {
      perHari[i] = {
        hadir: 0,
        terlambat: 0,
        tepat_waktu: 0,
        tanpa_keterangan: 0,
        izin: 0,
        lembur: 0,
        total: 0
      };
    }

    // Update dengan data yang ada
    statistikPerHari.forEach(item => {
      perHari[item.hari] = {
        hadir: Number(item.hadir) || 0,
        terlambat: Number(item.terlambat) || 0,
        tepat_waktu: Number(item.tepat_waktu) || 0,
        tanpa_keterangan: Number(item.tanpa_keterangan) || 0,
        izin: Number(item.izin) || 0,
        lembur: Number(item.lembur) || 0,
        total: Number(item.total) || 0
      };

      totalHadir += Number(item.hadir) || 0;
      totalTerlambat += Number(item.terlambat) || 0;
      totalIzin += Number(item.izin) || 0;
      totalTanpaKeterangan += Number(item.tanpa_keterangan) || 0;
      
      if (item.total > 0) {
        hariDenganData++;
      }
    });

    // Get total pegawai aktif berdasarkan roles
    let totalPegawaiQuery = `SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND status = 'Aktif'`;
    let totalPegawaiParams = [];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      totalPegawaiQuery += ' AND id = ?';
      totalPegawaiParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      totalPegawaiQuery += ' AND wilayah_penugasan = ?';
      totalPegawaiParams.push(req.user.wilayah_penugasan || '');
    }

    const [totalPegawai] = await pool.execute(totalPegawaiQuery, totalPegawaiParams);

    const jumlahPegawai = totalPegawai[0]?.total || 0;
    const rataRataHadir = hariDenganData > 0 ? Math.round(totalHadir / hariDenganData) : 0;
    const persenHadir = jumlahPegawai > 0 ? Math.round((totalHadir / (hariDenganData * jumlahPegawai)) * 100) : 0;

    res.json({
      success: true,
      data: {
        bulan: targetBulan,
        tahun: targetTahun,
        nama_bulan: months[targetBulan - 1],
        total_pegawai: jumlahPegawai,
        total_hadir: totalHadir,
        total_terlambat: totalTerlambat,
        total_izin: totalIzin,
        total_tanpa_keterangan: totalTanpaKeterangan,
        rata_rata_hadir: rataRataHadir,
        persen_hadir: persenHadir,
        per_hari: perHari
      }
    });

  } catch (error) {
    console.error('Get statistik bulanan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get dashboard summary data berdasarkan roles
const getDashboardSummary = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Query base untuk filter berdasarkan roles
    let queryBase = '';
    let queryParams = [];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      queryBase = 'AND p.user_id = ?';
      queryParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      queryBase = 'AND u.wilayah_penugasan = ?';
      queryParams.push(req.user.wilayah_penugasan || '');
    }

    // 1. Data hari ini
    const hariIniQuery = `
      SELECT 
        COUNT(*) as total_presensi,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.tanggal = ? ${queryBase}
    `;
    
    const [hariIni] = await pool.execute(
      hariIniQuery, 
      [today, ...queryParams]
    );

    // 2. Data bulan ini
    const bulanIniQuery = `
      SELECT 
        COUNT(DISTINCT DATE(p.tanggal)) as total_hari,
        COUNT(*) as total_presensi,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL THEN 1 ELSE 0 END) as total_terlambat
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ? ${queryBase}
    `;
    
    const [bulanIni] = await pool.execute(
      bulanIniQuery,
      [currentMonth, currentYear, ...queryParams]
    );

    // 3. Total pegawai aktif berdasarkan roles
    let totalPegawaiQuery = `SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND status = 'Aktif'`;
    let totalPegawaiParams = [];
    
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      totalPegawaiQuery += ' AND id = ?';
      totalPegawaiParams.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      totalPegawaiQuery += ' AND wilayah_penugasan = ?';
      totalPegawaiParams.push(req.user.wilayah_penugasan || '');
    }

    const [totalPegawai] = await pool.execute(totalPegawaiQuery, totalPegawaiParams);

    // 4. Pegawai terlambat hari ini
    const terlambatHariIniQuery = `
      SELECT COUNT(*) as total FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.tanggal = ? AND p.status_masuk IN ('Terlambat', 'Terlambat Berat') AND p.izin_id IS NULL ${queryBase}
    `;
    
    const [terlambatHariIni] = await pool.execute(
      terlambatHariIniQuery,
      [today, ...queryParams]
    );

    // 5. Pegawai izin hari ini
    const izinHariIniQuery = `
      SELECT COUNT(*) as total FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.tanggal = ? AND p.izin_id IS NOT NULL ${queryBase}
    `;
    
    const [izinHariIni] = await pool.execute(
      izinHariIniQuery,
      [today, ...queryParams]
    );

    const dataHariIni = hariIni[0] || { hadir: 0, terlambat: 0, izin: 0, total_presensi: 0 };
    const dataBulanIni = bulanIni[0] || { total_hadir: 0, total_terlambat: 0, total_hari: 0, total_presensi: 0 };
    const jumlahPegawai = totalPegawai[0]?.total || 0;

    // Hitung persentase
    const persenHadirHariIni = jumlahPegawai > 0 ? Math.round((dataHariIni.hadir / jumlahPegawai) * 100) : 0;
    const persenTerlambatHariIni = jumlahPegawai > 0 ? Math.round((dataHariIni.terlambat / jumlahPegawai) * 100) : 0;
    const persenIzinHariIni = jumlahPegawai > 0 ? Math.round((dataHariIni.izin / jumlahPegawai) * 100) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          total_pegawai: jumlahPegawai,
          hadir_hari_ini: dataHariIni.hadir,
          terlambat_hari_ini: dataHariIni.terlambat,
          izin_hari_ini: dataHariIni.izin,
          persen_hadir: persenHadirHariIni,
          persen_terlambat: persenTerlambatHariIni,
          persen_izin: persenIzinHariIni,
          
          total_hadir_bulan: dataBulanIni.total_hadir,
          total_terlambat_bulan: dataBulanIni.total_terlambat,
          total_hari_bulan: dataBulanIni.total_hari,
          
          jumlah_terlambat_hari_ini: terlambatHariIni[0]?.total || 0,
          jumlah_izin_hari_ini: izinHariIni[0]?.total || 0
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Tambahkan months array
const months = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];
const getPresensiHariIni = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    let query = `
      SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
             jk.jam_masuk_standar, jk.jam_pulang_standar
      FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE p.tanggal = ?
    `;

    const params = [today];

    // ROLE FILTER
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      query += ' AND p.user_id = ?';
      params.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    }

    query += ' ORDER BY u.nama ASC';

    const [data] = await pool.execute(query, params);

    const result = data.map(item => ({
      ...item,
      foto_masuk: item.foto_masuk ? getBase64FromFile(item.foto_masuk) : null,
      foto_pulang: item.foto_pulang ? getBase64FromFile(item.foto_pulang) : null
    }));

    res.json({
      success: true,
      tanggal: today,
      total: result.length,
      data: result
    });

  } catch (error) {
    console.error('Get presensi hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
const getPresensiBulanan = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    const targetBulan = bulan || (new Date().getMonth() + 1);
    const targetTahun = tahun || new Date().getFullYear();

    let query = `
      SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
             jk.jam_masuk_standar, jk.jam_pulang_standar
      FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?
    `;

    const params = [targetBulan, targetTahun];

    // ROLE FILTER
    if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      query += ' AND p.user_id = ?';
      params.push(userId);
    } else if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    }

    query += ' ORDER BY p.tanggal DESC, u.nama ASC';

    const [data] = await pool.execute(query, params);

    const result = data.map(item => ({
      ...item,
      foto_masuk: item.foto_masuk ? getBase64FromFile(item.foto_masuk) : null,
      foto_pulang: item.foto_pulang ? getBase64FromFile(item.foto_pulang) : null
    }));

    // SUMMARY BULANAN
    const summary = {
      total: result.length,
      hadir: result.filter(p => p.jam_masuk !== null).length,
      terlambat: result.filter(p => p.status_masuk === 'Terlambat').length,
      tanpa_keterangan: result.filter(p => p.status_masuk === 'Tanpa Keterangan').length,
      lembur: result.filter(p => p.is_lembur === 1).length
    };

    res.json({
      success: true,
      bulan: targetBulan,
      tahun: targetTahun,
      summary,
      total: result.length,
      data: result
    });

  } catch (error) {
    console.error('Get presensi bulanan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};



// ============ FUNGSI REKAP KEHADIRAN PER BULAN ============

/**
 * Get rekap kehadiran per bulan untuk admin
 * Endpoint: GET /presensi/rekap-bulanan
 * Query params: bulan, tahun (optional, default ke bulan/tahun saat ini)
 */
const getRekapKehadiranBulanan = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    
    // Cek hak akses (hanya admin dan atasan)
    if (!userRoles.includes('admin') && !userRoles.includes('atasan')) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengakses rekap ini.'
      });
    }
    
    // Ambil parameter bulan dan tahun
    let { bulan, tahun } = req.query;
    
    // Default ke bulan dan tahun saat ini
    const currentDate = new Date();
    const targetBulan = bulan ? parseInt(bulan) : currentDate.getMonth() + 1;
    const targetTahun = tahun ? parseInt(tahun) : currentDate.getFullYear();
    
    // Validasi bulan
    if (targetBulan < 1 || targetBulan > 12) {
      return res.status(400).json({
        success: false,
        message: 'Bulan harus antara 1 dan 12'
      });
    }
    
    console.log(`📊 Generating rekap kehadiran - Bulan: ${targetBulan}, Tahun: ${targetTahun}`);
    
    // Hitung jumlah hari dalam bulan
    const daysInMonth = new Date(targetTahun, targetBulan, 0).getDate();
    
    // Dapatkan semua user aktif
    const [users] = await pool.execute(
      `SELECT id, nama, jabatan, wilayah_penugasan 
       FROM users 
       WHERE is_active = 1 AND roles = 'pegawai'
       ORDER BY nama ASC`
    );
    
    // Dapatkan semua presensi dalam bulan tersebut
    const [presensiList] = await pool.execute(
      `SELECT user_id, tanggal, status_masuk, status_pulang, izin_id, is_lembur
       FROM presensi 
       WHERE MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
      [targetBulan, targetTahun]
    );
    
    // Dapatkan semua izin yang disetujui dalam bulan tersebut
    const [izinList] = await pool.execute(
      `SELECT user_id, tanggal_mulai, tanggal_selesai, jenis
       FROM izin 
       WHERE status = 'Disetujui'
         AND (
           (MONTH(tanggal_mulai) = ? AND YEAR(tanggal_mulai) = ?) OR
           (MONTH(tanggal_selesai) = ? AND YEAR(tanggal_selesai) = ?) OR
           (DATE(?) BETWEEN tanggal_mulai AND tanggal_selesai)
         )`,
      [targetBulan, targetTahun, targetBulan, targetTahun, `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-15`]
    );
    
    // Buat mapping izin per user per tanggal
    const izinMap = {};
    izinList.forEach(izin => {
      const startDate = new Date(izin.tanggal_mulai);
      const endDate = new Date(izin.tanggal_selesai);
      const currentDateLoop = new Date(startDate);
      
      while (currentDateLoop <= endDate) {
        if (currentDateLoop.getMonth() + 1 === targetBulan && 
            currentDateLoop.getFullYear() === targetTahun) {
          const tanggalStr = currentDateLoop.toISOString().split('T')[0];
          const userId = izin.user_id;
          
          if (!izinMap[userId]) izinMap[userId] = {};
          izinMap[userId][tanggalStr] = izin.jenis;
        }
        currentDateLoop.setDate(currentDateLoop.getDate() + 1);
      }
    });
    
    // Buat mapping presensi per user per tanggal
    const presensiMap = {};
    presensiList.forEach(presensi => {
      const userId = presensi.user_id;
      const tanggalStr = presensi.tanggal.toISOString().split('T')[0];
      
      if (!presensiMap[userId]) presensiMap[userId] = {};
      
      // Tentukan status kehadiran
      let status = '';
      if (presensi.izin_id) {
        status = 'I';
      } else if (presensi.status_masuk === 'Tepat Waktu') {
        status = 'H';
      } else if (presensi.status_masuk === 'Terlambat' || presensi.status_masuk === 'Terlambat Berat') {
        status = 'T';
      } else if (presensi.status_masuk === 'Tanpa Keterangan' || !presensi.jam_masuk) {
        status = 'TK';
      } else {
        status = 'TK';
      }
      
      presensiMap[userId][tanggalStr] = status;
    });
    
    // Buat array tanggal (1 - daysInMonth)
    const dates = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(targetTahun, targetBulan - 1, i);
      const dayOfWeek = date.getDay(); // 0=Minggu, 6=Sabtu
      
      // Tentukan apakah hari libur (Sabtu/Minggu) atau hari kerja
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      
      dates.push({
        date: i,
        dayName: getDayName(dayOfWeek),
        isWeekend: isWeekend
      });
    }
    
    // Proses setiap user untuk membuat rekap
    const rekapData = [];
    let totalH = 0, totalT = 0, totalI = 0, totalTK = 0;
    
    for (const user of users) {
      const dailyStatus = [];
      let userH = 0, userT = 0, userI = 0, userTK = 0;
      
      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(targetTahun, targetBulan - 1, i);
        const tanggalStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        
        let status = '';
        
        // Cek izin terlebih dahulu
        if (izinMap[user.id] && izinMap[user.id][tanggalStr]) {
          status = 'I';
          userI++;
          totalI++;
        } 
        // Cek presensi
        else if (presensiMap[user.id] && presensiMap[user.id][tanggalStr]) {
          status = presensiMap[user.id][tanggalStr];
          
          if (status === 'H') {
            userH++;
            totalH++;
          } else if (status === 'T') {
            userT++;
            totalT++;
          } else if (status === 'TK') {
            userTK++;
            totalTK++;
          }
        }
        // Weekend atau tidak ada data
        else {
          if (isWeekend) {
            status = ''; // Weekend kosong
          } else {
            status = 'TK';
            userTK++;
            totalTK++;
          }
        }
        
        dailyStatus.push(status);
      }
      
      rekapData.push({
        no: rekapData.length + 1,
        id: user.id,
        nama: user.nama,
        jabatan: user.jabatan,
        wilayah: user.wilayah_penugasan,
        daily: dailyStatus,
        H: userH,
        T: userT,
        I: userI,
        TK: userTK,
        total_hari: userH + userT + userI + userTK
      });
    }
    
    // Nama bulan
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const bulanNama = monthNames[targetBulan - 1];
    
    res.json({
      success: true,
      data: {
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          nama_bulan: bulanNama,
          total_hari: daysInMonth
        },
        summary: {
          total_pegawai: users.length,
          total_hadir: totalH,
          total_terlambat: totalT,
          total_izin: totalI,
          total_tanpa_keterangan: totalTK
        },
        dates: dates,
        rekap: rekapData
      }
    });
    
  } catch (error) {
    console.error('❌ Get rekap kehadiran bulanan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Helper function untuk mendapatkan nama hari
 */
const getDayName = (dayOfWeek) => {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[dayOfWeek];
};

/**
 * Export rekap kehadiran ke Excel (opsional)
 */
const exportRekapKehadiranExcel = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    
    if (!userRoles.includes('admin') && !userRoles.includes('atasan')) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak'
      });
    }
    
    let { bulan, tahun } = req.query;
    const currentDate = new Date();
    const targetBulan = bulan ? parseInt(bulan) : currentDate.getMonth() + 1;
    const targetTahun = tahun ? parseInt(tahun) : currentDate.getFullYear();
    
    // Dapatkan data rekap
    const [users] = await pool.execute(
      `SELECT id, nama, jabatan, wilayah_penugasan 
       FROM users 
       WHERE is_active = 1 AND roles = 'pegawai'
       ORDER BY nama ASC`
    );
    
    const [presensiList] = await pool.execute(
      `SELECT user_id, tanggal, status_masuk, izin_id
       FROM presensi 
       WHERE MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
      [targetBulan, targetTahun]
    );
    
    const daysInMonth = new Date(targetTahun, targetBulan, 0).getDate();
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Buat map presensi
    const presensiMap = {};
    presensiList.forEach(p => {
      const userId = p.user_id;
      const tanggalStr = p.tanggal.toISOString().split('T')[0];
      if (!presensiMap[userId]) presensiMap[userId] = {};
      
      let status = '';
      if (p.izin_id) status = 'I';
      else if (p.status_masuk === 'Tepat Waktu') status = 'H';
      else if (p.status_masuk === 'Terlambat' || p.status_masuk === 'Terlambat Berat') status = 'T';
      else status = 'TK';
      
      presensiMap[userId][tanggalStr] = status;
    });
    
    // Generate CSV
    let csv = `No,Nama,Jabatan,Wilayah`;
    for (let i = 1; i <= daysInMonth; i++) {
      csv = `${csv},"${i}"`;
    }
    csv = `${csv},H,T,I,TK\n`;
    
    let no = 1;
    for (const user of users) {
      let userH = 0, userT = 0, userI = 0, userTK = 0;
      csv = `${csv}${no},"${user.nama}","${user.jabatan}","${user.wilayah_penugasan || '-'}"`;
      
      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(targetTahun, targetBulan - 1, i);
        const tanggalStr = date.toISOString().split('T')[0];
        let status = presensiMap[user.id]?.[tanggalStr] || '';
        
        if (status === 'H') userH++;
        else if (status === 'T') userT++;
        else if (status === 'I') userI++;
        else if (status === 'TK') userTK++;
        
        csv = `${csv},"${status}"`;
      }
      
      csv = `${csv},${userH},${userT},${userI},${userTK}\n`;
      no++;
    }
    
    // Hitung total
    csv = `${csv}\nTOTAL,,,,`;
    for (let i = 1; i <= daysInMonth; i++) {
      csv = `${csv},`;
    }
    csv = `${csv},${totalH},${totalT},${totalI},${totalTK}\n`;
    
    // Set response headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="rekap_kehadiran_${monthNames[targetBulan-1]}_${targetTahun}.csv"`);
    
    res.send(csv);
    
  } catch (error) {
    console.error('Export rekap kehadiran error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
module.exports = {
  getAllPresensi,
  getPresensiById,
  updatePresensi,
  deletePresensi,
  getPresensiHariIni,
  getPresensiBulanan,
  generatePresensiHariIni,
  getStatistikPresensi,
  getStatistikHarian,
  getStatistikBulanan,
  getDashboardSummary,
  getRekapKehadiranBulanan, // TAMBAHKAN INI
  exportRekapKehadiranExcel  // TAMBAHKAN INI (opsional)
};
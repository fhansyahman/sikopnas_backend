// src/controllers/kinerjaController.js
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { 
  generateKinerjaPDF, 
  generateRekapWilayahPDF,
  generateWilayahAllPDFs 
} = require('../utils/pdfGenerator');

// File Utility Functions
const ensureUploadsDir = () => {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
};

const saveBase64Image = (base64String, subfolder = 'kinerja') => {
  if (!base64String) return null;
  
  try {
    // Handle both formats: with and without data:image prefix
    let imageData = base64String;
    let imageType = 'jpeg';
    
    if (base64String.includes(';base64,')) {
      const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        imageType = matches[1].split('/')[1] || 'jpeg';
        imageData = matches[2];
      }
    }
    
    const filename = `${subfolder}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${imageType}`;
    const uploadsDir = ensureUploadsDir();
    const subfolderDir = path.join(uploadsDir, subfolder);
    
    if (!fs.existsSync(subfolderDir)) {
      fs.mkdirSync(subfolderDir, { recursive: true });
    }
    
    const filePath = path.join(subfolderDir, filename);
    const buffer = Buffer.from(imageData, 'base64');
    
    fs.writeFileSync(filePath, buffer);
    
    return `/uploads/${subfolder}/${filename}`;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

const deleteFile = (filePath) => {
  if (!filePath) return;
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

const getBase64FromFile = (filePath) => {
  if (!filePath) return null;
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    const fileBuffer = fs.readFileSync(fullPath);
    const fileType = path.extname(filePath).substring(1);
    const base64 = fileBuffer.toString('base64');
    
    return `data:image/${fileType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
};

// Main Controller Functions
const createKinerja = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      tanggal,
      ruas_jalan,
      kegiatan,
      panjang_kr,
      panjang_kn,
      sket_image,
      foto_0,
      foto_50,
      foto_100
    } = req.body;

    // Validasi required fields
    if (!tanggal || !ruas_jalan || !kegiatan) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal, ruas jalan, dan kegiatan wajib diisi'
      });
    }

    // Set default value untuk panjang jika tidak ada
    const finalPanjangKr = panjang_kr !== undefined && panjang_kr !== null ? panjang_kr : 0;
    const finalPanjangKn = panjang_kn !== undefined && panjang_kn !== null ? panjang_kn : 0;

    // Cek apakah sudah ada data untuk tanggal dan user yang sama
    const [existing] = await pool.execute(
      'SELECT id FROM kinerja_harian WHERE user_id = ? AND tanggal = ?',
      [userId, tanggal]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Data kinerja untuk tanggal ini sudah ada'
      });
    }

    // Simpan gambar sebagai file
    const sketImagePath = saveBase64Image(sket_image, 'sket');
    const foto0Path = saveBase64Image(foto_0, 'foto');
    const foto50Path = saveBase64Image(foto_50, 'foto');
    const foto100Path = saveBase64Image(foto_100, 'foto');

    // Insert data kinerja
    const [result] = await pool.execute(
      `INSERT INTO kinerja_harian 
       (user_id, tanggal, ruas_jalan, kegiatan, panjang_kr, panjang_kn, 
        sket_image, foto_0, foto_50, foto_100) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        tanggal,
        ruas_jalan,
        kegiatan,
        finalPanjangKr,
        finalPanjangKn,
        sketImagePath,
        foto0Path,
        foto50Path,
        foto100Path
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_CREATE', `User membuat laporan kinerja harian - Ruas: ${ruas_jalan}`, userId]
    );

    res.status(201).json({
      success: true,
      message: 'Data kinerja harian berhasil disimpan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// NEW: Create kinerja with camera capture (accepts base64 images)
const createKinerjaWithCamera = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      tanggal,
      ruas_jalan,
      kegiatan,
      panjang_kr,
      panjang_kn,
      sket_image,
      foto_0,
      foto_50,
      foto_100
    } = req.body;

    // Validasi required fields
    if (!tanggal || !ruas_jalan || !kegiatan) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal, ruas jalan, dan kegiatan wajib diisi'
      });
    }

    // Validasi minimal satu foto dari kamera
    if (!foto_0 && !foto_50 && !foto_100) {
      return res.status(400).json({
        success: false,
        message: 'Minimal satu foto dokumentasi wajib diambil'
      });
    }

    // Set default value untuk panjang jika tidak ada
    const finalPanjangKr = panjang_kr !== undefined && panjang_kr !== null ? parseFloat(panjang_kr) : 0;
    const finalPanjangKn = panjang_kn !== undefined && panjang_kn !== null ? parseFloat(panjang_kn) : 0;

    // Cek apakah sudah ada data untuk tanggal dan user yang sama
    const [existing] = await pool.execute(
      'SELECT id FROM kinerja_harian WHERE user_id = ? AND tanggal = ?',
      [userId, tanggal]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Data kinerja untuk tanggal ini sudah ada'
      });
    }

    // Simpan gambar dari base64 (dari kamera)
    const sketImagePath = sket_image ? saveBase64Image(sket_image, 'sket') : null;
    const foto0Path = foto_0 ? saveBase64Image(foto_0, 'foto') : null;
    const foto50Path = foto_50 ? saveBase64Image(foto_50, 'foto') : null;
    const foto100Path = foto_100 ? saveBase64Image(foto_100, 'foto') : null;

    // Insert data kinerja
    const [result] = await pool.execute(
      `INSERT INTO kinerja_harian 
       (user_id, tanggal, ruas_jalan, kegiatan, panjang_kr, panjang_kn, 
        sket_image, foto_0, foto_50, foto_100) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        tanggal,
        ruas_jalan,
        kegiatan,
        finalPanjangKr,
        finalPanjangKn,
        sketImagePath,
        foto0Path,
        foto50Path,
        foto100Path
      ]
    );

    // Log activity with camera flag
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_CREATE_CAMERA', `User membuat laporan kinerja harian via kamera - Ruas: ${ruas_jalan}`, userId]
    );

    res.status(201).json({
      success: true,
      message: 'Data kinerja harian berhasil disimpan (via kamera)',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create kinerja with camera error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server saat menyimpan data dari kamera'
    });
  }
};

const getKinerjaUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bulan, tahun } = req.query;

    let query = `
      SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE k.user_id = ?
    `;
    const params = [userId];

    if (bulan && tahun) {
      query += ' AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?';
      params.push(bulan, tahun);
    }

    query += ' ORDER BY k.tanggal DESC';

    const [kinerja] = await pool.execute(query, params);

    // Convert file paths back to base64 untuk response
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100)
    }));

    res.json({
      success: true,
      data: parsedKinerja
    });

  } catch (error) {
    console.error('Get kinerja user error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKinerjaById = async (req, res) => {
  try {
    const { id } = req.params;

    const [kinerja] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE k.id = ?`,
      [id]
    );

    if (kinerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    // Convert file paths back to base64
    const data = {
      ...kinerja[0],
      sket_image: getBase64FromFile(kinerja[0].sket_image),
      foto_0: getBase64FromFile(kinerja[0].foto_0),
      foto_50: getBase64FromFile(kinerja[0].foto_50),
      foto_100: getBase64FromFile(kinerja[0].foto_100)
    };

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get kinerja by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateKinerja = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      tanggal,
      ruas_jalan,
      kegiatan,
      panjang_kr,
      panjang_kn,
      sket_image,
      foto_0,
      foto_50,
      foto_100
    } = req.body;

    // Cek kepemilikan data dan dapatkan data lama
    const [existing] = await pool.execute(
      'SELECT * FROM kinerja_harian WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    // Cek akses (user sendiri atau admin)
    if (existing[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk mengubah data ini'
      });
    }

    const oldData = existing[0];

    // Gunakan data lama jika field tidak dikirim atau null/undefined
    const finalTanggal = tanggal || oldData.tanggal;
    const finalRuasJalan = ruas_jalan || oldData.ruas_jalan;
    const finalKegiatan = kegiatan || oldData.kegiatan;
    
    // Untuk panjang, jika tidak dikirim atau null, gunakan data lama
    const finalPanjangKr = panjang_kr !== undefined && panjang_kr !== null 
      ? parseFloat(panjang_kr) 
      : oldData.panjang_kr;
    const finalPanjangKn = panjang_kn !== undefined && panjang_kn !== null 
      ? parseFloat(panjang_kn) 
      : oldData.panjang_kn;

    // Validasi hanya untuk field yang wajib
    if (!finalTanggal || !finalRuasJalan || !finalKegiatan) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal, ruas jalan, dan kegiatan wajib diisi'
      });
    }

    // Handle gambar - simpan yang baru, hapus yang lama jika diupdate
    let sketImagePath = oldData.sket_image;
    let foto0Path = oldData.foto_0;
    let foto50Path = oldData.foto_50;
    let foto100Path = oldData.foto_100;

    // Jika ada gambar baru (bukan 'keep' dan berbeda dari yang lama)
    if (sket_image && sket_image !== 'keep' && sket_image !== oldData.sket_image) {
      if (sketImagePath) {
        deleteFile(sketImagePath);
      }
      sketImagePath = saveBase64Image(sket_image, 'sket');
    }

    if (foto_0 && foto_0 !== 'keep' && foto_0 !== oldData.foto_0) {
      if (foto0Path) {
        deleteFile(foto0Path);
      }
      foto0Path = saveBase64Image(foto_0, 'foto');
    }

    if (foto_50 && foto_50 !== 'keep' && foto_50 !== oldData.foto_50) {
      if (foto50Path) {
        deleteFile(foto50Path);
      }
      foto50Path = saveBase64Image(foto_50, 'foto');
    }

    if (foto_100 && foto_100 !== 'keep' && foto_100 !== oldData.foto_100) {
      if (foto100Path) {
        deleteFile(foto100Path);
      }
      foto100Path = saveBase64Image(foto_100, 'foto');
    }

    // Update data
    await pool.execute(
      `UPDATE kinerja_harian SET 
        tanggal = ?, ruas_jalan = ?, kegiatan = ?, 
        panjang_kr = ?, panjang_kn = ?,
        sket_image = ?, foto_0 = ?, foto_50 = ?, foto_100 = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        finalTanggal,
        finalRuasJalan,
        finalKegiatan,
        finalPanjangKr,
        finalPanjangKn,
        sketImagePath,
        foto0Path,
        foto50Path,
        foto100Path,
        id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_UPDATE', `User mengupdate laporan kinerja harian - ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data kinerja berhasil diupdate'
    });

  } catch (error) {
    console.error('Update kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteKinerja = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cek kepemilikan data dan dapatkan path file
    const [existing] = await pool.execute(
      'SELECT user_id, sket_image, foto_0, foto_50, foto_100 FROM kinerja_harian WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    if (existing[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk menghapus data ini'
      });
    }

    // Hapus file-file gambar
    const fileFields = ['sket_image', 'foto_0', 'foto_50', 'foto_100'];
    fileFields.forEach(field => {
      if (existing[0][field]) {
        deleteFile(existing[0][field]);
      }
    });

    // Delete data dari database
    await pool.execute('DELETE FROM kinerja_harian WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_DELETE', `User menghapus laporan kinerja harian - ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data kinerja berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getAllKinerja = async (req, res) => {
  try {
    const { start_date, end_date, wilayah, user_id } = req.query;

    let query = `
      SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ' AND k.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    if (user_id) {
      query += ' AND k.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY k.tanggal DESC, u.nama ASC';

    const [kinerja] = await pool.execute(query, params);

    // Convert file paths ke base64
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100)
    }));

    res.json({
      success: true,
      data: parsedKinerja
    });

  } catch (error) {
    console.error('Get all kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKinerjaStatistik = async (req, res) => {
  try {
    const { bulan, tahun, wilayah } = req.query;

    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();

    let query = `
      SELECT 
        u.wilayah_penugasan,
        COUNT(k.id) as total_laporan,
        COUNT(DISTINCT k.user_id) as total_pegawai,
        AVG(k.panjang_kr) as avg_panjang_kr,
        AVG(k.panjang_kn) as avg_panjang_kn
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
    `;
    const params = [targetBulan, targetTahun];

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    query += ' GROUP BY u.wilayah_penugasan ORDER BY total_laporan DESC';

    const [statistik] = await pool.execute(query, params);

    res.json({
      success: true,
      data: statistik
    });

  } catch (error) {
    console.error('Get kinerja statistik error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const generatePDF = async (req, res) => {
  try {
    const { id } = req.params;

    // Get kinerja data
    const [kinerja] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE k.id = ?`,
      [id]
    );

    if (kinerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    const kinerjaData = kinerja[0];

    // Generate PDF
    const pdfBuffer = await generateKinerjaPDF(kinerjaData);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PDF_GENERATE', `Generate PDF laporan kinerja - ID: ${id}`, req.user.id]
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Laporan_${kinerjaData.nama}_${kinerjaData.tanggal}.pdf"`);
    
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat generate PDF'
    });
  }
};

const generateRekapWilayah = async (req, res) => {
  try {
    const { wilayah, start_date, end_date } = req.body;

    if (!wilayah) {
      return res.status(400).json({
        success: false,
        message: 'Wilayah harus diisi'
      });
    }

    // Get statistik wilayah
    const [statistik] = await pool.execute(
      `SELECT 
        u.wilayah_penugasan as wilayah,
        COUNT(k.id) as total_laporan,
        COUNT(DISTINCT k.user_id) as total_pegawai,
        AVG(k.panjang_kr) as avg_panjang_kr,
        AVG(k.panjang_kn) as avg_panjang_kn
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE u.wilayah_penugasan = ?
       ${start_date && end_date ? ' AND k.tanggal BETWEEN ? AND ?' : ''}
       GROUP BY u.wilayah_penugasan`,
      start_date && end_date ? [wilayah, start_date, end_date] : [wilayah]
    );

    if (statistik.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tidak ada data untuk wilayah ini'
      });
    }

    // Get detail laporan
    const [laporanList] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE u.wilayah_penugasan = ?
       ${start_date && end_date ? ' AND k.tanggal BETWEEN ? AND ?' : ''}
       ORDER BY k.tanggal DESC, u.nama ASC`,
      start_date && end_date ? [wilayah, start_date, end_date] : [wilayah]
    );

    const wilayahData = statistik[0];
    const periode = start_date && end_date 
      ? `${start_date} s/d ${end_date}`
      : 'Semua Periode';

    // Generate PDF
    const pdfBuffer = await generateRekapWilayahPDF(wilayahData, periode, laporanList);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PDF_GENERATE_REKAP', `Generate rekap PDF wilayah ${wilayah}`, req.user.id]
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rekap_Wilayah_${wilayah}.pdf"`);
    
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Generate rekap wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat generate rekap PDF'
    });
  }
};

const downloadAllWilayah = async (req, res) => {
  try {
    const { wilayah, start_date, end_date } = req.query;

    if (!wilayah) {
      return res.status(400).json({
        success: false,
        message: 'Wilayah harus diisi'
      });
    }

    // Get detail laporan
    const [laporanList] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE u.wilayah_penugasan = ?
       ${start_date && end_date ? ' AND k.tanggal BETWEEN ? AND ?' : ''}
       ORDER BY k.tanggal DESC, u.nama ASC`,
      start_date && end_date ? [wilayah, start_date, end_date] : [wilayah]
    );

    if (laporanList.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tidak ada data untuk wilayah ini'
      });
    }

    // Calculate statistics
    const totalPegawai = new Set(laporanList.map(item => item.user_id)).size;
    
    // Calculate averages
    let totalPanjangKr = 0;
    let totalPanjangKn = 0;
    let countValidKr = 0;
    let countValidKn = 0;

    laporanList.forEach(item => {
      const kr = parseFloat(item.panjang_kr) || 0;
      const kn = parseFloat(item.panjang_kn) || 0;
      
      if (kr > 0) {
        totalPanjangKr += kr;
        countValidKr++;
      }
      
      if (kn > 0) {
        totalPanjangKn += kn;
        countValidKn++;
      }
    });

    const wilayahData = {
      wilayah: wilayah,
      total_laporan: laporanList.length,
      total_pegawai: totalPegawai,
      avg_panjang_kr: countValidKr > 0 ? totalPanjangKr / countValidKr : 0,
      avg_panjang_kn: countValidKn > 0 ? totalPanjangKn / countValidKn : 0
    };

    const periode = start_date && end_date 
      ? `${start_date}_sampai_${end_date}`
      : 'semua_periode';

    // Generate ZIP dengan semua file PDF
    const zipBuffer = await generateWilayahAllPDFs(wilayahData, periode, laporanList);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DOWNLOAD_ALL_WILAYAH', `Download semua laporan wilayah ${wilayah} (${laporanList.length} files)`, req.user.id]
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Semua_Laporan_Wilayah_${wilayah}.zip"`);
    
    res.send(zipBuffer);

  } catch (error) {
    console.error('Download all wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat download semua laporan'
    });
  }
};
// ============ FUNGSI GET KINERJA USER PER BULAN (EFISIEN) ============

/**
 * FUNGSI BARU: Get kinerja user per bulan (lebih efisien)
 * Endpoint: GET /kinerja/perbulan
 * Query params: bulan, tahun (optional, default ke bulan/tahun saat ini)
 */
// ============ FUNGSI GET KINERJA USER PER BULAN (EFISIEN) ============

/**
 * FUNGSI BARU: Get kinerja user per bulan (lebih efisien)
 * Endpoint: GET /kinerja/perbulan
 * Query params: bulan, tahun (optional, default ke bulan/tahun saat ini)
 */
const getKinerjaUserPerBulan = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Ambil parameter bulan dan tahun dari query string
    let { bulan, tahun } = req.query;
    
    // Default ke bulan dan tahun saat ini
    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    
    // Validasi dan parsing bulan
    let targetBulan;
    if (bulan && bulan !== '' && !isNaN(parseInt(bulan))) {
      targetBulan = parseInt(bulan);
    } else {
      targetBulan = currentDate.month;
    }
    
    // Validasi dan parsing tahun
    let targetTahun;
    if (tahun && tahun !== '' && !isNaN(parseInt(tahun))) {
      targetTahun = parseInt(tahun);
    } else {
      targetTahun = currentDate.year;
    }
    
    // Validasi bulan (1-12)
    if (targetBulan < 1 || targetBulan > 12) {
      return res.status(400).json({
        success: false,
        message: 'Bulan harus antara 1 dan 12'
      });
    }
    
    // Validasi tahun (minimal 2000)
    if (targetTahun < 2000 || targetTahun > 2100) {
      return res.status(400).json({
        success: false,
        message: 'Tahun tidak valid'
      });
    }
    
    console.log(`📊 Getting kinerja for user ${userId} - Bulan: ${targetBulan}, Tahun: ${targetTahun}`);
    
    // Hitung tanggal awal dan akhir bulan
    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();
    
    // Query untuk mengambil data kinerja (sama persis dengan getKinerjaUser)
    const [kinerja] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE k.user_id = ? AND k.tanggal BETWEEN ? AND ?
       ORDER BY k.tanggal DESC`,
      [userId, startDate, endDate]
    );
    
    // Convert file paths back to base64 (sama persis dengan getKinerjaUser)
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100)
    }));
    
    // Hitung statistik (sama persis dengan getKinerjaUser)
    const totalLaporan = parsedKinerja.length;
    const totalPanjang = parsedKinerja.reduce((sum, item) => {
      const kr = parseFloat(item.panjang_kr) || 0;
      const kn = parseFloat(item.panjang_kn) || 0;
      return sum + kr + kn;
    }, 0);
    const avgPanjang = totalLaporan > 0 ? totalPanjang / totalLaporan : 0;
    
    // Hitung total hari kerja dalam bulan (Senin-Jumat)
    let totalHariKerja = 0;
    const startDateObj = DateTime.fromISO(startDate);
    const endDateObj = DateTime.fromISO(endDate);
    let currentDateLoop = startDateObj;
    
    while (currentDateLoop <= endDateObj) {
      const dayOfWeek = currentDateLoop.weekday;
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        totalHariKerja++;
      }
      currentDateLoop = currentDateLoop.plus({ days: 1 });
    }
    
    const presentaseKehadiran = totalHariKerja > 0 ? Math.round((totalLaporan / totalHariKerja) * 100) : 0;
    
    res.json({
      success: true,
      data: {
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate,
          total_hari_kerja: totalHariKerja
        },
        stats: {
          total_laporan: totalLaporan,
          total_panjang: totalPanjang,
          avg_panjang: avgPanjang,
          presentase_kehadiran: presentaseKehadiran
        },
        kinerja: parsedKinerja
      }
    });
    
  } catch (error) {
    console.error('❌ Get kinerja per bulan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============ FUNGSI GET KINERJA PER TANGGAL (UNTUK ADMIN) ============

/**
 * FUNGSI BARU: Get kinerja per tanggal (untuk admin)
 * Endpoint: GET /kinerja/admin/per-tanggal
 * Query params: tanggal (wajib), wilayah (optional), search (optional)
 */
const getKinerjaPerTanggal = async (req, res) => {
  try {
    // Hanya admin dan atasan yang bisa akses
    if (req.user.roles !== 'admin' && req.user.roles !== 'atasan') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengakses.'
      });
    }

    const { tanggal, wilayah, search } = req.query;

    // Validasi tanggal wajib
    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Parameter tanggal wajib diisi dengan format YYYY-MM-DD'
      });
    }

    // Validasi format tanggal
    const targetDate = DateTime.fromISO(tanggal);
    if (!targetDate.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    console.log(`📊 Getting kinerja for date: ${tanggal}`);
    console.log(`Filters - Wilayah: ${wilayah || 'semua'}, Search: ${search || 'tidak ada'}`);

    let query = `
      SELECT 
        k.*, 
        u.nama, 
        u.jabatan, 
        u.wilayah_penugasan,
        DATE_FORMAT(k.tanggal, '%d %M %Y') as tanggal_formatted,
        DATE_FORMAT(k.tanggal, '%W') as hari
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE DATE(k.tanggal) = ?
        AND u.is_active = 1
    `;
    
    const params = [tanggal];

    // Filter wilayah
    if (wilayah && wilayah !== '') {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    // Filter search (nama pegawai, ruas jalan, atau kegiatan)
    if (search && search !== '') {
      query += ` AND (
        u.nama LIKE ? OR 
        k.ruas_jalan LIKE ? OR 
        k.kegiatan LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY u.nama ASC, k.tanggal DESC';

    console.log('📝 SQL Query:', query);
    console.log('📝 Parameters:', params);

    const [kinerja] = await pool.execute(query, params);

    console.log(`✅ Found ${kinerja.length} kinerja records for date ${tanggal}`);

    // Convert file paths ke base64 (sama seperti getAllKinerja)
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100),
      // Tambahkan formatted fields
      panjang_kr_formatted: item.panjang_kr ? `${item.panjang_kr} meter` : '0 meter',
      panjang_kn_formatted: item.panjang_kn ? `${item.panjang_kn} meter` : '0 meter',
      total_panjang: (parseFloat(item.panjang_kr) || 0) + (parseFloat(item.panjang_kn) || 0)
    }));

    // Hitung statistik
    const totalLaporan = parsedKinerja.length;
    const uniquePegawai = [...new Set(parsedKinerja.map(item => item.user_id))].length;
    const totalPanjangKR = parsedKinerja.reduce((sum, item) => sum + (parseFloat(item.panjang_kr) || 0), 0);
    const totalPanjangKN = parsedKinerja.reduce((sum, item) => sum + (parseFloat(item.panjang_kn) || 0), 0);
    const avgPanjangKR = totalLaporan > 0 ? totalPanjangKR / totalLaporan : 0;
    const avgPanjangKN = totalLaporan > 0 ? totalPanjangKN / totalLaporan : 0;

    // Statistik per wilayah
    const wilayahStatistik = {};
    parsedKinerja.forEach(item => {
      const wilayahName = item.wilayah_penugasan || 'Unknown';
      if (!wilayahStatistik[wilayahName]) {
        wilayahStatistik[wilayahName] = {
          total: 0,
          total_kr: 0,
          total_kn: 0,
          pegawai: new Set()
        };
      }
      wilayahStatistik[wilayahName].total++;
      wilayahStatistik[wilayahName].total_kr += parseFloat(item.panjang_kr) || 0;
      wilayahStatistik[wilayahName].total_kn += parseFloat(item.panjang_kn) || 0;
      wilayahStatistik[wilayahName].pegawai.add(item.user_id);
    });

    // Konversi Set ke jumlah untuk response
    Object.keys(wilayahStatistik).forEach(wilayahName => {
      wilayahStatistik[wilayahName].total_pegawai = wilayahStatistik[wilayahName].pegawai.size;
      delete wilayahStatistik[wilayahName].pegawai;
    });

    // Data untuk chart
    const chartData = {
      labels: ['Panjang KR', 'Panjang KN'],
      datasets: [{
        data: [totalPanjangKR, totalPanjangKN],
        backgroundColor: ['#10B981', '#3B82F6'],
        borderColor: ['#0DA675', '#2563EB'],
        borderWidth: 1
      }]
    };

    res.json({
      success: true,
      data: {
        tanggal: tanggal,
        tanggal_formatted: targetDate.toFormat('dd MMMM yyyy'),
        hari: targetDate.toFormat('EEEE'),
        statistik: {
          total_laporan: totalLaporan,
          total_pegawai: uniquePegawai,
          total_panjang_kr: parseFloat(totalPanjangKR.toFixed(2)),
          total_panjang_kn: parseFloat(totalPanjangKN.toFixed(2)),
          avg_panjang_kr: parseFloat(avgPanjangKR.toFixed(2)),
          avg_panjang_kn: parseFloat(avgPanjangKN.toFixed(2)),
          wilayah: wilayahStatistik
        },
        charts: {
          pie: chartData
        },
        kinerja: parsedKinerja
      }
    });

  } catch (error) {
    console.error('❌ Get kinerja per tanggal error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============ FUNGSI GET ALL KINERJA PER BULAN (UNTUK ADMIN) ============

/**
 * FUNGSI BARU: Get semua kinerja per bulan untuk admin
 * Endpoint: GET /kinerja/admin/perbulan
 * Query params: bulan, tahun (wajib), wilayah (optional), search (optional)
 */
const getAllKinerjaPerBulan = async (req, res) => {
  try {
    // Hanya admin dan atasan yang bisa akses
    if (req.user.roles !== 'admin' && req.user.roles !== 'atasan') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengakses.'
      });
    }

    let { bulan, tahun, wilayah, search } = req.query;

    // Validasi bulan dan tahun wajib
    if (!bulan || !tahun) {
      return res.status(400).json({
        success: false,
        message: 'Parameter bulan dan tahun wajib diisi'
      });
    }

    const targetBulan = parseInt(bulan);
    const targetTahun = parseInt(tahun);

    // Validasi bulan (1-12)
    if (targetBulan < 1 || targetBulan > 12) {
      return res.status(400).json({
        success: false,
        message: 'Bulan harus antara 1 dan 12'
      });
    }

    // Validasi tahun (minimal 2000)
    if (targetTahun < 2000 || targetTahun > 2100) {
      return res.status(400).json({
        success: false,
        message: 'Tahun tidak valid'
      });
    }

    console.log(`📊 Getting all kinerja for admin - Bulan: ${targetBulan}, Tahun: ${targetTahun}`);
    console.log(`Filters - Wilayah: ${wilayah || 'semua'}, Search: ${search || 'tidak ada'}`);

    // Hitung tanggal awal dan akhir bulan
    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();

    let query = `
      SELECT 
        k.*, 
        u.id as user_id,
        u.nama, 
        u.jabatan, 
        u.wilayah_penugasan,
        DATE_FORMAT(k.tanggal, '%Y-%m-%d') as tanggal,
        DATE_FORMAT(k.tanggal, '%d %M %Y') as tanggal_formatted,
        DATE_FORMAT(k.tanggal, '%W') as hari
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE DATE(k.tanggal) BETWEEN ? AND ?
        AND u.is_active = 1
        AND u.roles = 'pegawai'
    `;
    
    const params = [startDate, endDate];

    // Filter wilayah
    if (wilayah && wilayah !== '') {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    // Filter search (nama pegawai, ruas jalan, atau kegiatan)
    if (search && search !== '') {
      query += ` AND (
        u.nama LIKE ? OR 
        k.ruas_jalan LIKE ? OR 
        k.kegiatan LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY u.nama ASC, k.tanggal ASC';

    console.log('📝 SQL Query:', query);
    console.log('📝 Parameters:', params);

    const [kinerja] = await pool.execute(query, params);

    console.log(`✅ Found ${kinerja.length} kinerja records for period ${startDate} to ${endDate}`);

    // Convert file paths ke base64
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100),
      // Tambahkan formatted fields
      panjang_kr_formatted: item.panjang_kr ? `${item.panjang_kr} meter` : '0 meter',
      panjang_kn_formatted: item.panjang_kn ? `${item.panjang_kn} meter` : '0 meter',
      total_panjang: (parseFloat(item.panjang_kr) || 0) + (parseFloat(item.panjang_kn) || 0)
    }));

    // Hitung total hari kerja dalam bulan
    let totalHariKerja = 0;
    const startDateObj = DateTime.fromISO(startDate);
    const endDateObj = DateTime.fromISO(endDate);
    let currentDateLoop = startDateObj;
    
    while (currentDateLoop <= endDateObj) {
      const dayOfWeek = currentDateLoop.weekday;
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        totalHariKerja++;
      }
      currentDateLoop = currentDateLoop.plus({ days: 1 });
    }

    // Dapatkan semua pegawai aktif
    let pegawaiQuery = `
      SELECT id, nama, jabatan, wilayah_penugasan
      FROM users 
      WHERE is_active = 1 AND roles = 'pegawai'
    `;
    
    let pegawaiParams = [];
    
    if (wilayah && wilayah !== '') {
      pegawaiQuery += ' AND wilayah_penugasan = ?';
      pegawaiParams.push(wilayah);
    }
    
    if (search && search !== '') {
      pegawaiQuery += ` AND (nama LIKE ? OR jabatan LIKE ?)`;
      const searchPattern = `%${search}%`;
      pegawaiParams.push(searchPattern, searchPattern);
    }
    
    pegawaiQuery += ' ORDER BY nama ASC';
    
    const [pegawaiList] = await pool.execute(pegawaiQuery, pegawaiParams);
    
    // Kelompokkan kinerja per pegawai
    const kinerjaPerPegawai = {};
    
    // Inisialisasi semua pegawai
    pegawaiList.forEach(pegawai => {
      kinerjaPerPegawai[pegawai.id] = {
        id: pegawai.id,
        nama: pegawai.nama,
        jabatan: pegawai.jabatan,
        wilayah: pegawai.wilayah_penugasan,
        total_hari_lapor: 0,
        total_kr: 0,
        total_kn: 0,
        rata_harian_kr: 0,
        rata_harian_kn: 0,
        persen_kehadiran: 0,
        target_kr_bulanan: totalHariKerja * 50, // Target 50 meter per hari
        target_kn_bulanan: totalHariKerja * 50, // Target 50 meter per hari
        laporan_harian: [],
        status: 'belum_lapor'
      };
    });
    
    // Isi data kinerja
    parsedKinerja.forEach(item => {
      if (kinerjaPerPegawai[item.user_id]) {
        const pegawai = kinerjaPerPegawai[item.user_id];
        pegawai.total_hari_lapor++;
        pegawai.total_kr += parseFloat(item.panjang_kr) || 0;
        pegawai.total_kn += parseFloat(item.panjang_kn) || 0;
        pegawai.laporan_harian.push({
          tanggal: item.tanggal,
          tanggal_formatted: item.tanggal_formatted,
          hari: item.hari,
          ruas_jalan: item.ruas_jalan,
          kegiatan: item.kegiatan,
          panjang_kr: item.panjang_kr,
          panjang_kn: item.panjang_kn,
          total_panjang: item.total_panjang
        });
      }
    });
    
    // Hitung statistik per pegawai
    let totalSudahLapor = 0;
    let totalKR = 0;
    let totalKN = 0;
    let totalPencapaianKR = 0;
    let totalPencapaianKN = 0;
    
    Object.values(kinerjaPerPegawai).forEach(pegawai => {
      if (pegawai.total_hari_lapor > 0) {
        totalSudahLapor++;
        pegawai.rata_harian_kr = pegawai.total_kr / pegawai.total_hari_lapor;
        pegawai.rata_harian_kn = pegawai.total_kn / pegawai.total_hari_lapor;
        pegawai.persen_kehadiran = (pegawai.total_hari_lapor / totalHariKerja) * 100;
        
        const pencapaianKR = (pegawai.total_kr / pegawai.target_kr_bulanan) * 100;
        const pencapaianKN = (pegawai.total_kn / pegawai.target_kn_bulanan) * 100;
        
        pegawai.pencapaian_kr = parseFloat(pencapaianKR.toFixed(1));
        pegawai.pencapaian_kn = parseFloat(pencapaianKN.toFixed(1));
        
        if (pegawai.pencapaian_kr >= 100 && pegawai.pencapaian_kn >= 100) {
          pegawai.status = 'tercapai_target';
        } else if (pegawai.pencapaian_kr >= 80 && pegawai.pencapaian_kn >= 80) {
          pegawai.status = 'hampir_tercapai';
        } else if (pegawai.pencapaian_kr >= 60 && pegawai.pencapaian_kn >= 60) {
          pegawai.status = 'sedang';
        } else {
          pegawai.status = 'tidak_tercapai';
        }
        
        totalKR += pegawai.total_kr;
        totalKN += pegawai.total_kn;
        totalPencapaianKR += pegawai.pencapaian_kr;
        totalPencapaianKN += pegawai.pencapaian_kn;
      } else {
        pegawai.pencapaian_kr = 0;
        pegawai.pencapaian_kn = 0;
        pegawai.persen_kehadiran = 0;
        pegawai.status = 'tidak_ada_laporan';
      }
    });
    
    // Hitung statistik keseluruhan
    const totalPegawai = pegawaiList.length;
    const rataKR = totalSudahLapor > 0 ? totalKR / totalSudahLapor : 0;
    const rataKN = totalSudahLapor > 0 ? totalKN / totalSudahLapor : 0;
    const rataPencapaianKR = totalSudahLapor > 0 ? totalPencapaianKR / totalSudahLapor : 0;
    const rataPencapaianKN = totalSudahLapor > 0 ? totalPencapaianKN / totalSudahLapor : 0;
    
    // Hitung status counts
    const statusCounts = {
      tercapai_target: Object.values(kinerjaPerPegawai).filter(p => p.status === 'tercapai_target').length,
      hampir_tercapai: Object.values(kinerjaPerPegawai).filter(p => p.status === 'hampir_tercapai').length,
      sedang: Object.values(kinerjaPerPegawai).filter(p => p.status === 'sedang').length,
      tidak_tercapai: Object.values(kinerjaPerPegawai).filter(p => p.status === 'tidak_tercapai').length,
      tidak_ada_laporan: Object.values(kinerjaPerPegawai).filter(p => p.status === 'tidak_ada_laporan').length
    };
    
    // Data untuk chart
    const chartData = {
      labels: Object.values(kinerjaPerPegawai).map(p => p.nama),
      datasets: [
        {
          label: 'Pencapaian KR (%)',
          data: Object.values(kinerjaPerPegawai).map(p => p.pencapaian_kr || 0),
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderColor: 'rgb(34, 197, 94)',
          borderWidth: 1
        },
        {
          label: 'Pencapaian KN (%)',
          data: Object.values(kinerjaPerPegawai).map(p => p.pencapaian_kn || 0),
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1
        }
      ]
    };
    
    res.json({
      success: true,
      data: {
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate,
          total_hari_kerja: totalHariKerja
        },
        statistik: {
          total_pegawai: totalPegawai,
          total_sudah_lapor: totalSudahLapor,
          total_belum_lapor: totalPegawai - totalSudahLapor,
          total_kr: parseFloat(totalKR.toFixed(2)),
          total_kn: parseFloat(totalKN.toFixed(2)),
          rata_kr: parseFloat(rataKR.toFixed(2)),
          rata_kn: parseFloat(rataKN.toFixed(2)),
          rata_pencapaian_kr: parseFloat(rataPencapaianKR.toFixed(1)),
          rata_pencapaian_kn: parseFloat(rataPencapaianKN.toFixed(1)),
          persen_sudah_lapor: totalPegawai > 0 ? parseFloat(((totalSudahLapor / totalPegawai) * 100).toFixed(1)) : 0,
          status_counts: statusCounts
        },
        charts: chartData,
        pegawai_kinerja: Object.values(kinerjaPerPegawai),
        all_kinerja: parsedKinerja
      }
    });

  } catch (error) {
    console.error('❌ Get all kinerja per bulan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  createKinerja,
  createKinerjaWithCamera,
  getKinerjaUser,
  getKinerjaUserPerBulan,
  getKinerjaPerTanggal,
  getAllKinerjaPerBulan, // TAMBAHKAN INI
  getKinerjaById,
  updateKinerja,
  deleteKinerja,
  getAllKinerja,
  getKinerjaStatistik,
  generatePDF,
  generateRekapWilayah,
  downloadAllWilayah
};
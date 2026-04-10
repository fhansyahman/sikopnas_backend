const { pool } = require('../config/database');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');

const getAllIzin = async (req, res) => {
  try {
    const { status, user_id, jenis, tanggal } = req.query;

    let query = `
      SELECT i.*, u.nama as nama_pegawai, u.jabatan, u.wilayah_penugasan,
             admin.nama as Disetujui_by_name
      FROM izin i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN users admin ON i.updated_by = admin.id
    `;
    const params = [];
    const conditions = [];

    // Filter status
    if (status) {
      conditions.push('i.status = ?');
      params.push(status);
    }

    // Filter user_id
    if (user_id) {
      conditions.push('i.user_id = ?');
      params.push(user_id);
    }

    // PERBAIKAN: Tambahkan filter jenis
    if (jenis) {
      conditions.push('i.jenis = ?');
      params.push(jenis);
    }

    // PERBAIKAN: Tambahkan filter tanggal
    if (tanggal) {
      conditions.push('? BETWEEN i.tanggal_mulai AND i.tanggal_selesai');
      params.push(tanggal);
    }

    // Gabungkan semua kondisi
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY i.created_at DESC';

    console.log('📝 SQL Query:', query);
    console.log('📝 Parameters:', params);

    const [izin] = await pool.execute(query, params);

    console.log(`✅ Found ${izin.length} izin records`);

    res.json({
      success: true,
      data: izin,
      filters: { status, user_id, jenis, tanggal } // Kirim balik filter untuk debugging
    });

  } catch (error) {
    console.error('Get all izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getIzinById = async (req, res) => {
  try {
    const { id } = req.params;

    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai, u.jabatan, u.wilayah_penugasan,
              admin.nama as Disetujui_by_name
       FROM izin i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN users admin ON i.updated_by = admin.id
       WHERE i.id = ?`,
      [id]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: izin[0]
    });

  } catch (error) {
    console.error('Get izin by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getMyIzin = async (req, res) => {
  try {
    const userId = req.user.id;

    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai, u.jabatan,
              admin.nama as Disetujui_by_name
       FROM izin i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN users admin ON i.updated_by = admin.id
       WHERE i.user_id = ?
       ORDER BY i.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: izin
    });

  } catch (error) {
    console.error('Get my izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createIzin = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      jenis, 
      tanggal_mulai, 
      tanggal_selesai, 
      keterangan, 
      dokumen_pendukung 
    } = req.body;

    console.log('Create izin attempt - User:', userId);
    console.log('Data:', { jenis, tanggal_mulai, tanggal_selesai, keterangan });

    // Validasi required fields
    if (!jenis || !tanggal_mulai || !tanggal_selesai) {
      return res.status(400).json({
        success: false,
        message: 'Jenis, tanggal mulai, dan tanggal selesai wajib diisi'
      });
    }

    // Validasi jenis izin sesuai ENUM
    const validJenis = [
      'Sakit', 'Izin','Dinas Luar'
    ];
    
    if (!validJenis.includes(jenis)) {
      return res.status(400).json({
        success: false,
        message: `Jenis izin tidak valid. Pilihan: ${validJenis.join(', ')}`
      });
    }

    // Parsing tanggal dengan Luxon
    const startDate = DateTime.fromISO(tanggal_mulai);
    const endDate = DateTime.fromISO(tanggal_selesai);

    // Validasi tanggal
    if (!startDate.isValid || !endDate.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid'
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal selesai tidak boleh sebelum tanggal mulai'
      });
    }

    // Hitung durasi hari dengan Luxon
    const durasi_hari = endDate.diff(startDate, 'days').days + 1;

    let dokumenFileName = null;

    // Handle file upload jika ada dokumen pendukung
    if (dokumen_pendukung) {
      // Generate filename dengan timestamp Luxon
      const timestamp = DateTime.now().setZone('Asia/Jakarta').toFormat('yyyyMMdd_HHmmss');
      dokumenFileName = `izin_${userId}_${timestamp}.pdf`;
      const filePath = path.join(__dirname, '../uploads/izin', dokumenFileName);
      
      // Convert base64 to file dan simpan
      const base64Data = dokumen_pendukung.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Pastikan folder uploads exists
      const uploadDir = path.join(__dirname, '../uploads/izin');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, buffer);
      console.log('Dokumen izin disimpan sebagai:', dokumenFileName);
    }

    // Format tanggal untuk database (YYYY-MM-DD)
    const tanggalMulaiDB = startDate.toFormat('yyyy-MM-dd');
    const tanggalSelesaiDB = endDate.toFormat('yyyy-MM-dd');

    // Insert izin ke database
    const [result] = await pool.execute(
      `INSERT INTO izin 
       (user_id, tanggal_mulai, tanggal_selesai, durasi_hari, jenis, 
        keterangan, dokumen_pendukung, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        userId,
        tanggalMulaiDB,
        tanggalSelesaiDB,
        durasi_hari,
        jenis,
        keterangan || null,
        dokumenFileName,
      ]
    );

    // Log activity dengan timestamp Luxon
    const now = DateTime.now().setZone('Asia/Jakarta');
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, created_at) VALUES (?, ?, ?, ?)',
      ['CREATE_IZIN', `User mengajukan izin ${jenis} - ${durasi_hari} hari`, userId, now.toJSDate()]
    );

    console.log('Izin berhasil dibuat - ID:', result.insertId);

    res.json({
      success: true,
      message: 'Izin berhasil diajukan',
      data: {
        id: result.insertId,
        jenis,
        tanggal_mulai: tanggalMulaiDB,
        tanggal_selesai: tanggalSelesaiDB,
        durasi_hari,
        status: 'Pending'
      }
    });

  } catch (error) {
    console.error('Create izin error:', error);
    console.error('Error details:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateIzinStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.user.id;

    console.log('=== UPDATE IZIN STATUS START ===');

    // Validasi status
    if (!status || !['Disetujui', 'Ditolak'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus Disetujui atau Ditolak'
      });
    }

    // Cek apakah izin exists
    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai 
       FROM izin i 
       JOIN users u ON i.user_id = u.id 
       WHERE i.id = ?`,
      [id]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    console.log('Izin found - Dates:', izin[0].tanggal_mulai, 'to', izin[0].tanggal_selesai);

    // Update status izin dengan timestamp Luxon
    const now = DateTime.now().setZone('Asia/Jakarta');
    await pool.execute(
      `UPDATE izin SET 
        status = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [status, adminId, now.toJSDate(), id]
    );

    console.log('Izin status updated successfully');

    let presensiGenerated = 0;
    
    // Jika status Disetujui, generate presensi otomatis
    if (status === 'Disetujui') {
      console.log('Starting presensi generation...');
      try {
        // **GUNAKAN FUNGSI YANG SAMA DENGAN BACKEND LAMA TAPI DENGAN LUXON**
        presensiGenerated = await generatePresensiIzinSimpleWithLuxon(izin[0]);
        console.log('Presensi generation completed successfully');
      } catch (presensiError) {
        console.error('Presensi generation failed:', presensiError);
      }
    }

    // Log activity dengan timestamp Luxon
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, created_at) VALUES (?, ?, ?, ?)',
      ['UPDATE_IZIN_STATUS', `Admin mengubah status izin ID ${id} menjadi ${status}`, adminId, now.toJSDate()]
    );

    // Kirim response
    const response = {
      success: true,
      message: `Izin berhasil ${status.toLowerCase()}`,
      data: {
        izin_id: parseInt(id),
        status: status,
        presensi_generated: presensiGenerated
      }
    };

    console.log('Sending response');
    res.json(response);

  } catch (error) {
    console.error('!!! UPDATE IZIN STATUS ERROR:', error);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteIzin = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cek apakah izin exists
    const [izin] = await pool.execute(
      'SELECT * FROM izin WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    // Hanya bisa hapus izin dengan status Pending
    if (izin[0].status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya bisa menghapus izin dengan status Pending'
      });
    }

    // Hapus izin
    await pool.execute('DELETE FROM izin WHERE id = ?', [id]);

    // Log activity dengan timestamp Luxon
    const now = DateTime.now().setZone('Asia/Jakarta');
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, created_at) VALUES (?, ?, ?, ?)',
      ['DELETE_IZIN', `User menghapus pengajuan izin ID: ${id}`, userId, now.toJSDate()]
    );

    res.json({
      success: true,
      message: 'Izin berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// =============================================
// FUNGSI GENERATE PRESENSI YANG BERHASIL BEKERJA
// =============================================

// Versi 1: Menggunakan pendekatan yang sama dengan backend lama tapi dengan Luxon
const generatePresensiIzinSimpleWithLuxon = async (izin) => {
  let generatedCount = 0;
  
  try {
    console.log('=== GENERATE PRESENSI IZIN WITH LUXON (SIMPLE) ===');
    console.log('Izin ID:', izin.id, 'User ID:', izin.user_id);
    console.log('Tanggal mulai raw:', izin.tanggal_mulai);
    console.log('Tanggal selesai raw:', izin.tanggal_selesai);
    
    // **KUNCI UTAMA: Tangani format tanggal dari database dengan benar**
    // Data dari database bisa berupa string 'YYYY-MM-DD' atau Date object
    
    let tanggalMulaiStr, tanggalSelesaiStr;
    
    // Konversi ke string YYYY-MM-DD
    if (izin.tanggal_mulai instanceof Date) {
      // Jika Date object, format ke YYYY-MM-DD
      tanggalMulaiStr = DateTime.fromJSDate(izin.tanggal_mulai).toFormat('yyyy-MM-dd');
    } else {
      // Jika string, langsung gunakan
      tanggalMulaiStr = izin.tanggal_mulai;
    }
    
    if (izin.tanggal_selesai instanceof Date) {
      tanggalSelesaiStr = DateTime.fromJSDate(izin.tanggal_selesai).toFormat('yyyy-MM-dd');
    } else {
      tanggalSelesaiStr = izin.tanggal_selesai;
    }
    
    console.log('Tanggal mulai processed:', tanggalMulaiStr);
    console.log('Tanggal selesai processed:', tanggalSelesaiStr);
    
    // Parsing dengan Luxon - gunakan fromSQL untuk format YYYY-MM-DD
    let startDate = DateTime.fromSQL(tanggalMulaiStr);
    let endDate = DateTime.fromSQL(tanggalSelesaiStr);
    
    // Fallback jika fromSQL tidak berhasil
    if (!startDate.isValid) {
      startDate = DateTime.fromISO(tanggalMulaiStr);
    }
    if (!endDate.isValid) {
      endDate = DateTime.fromISO(tanggalSelesaiStr);
    }
    
    console.log('Start date parsed:', startDate.toISO(), 'Valid:', startDate.isValid);
    console.log('End date parsed:', endDate.toISO(), 'Valid:', endDate.isValid);
    
    if (!startDate.isValid || !endDate.isValid) {
      throw new Error(`Format tanggal tidak valid: ${tanggalMulaiStr} - ${tanggalSelesaiStr}`);
    }
    
    // Set timezone ke Asia/Jakarta dan start of day
    startDate = startDate.setZone('Asia/Jakarta').startOf('day');
    endDate = endDate.setZone('Asia/Jakarta').startOf('day');
    
    // Validasi
    if (startDate > endDate) {
      throw new Error('Tanggal mulai tidak boleh setelah tanggal selesai');
    }
    
    console.log('Date range for generation:');
    console.log('Start:', startDate.toFormat('dd/MM/yyyy'));
    console.log('End:', endDate.toFormat('dd/MM/yyyy'));
    console.log('Days:', endDate.diff(startDate, 'days').days + 1);
    
    // Loop melalui setiap tanggal
    let currentDate = startDate;
    let dayCounter = 0;
    
    while (currentDate <= endDate) {
      dayCounter++;
      
      // Format tanggal untuk database
      const tanggal = currentDate.toFormat('yyyy-MM-dd');
      console.log(`Day ${dayCounter}: Generating for ${tanggal}`);
      
      try {
        // Cek apakah sudah ada presensi
        const [existingPresensi] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [izin.user_id, tanggal]
        );
        
        const statusIzin = 'Tanpa Keterangan';
        const statusPulang = 'Belum Pulang';
        
        if (existingPresensi.length === 0) {
          // Insert baru
          const [insertResult] = await pool.execute(
            `INSERT INTO presensi 
             (user_id, izin_id, tanggal, status_masuk, status_pulang, 
              is_system_generated, keterangan, created_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
            [
              izin.user_id,
              izin.id,
              tanggal,
              statusIzin,
              statusPulang,
              `Auto-generated: Izin ${izin.jenis}`,
              DateTime.now().setZone('Asia/Jakarta').toJSDate()
            ]
          );
          console.log(`✓ Inserted presensi ID: ${insertResult.insertId}`);
          generatedCount++;
        } else {
          // Update yang sudah ada
          const [updateResult] = await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?, status_masuk = ?, status_pulang = ?,
              keterangan = ?, updated_at = ?
             WHERE user_id = ? AND tanggal = ?`,
            [
              izin.id,
              statusIzin,
              statusPulang,
              `Updated: Izin ${izin.jenis}`,
              DateTime.now().setZone('Asia/Jakarta').toJSDate(),
              izin.user_id,
              tanggal
            ]
          );
          console.log(`✓ Updated rows: ${updateResult.affectedRows}`);
          generatedCount++;
        }
      } catch (error) {
        console.error(`✗ Error for date ${tanggal}:`, error.message);
      }
      
      // Tambah 1 hari
      currentDate = currentDate.plus({ days: 1 });
    }
    
    console.log('=== GENERATION COMPLETE ===');
    console.log(`Total days processed: ${dayCounter}`);
    console.log(`Total records generated/updated: ${generatedCount}`);
    
  } catch (error) {
    console.error('!!! ERROR in generatePresensiIzinSimpleWithLuxon:', error);
    throw error;
  }
  
  return generatedCount;
};

// Versi 2: Hybrid approach - menggunakan logic yang sama persis dengan backend lama
const generatePresensiIzinHybrid = async (izin) => {
  let generatedCount = 0;
  
  try {
    console.log('=== GENERATE PRESENSI IZIN HYBRID ===');
    
    // Gunakan pendekatan yang sama dengan backend lama
    const parseDateWithTimezone = (dateString) => {
      if (!dateString) return null;
      
      try {
        // Jika sudah Date object
        if (dateString instanceof Date) {
          return DateTime.fromJSDate(dateString);
        }
        
        // Jika string, parsing dengan berbagai cara
        let dt = DateTime.fromSQL(dateString);
        if (!dt.isValid) {
          dt = DateTime.fromISO(dateString);
        }
        if (!dt.isValid) {
          // Parsing manual untuk format YYYY-MM-DD
          const parts = dateString.split('-');
          if (parts.length === 3) {
            dt = DateTime.fromObject({
              year: parseInt(parts[0]),
              month: parseInt(parts[1]),
              day: parseInt(parts[2]),
              hour: 12, // Set ke tengah hari untuk hindari masalah midnight
              zone: 'Asia/Jakarta'
            });
          }
        }
        
        return dt.isValid ? dt : null;
      } catch (error) {
        console.error('Error parsing date:', error);
        return null;
      }
    };
    
    const startDate = parseDateWithTimezone(izin.tanggal_mulai);
    const endDate = parseDateWithTimezone(izin.tanggal_selesai);
    
    console.log('Start date:', startDate?.toFormat('dd/MM/yyyy'));
    console.log('End date:', endDate?.toFormat('dd/MM/yyyy'));
    
    if (!startDate || !endDate || !startDate.isValid || !endDate.isValid) {
      throw new Error('Format tanggal tidak valid');
    }
    
    // Loop
    let currentDate = startDate;
    while (currentDate <= endDate) {
      const tanggal = currentDate.toFormat('yyyy-MM-dd');
      
      try {
        // Cek existing
        const [existing] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [izin.user_id, tanggal]
        );
        
        const [result] = existing.length === 0 
          ? await pool.execute(
              `INSERT INTO presensi 
               (user_id, izin_id, tanggal, status_masuk, status_pulang, 
                is_system_generated, keterangan) 
               VALUES (?, ?, ?, ?, ?, 1, ?)`,
              [
                izin.user_id,
                izin.id,
                tanggal,
                'Tanpa Keterangan',
                'Belum Pulang',
                `Auto-generated: Izin ${izin.jenis}`
              ]
            )
          : await pool.execute(
              `UPDATE presensi SET 
                izin_id = ?, status_masuk = ?, status_pulang = ?,
                keterangan = ?, updated_at = NOW()
               WHERE user_id = ? AND tanggal = ?`,
              [
                izin.id,
                'Tanpa Keterangan',
                'Belum Pulang',
                `Updated: Izin ${izin.jenis}`,
                izin.user_id,
                tanggal
              ]
            );
        
        generatedCount++;
        console.log(`✓ Processed date: ${tanggal}`);
        
      } catch (error) {
        console.error(`✗ Error for ${tanggal}:`, error.message);
      }
      
      currentDate = currentDate.plus({ days: 1 });
    }
    
  } catch (error) {
    console.error('Hybrid generation error:', error);
    throw error;
  }
  
  return generatedCount;
};

// Versi 3: Simple and reliable (rekomendasi)
const generatePresensiIzinReliable = async (izin) => {
  let generatedCount = 0;
  
  try {
    console.log('=== GENERATE PRESENSI IZIN RELIABLE ===');
    
    // **SOLUSI PALING SIMPLE: Parsing manual YYYY-MM-DD**
    const parseDateManual = (dateInput) => {
      let dateStr;
      
      if (dateInput instanceof Date) {
        // Convert Date to YYYY-MM-DD string
        const year = dateInput.getFullYear();
        const month = String(dateInput.getMonth() + 1).padStart(2, '0');
        const day = String(dateInput.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      } else {
        // Assume it's already YYYY-MM-DD string
        dateStr = String(dateInput);
      }
      
      // Parse YYYY-MM-DD
      const [year, month, day] = dateStr.split('-').map(Number);
      
      // Create Luxon DateTime with explicit timezone
      return DateTime.fromObject({
        year: year,
        month: month,
        day: day,
        zone: 'Asia/Jakarta'
      }).startOf('day');
    };
    
    const startDate = parseDateManual(izin.tanggal_mulai);
    const endDate = parseDateManual(izin.tanggal_selesai);
    
    console.log('Start:', startDate.toFormat('dd/MM/yyyy'));
    console.log('End:', endDate.toFormat('dd/MM/yyyy'));
    
    // Validasi
    if (!startDate.isValid || !endDate.isValid) {
      throw new Error('Invalid dates');
    }
    
    if (startDate > endDate) {
      throw new Error('Start date after end date');
    }
    
    // Loop
    let currentDate = startDate;
    while (currentDate <= endDate) {
      const tanggal = currentDate.toFormat('yyyy-MM-dd');
      
      try {
        // Gunakan query yang sama dengan backend lama
        const [existing] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [izin.user_id, tanggal]
        );
        
        if (existing.length === 0) {
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, izin_id, tanggal, status_masuk, status_pulang, 
              is_system_generated, keterangan) 
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [
              izin.user_id,
              izin.id,
              tanggal,
              'Tanpa Keterangan',
              'Belum Pulang',
              `Auto-generated: Izin ${izin.jenis}`
            ]
          );
        } else {
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?, status_masuk = ?, status_pulang = ?,
              keterangan = ?, updated_at = NOW()
             WHERE user_id = ? AND tanggal = ?`,
            [
              izin.id,
              'Tanpa Keterangan',
              'Belum Pulang',
              `Updated: Izin ${izin.jenis}`,
              izin.user_id,
              tanggal
            ]
          );
        }
        
        generatedCount++;
        console.log(`✓ Generated presensi for: ${tanggal}`);
        
      } catch (error) {
        console.error(`✗ Error for ${tanggal}:`, error.message);
      }
      
      currentDate = currentDate.plus({ days: 1 });
    }
    
    console.log(`✅ Total generated: ${generatedCount}`);
    
  } catch (error) {
    console.error('Reliable generation error:', error);
    throw error;
  }
  
  return generatedCount;
};

// Update juga di presensiController untuk validasi izin
const checkIzinBeforePresensi = async (userId, tanggal) => {
  const [izin] = await pool.execute(
    `SELECT * FROM izin 
     WHERE user_id = ? AND tanggal_mulai <= ? AND tanggal_selesai >= ? 
     AND status = 'Disetujui'`,
    [userId, tanggal, tanggal]
  );
  
  return izin.length > 0 ? izin[0] : null;
};

// Admin create izin for user
const createIzinByAdmin = async (req, res) => {
  try {
    const adminId = req.user.id;
    const {
      user_id,
      tanggal_mulai,
      tanggal_selesai,
      jenis,
      keterangan,
      dokumen_pendukung,
      status = 'Disetujui',
      auto_generate = true // Default true
    } = req.body;

    console.log('=== CREATE IZIN BY ADMIN START ===');
    console.log('Admin ID:', adminId);
    console.log('Data received:', {
      user_id,
      tanggal_mulai,
      tanggal_selesai,
      jenis,
      keterangan: keterangan ? 'Ada' : 'Tidak ada',
      dokumen_pendukung: dokumen_pendukung ? 'Ada' : 'Tidak ada',
      status,
      auto_generate
    });

    // Validasi required fields
    if (!user_id || !tanggal_mulai || !tanggal_selesai || !jenis) {
      return res.status(400).json({
        success: false,
        message: 'User ID, tanggal mulai, tanggal selesai, dan jenis izin wajib diisi'
      });
    }

    // Validasi jenis izin sesuai ENUM
    const validJenis = ['Sakit', 'Izin', 'Dinas Luar'];
    if (!validJenis.includes(jenis)) {
      return res.status(400).json({
        success: false,
        message: `Jenis izin tidak valid. Pilihan: ${validJenis.join(', ')}`
      });
    }

    // Parsing tanggal dengan Luxon
    const { DateTime } = require('luxon');
    
    let startDate, endDate;
    
    try {
      startDate = DateTime.fromISO(tanggal_mulai, { zone: 'Asia/Jakarta' });
      endDate = DateTime.fromISO(tanggal_selesai, { zone: 'Asia/Jakarta' });
    } catch (parseError) {
      console.error('Date parse error:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid'
      });
    }

    // Validasi tanggal
    if (!startDate.isValid || !endDate.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid'
      });
    }

    if (endDate < startDate) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal selesai tidak boleh sebelum tanggal mulai'
      });
    }

    // Hitung durasi hari dengan Luxon
    const durasiHari = Math.floor(endDate.diff(startDate, 'days').days) + 1;
    console.log('Durasi hari:', durasiHari);

    // Cek apakah user exists dan aktif
    const [user] = await pool.execute(
      'SELECT id, nama, jabatan, wilayah_penugasan FROM users WHERE id = ? AND is_active = 1',
      [user_id]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan atau tidak aktif'
      });
    }

    console.log('User ditemukan:', user[0].nama);

    // Format tanggal untuk database (YYYY-MM-DD)
    const tanggalMulaiDB = startDate.toFormat('yyyy-MM-dd');
    const tanggalSelesaiDB = endDate.toFormat('yyyy-MM-dd');

    // CEK DUPLIKASI IZIN - Periksa apakah ada izin yang sudah disetujui pada rentang tanggal yang sama
    const [existingIzin] = await pool.execute(
      `SELECT * FROM izin 
       WHERE user_id = ? AND status = 'Disetujui'
       AND (
         (tanggal_mulai BETWEEN ? AND ?) OR
         (tanggal_selesai BETWEEN ? AND ?) OR
         (? BETWEEN tanggal_mulai AND tanggal_selesai) OR
         (? BETWEEN tanggal_mulai AND tanggal_selesai)
       )`,
      [user_id, tanggalMulaiDB, tanggalSelesaiDB, tanggalMulaiDB, tanggalSelesaiDB, 
       tanggalMulaiDB, tanggalSelesaiDB]
    );

    if (existingIzin.length > 0) {
      console.log('Duplikasi izin ditemukan:', existingIzin[0]);
      
      // Format tanggal untuk pesan error
      const izinExist = existingIzin[0];
      const existStart = DateTime.fromSQL(izinExist.tanggal_mulai).toFormat('dd/MM/yyyy');
      const existEnd = DateTime.fromSQL(izinExist.tanggal_selesai).toFormat('dd/MM/yyyy');
      
      return res.status(400).json({
        success: false,
        message: `User sudah memiliki izin yang disetujui pada tanggal ${existStart} s/d ${existEnd}`
      });
    }

    // Handle dokumen pendukung jika ada
    let dokumenFileName = null;
    if (dokumen_pendukung) {
      try {
        const path = require('path');
        const fs = require('fs');
        
        // Generate filename dengan timestamp
        const timestamp = DateTime.now().setZone('Asia/Jakarta').toFormat('yyyyMMdd_HHmmss');
        dokumenFileName = `izin_admin_${adminId}_user_${user_id}_${timestamp}.pdf`;
        
        // Tentukan path penyimpanan
        const uploadDir = path.join(__dirname, '../uploads/izin');
        const filePath = path.join(uploadDir, dokumenFileName);
        
        // Pastikan folder uploads exists
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        // Handle jika dokumen dalam format base64
        if (dokumen_pendukung.startsWith('data:application/pdf;base64,')) {
          const base64Data = dokumen_pendukung.replace(/^data:application\/pdf;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(filePath, buffer);
        } else if (dokumen_pendukung.startsWith('/uploads/')) {
          // Jika sudah berupa path, gunakan langsung
          dokumenFileName = path.basename(dokumen_pendukung);
        }
        
        console.log('Dokumen izin disimpan sebagai:', dokumenFileName);
      } catch (fileError) {
        console.error('Error saving dokumen:', fileError);
        // Lanjutkan tanpa dokumen jika gagal
        dokumenFileName = null;
      }
    }

    // Insert izin ke database
    const now = DateTime.now().setZone('Asia/Jakarta');
    const [result] = await pool.execute(
      `INSERT INTO izin 
       (user_id, tanggal_mulai, tanggal_selesai, durasi_hari, jenis, 
        keterangan, dokumen_pendukung, status, updated_by, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        tanggalMulaiDB,
        tanggalSelesaiDB,
        durasiHari,
        jenis,
        keterangan || null,
        dokumenFileName,
        status,
        adminId,
        now.toJSDate(),
        now.toJSDate()
      ]
    );

    console.log('Izin berhasil dibuat - ID:', result.insertId);

    let presensiGenerated = 0;
    
    // Jika status Disetujui dan auto_generate true, generate presensi otomatis
    if (status === 'Disetujui' && auto_generate !== false) {
      console.log('Memulai generate presensi otomatis...');
      try {
        const izinData = {
          id: result.insertId,
          user_id: user_id,
          tanggal_mulai: tanggalMulaiDB,
          tanggal_selesai: tanggalSelesaiDB,
          jenis: jenis
        };
        
        // GUNAKAN FUNGSI GENERATE PRESENSI YANG RELIABLE
        presensiGenerated = await generatePresensiIzinReliable(izinData);
        
        console.log(`✅ Generate presensi selesai: ${presensiGenerated} record`);
      } catch (presensiError) {
        console.error('❌ Presensi generation failed:', presensiError);
        // Jangan gagalkan request utama jika generate presensi gagal
        presensiGenerated = 0;
      }
    }

    // Log activity
    await pool.execute(
      `INSERT INTO system_log 
       (event_type, description, user_id, created_at) 
       VALUES (?, ?, ?, ?)`,
      [
        'CREATE_IZIN_BY_ADMIN', 
        `Admin membuat izin ${jenis} untuk ${user[0].nama} selama ${durasiHari} hari ${presensiGenerated > 0 ? `(Presensi: ${presensiGenerated} hari)` : ''}`, 
        adminId, 
        now.toJSDate()
      ]
    );

    console.log('=== CREATE IZIN BY ADMIN SUCCESS ===');
    console.log('Response:', {
      id: result.insertId,
      durasi_hari: durasiHari,
      presensi_generated: presensiGenerated
    });

    // Kirim response sukses
    res.json({
      success: true,
      message: `Izin berhasil dibuat ${status === 'Disetujui' ? 'dan disetujui' : ''}`,
      data: {
        id: result.insertId,
        durasi_hari: durasiHari,
        presensi_generated: presensiGenerated,
        auto_generate: auto_generate
      }
    });

  } catch (error) {
    console.error('!!! CREATE IZIN BY ADMIN ERROR:', error);
    console.error('Error stack:', error.stack);
    
    // Error handling yang lebih spesifik
    let errorMessage = 'Terjadi kesalahan server';
    let statusCode = 500;
    
    if (error.code === 'ER_DUP_ENTRY') {
      errorMessage = 'Data izin sudah ada';
      statusCode = 400;
    } else if (error.code === 'ER_NO_REFERENCED_ROW') {
      errorMessage = 'Referensi data tidak valid';
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getMyIzinPerBulan = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Ambil parameter bulan dan tahun dari query string
    let { bulan, tahun } = req.query;
    
    console.log('Raw params - Bulan:', bulan, 'Tahun:', tahun);
    
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
    
    console.log(`📊 Getting izin for user ${userId} - Bulan: ${targetBulan}, Tahun: ${targetTahun}`);
    
    // Hitung tanggal awal dan akhir bulan
    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();
    
    console.log(`Periode: ${startDate} sampai ${endDate}`);
    
    // Query ONLY for specific month (di database level)
    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai, u.jabatan, u.wilayah_penugasan,
              admin.nama as disetujui_by_name
       FROM izin i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN users admin ON i.updated_by = admin.id
       WHERE i.user_id = ? 
         AND (
           (i.tanggal_mulai BETWEEN ? AND ?) OR
           (i.tanggal_selesai BETWEEN ? AND ?) OR
           (? BETWEEN i.tanggal_mulai AND i.tanggal_selesai) OR
           (? BETWEEN i.tanggal_mulai AND i.tanggal_selesai)
         )
       ORDER BY i.tanggal_mulai DESC`,
      [userId, startDate, endDate, startDate, endDate, startDate, endDate]
    );
    
    console.log(`Found ${izin.length} izin records for this period`);
    
    // Proses setiap data izin
    const processedIzin = izin.map(item => {
      const processed = { ...item };
      
      // Format tanggal
      if (processed.tanggal_mulai) {
        const startDateObj = DateTime.fromSQL(processed.tanggal_mulai);
        processed.tanggal_mulai_formatted = startDateObj.toFormat('dd MMMM yyyy');
        processed.bulan_mulai = startDateObj.month;
        processed.tahun_mulai = startDateObj.year;
      }
      
      if (processed.tanggal_selesai) {
        const endDateObj = DateTime.fromSQL(processed.tanggal_selesai);
        processed.tanggal_selesai_formatted = endDateObj.toFormat('dd MMMM yyyy');
        processed.bulan_selesai = endDateObj.month;
        processed.tahun_selesai = endDateObj.year;
      }
      
      // Format durasi
      if (processed.durasi_hari) {
        processed.durasi_text = processed.durasi_hari === 1 ? '1 hari' : `${processed.durasi_hari} hari`;
      }
      
      // Status badge
      const statusConfig = {
        'Pending': { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: '⏳' },
        'Disetujui': { label: 'Disetujui', color: 'bg-green-100 text-green-700', icon: '✅' },
        'Ditolak': { label: 'Ditolak', color: 'bg-red-100 text-red-700', icon: '❌' }
      };
      processed.status_config = statusConfig[processed.status] || { label: processed.status, color: 'bg-gray-100 text-gray-700', icon: '❓' };
      
      // Jenis icon
      const jenisConfig = {
        'Sakit': { icon: '🤒', color: 'bg-pink-100 text-pink-700' },
        'Izin': { icon: '📋', color: 'bg-purple-100 text-purple-700' },
        'Dinas Luar': { icon: '🚗', color: 'bg-blue-100 text-blue-700' }
      };
      processed.jenis_config = jenisConfig[processed.jenis] || { icon: '📝', color: 'bg-gray-100 text-gray-700' };
      
      return processed;
    });
    
    // Hitung statistik
    const stats = {
      total: processedIzin.length,
      pending: 0,
      disetujui: 0,
      ditolak: 0,
      sakit: 0,
      izin: 0,
      dinas_luar: 0,
      total_hari: 0
    };
    
    processedIzin.forEach(item => {
      // Status
      switch (item.status) {
        case 'Pending': stats.pending++; break;
        case 'Disetujui': stats.disetujui++; break;
        case 'Ditolak': stats.ditolak++; break;
      }
      
      // Jenis
      switch (item.jenis) {
        case 'Sakit': stats.sakit++; break;
        case 'Izin': stats.izin++; break;
        case 'Dinas Luar': stats.dinas_luar++; break;
      }
      
      // Total hari
      if (item.durasi_hari && item.status === 'Disetujui') {
        stats.total_hari += item.durasi_hari;
      }
    });
    
    // Data untuk dropdown filter
    const [availableYearsData] = await pool.execute(
      `SELECT DISTINCT YEAR(tanggal_mulai) as tahun 
       FROM izin 
       WHERE user_id = ? 
       ORDER BY tahun DESC`,
      [userId]
    );
    
    const availableYears = [
      { value: "", label: "Semua Tahun" },
      ...availableYearsData.map(y => ({ value: y.tahun.toString(), label: y.tahun.toString() }))
    ];
    
    // Data bulan (static)
    const monthsData = [
      { value: "01", label: "Januari" },
      { value: "02", label: "Februari" },
      { value: "03", label: "Maret" },
      { value: "04", label: "April" },
      { value: "05", label: "Mei" },
      { value: "06", label: "Juni" },
      { value: "07", label: "Juli" },
      { value: "08", label: "Agustus" },
      { value: "09", label: "September" },
      { value: "10", label: "Oktober" },
      { value: "11", label: "November" },
      { value: "12", label: "Desember" }
    ];
    
    res.json({
      success: true,
      data: {
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate
        },
        stats: stats,
        izin: processedIzin,
        filters: {
          months: monthsData,
          years: availableYears,
          current_month: targetBulan.toString().padStart(2, '0'),
          current_year: targetTahun.toString()
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Get izin per bulan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// ============ FUNGSI GET IZIN PER TANGGAL (UNTUK ADMIN) ============

/**
 * FUNGSI BARU: Get izin per tanggal (untuk admin)
 * Endpoint: GET /izin/per-tanggal
 * Query params: tanggal (optional, default ke hari ini)
 */
const getIzinPerTanggal = async (req, res) => {
  try {
    // Hanya admin dan atasan yang bisa akses
    if (req.user.roles !== 'admin' && req.user.roles !== 'atasan') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengakses.'
      });
    }

    // Ambil parameter tanggal dari query string
    let { tanggal, status, jenis, search } = req.query;
    
    console.log('📊 Get Izin Per Tanggal - Params:', { tanggal, status, jenis, search });
    
    // Default ke hari ini jika tidak ada tanggal
    let targetDate;
    if (tanggal && tanggal !== '') {
      targetDate = DateTime.fromISO(tanggal);
      if (!targetDate.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
        });
      }
    } else {
      targetDate = DateTime.now().setZone('Asia/Jakarta');
    }
    
    const targetDateStr = targetDate.toISODate();
    console.log(`📅 Target date: ${targetDateStr}`);
    
    // Query untuk mengambil izin yang aktif pada tanggal tersebut
    let query = `
      SELECT 
        i.*,
        u.nama as nama_pegawai,
        u.jabatan,
        u.wilayah_penugasan,
        admin.nama as disetujui_by_name,
        DATE_FORMAT(i.created_at, '%d %M %Y pukul %H.%i') as created_at_formatted,
        DATE_FORMAT(i.updated_at, '%d %M %Y pukul %H.%i') as updated_at_formatted
      FROM izin i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN users admin ON i.updated_by = admin.id
      WHERE u.is_active = 1
        AND (
          (i.tanggal_mulai <= ? AND i.tanggal_selesai >= ?)
        )
    `;
    
    const params = [targetDateStr, targetDateStr];
    
    // Filter status
    if (status && status !== '') {
      query += ` AND i.status = ?`;
      params.push(status);
    }
    
    // Filter jenis
    if (jenis && jenis !== '') {
      query += ` AND i.jenis = ?`;
      params.push(jenis);
    }
    
    // Filter search (nama pegawai, jenis izin, atau keterangan)
    if (search && search !== '') {
      query += ` AND (
        u.nama LIKE ? OR 
        i.jenis LIKE ? OR 
        i.keterangan LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    query += ` ORDER BY i.created_at DESC`;
    
    console.log('📝 SQL Query:', query);
    console.log('📝 Parameters:', params);
    
    const [izin] = await pool.execute(query, params);
    
    console.log(`✅ Found ${izin.length} izin records for date ${targetDateStr}`);
    
    // Proses data untuk frontend
    const processedIzin = izin.map(item => {
      const processed = { ...item };
      
      // Format tanggal mulai dan selesai
      if (processed.tanggal_mulai) {
        const startDate = DateTime.fromSQL(processed.tanggal_mulai);
        processed.tanggal_mulai_formatted = startDate.toFormat('dd MMMM yyyy');
        processed.tanggal_mulai_hari = startDate.toFormat('EEEE');
      }
      
      if (processed.tanggal_selesai) {
        const endDate = DateTime.fromSQL(processed.tanggal_selesai);
        processed.tanggal_selesai_formatted = endDate.toFormat('dd MMMM yyyy');
        processed.tanggal_selesai_hari = endDate.toFormat('EEEE');
      }
      
      // Durasi text
      if (processed.durasi_hari) {
        processed.durasi_text = processed.durasi_hari === 1 ? '1 hari' : `${processed.durasi_hari} hari`;
      }
      
      // Status config untuk badge
      const statusConfig = {
        'Pending': { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: '⏳', badge: 'warning' },
        'Disetujui': { label: 'Disetujui', color: 'bg-green-100 text-green-700', icon: '✅', badge: 'success' },
        'Ditolak': { label: 'Ditolak', color: 'bg-red-100 text-red-700', icon: '❌', badge: 'danger' }
      };
      processed.status_config = statusConfig[processed.status] || { 
        label: processed.status, 
        color: 'bg-gray-100 text-gray-700', 
        icon: '❓',
        badge: 'secondary'
      };
      
      // Jenis config
      const jenisConfig = {
        'Sakit': { icon: '🤒', color: 'bg-pink-100 text-pink-700' },
        'Izin': { icon: '📋', color: 'bg-purple-100 text-purple-700' },
        'Dinas Luar': { icon: '🚗', color: 'bg-blue-100 text-blue-700' }
      };
      processed.jenis_config = jenisConfig[processed.jenis] || { 
        icon: '📝', 
        color: 'bg-gray-100 text-gray-700' 
      };
      
      return processed;
    });
    
    // Hitung statistik
    const totalPengajuan = processedIzin.length;
    const pending = processedIzin.filter(i => i.status === 'Pending').length;
    const disetujui = processedIzin.filter(i => i.status === 'Disetujui').length;
    const ditolak = processedIzin.filter(i => i.status === 'Ditolak').length;
    const sakit = processedIzin.filter(i => i.jenis === 'Sakit').length;
    const izinCount = processedIzin.filter(i => i.jenis === 'Izin').length;
    const dinasLuar = processedIzin.filter(i => i.jenis === 'Dinas Luar').length;
    
    const persenDisetujui = totalPengajuan > 0 ? Math.round((disetujui / totalPengajuan) * 100) : 0;
    const persenDitolak = totalPengajuan > 0 ? Math.round((ditolak / totalPengajuan) * 100) : 0;
    const persenPending = totalPengajuan > 0 ? Math.round((pending / totalPengajuan) * 100) : 0;
    
    // Statistik per wilayah
    const wilayahStatistik = {};
    processedIzin.forEach(izin => {
      const wilayah = izin.wilayah_penugasan || 'Unknown';
      if (!wilayahStatistik[wilayah]) {
        wilayahStatistik[wilayah] = { total: 0, pending: 0, disetujui: 0, ditolak: 0 };
      }
      wilayahStatistik[wilayah].total++;
      if (izin.status === 'Pending') wilayahStatistik[wilayah].pending++;
      if (izin.status === 'Disetujui') wilayahStatistik[wilayah].disetujui++;
      if (izin.status === 'Ditolak') wilayahStatistik[wilayah].ditolak++;
    });
    
    // Data untuk chart
    const chartData = {
      labels: ['Disetujui', 'Ditolak', 'Pending'],
      datasets: [{
        data: [disetujui, ditolak, pending],
        backgroundColor: ['#10B981', '#EF4444', '#F59E0B'],
        borderColor: ['#0DA675', '#DC2626', '#D97706'],
        borderWidth: 1
      }]
    };
    
    res.json({
      success: true,
      data: {
        tanggal: targetDateStr,
        tanggal_formatted: targetDate.toFormat('dd MMMM yyyy'),
        hari: targetDate.toFormat('EEEE'),
        total: totalPengajuan,
        statistik: {
          total_pengajuan: totalPengajuan,
          pending,
          disetujui,
          ditolak,
          sakit,
          izin: izinCount,
          dinas_luar: dinasLuar,
          persen_disetujui: persenDisetujui,
          persen_ditolak: persenDitolak,
          persen_pending: persenPending,
          wilayah: wilayahStatistik,
          chart_data: chartData
        },
        izin: processedIzin,
        filters: {
          status: status || null,
          jenis: jenis || null,
          search: search || null
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Get izin per tanggal error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Fungsi untuk mendapatkan daftar tanggal yang memiliki izin (untuk calendar)
 */
const getIzinTanggalOptions = async (req, res) => {
  try {
    // Hanya admin dan atasan yang bisa akses
    if (req.user.roles !== 'admin' && req.user.roles !== 'atasan') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengakses.'
      });
    }
    
    const [result] = await pool.execute(`
      SELECT DISTINCT 
        DATE(tanggal_mulai) as tanggal,
        COUNT(*) as total
      FROM izin
      WHERE status = 'Disetujui'
      GROUP BY DATE(tanggal_mulai)
      ORDER BY tanggal DESC
      LIMIT 30
    `);
    
    const options = result.map(item => ({
      value: item.tanggal,
      label: DateTime.fromSQL(item.tanggal).toFormat('dd MMMM yyyy'),
      total: item.total
    }));
    
    res.json({
      success: true,
      data: options
    });
    
  } catch (error) {
    console.error('Error get izin tanggal options:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
// **FUNGSI UTAMA YANG DIGUNAKAN** - pilih salah satu
// Gunakan fungsi generatePresensiIzinReliable untuk hasil terbaik

/**
 * FUNGSI DOWNLOAD DOKUMEN PENDUKUNG
 * Endpoint: GET /izin/download/:filename
 */
const downloadDokumen = async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validasi akses (hanya admin dan atasan)
    if (req.user.roles !== 'admin' && req.user.roles !== 'atasan') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan atasan yang dapat mengunduh dokumen.'
      });
    }
    
    // Validasi filename (mencegah directory traversal attack)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: 'Nama file tidak valid'
      });
    }
    
    // Validasi ekstensi file (hanya PDF)
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({
        success: false,
        message: 'Hanya file PDF yang dapat diunduh'
      });
    }
    
    // Tentukan path folder upload
    const uploadDir = path.join(__dirname, '../uploads/izin');
    const filePath = path.join(uploadDir, filename);
    
    console.log(`📥 Download request for: ${filename}`);
    console.log(`📁 File path: ${filePath}`);
    
    // Cek apakah file ada
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filename}`);
      return res.status(404).json({
        success: false,
        message: 'File dokumen tidak ditemukan'
      });
    }
    
    // Dapatkan statistik file
    const stats = fs.statSync(filePath);
    console.log(`✅ File found. Size: ${stats.size} bytes`);
    
    // Set headers untuk download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);
    
    // Kirim file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim file'
      });
    });
    
  } catch (error) {
    console.error('❌ Download dokumen error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
module.exports = {
  getAllIzin,
  getIzinById,
  getMyIzin,
  getMyIzinPerBulan,
  getIzinPerTanggal,
  getIzinTanggalOptions,
  downloadDokumen, // TAMBAHKAN INI
  createIzin,
  updateIzinStatus,
  deleteIzin,
  generatePresensiIzinSimple: generatePresensiIzinReliable,
  checkIzinBeforePresensi,
  createIzinByAdmin
};
const { pool } = require('../config/database');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');
const { checkHariKerja, getHariKerjaInRange } = require('../utils/hariKerja');

// ==================== GENERATE PRESENSI OTOMATIS ====================

const generatePresensiHarian = async (targetDate = null) => {
  try {
    const today = targetDate || DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log('🔄 Auto-generating presensi untuk:', today);

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let izinCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi untuk hari ini
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, today]
        );

        if (existingPresensi.length > 0) {
          skippedCount++;
          continue;
        }

        // Cek apakah hari ini hari kerja
        const hariKerjaInfo = await checkHariKerja(today);
        
        if (!hariKerjaInfo.is_hari_kerja) {
          console.log(`⏭️  Skip ${user.nama}: Bukan hari kerja - ${hariKerjaInfo.keterangan}`);
          continue;
        }

        // Cek apakah user memiliki izin yang disetujui untuk hari ini
        const [izin] = await pool.execute(
          `SELECT i.id, i.jenis, i.status 
           FROM izin i 
           WHERE i.user_id = ? 
             AND i.status = 'Disetujui'
             AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai`,
          [user.id, today]
        );

        if (izin.length > 0) {
          // Buat presensi dengan status izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              today,
              izin[0].id,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              `Auto-generated: Izin ${izin[0].jenis}`
            ]
          );
          generatedCount++;
          izinCount++;
          console.log(`✅ Generated izin presensi untuk: ${user.nama} - ${izin[0].jenis}`);
        } else {
          // Buat presensi dengan status alpha (hanya untuk hari kerja)
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, 'Tanpa Keterangan', 'Tanpa Keterangan', 1, 'Auto-generated: Tidak hadir', NOW(), NOW())`,
            [user.id, today]
          );
          generatedCount++;
          console.log(`❌ Generated alpha presensi untuk: ${user.nama}`);
        }
      } catch (error) {
        console.error(`❌ Error generating presensi for user ${user.id}:`, error);
      }
    }

    console.log(`🎉 Auto-generation selesai: ${generatedCount} generated (${izinCount} izin), ${skippedCount} skipped`);
    
    // Log ke system_log
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['AUTO_GENERATE_PRESENSI', `System generate presensi otomatis: ${generatedCount} generated (${izinCount} izin), ${skippedCount} skipped`, 1]
    );

    return {
      success: true,
      generated_count: generatedCount,
      izin_count: izinCount,
      skipped_count: skippedCount,
      total_users: users.length,
      tanggal: today
    };

  } catch (error) {
    console.error('❌ Generate presensi harian error:', error);
    throw error;
  }
};

// ==================== GENERATE PRESENSI MANUAL ====================

const generatePresensiManual = async (req, res) => {
  try {
    const { tanggal } = req.body;
    const targetDate = tanggal || DateTime.now().setZone('Asia/Jakarta').toISODate();

    if (!DateTime.fromISO(targetDate).isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    console.log('🔄 Manual generate presensi untuk:', targetDate);

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let izinCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi untuk tanggal tersebut
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, targetDate]
        );

        // Cek apakah hari tersebut hari kerja
        const hariKerjaInfo = await checkHariKerja(targetDate);
        
        if (!hariKerjaInfo.is_hari_kerja) {
          console.log(`⏭️  Skip ${user.nama}: Bukan hari kerja - ${hariKerjaInfo.keterangan}`);
          continue;
        }

        // Cek izin yang disetujui
        const [izin] = await pool.execute(
          `SELECT i.id, i.jenis, i.status 
           FROM izin i 
           WHERE i.user_id = ? 
             AND i.status = 'Disetujui'
             AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai`,
          [user.id, targetDate]
        );

        if (existingPresensi.length > 0) {
          // Jika sudah ada presensi, update jika ada perubahan izin
          if (izin.length > 0 && !existingPresensi[0].izin_id) {
            await pool.execute(
              `UPDATE presensi SET 
                izin_id = ?, 
                status_masuk = ?, 
                status_pulang = ?, 
                keterangan = ?,
                updated_at = NOW()
               WHERE id = ?`,
              [
                izin[0].id,
                `Izin ${izin[0].jenis}`,
                `Izin ${izin[0].jenis}`,
                `Updated: Izin ${izin[0].jenis}`,
                existingPresensi[0].id
              ]
            );
            updatedCount++;
            izinCount++;
            console.log(`🔄 Updated presensi dengan izin untuk: ${user.nama}`);
          }
          skippedCount++;
          continue;
        }

        if (izin.length > 0) {
          // Buat presensi dengan status izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              targetDate,
              izin[0].id,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              `Manual-generated: Izin ${izin[0].jenis}`
            ]
          );
          generatedCount++;
          izinCount++;
          console.log(`✅ Generated izin presensi untuk: ${user.nama} - ${izin[0].jenis}`);
        } else {
          // Buat presensi dengan status alpha
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, 'Tanpa Keterangan', 'Tanpa Keterangan', 1, 'Manual-generated: Tidak hadir', NOW(), NOW())`,
            [user.id, targetDate]
          );
          generatedCount++;
          console.log(`❌ Generated alpha presensi untuk: ${user.nama}`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${user.id}:`, error);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['GENERATE_PRESENSI_MANUAL', `Manual generate presensi untuk ${targetDate}: ${generatedCount} generated, ${updatedCount} updated, ${skippedCount} skipped`, req.user?.id || 1]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${generatedCount} presensi (${izinCount} izin) dan update ${updatedCount} presensi untuk tanggal ${targetDate}`,
      data: {
        generated_count: generatedCount,
        updated_count: updatedCount,
        izin_count: izinCount,
        skipped_count: skippedCount,
        total_users: users.length,
        tanggal: targetDate
      }
    });

  } catch (error) {
    console.error('❌ Generate presensi manual error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== PRESENSI MANUAL ====================

const presensiMasuk = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_masuk, latitude_masuk, longitude_masuk, keterangan } = req.body;

    console.log('🔄 Presensi masuk attempt - User:', userId);

    // Validasi required fields
    if (!foto_masuk) {
      return res.status(400).json({
        success: false,
        message: 'Foto wajib diambil'
      });
    }

    if (latitude_masuk === undefined || longitude_masuk === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Lokasi wajib diisi'
      });
    }

    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const now = DateTime.now().setZone('Asia/Jakarta');

    console.log('📅 Tanggal:', today, '⏰ Waktu sekarang:', now.toFormat('HH:mm:ss'));

    // Cek apakah sudah presensi hari ini
    const [existingPresensi] = await pool.execute(
      'SELECT id, izin_id FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (existingPresensi.length > 0) {
      // Jika sudah ada presensi dengan izin, tolak
      if (existingPresensi[0].izin_id) {
        return res.status(400).json({
          success: false,
          message: 'Anda memiliki izin yang disetujui pada tanggal ini, tidak bisa presensi'
        });
      }
      
      // Jika sudah presensi masuk
      const existing = existingPresensi[0];
      if (existing.jam_masuk) {
        return res.status(400).json({
          success: false,
          message: 'Anda sudah melakukan presensi masuk hari ini'
        });
      }
    }

    // CEK HARI KERJA
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.status(400).json({
        success: false,
        message: `Hari ini bukan hari kerja: ${hariKerjaInfo.keterangan}`
      });
    }

    // Cek apakah user memiliki izin yang disetujui
    const [izin] = await pool.execute(
      `SELECT * FROM izin 
       WHERE user_id = ? AND status = 'Disetujui' 
       AND ? BETWEEN tanggal_mulai AND tanggal_selesai`,
      [userId, today]
    );

    if (izin.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Anda memiliki izin ${izin[0].jenis} yang disetujui pada tanggal ini`
      });
    }

    // Get jam kerja user
    const [jamKerja] = await pool.execute(
      `SELECT jk.* FROM jam_kerja jk
       JOIN users u ON u.jam_kerja_id = jk.id
       WHERE u.id = ?`,
      [userId]
    );

    if (jamKerja.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Jam kerja tidak ditemukan untuk user ini'
      });
    }

    const jamKerjaAktif = jamKerja[0];

    // VALIDASI WAKTU PRESENSI MASUK
    const jamMasukStandar = DateTime.fromFormat(jamKerjaAktif.jam_masuk_standar, 'HH:mm:ss');
    const batasAwalPresensi = jamMasukStandar.minus({ hours: 1 });
    const batasTerlambat = DateTime.fromFormat(jamKerjaAktif.batas_terlambat, 'HH:mm:ss');
    const batasAkhirPresensi = batasTerlambat.plus({ hours: 2 });

    // Set waktu validasi dengan tanggal hari ini
    const jamMasukStandarToday = now.set({
      hour: jamMasukStandar.hour,
      minute: jamMasukStandar.minute,
      second: jamMasukStandar.second
    });
    
    const batasAwalPresensiToday = now.set({
      hour: batasAwalPresensi.hour,
      minute: batasAwalPresensi.minute,
      second: batasAwalPresensi.second
    });
    
    const batasTerlambatToday = now.set({
      hour: batasTerlambat.hour,
      minute: batasTerlambat.minute,
      second: batasTerlambat.second
    });
    
    const batasAkhirPresensiToday = now.set({
      hour: batasAkhirPresensi.hour,
      minute: batasAkhirPresensi.minute,
      second: batasAkhirPresensi.second
    });

    // Cek apakah terlalu awal untuk presensi
    if (now < batasAwalPresensiToday) {
      return res.status(400).json({
        success: false,
        message: `Presensi masuk hanya bisa dilakukan mulai ${batasAwalPresensi.toFormat('HH:mm')}`
      });
    }

    // Cek apakah terlalu telat untuk presensi
    if (now > batasAkhirPresensiToday) {
      return res.status(400).json({
        success: false,
        message: `Presensi masuk hanya bisa dilakukan hingga ${batasAkhirPresensi.toFormat('HH:mm')}`
      });
    }

    // Tentukan status masuk
    const toleransi = DateTime.fromFormat(jamKerjaAktif.toleransi_keterlambatan, 'HH:mm:ss');
    
    let statusMasuk = 'Tepat Waktu';
    
    if (now > batasTerlambatToday) {
      statusMasuk = 'Terlambat Berat';
    } else if (now > jamMasukStandarToday.plus({ minutes: toleransi.minute })) {
      statusMasuk = 'Terlambat';
    }

    console.log('📊 Status masuk:', statusMasuk);

    // GENERATE FILENAME DAN SIMPAN FILE
    const fotoFileName = `masuk_${userId}_${today}_${Date.now()}.jpg`;
    const filePath = path.join(__dirname, '../uploads/presensi', fotoFileName);
    
    // Convert base64 to file dan simpan
    const base64Data = foto_masuk.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Pastikan folder uploads exists
    const uploadDir = path.join(__dirname, '../uploads/presensi');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    console.log('📷 Foto disimpan sebagai:', fotoFileName);

    if (existingPresensi.length > 0) {
      // Update presensi yang sudah ada
      await pool.execute(
        `UPDATE presensi SET 
          jam_masuk = ?, 
          foto_masuk = ?, 
          latitude_masuk = ?, 
          longitude_masuk = ?,
          status_masuk = ?, 
          keterangan = COALESCE(?, keterangan),
          updated_at = NOW()
         WHERE id = ?`,
        [
          now.toFormat('HH:mm:ss'),
          fotoFileName,
          parseFloat(latitude_masuk),
          parseFloat(longitude_masuk),
          statusMasuk,
          keterangan || null,
          existingPresensi[0].id
        ]
      );
    } else {
      // Insert presensi baru
      await pool.execute(
        `INSERT INTO presensi 
         (user_id, tanggal, jam_masuk, foto_masuk, latitude_masuk, longitude_masuk, 
          status_masuk, status_pulang, keterangan, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          userId,
          today,
          now.toFormat('HH:mm:ss'),
          fotoFileName,
          parseFloat(latitude_masuk),
          parseFloat(longitude_masuk),
          statusMasuk,
          'Belum Pulang',
          keterangan || null
        ]
      );
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PRESENSI_MASUK', `User melakukan presensi masuk - Status: ${statusMasuk}`, userId]
    );

    console.log('✅ Presensi masuk berhasil');

    res.json({
      success: true,
      message: 'Presensi masuk berhasil',
      data: {
        tanggal: today,
        jam_masuk: now.toFormat('HH:mm:ss'),
        status_masuk: statusMasuk,
        foto_masuk: fotoFileName
      }
    });

  } catch (error) {
    console.error('❌ Presensi masuk error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const presensiPulang = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_pulang, latitude_pulang, longitude_pulang, keterangan } = req.body;

    console.log('🔄 Presensi pulang attempt - User:', userId);

    // Validasi required fields
    if (!foto_pulang) {
      return res.status(400).json({
        success: false,
        message: 'Foto wajib diambil'
      });
    }

    if (latitude_pulang === undefined || longitude_pulang === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Lokasi wajib diisi'
      });
    }

    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const now = DateTime.now().setZone('Asia/Jakarta');

    console.log('📅 Tanggal pulang:', today, '⏰ Waktu sekarang:', now.toFormat('HH:mm:ss'));

    // Cek presensi masuk
    const [presensi] = await pool.execute(
      'SELECT * FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (presensi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Anda belum melakukan presensi masuk hari ini'
      });
    }

    if (presensi[0].jam_pulang) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan presensi pulang hari ini'
      });
    }

    if (presensi[0].izin_id) {
      return res.status(400).json({
        success: false,
        message: 'Anda memiliki izin pada hari ini, tidak bisa presensi pulang'
      });
    }

    // GENERATE FILENAME DAN SIMPAN FILE
    const fotoFileName = `pulang_${userId}_${today}_${Date.now()}.jpg`;
    const filePath = path.join(__dirname, '../uploads/presensi', fotoFileName);
    
    // Convert base64 to file dan simpan
    const base64Data = foto_pulang.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Pastikan folder uploads exists
    const uploadDir = path.join(__dirname, '../uploads/presensi');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    console.log('📷 Foto pulang disimpan sebagai:', fotoFileName);

    // Get jam kerja user
    const [jamKerja] = await pool.execute(
      `SELECT jk.* FROM jam_kerja jk
       JOIN users u ON u.jam_kerja_id = jk.id
       WHERE u.id = ?`,
      [userId]
    );

    let statusPulang = 'Tepat Waktu';
    let isLembur = 0;
    let jamLembur = null;

    if (jamKerja.length > 0) {
      const jamKerjaAktif = jamKerja[0];
      const jamPulangStandar = DateTime.fromFormat(jamKerjaAktif.jam_pulang_standar, 'HH:mm:ss');
      
      // Set waktu validasi dengan tanggal hari ini
      const jamPulangStandarToday = now.set({
        hour: jamPulangStandar.hour,
        minute: jamPulangStandar.minute,
        second: jamPulangStandar.second
      });

      // Batas awal presensi pulang (1 jam sebelum jam pulang standar)
      const batasAwalPulang = jamPulangStandarToday.minus({ hours: 1 });

      // Cek apakah terlalu awal untuk presensi pulang
      if (now < batasAwalPulang) {
        return res.status(400).json({
          success: false,
          message: `Presensi pulang hanya bisa dilakukan mulai ${batasAwalPulang.toFormat('HH:mm')}`
        });
      }

      // Cek apakah pulang lebih cepat
      if (now < jamPulangStandarToday) {
        statusPulang = 'Cepat Pulang';
      } 
      // Cek lembur (lebih dari jam pulang standar)
      else if (now > jamPulangStandarToday) {
        statusPulang = 'Lembur';
        isLembur = 1;
        
        // Hitung jam lembur
        const diffMinutes = Math.floor(now.diff(jamPulangStandarToday, 'minutes').minutes);
        const lemburHours = Math.floor(diffMinutes / 60);
        const lemburMinutes = diffMinutes % 60;
        jamLembur = `${lemburHours.toString().padStart(2, '0')}:${lemburMinutes.toString().padStart(2, '0')}:00`;
        
        console.log('💪 Lembur detected:', jamLembur, 'Total minutes:', diffMinutes);
      }
    }

    // Update presensi pulang
    await pool.execute(
      `UPDATE presensi SET 
        jam_pulang = ?, 
        foto_pulang = ?, 
        latitude_pulang = ?, 
        longitude_pulang = ?,
        status_pulang = ?, 
        is_lembur = ?, 
        jam_lembur = ?, 
        keterangan = COALESCE(?, keterangan),
        updated_at = NOW()
       WHERE id = ?`,
      [
        now.toFormat('HH:mm:ss'),
        fotoFileName,
        parseFloat(latitude_pulang),
        parseFloat(longitude_pulang),
        statusPulang,
        isLembur,
        jamLembur,
        keterangan || null,
        presensi[0].id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PRESENSI_PULANG', `User melakukan presensi pulang - Status: ${statusPulang}${isLembur ? ' dengan lembur ' + jamLembur : ''}`, userId]
    );

    console.log('✅ Presensi pulang berhasil');

    res.json({
      success: true,
      message: 'Presensi pulang berhasil',
      data: {
        jam_pulang: now.toFormat('HH:mm:ss'),
        status_pulang: statusPulang,
        is_lembur: isLembur,
        jam_lembur: jamLembur,
        foto_pulang: fotoFileName
      }
    });

  } catch (error) {
    console.error('❌ Presensi pulang error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== GET DATA PRESENSI ====================

const getPresensiHariIni = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan, i.jenis as jenis_izin
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       LEFT JOIN izin i ON p.izin_id = i.id
       WHERE p.user_id = ? AND p.tanggal = ?`,
      [userId, today]
    );

    res.json({
      success: true,
      data: presensi[0] || null
    });

  } catch (error) {
    console.error('Get presensi hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getRekapKehadiran = async (req, res) => {
  try {
    const { bulan, tahun, user_id, wilayah } = req.query;

    // Default ke bulan dan tahun saat ini
    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    const targetBulan = bulan || currentDate.month;
    const targetTahun = tahun || currentDate.year;

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();

    console.log('📊 Rekap period:', startDate, 'to', endDate);

    // Dapatkan hari kerja dalam rentang tanggal
    const hariKerjaInRange = await getHariKerjaInRange(startDate, endDate);
    const totalHariKerja = hariKerjaInRange.filter(day => day.is_hari_kerja_result).length;

    let query = `
      SELECT 
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        
        -- Total hari kerja dari perhitungan
        ? as total_hari_kerja,
        
        -- Hitung presensi
        COUNT(p.id) as total_presensi,
        
        -- Hitung kehadiran (presensi fisik)
        SUM(CASE 
          WHEN p.izin_id IS NULL 
          AND p.jam_masuk IS NOT NULL
          AND (p.status_masuk = 'Tepat Waktu' OR p.status_masuk = 'Terlambat' OR p.status_masuk = 'Terlambat Berat')
          THEN 1 
          ELSE 0 
        END) as hadir,
        
        -- Hitung tepat waktu
        SUM(CASE 
          WHEN p.izin_id IS NULL AND p.status_masuk = 'Tepat Waktu' THEN 1 
          ELSE 0 
        END) as tepat_waktu,
        
        -- Hitung terlambat
        SUM(CASE 
          WHEN p.izin_id IS NULL AND (p.status_masuk = 'Terlambat' OR p.status_masuk = 'Terlambat Berat') THEN 1 
          ELSE 0 
        END) as terlambat,
        
        -- Hitung izin dari tabel izin yang disetujui
        (
          SELECT COUNT(DISTINCT i.tanggal_mulai, i.tanggal_selesai) 
          FROM izin i 
          WHERE i.user_id = u.id 
            AND i.status = 'Disetujui'
            AND (i.tanggal_mulai BETWEEN ? AND ? OR i.tanggal_selesai BETWEEN ? AND ?)
        ) as total_izin,
        
        -- Hitung tanpa keterangan
        SUM(CASE 
          WHEN p.izin_id IS NULL 
          AND p.jam_masuk IS NULL
          AND p.status_masuk = 'Tanpa Keterangan'
          THEN 1 
          ELSE 0 
        END) as tanpa_keterangan,
        
        -- Hitung lembur
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur

      FROM users u
      LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal BETWEEN ? AND ?
      WHERE u.is_active = 1 AND u.roles = 'pegawai'
    `;

    const params = [
      totalHariKerja,  // total_hari_kerja
      startDate, endDate, startDate, endDate,  // untuk hitung izin
      startDate, endDate  // untuk JOIN presensi
    ];

    if (user_id) {
      query += ' AND u.id = ?';
      params.push(user_id);
    }

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    query += ' GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan ORDER BY u.nama';

    const [rekap] = await pool.execute(query, params);

    // Hitung statistik tambahan
    const rekapDenganStatistik = rekap.map(item => {
      const totalHadir = item.hadir;
      const totalIzin = item.total_izin;
      const totalKehadiran = totalHadir + totalIzin;
      
      const persentaseHadir = item.total_hari_kerja > 0 
        ? ((totalKehadiran / item.total_hari_kerja) * 100).toFixed(2)
        : 0;

      const persentaseTepatWaktu = totalHadir > 0 
        ? ((item.tepat_waktu / totalHadir) * 100).toFixed(2)
        : 0;

      return {
        ...item,
        total_hadir: totalHadir,
        total_izin: totalIzin,
        total_kehadiran: totalKehadiran,
        persentase_kehadiran: parseFloat(persentaseHadir),
        persentase_tepat_waktu: parseFloat(persentaseTepatWaktu),
        alpha: item.tanpa_keterangan
      };
    });

    // Hitung total statistik
    const totalStatistik = {
      total_pegawai: rekapDenganStatistik.length,
      total_hari_kerja: totalHariKerja,
      total_hadir: rekapDenganStatistik.reduce((sum, item) => sum + item.hadir, 0),
      total_terlambat: rekapDenganStatistik.reduce((sum, item) => sum + item.terlambat, 0),
      total_izin: rekapDenganStatistik.reduce((sum, item) => sum + item.total_izin, 0),
      total_alpha: rekapDenganStatistik.reduce((sum, item) => sum + item.tanpa_keterangan, 0),
      total_lembur: rekapDenganStatistik.reduce((sum, item) => sum + item.lembur, 0)
    };

    res.json({
      success: true,
      data: {
        periode: {
          bulan: parseInt(targetBulan),
          tahun: parseInt(targetTahun),
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate,
          total_hari_kerja: totalHariKerja
        },
        statistik: totalStatistik,
        rekap: rekapDenganStatistik
      }
    });

  } catch (error) {
    console.error('Get rekap kehadiran error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ==================== EKSPOR MODUL ====================

module.exports = {
  // Generate
  generatePresensiHarian,
  generatePresensiManual,
  
  // Presensi Manual
  presensiMasuk,
  presensiPulang,
  
  // Get Data
  getPresensiHariIni,
  getRekapKehadiran,
  
  // Helper (jika diperlukan di file lain)
  checkHariKerja
};
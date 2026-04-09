const { pool } = require('../config/database');
const { DateTime } = require('luxon');

const getDataForPemutihan = async (req, res) => {
  console.log('=== GET DATA PEMUTIHAN START ===');
  try {
    const { bulan, tahun, wilayah } = req.query;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    console.log('Query parameters:', { bulan, tahun, wilayah });

    // Validasi bulan dan tahun
    if (!bulan || !tahun) {
      return res.status(400).json({
        success: false,
        message: 'Bulan dan tahun wajib diisi'
      });
    }

    const bulanNum = parseInt(bulan);
    const tahunNum = parseInt(tahun);

    // Validasi bulan dan tahun
    if (bulanNum < 1 || bulanNum > 12) {
      return res.status(400).json({
        success: false,
        message: 'Bulan harus antara 1-12'
      });
    }

    if (tahunNum < 2000 || tahunNum > 2100) {
      return res.status(400).json({
        success: false,
        message: 'Tahun tidak valid'
      });
    }

    // Buat tanggal
    const startDate = `${tahunNum}-${bulanNum.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromISO(startDate).endOf('month').toISODate();

    console.log('Date range:', { startDate, endDate });

    // **PERBAIKAN UTAMA: Query yang lebih akurat**
    let query = `
      SELECT 
        p.id as presensi_id,
        p.tanggal,
        p.jam_masuk,
        p.jam_pulang,
        p.status_masuk,
        p.status_pulang,
        p.keterangan,
        p.is_lembur,
        p.jam_lembur,
        p.izin_id,
        p.created_at,
        p.updated_at,
        p.user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        i.jenis as jenis_izin,
        i.status as status_izin,
        jk.jam_masuk_standar,
        jk.jam_pulang_standar,
        p.foto_masuk,
        p.foto_pulang,
        p.latitude_masuk,
        p.longitude_masuk,
        p.latitude_pulang,
        p.longitude_pulang
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN izin i ON p.izin_id = i.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE p.tanggal BETWEEN ? AND ?
        AND u.is_active = 1 
        AND u.roles LIKE '%pegawai%'
        AND p.izin_id IS NULL  -- Tidak ada izin
        AND (
          -- KASUS 1: Data kosong total (Alpha total) - PERBAIKAN
          (
            p.jam_masuk IS NULL 
            AND p.status_masuk IS NULL 
            AND p.jam_pulang IS NULL 
            AND p.status_pulang IS NULL
          )
          OR
          -- KASUS 2: Sudah masuk tapi belum pulang
          (
            p.jam_masuk IS NOT NULL 
            AND p.jam_pulang IS NULL 
          )
          OR
          -- KASUS 3: Status pulang adalah 'Belum Pulang'
          (
            p.jam_masuk IS NOT NULL 
            AND p.status_pulang = 'Belum Pulang'
          )
        )
        AND (p.keterangan IS NULL OR p.keterangan NOT LIKE '%PEMUTIHAN: Dibatalkan%')
    `;

    const params = [startDate, endDate];

    // Filter berdasarkan wilayah (jika ada)
    if (wilayah && wilayah !== 'all' && wilayah !== '') {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    // Filter berdasarkan role
    if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor hanya bisa lihat wilayahnya
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    } else if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Pegawai hanya bisa lihat data sendiri
      query += ' AND p.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY p.tanggal DESC, u.nama ASC';

    console.log('Executing query...');
    console.log('Query:', query);
    console.log('Params:', params);
    
    const [data] = await pool.execute(query, params);
    console.log('Found records:', data.length);

    // **DEBUG: Tampilkan beberapa data untuk verifikasi**
    if (data.length > 0) {
      console.log('Sample data (first 3):');
      data.slice(0, 3).forEach((item, index) => {
        console.log(`Data ${index + 1}:`, {
          id: item.presensi_id,
          nama: item.nama,
          tanggal: item.tanggal,
          jam_masuk: item.jam_masuk,
          jam_pulang: item.jam_pulang,
          status_masuk: item.status_masuk,
          status_pulang: item.status_pulang,
          izin_id: item.izin_id,
          keterangan: item.keterangan
        });
      });
    }

    // Hitung statistik
    const stats = {
      total: data.length,
      alpha_total: data.filter(d => 
        d.jam_masuk === null && 
        d.status_masuk === null && 
        d.jam_pulang === null && 
        d.status_pulang === null
      ).length,
      belum_pulang: data.filter(d => 
        (d.jam_masuk !== null && d.jam_pulang === null) ||
        d.status_pulang === 'Belum Pulang'
      ).length,
      bisa_diputihkan: data.length  // Semua data yang diambil bisa diputihkan
    };

    console.log('Stats:', stats);

    // Format data untuk response
    const formattedData = data.map(item => {
      let kategori = '';
      let keterangan_pemutihan = '';
      let status_kehadiran = '';

      // Tentukan kategori berdasarkan kondisi data
      if (item.jam_masuk === null && item.status_masuk === null && 
          item.jam_pulang === null && item.status_pulang === null) {
        // KASUS 1: Alpha total
        kategori = 'Alpha Total';
        status_kehadiran = 'Tanpa Data';
        keterangan_pemutihan = 'Tidak ada data presensi sama sekali';
      } else if ((item.jam_masuk !== null && item.jam_pulang === null) ||
                item.status_pulang === 'Belum Pulang') {
        // KASUS 2: Sudah masuk tapi belum pulang
        kategori = 'Belum Pulang';
        status_kehadiran = item.status_masuk || 'Telah Masuk';
        keterangan_pemutihan = item.jam_masuk ? 
          `Sudah masuk pada ${item.jam_masuk.substring(0, 5)} tapi belum pulang` : 
          'Belum melakukan presensi pulang';
      }

      // Cek apakah sudah pernah diputihkan
      const sudah_diputihkan = item.keterangan && item.keterangan.includes('PEMUTIHAN:') && 
                                !item.keterangan.includes('PEMUTIHAN: Dibatalkan');
      const sudah_dibatalkan = item.keterangan && item.keterangan.includes('PEMUTIHAN: Dibatalkan');

      // Semua data yang diambil bisa diputihkan
      const bisa_diputihkan = !sudah_diputihkan && !sudah_dibatalkan && item.izin_id === null;

      return {
        ...item,
        kategori,
        status_kehadiran,
        keterangan_pemutihan,
        sudah_diputihkan,
        sudah_dibatalkan,
        bisa_diputihkan
      };
    });

    const response = {
      success: true,
      data: {
        presensi: formattedData,
        stats,
        periode: {
          bulan: bulanNum,
          tahun: tahunNum,
          nama_bulan: DateTime.fromISO(startDate).setLocale('id').toFormat('MMMM yyyy'),
          start_date: startDate,
          end_date: endDate
        }
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in getDataForPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const prosesPemutihan = async (req, res) => {
  console.log('=== PROSES PEMUTIHAN START ===');
  try {
    const { presensi_ids, catatan_pemutihan, jenis_pemutihan = 'manual' } = req.body;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    console.log('Request body:', { presensi_ids, catatan_pemutihan, jenis_pemutihan });

    // Validasi
    if (!presensi_ids || !Array.isArray(presensi_ids) || presensi_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi wajib dipilih'
      });
    }

    if (!catatan_pemutihan || catatan_pemutihan.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Catatan pemutihan wajib diisi'
      });
    }

    // Cek hak akses
    if (!userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      return res.status(403).json({
        success: false,
        message: 'Hanya admin dan supervisor yang bisa melakukan pemutihan'
      });
    }

    // Cek data presensi
    const placeholders = presensi_ids.map(() => '?').join(',');
    const [existingPresensi] = await pool.execute(
      `SELECT p.id, p.tanggal, u.nama, p.status_masuk, p.jam_masuk, p.jam_pulang, 
              p.status_pulang, p.izin_id, p.keterangan, u.wilayah_penugasan,
              p.foto_masuk, p.foto_pulang
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.id IN (${placeholders})`,
      presensi_ids
    );

    console.log('Existing presensi:', existingPresensi.length);

    if (existingPresensi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // Cek apakah data sudah diputihkan
    const sudahDiputihkan = existingPresensi.filter(p => 
      p.keterangan && p.keterangan.includes('PEMUTIHAN:') && 
      !p.keterangan.includes('PEMUTIHAN: Dibatalkan')
    );

    if (sudahDiputihkan.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Beberapa data sudah pernah diputihkan',
        data: {
          sudah_diputihkan: sudahDiputihkan.map(p => ({ id: p.id, nama: p.nama }))
        }
      });
    }

    // Cek hak akses untuk supervisor (hanya wilayahnya)
    if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      const wilayahSupervisor = req.user.wilayah_penugasan || '';
      const diluarWilayah = existingPresensi.filter(p => 
        p.wilayah_penugasan !== wilayahSupervisor
      );

      if (diluarWilayah.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Supervisor hanya bisa memutihkan presensi di wilayahnya sendiri',
          data: {
            diluar_wilayah: diluarWilayah.map(p => ({ 
              id: p.id, 
              nama: p.nama, 
              wilayah: p.wilayah_penugasan 
            }))
          }
        });
      }
    }

    // **PERBAIKAN: Data yang valid untuk diputihkan**
    const validForPemutihan = existingPresensi.filter(p => {
      // Pastikan tidak ada izin
      if (p.izin_id) return false;
      
      // KASUS 1: Data kosong total (Alpha total)
      const isAlphaTotal = p.jam_masuk === null && 
                          p.status_masuk === null && 
                          p.jam_pulang === null && 
                          p.status_pulang === null;
      
      // KASUS 2: Sudah masuk tapi belum pulang atau status Belum Pulang
      const isBelumPulang = (p.jam_masuk !== null && p.jam_pulang === null) ||
                           p.status_pulang === 'Belum Pulang';
      
      return isAlphaTotal || isBelumPulang;
    });

    console.log('Valid for pemutihan:', validForPemutihan.length);
    console.log('Valid data details:', validForPemutihan.map(p => ({
      id: p.id,
      nama: p.nama,
      jam_masuk: p.jam_masuk,
      status_masuk: p.status_masuk,
      jam_pulang: p.jam_pulang,
      status_pulang: p.status_pulang,
      isAlphaTotal: p.jam_masuk === null && p.status_masuk === null && p.jam_pulang === null && p.status_pulang === null,
      isBelumPulang: (p.jam_masuk !== null && p.jam_pulang === null) || p.status_pulang === 'Belum Pulang'
    })));

    if (validForPemutihan.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada data yang valid untuk diputihkan'
      });
    }

    // Update status presensi
    const validIds = validForPemutihan.map(p => p.id);
    const placeholdersValid = validIds.map(() => '?').join(',');
    
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const catatanFull = `PEMUTIHAN: ${catatan_pemutihan} (${jenis_pemutihan}) - ${timestamp} oleh ${req.user.nama || 'Admin'}`;

    // Update berdasarkan tipe data
    let totalUpdated = 0;
    const updateDetails = [];

    for (const presensi of validForPemutihan) {
      let updateQuery = '';
      let updateParams = [];
      
      // Tentukan tipe dan lakukan update sesuai tipe
      const isAlphaTotal = presensi.jam_masuk === null && 
                          presensi.status_masuk === null && 
                          presensi.jam_pulang === null && 
                          presensi.status_pulang === null;
      
      const isBelumPulang = (presensi.jam_masuk !== null && presensi.jam_pulang === null) ||
                           presensi.status_pulang === 'Belum Pulang';

      if (isAlphaTotal) {
        // Untuk Alpha Total: isi semua data dengan nilai default
        updateQuery = `
          UPDATE presensi 
          SET 
            status_masuk = 'Tepat Waktu',
            status_pulang = 'Tepat Waktu',
            jam_masuk = COALESCE(jam_masuk, '08:00:00'),
            jam_pulang = COALESCE(jam_pulang, '16:00:00'),
            keterangan = CONCAT(
              COALESCE(keterangan, ''),
              CASE WHEN keterangan IS NOT NULL AND keterangan != '' THEN ' | ' ELSE '' END,
              ?
            ),
            updated_at = NOW()
          WHERE id = ?
        `;
        updateParams = [catatanFull, presensi.id];
        
        updateDetails.push({
          id: presensi.id,
          nama: presensi.nama,
          tipe: 'Alpha Total',
          status_sebelum: 'Data Kosong',
          status_setelah: 'Tepat Waktu',
          jam_masuk_sebelum: null,
          jam_masuk_setelah: '08:00',
          jam_pulang_sebelum: null,
          jam_pulang_setelah: '16:00'
        });
        
      } else if (isBelumPulang) {
        // Untuk Belum Pulang: lengkapi data pulang
        let jamPulangDefault = '16:00:00';
        
        updateQuery = `
          UPDATE presensi 
          SET 
            status_pulang = 'Tepat Waktu',
            jam_pulang = COALESCE(jam_pulang, ?),
            keterangan = CONCAT(
              COALESCE(keterangan, ''),
              CASE WHEN keterangan IS NOT NULL AND keterangan != '' THEN ' | ' ELSE '' END,
              ?
            ),
            updated_at = NOW()
          WHERE id = ?
        `;
        updateParams = [jamPulangDefault, catatanFull, presensi.id];
        
        updateDetails.push({
          id: presensi.id,
          nama: presensi.nama,
          tipe: 'Belum Pulang',
          status_sebelum: presensi.status_pulang || 'Belum Pulang',
          status_setelah: 'Tepat Waktu',
          jam_masuk_sebelum: presensi.jam_masuk,
          jam_masuk_setelah: presensi.jam_masuk,
          jam_pulang_sebelum: presensi.jam_pulang,
          jam_pulang_setelah: jamPulangDefault.substring(0, 5)
        });
      }

      if (updateQuery) {
        const [result] = await pool.execute(updateQuery, updateParams);
        if (result.affectedRows > 0) {
          totalUpdated++;
        }
      }
    }

    console.log('Update result - affected rows:', totalUpdated);

    // Log activity
    const namaUser = validForPemutihan.map(p => p.nama).join(', ');
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, records_affected) VALUES (?, ?, ?, ?)',
      [
        'PEMUTIHAN_PRESENSI', 
        `Melakukan pemutihan ${totalUpdated} data presensi: ${catatan_pemutihan}`,
        userId,
        totalUpdated
      ]
    );

    const response = {
      success: true,
      message: `Berhasil memutihkan ${totalUpdated} data presensi`,
      data: {
        affected_rows: totalUpdated,
        total_dipilih: presensi_ids.length,
        valid_diputihkan: validForPemutihan.length,
        catatan_pemutihan: catatanFull,
        tanggal_pemutihan: timestamp,
        details: updateDetails
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in prosesPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const batalkanPemutihan = async (req, res) => {
  console.log('=== BATAL PEMUTIHAN START ===');
  try {
    const { presensi_ids, alasan_pembatalan } = req.body;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    console.log('Request body:', { presensi_ids, alasan_pembatalan });

    // Validasi
    if (!presensi_ids || !Array.isArray(presensi_ids) || presensi_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi wajib dipilih'
      });
    }

    if (!alasan_pembatalan || alasan_pembatalan.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Alasan pembatalan wajib diisi'
      });
    }

    // Cek hak akses
    if (!userRoles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Hanya admin yang bisa membatalkan pemutihan'
      });
    }

    // Cek data presensi yang sudah diputihkan
    const placeholders = presensi_ids.map(() => '?').join(',');
    const [existingPresensi] = await pool.execute(
      `SELECT p.id, p.tanggal, u.nama, p.status_masuk, p.jam_masuk, p.jam_pulang,
              p.status_pulang, p.izin_id, p.keterangan, u.wilayah_penugasan
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.id IN (${placeholders})
         AND p.keterangan LIKE '%PEMUTIHAN:%'
         AND p.keterangan NOT LIKE '%PEMUTIHAN: Dibatalkan%'`,
      presensi_ids
    );

    console.log('Existing presensi yang sudah diputihkan:', existingPresensi.length);

    if (existingPresensi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada data pemutihan yang ditemukan atau data belum diputihkan'
      });
    }

    // Batalkan pemutihan dengan mengembalikan ke status sebelumnya
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const alasanFull = `PEMUTIHAN: Dibatalkan - ${alasan_pembatalan} (${timestamp}) oleh ${req.user.nama || 'Admin'}`;

    let totalUpdated = 0;
    const results = [];

    // Update per item
    for (const presensi of existingPresensi) {
      // Tentukan apakah ini Alpha Total atau Belum Pulang berdasarkan keterangan
      let statusMasukSebelum = null;
      let statusPulangSebelum = null;
      let jamMasukSebelum = null;
      let jamPulangSebelum = null;

      // Ekstrak informasi dari keterangan untuk menentukan tipe
      if (presensi.keterangan) {
        if (presensi.keterangan.includes('Alpha Total') || 
            (presensi.status_masuk === 'Tepat Waktu' && presensi.jam_masuk === '08:00:00')) {
          // Alpha Total: kembalikan semua ke NULL
          statusMasukSebelum = null;
          statusPulangSebelum = null;
          jamMasukSebelum = null;
          jamPulangSebelum = null;
        } else {
          // Belum Pulang: kembalikan jam_pulang dan status_pulang ke NULL
          statusMasukSebelum = presensi.status_masuk; // Pertahankan status masuk
          statusPulangSebelum = null;
          jamMasukSebelum = presensi.jam_masuk; // Pertahankan jam masuk
          jamPulangSebelum = null;
        }
      }

      const [result] = await pool.execute(
        `UPDATE presensi 
         SET 
           status_masuk = ?,
           status_pulang = ?,
           jam_masuk = ?,
           jam_pulang = ?,
           keterangan = CONCAT(
             COALESCE(keterangan, ''),
             ' | ',
             ?
           ),
           updated_at = NOW()
         WHERE id = ?`,
        [
          statusMasukSebelum,
          statusPulangSebelum,
          jamMasukSebelum,
          jamPulangSebelum,
          alasanFull,
          presensi.id
        ]
      );

      if (result.affectedRows > 0) {
        totalUpdated++;
        results.push({
          id: presensi.id,
          nama: presensi.nama,
          status_masuk_sebelum: presensi.status_masuk,
          status_masuk_setelah: statusMasukSebelum,
          status_pulang_sebelum: presensi.status_pulang,
          status_pulang_setelah: statusPulangSebelum
        });
      }
    }

    console.log('Cancel result - affected rows:', totalUpdated);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, records_affected) VALUES (?, ?, ?, ?)',
      [
        'BATAL_PEMUTIHAN', 
        `Membatalkan pemutihan ${totalUpdated} data presensi: ${alasan_pembatalan}`,
        userId,
        totalUpdated
      ]
    );

    const response = {
      success: true,
      message: `Berhasil membatalkan ${totalUpdated} data pemutihan`,
      data: {
        affected_rows: totalUpdated,
        alasan_pembatalan: alasanFull,
        tanggal_pembatalan: timestamp,
        details: results
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in batalkanPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getRiwayatPemutihan = async (req, res) => {
  console.log('=== GET RIWAYAT PEMUTIHAN START ===');
  try {
    const { start_date, end_date, wilayah, jenis = 'all' } = req.query;
    const userRoles = req.user.roles || [];
    const userId = req.user.id;

    console.log('Query parameters:', { start_date, end_date, wilayah, jenis });

    // Query riwayat pemutihan
    let query = `
      SELECT 
        p.id as presensi_id,
        p.tanggal,
        p.jam_masuk,
        p.jam_pulang,
        p.status_masuk as status_sebelum,
        p.status_pulang as status_pulang_sebelum,
        p.keterangan,
        p.updated_at as tanggal_pemutihan,
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        i.jenis as jenis_izin,
        CASE 
          WHEN p.keterangan LIKE '%PEMUTIHAN: Dibatalkan%' THEN 'dibatalkan'
          WHEN p.keterangan LIKE '%PEMUTIHAN:%' THEN 'diputihkan'
          ELSE 'normal'
        END as status_pemutihan
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN izin i ON p.izin_id = i.id
      WHERE p.keterangan LIKE '%PEMUTIHAN:%'
        AND u.is_active = 1
    `;

    const params = [];

    // Filter tanggal
    if (start_date && end_date) {
      query += ' AND p.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else {
      // Default: bulan ini
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      
      query += ' AND p.tanggal BETWEEN ? AND ?';
      params.push(firstDay, lastDay);
    }

    // Filter wilayah
    if (wilayah && wilayah !== 'all' && wilayah !== '') {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    // Filter jenis
    if (jenis === 'diputihkan') {
      query += ' AND p.keterangan LIKE "%PEMUTIHAN:%" AND p.keterangan NOT LIKE "%PEMUTIHAN: Dibatalkan%"';
    } else if (jenis === 'dibatalkan') {
      query += ' AND p.keterangan LIKE "%PEMUTIHAN: Dibatalkan%"';
    }

    // Filter berdasarkan role
    if (userRoles.includes('supervisor') && !userRoles.includes('admin')) {
      // Supervisor hanya bisa lihat wilayahnya
      query += ' AND u.wilayah_penugasan = ?';
      params.push(req.user.wilayah_penugasan || '');
    } else if (userRoles.includes('pegawai') && !userRoles.includes('admin') && !userRoles.includes('supervisor')) {
      // Pegawai hanya bisa lihat data sendiri
      query += ' AND p.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY p.updated_at DESC, p.tanggal DESC';

    console.log('Executing riwayat query...');
    const [riwayat] = await pool.execute(query, params);
    console.log('Riwayat found:', riwayat.length);

    // Format data riwayat
    const formattedRiwayat = riwayat.map(item => {
      let jenis_pemutihan = 'unknown';
      let catatan = '';
      let tipe_pemutihan = 'unknown';
      let status = item.status_pemutihan;

      // Ekstrak informasi dari keterangan
      if (item.keterangan) {
        const pemutihanMatch = item.keterangan.match(/PEMUTIHAN: ([^|(]+)/);
        if (pemutihanMatch) {
          catatan = pemutihanMatch[1].trim();
        }

        if (item.keterangan.includes('manual')) {
          jenis_pemutihan = 'manual';
        } else if (item.keterangan.includes('otomatis')) {
          jenis_pemutihan = 'otomatis';
        }

        if (item.keterangan.includes('Dibatalkan')) {
          status = 'dibatalkan';
        } else if (item.keterangan.includes('PEMUTIHAN:')) {
          status = 'diputihkan';
        }

        // Tentukan tipe pemutihan
        if (item.keterangan.includes('Alpha Total') || 
            (item.jam_masuk === '08:00:00' && item.jam_pulang === '16:00:00' && item.jenis_izin === null)) {
          tipe_pemutihan = 'Alpha Total';
        } else if (item.keterangan.includes('Belum Pulang') || 
                  (item.jam_masuk !== null && item.jam_pulang === '16:00:00' && item.jenis_izin === null)) {
          tipe_pemutihan = 'Belum Pulang';
        }
      }

      return {
        ...item,
        jenis_pemutihan,
        tipe_pemutihan,
        catatan_pemutihan: catatan,
        status_pemutihan: status,
        keterangan_asli: item.keterangan
      };
    });

    // Statistik riwayat
    const stats = {
      total: formattedRiwayat.length,
      diputihkan: formattedRiwayat.filter(r => r.status_pemutihan === 'diputihkan').length,
      dibatalkan: formattedRiwayat.filter(r => r.status_pemutihan === 'dibatalkan').length,
      alpha_total: formattedRiwayat.filter(r => r.tipe_pemutihan === 'Alpha Total').length,
      belum_pulang: formattedRiwayat.filter(r => r.tipe_pemutihan === 'Belum Pulang').length
    };

    const response = {
      success: true,
      data: {
        riwayat: formattedRiwayat,
        stats,
        periode: {
          start_date: start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
          end_date: end_date || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]
        }
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in getRiwayatPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getDataForPemutihan,
  prosesPemutihan,
  batalkanPemutihan,
  getRiwayatPemutihan
};
// controllers/dashboardController.js
const { pool } = require('../config/database');

// Helper functions
const formatDate = (date) => {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${dayName}, ${day} ${month} ${year}`;
};

// Get dashboard kehadiran hari ini
const getDashboardKehadiranHariIni = async (req, res) => {
  try {
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    
    const formattedDate = formatDate(today);
    const jamKerja = "08:00 - 16:00";
    
    // Query untuk statistik hari ini
    const [statistik] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT u.id) as total_pegawai,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.jam_masuk != '' THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
        SUM(CASE WHEN p.jam_masuk IS NULL OR p.jam_masuk = '' THEN 1 ELSE 0 END) as total_tidak_hadir,
        SUM(CASE WHEN p.keterangan IS NOT NULL AND p.keterangan != '' AND p.jam_masuk IS NULL THEN 1 ELSE 0 END) as total_izin,
        SUM(CASE WHEN p.status_masuk = 'Tepat Waktu' THEN 1 ELSE 0 END) as total_tepat_waktu
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'`,
      [todayDate]
    );
    
    const data = statistik[0] || {};
    const totalPegawai = data.total_pegawai || 0;
    const totalHadir = data.total_hadir || 0;
    const totalTerlambat = data.total_terlambat || 0;
    const totalTidakHadir = data.total_tidak_hadir || 0;
    const totalIzin = data.total_izin || 0;
    const totalTepatWaktu = data.total_tepat_waktu || 0;
    
    // Hitung persentase
    const persentaseHadir = totalPegawai > 0 ? ((totalHadir / totalPegawai) * 100).toFixed(1) : 0;
    const persentaseTidakHadir = totalPegawai > 0 ? ((totalTidakHadir / totalPegawai) * 100).toFixed(1) : 0;
    const persentaseIzin = totalPegawai > 0 ? ((totalIzin / totalPegawai) * 100).toFixed(1) : 0;
    const persentaseTerlambat = totalHadir > 0 ? ((totalTerlambat / totalHadir) * 100).toFixed(1) : 0;
    const persentaseKehadiran = parseFloat(persentaseHadir);
    
    // Tentukan status berdasarkan persentase
    let statusKehadiran = "Perlu Ditingkatkan";
    let target = 90;
    
    if (persentaseKehadiran >= 90) {
      statusKehadiran = "Baik";
    } else if (persentaseKehadiran >= 70) {
      statusKehadiran = "Cukup";
    }
    
    res.json({
      success: true,
      data: {
        judul: "Kehadiran Hari Ini",
        tanggal: formattedDate,
        jam_kerja: jamKerja,
        status: "Hadir",
        statistik: {
          hadir: {
            jumlah: totalHadir,
            persentase: persentaseHadir,
            label: "dari total",
            detail: {
              tepat_waktu: totalTepatWaktu,
              terlambat: totalTerlambat
            }
          },
          tidak_hadir: {
            jumlah: totalTidakHadir,
            persentase: persentaseTidakHadir,
            label: "dari total"
          },
          izin: {
            jumlah: totalIzin,
            persentase: persentaseIzin,
            label: "dari total"
          },
          terlambat: {
            jumlah: totalTerlambat,
            persentase: persentaseTerlambat,
            label: "dari hadir"
          }
        },
        persentase_kehadiran: {
          nilai: persentaseKehadiran.toFixed(1),
          status: statusKehadiran,
          target: target,
          progress: persentaseKehadiran,
          min: 0,
          max: 100
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard kehadiran hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get dashboard kinerja harian
const getDashboardKinerjaHarian = async (req, res) => {
  try {
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    const formattedDate = formatDate(today);
    
    // TARGET KINERJA
    const targetHarian = 50; // 50 meter per hari
    const targetBulanan = targetHarian * 20; // 20 hari kerja
    
    // Statistik kinerja hari ini
    const [kinerjaHariIni] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT k.user_id) as total_pegawai_kinerja,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE k.tanggal = ? AND u.is_active = 1 AND u.status = 'Aktif'`,
      [todayDate]
    );
    
    const dataHariIni = kinerjaHariIni[0] || {};
    const totalPanjangKr = dataHariIni.total_panjang_kr || 0;
    const totalPanjangKn = dataHariIni.total_panjang_kn || 0;
    const totalPanjang = totalPanjangKr + totalPanjangKn;
    
    // Statistik kinerja bulan ini
    const [kinerjaBulanIni] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT k.user_id) as total_pegawai,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr_bulan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn_bulan
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ? 
         AND u.is_active = 1 AND u.status = 'Aktif'`,
      [currentMonth, currentYear]
    );
    
    const dataBulanIni = kinerjaBulanIni[0] || {};
    const totalPanjangKrBulan = dataBulanIni.total_panjang_kr_bulan || 0;
    const totalPanjangKnBulan = dataBulanIni.total_panjang_kn_bulan || 0;
    const totalPanjangBulan = totalPanjangKrBulan + totalPanjangKnBulan;
    
    // Pegawai dengan kinerja terbaik hari ini
    const [topPerformersHariIni] = await pool.execute(
      `SELECT 
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        k.ruas_jalan,
        (
          COALESCE(
            CASE 
              WHEN k.panjang_kr LIKE '% meter' THEN 
                CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
              WHEN k.panjang_kr LIKE '%m' THEN 
                CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
              ELSE 
                CAST(k.panjang_kr AS DECIMAL(10,2))
            END, 0
          ) + 
          COALESCE(
            CASE 
              WHEN k.panjang_kn LIKE '% meter' THEN 
                CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
              WHEN k.panjang_kn LIKE '%m' THEN 
                CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
              ELSE 
                CAST(k.panjang_kn AS DECIMAL(10,2))
            END, 0
          )
        ) as total_panjang,
        k.kegiatan
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE k.tanggal = ?
       ORDER BY total_panjang DESC
       LIMIT 5`,
      [todayDate]
    );
    
    // Hitung persentase target
    const persentaseTargetHarian = targetHarian > 0 ? ((totalPanjang / targetHarian) * 100).toFixed(1) : 0;
    const persentaseTargetBulanan = targetBulanan > 0 ? ((totalPanjangBulan / targetBulanan) * 100).toFixed(1) : 0;
    
    // Status kinerja
    let statusKinerjaHarian = "Perlu Ditingkatkan";
    if (persentaseTargetHarian >= 100) {
      statusKinerjaHarian = "Mencapai Target";
    } else if (persentaseTargetHarian >= 70) {
      statusKinerjaHarian = "Cukup Baik";
    }
    
    let statusKinerjaBulanan = "Perlu Ditingkatkan";
    if (persentaseTargetBulanan >= 100) {
      statusKinerjaBulanan = "Mencapai Target";
    } else if (persentaseTargetBulanan >= 70) {
      statusKinerjaBulanan = "Cukup Baik";
    }
    
    res.json({
      success: true,
      data: {
        judul: "Kinerja Harian",
        tanggal: formattedDate,
        periode_bulan: `${currentMonth}/${currentYear}`,
        target: {
          harian: targetHarian,
          bulanan: targetBulanan,
          hari_kerja_per_bulan: 20 // Default 20 hari kerja
        },
        statistik_hari_ini: {
          total_pegawai: dataHariIni.total_pegawai_kinerja || 0,
          total_panjang: parseFloat(totalPanjang).toFixed(2),
          detail: {
            panjang_kr: parseFloat(totalPanjangKr).toFixed(2),
            panjang_kn: parseFloat(totalPanjangKn).toFixed(2)
          },
          pencapaian_target: {
            persentase: persentaseTargetHarian,
            status: statusKinerjaHarian,
            progress: parseFloat(persentaseTargetHarian)
          }
        },
        statistik_bulan_ini: {
          total_pegawai: dataBulanIni.total_pegawai || 0,
          total_panjang: parseFloat(totalPanjangBulan).toFixed(2),
          detail: {
            panjang_kr: parseFloat(totalPanjangKrBulan).toFixed(2),
            panjang_kn: parseFloat(totalPanjangKnBulan).toFixed(2)
          },
          pencapaian_target: {
            persentase: persentaseTargetBulanan,
            status: statusKinerjaBulanan,
            progress: parseFloat(persentaseTargetBulanan)
          }
        },
        top_performers: topPerformersHariIni.map(p => ({
          ...p,
          total_panjang: parseFloat(p.total_panjang).toFixed(2)
        })),
        summary: {
          target_harian_tercapai: totalPanjang >= targetHarian,
          target_bulanan_tercapai: totalPanjangBulan >= targetBulanan,
          selisih_target_harian: (targetHarian - totalPanjang).toFixed(2),
          selisih_target_bulanan: (targetBulanan - totalPanjangBulan).toFixed(2)
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard kinerja harian error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get dashboard ringkasan lengkap (VERSI SEDERHANA)
const getDashboardRingkasanLengkap = async (req, res) => {
  try {
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    const formattedDate = formatDate(today);
    
    // ===== 1. KEHADIRAN HARI INI =====
    const [kehadiran] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT u.id) as total_pegawai,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'`,
      [todayDate]
    );
    
    const kehadiranData = kehadiran[0] || {};
    const totalPegawai = kehadiranData.total_pegawai || 0;
    const totalHadir = kehadiranData.total_hadir || 0;
    const totalTerlambat = kehadiranData.total_terlambat || 0;
    
    // ===== 2. KINERJA HARI INI =====
    const [kinerja] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT k.user_id) as total_pegawai_kinerja,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE k.tanggal = ? AND u.is_active = 1 AND u.status = 'Aktif'`,
      [todayDate]
    );
    
    const kinerjaData = kinerja[0] || {};
    const totalPanjangKr = kinerjaData.total_panjang_kr || 0;
    const totalPanjangKn = kinerjaData.total_panjang_kn || 0;
    const totalPanjang = totalPanjangKr + totalPanjangKn;
    const targetHarian = 50; // 50 meter per hari
    
    // ===== 3. STATISTIK BULAN INI =====
    // Kehadiran bulan ini
    const [kehadiranBulan] = await pool.execute(
      `SELECT COUNT(DISTINCT p.user_id) as total_kehadiran_bulan
       FROM presensi p 
       INNER JOIN users u ON p.user_id = u.id
       WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ? 
         AND u.is_active = 1 AND u.status = 'Aktif'
         AND p.jam_masuk IS NOT NULL`,
      [currentMonth, currentYear]
    );
    
    // Kinerja bulan ini
    const [kinerjaBulan] = await pool.execute(
      `SELECT 
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr_bulan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn_bulan
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ? 
         AND u.is_active = 1 AND u.status = 'Aktif'`,
      [currentMonth, currentYear]
    );
    
    const kehadiranBulanData = kehadiranBulan[0] || {};
    const kinerjaBulanData = kinerjaBulan[0] || {};
    const totalPanjangKrBulan = kinerjaBulanData.total_panjang_kr_bulan || 0;
    const totalPanjangKnBulan = kinerjaBulanData.total_panjang_kn_bulan || 0;
    const totalPanjangBulan = totalPanjangKrBulan + totalPanjangKnBulan;
    const targetBulanan = 1000; // 50m x 20 hari
    
    // ===== 4. TOP PERFORMER =====
    const [topPerformer] = await pool.execute(
      `SELECT u.nama, u.jabatan 
       FROM kinerja_harian k
       INNER JOIN users u ON k.user_id = u.id
       WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
       GROUP BY u.id, u.nama, u.jabatan
       ORDER BY 
         SUM(
           COALESCE(
             CASE 
               WHEN k.panjang_kr LIKE '% meter' THEN 
                 CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
               WHEN k.panjang_kr LIKE '%m' THEN 
                 CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
               ELSE 
                 CAST(k.panjang_kr AS DECIMAL(10,2))
             END, 0
           ) + 
           COALESCE(
             CASE 
               WHEN k.panjang_kn LIKE '% meter' THEN 
                 CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
               WHEN k.panjang_kn LIKE '%m' THEN 
                 CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
               ELSE 
                 CAST(k.panjang_kn AS DECIMAL(10,2))
             END, 0
           )
         ) DESC
       LIMIT 1`,
      [currentMonth, currentYear]
    );
    
    // ===== 5. HARI KERJA BERJALAN =====
    const [hariKerja] = await pool.execute(
      `SELECT DAY(CURRENT_DATE()) as hari_ke`
    );
    
    // ===== PERHITUNGAN PERSENTASE =====
    const persentaseKehadiran = totalPegawai > 0 ? ((totalHadir / totalPegawai) * 100).toFixed(1) : 0;
    const persentaseTerlambat = totalHadir > 0 ? ((totalTerlambat / totalHadir) * 100).toFixed(1) : 0;
    const persentaseKinerja = targetHarian > 0 ? ((totalPanjang / targetHarian) * 100).toFixed(1) : 0;
    const persentaseKinerjaBulanan = targetBulanan > 0 ? ((totalPanjangBulan / targetBulanan) * 100).toFixed(1) : 0;
    
    // Status
    let statusKehadiran = "Perlu Ditingkatkan";
    if (persentaseKehadiran >= 90) statusKehadiran = "Baik";
    else if (persentaseKehadiran >= 70) statusKehadiran = "Cukup";
    
    let statusKinerja = "Perlu Ditingkatkan";
    if (persentaseKinerja >= 100) statusKinerja = "Mencapai Target";
    else if (persentaseKinerja >= 70) statusKinerja = "Cukup Baik";
    
    res.json({
      success: true,
      data: {
        judul: "Dashboard Ringkasan",
        tanggal: formattedDate,
        periode_bulan: `${currentMonth}/${currentYear}`,
        
        statistik_hari_ini: {
          kehadiran: {
            total_pegawai: totalPegawai,
            total_hadir: totalHadir,
            total_terlambat: totalTerlambat,
            persentase_kehadiran: persentaseKehadiran,
            persentase_terlambat: persentaseTerlambat,
            status: statusKehadiran
          },
          kinerja: {
            total_panjang: parseFloat(totalPanjang).toFixed(2),
            target_harian: targetHarian,
            persentase_target: persentaseKinerja,
            status: statusKinerja,
            detail: {
              panjang_kr: parseFloat(totalPanjangKr).toFixed(2),
              panjang_kn: parseFloat(totalPanjangKn).toFixed(2)
            }
          }
        },
        
        statistik_bulan_ini: {
          total_kehadiran: kehadiranBulanData.total_kehadiran_bulan || 0,
          total_kinerja: parseFloat(totalPanjangBulan).toFixed(2),
          target_kinerja: targetBulanan,
          persentase_target_kinerja: persentaseKinerjaBulanan,
          detail: {
            panjang_kr_bulan: parseFloat(totalPanjangKrBulan).toFixed(2),
            panjang_kn_bulan: parseFloat(totalPanjangKnBulan).toFixed(2)
          }
        },
        
        highlight: {
          top_performer: topPerformer[0] || null,
          kehadiran_tertinggi: persentaseKehadiran,
          kinerja_terbaik: persentaseKinerja
        },
        
        summary: {
          hari_kerja_berjalan: `Hari ke-${hariKerja[0]?.hari_ke || 0} dari 20`,
          pencapaian_keseluruhan: parseFloat(persentaseKinerjaBulanan) >= 100 ? "Target Tercapai" : "Menuju Target",
          rekomendasi: totalTerlambat > 0 ? 
            "Perbaiki kedisiplinan waktu masuk" : 
            "Pertahankan kedisiplinan dan tingkatkan produktivitas"
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard ringkasan lengkap error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get dashboard per wilayah
const getDashboardPerWilayah = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();
    
    // Data per wilayah
    const [wilayahData] = await pool.execute(
      `SELECT 
        u.wilayah_penugasan,
        COUNT(DISTINCT u.id) as total_pegawai,
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN u.id END) as total_hadir,
        COUNT(DISTINCT CASE WHEN k.id IS NOT NULL THEN u.id END) as total_kinerja
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       LEFT JOIN kinerja_harian k ON u.id = k.user_id 
         AND MONTH(k.tanggal) = ? 
         AND YEAR(k.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'
       GROUP BY u.wilayah_penugasan
       ORDER BY total_hadir DESC`,
      [targetBulan, targetTahun, targetBulan, targetTahun]
    );
    
    // Statistik keseluruhan
    const [overallStats] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT u.id) as total_pegawai_all,
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN u.id END) as total_hadir_all,
        COUNT(DISTINCT u.wilayah_penugasan) as total_wilayah
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'`,
      [targetBulan, targetTahun]
    );
    
    const overall = overallStats[0] || {};
    
    res.json({
      success: true,
      data: {
        wilayah: wilayahData,
        overall: {
          total_pegawai: overall.total_pegawai_all || 0,
          total_hadir: overall.total_hadir_all || 0,
          total_wilayah: overall.total_wilayah || 0,
          rata_rata_kehadiran: overall.total_pegawai_all > 0 ? 
            ((overall.total_hadir_all / overall.total_pegawai_all) * 100).toFixed(1) : 0
        },
        periode: {
          bulan: targetBulan,
          tahun: targetTahun
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard per wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get dashboard pegawai aktif
const getDashboardPegawaiAktif = async (req, res) => {
  try {
    const [pegawai] = await pool.execute(
      `SELECT 
        u.id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        u.status,
        (
          SELECT COUNT(*)
          FROM presensi p
          WHERE p.user_id = u.id 
            AND MONTH(p.tanggal) = MONTH(CURRENT_DATE())
            AND YEAR(p.tanggal) = YEAR(CURRENT_DATE())
            AND p.jam_masuk IS NOT NULL
        ) as kehadiran_bulan_ini
       FROM users u
       WHERE u.is_active = 1 AND u.status = 'Aktif'
       ORDER BY u.nama ASC`
    );
    
    res.json({
      success: true,
      data: {
        total_pegawai: pegawai.length,
        pegawai: pegawai
      }
    });

  } catch (error) {
    console.error('Get dashboard pegawai aktif error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
// Get dashboard statistik bulanan lengkap
// Get dashboard statistik bulanan lengkap - VERSI PER BULAN
// Get dashboard statistik bulanan lengkap - VERSI PER BULAN
const getDashboardStatistikBulanan = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();
    
    // Nama bulan
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const namaBulan = months[targetBulan - 1];
    
    // 1. STATISTIK BULANAN (Data agregat per bulan)
    const [statistikBulanIni] = await pool.execute(
      `SELECT 
        -- Kehadiran
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN p.user_id END) as total_hadir_bulan,
        COUNT(DISTINCT u.id) as total_pegawai,
        ROUND(AVG(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) * 100, 1) as rata_kehadiran_persen,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat_bulan,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur_bulan,
        
        -- Kinerja
        COUNT(DISTINCT k.id) as total_laporan_bulan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr_bulan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn_bulan,
        
        -- Rata-rata per pegawai
        ROUND(
          COALESCE(AVG(
            CASE 
              WHEN k.panjang_kr LIKE '% meter' THEN 
                CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
              WHEN k.panjang_kr LIKE '%m' THEN 
                CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
              ELSE 
                CAST(k.panjang_kr AS DECIMAL(10,2))
            END
          ), 0), 1) as rata_panjang_kr_pegawai,
        
        -- Pegawai yang melaporkan kinerja
        COUNT(DISTINCT k.user_id) as total_pegawai_lapor
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       LEFT JOIN kinerja_harian k ON u.id = k.user_id 
         AND MONTH(k.tanggal) = ? 
         AND YEAR(k.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'`,
      [targetBulan, targetTahun, targetBulan, targetTahun]
    );
    
    const statistik = statistikBulanIni[0] || {};
    
    // 2. DATA PER MINGGU DALAM BULAN (untuk grafik) - DIPERBAIKI
    const [dataPerMinggu] = await pool.execute(
      `SELECT 
        WEEK(dates.tanggal, 1) - WEEK(DATE_SUB(dates.tanggal, INTERVAL DAYOFMONTH(dates.tanggal)-1 DAY), 1) + 1 as minggu_ke,
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN p.user_id END) as total_hadir,
        COUNT(DISTINCT k.id) as total_laporan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn
       FROM (
         SELECT DATE_ADD(?, INTERVAL n DAY) as tanggal
         FROM (
           SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
           UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13
           UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 UNION SELECT 20
           UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24 UNION SELECT 25 UNION SELECT 26 UNION SELECT 27
           UNION SELECT 28 UNION SELECT 29 UNION SELECT 30
         ) numbers
         WHERE DATE_ADD(?, INTERVAL n DAY) <= LAST_DAY(?)
       ) dates
       LEFT JOIN presensi p ON DATE(p.tanggal) = dates.tanggal
       LEFT JOIN kinerja_harian k ON DATE(k.tanggal) = dates.tanggal
       GROUP BY WEEK(dates.tanggal, 1) - WEEK(DATE_SUB(dates.tanggal, INTERVAL DAYOFMONTH(dates.tanggal)-1 DAY), 1) + 1
       ORDER BY minggu_ke`,
      [
        `${targetTahun}-${String(targetBulan).padStart(2, '0')}-01`,
        `${targetTahun}-${String(targetBulan).padStart(2, '0')}-01`,
        `${targetTahun}-${String(targetBulan).padStart(2, '0')}-01`
      ]
    );
    
    // 3. DATA PER WILAYAH
    const [dataPerWilayah] = await pool.execute(
      `SELECT 
        u.wilayah_penugasan,
        COUNT(DISTINCT u.id) as total_pegawai,
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN u.id END) as total_hadir,
        COUNT(DISTINCT CASE WHEN k.id IS NOT NULL THEN u.id END) as total_kinerja,
        ROUND(AVG(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) * 100, 1) as persentase_kehadiran,
        ROUND(AVG(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) * 100, 1) as persentase_terlambat,
        COALESCE(ROUND(AVG(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 1), 0) as rata_panjang_kr
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       LEFT JOIN kinerja_harian k ON u.id = k.user_id 
         AND MONTH(k.tanggal) = ? 
         AND YEAR(k.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'
         AND u.wilayah_penugasan IS NOT NULL
       GROUP BY u.wilayah_penugasan
       ORDER BY persentase_kehadiran DESC`,
      [targetBulan, targetTahun, targetBulan, targetTahun]
    );
    
    // 4. TREND 6 BULAN TERAKHIR (untuk grafik trend)
    const [trend6Bulan] = await pool.execute(
      `SELECT 
        DATE_FORMAT(bulan_range.tanggal, '%Y-%m') as bulan_tahun,
        DATE_FORMAT(bulan_range.tanggal, '%b') as nama_bulan_singkat,
        COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN p.user_id END) as total_hadir,
        COUNT(DISTINCT p.user_id) as total_presensi,
        COUNT(DISTINCT k.id) as total_laporan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr
       FROM (
         SELECT LAST_DAY(CURRENT_DATE - INTERVAL n MONTH) + INTERVAL 1 DAY - INTERVAL 1 MONTH as tanggal
         FROM (
           SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
         ) months
       ) bulan_range
       LEFT JOIN presensi p ON DATE_FORMAT(p.tanggal, '%Y-%m') = DATE_FORMAT(bulan_range.tanggal, '%Y-%m')
       LEFT JOIN kinerja_harian k ON DATE_FORMAT(k.tanggal, '%Y-%m') = DATE_FORMAT(bulan_range.tanggal, '%Y-%m')
       GROUP BY DATE_FORMAT(bulan_range.tanggal, '%Y-%m'), DATE_FORMAT(bulan_range.tanggal, '%b')
       ORDER BY bulan_tahun DESC
       LIMIT 6`,
      []
    );
    
    // 5. TARGET VS REALISASI
    const totalPegawai = statistik.total_pegawai || 0;
    const targetHarianPerPegawai = 50; // 50 meter per hari
    const hariKerjaPerBulan = 20; // 20 hari kerja per bulan
    const targetBulananPerPegawai = targetHarianPerPegawai * hariKerjaPerBulan; // 1000 meter per pegawai
    
    const totalPanjang = (statistik.total_panjang_kr_bulan || 0) + (statistik.total_panjang_kn_bulan || 0);
    const targetTotal = targetBulananPerPegawai * totalPegawai;
    const realisasiPersen = targetTotal > 0 ? (totalPanjang / targetTotal * 100) : 0;
    
    // Data untuk grafik target vs realisasi
    const targetVsRealisasi = {
      target: targetTotal,
      realisasi: totalPanjang,
      persentase: realisasiPersen.toFixed(1),
      sisa_target: Math.max(targetTotal - totalPanjang, 0),
      status: realisasiPersen >= 100 ? 'Terpenuhi' : realisasiPersen >= 80 ? 'Hampir Terpenuhi' : 'Belum Terpenuhi'
    };
    
    // 6. TOP PERFORMERS BULAN INI
    const [topPerformers] = await pool.execute(
      `SELECT 
        u.id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        COUNT(DISTINCT k.id) as total_laporan,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kr LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kr LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kr AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kr,
        COALESCE(SUM(
          CASE 
            WHEN k.panjang_kn LIKE '% meter' THEN 
              CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))
            WHEN k.panjang_kn LIKE '%m' THEN 
              CAST(REPLACE(k.panjang_kn, 'm', '') AS DECIMAL(10,2))
            ELSE 
              CAST(k.panjang_kn AS DECIMAL(10,2))
          END
        ), 0) as total_panjang_kn
       FROM users u
       LEFT JOIN kinerja_harian k ON u.id = k.user_id 
         AND MONTH(k.tanggal) = ? 
         AND YEAR(k.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'
         AND k.id IS NOT NULL
       GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan
       ORDER BY (total_panjang_kr + total_panjang_kn) DESC
       LIMIT 10`,
      [targetBulan, targetTahun]
    );
    
    // 7. PERBANDINGAN BULAN INI DENGAN BULAN SEBELUMNYA
    const bulanSebelumnya = targetBulan === 1 ? 12 : targetBulan - 1;
    const tahunSebelumnya = targetBulan === 1 ? targetTahun - 1 : targetTahun;
    
    const [perbandinganBulan] = await pool.execute(
      `SELECT 
        -- Bulan ini
        (SELECT COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN p.user_id END)
         FROM presensi p
         WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?) as hadir_bulan_ini,
        
        (SELECT COALESCE(SUM(
           CASE 
             WHEN k.panjang_kr LIKE '% meter' THEN 
               CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
             WHEN k.panjang_kr LIKE '%m' THEN 
               CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
             ELSE 
               CAST(k.panjang_kr AS DECIMAL(10,2))
           END
         ), 0)
         FROM kinerja_harian k
         WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?) as panjang_bulan_ini,
        
        -- Bulan sebelumnya
        (SELECT COUNT(DISTINCT CASE WHEN p.jam_masuk IS NOT NULL THEN p.user_id END)
         FROM presensi p
         WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?) as hadir_bulan_lalu,
        
        (SELECT COALESCE(SUM(
           CASE 
             WHEN k.panjang_kr LIKE '% meter' THEN 
               CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))
             WHEN k.panjang_kr LIKE '%m' THEN 
               CAST(REPLACE(k.panjang_kr, 'm', '') AS DECIMAL(10,2))
             ELSE 
               CAST(k.panjang_kr AS DECIMAL(10,2))
           END
         ), 0)
         FROM kinerja_harian k
         WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?) as panjang_bulan_lalu`,
      [
        targetBulan, targetTahun, targetBulan, targetTahun,
        bulanSebelumnya, tahunSebelumnya, bulanSebelumnya, tahunSebelumnya
      ]
    );
    
    const perbandingan = perbandinganBulan[0] || {};
    const perubahanHadir = perbandingan.hadir_bulan_lalu > 0 ? 
      ((perbandingan.hadir_bulan_ini - perbandingan.hadir_bulan_lalu) / perbandingan.hadir_bulan_lalu * 100).toFixed(1) : 0;
    const perubahanPanjang = perbandingan.panjang_bulan_lalu > 0 ? 
      ((perbandingan.panjang_bulan_ini - perbandingan.panjang_bulan_lalu) / perbandingan.panjang_bulan_lalu * 100).toFixed(1) : 0;
    
    res.json({
      success: true,
      data: {
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          nama_bulan: namaBulan,
          hari_kerja: hariKerjaPerBulan,
          label_periode: `${namaBulan} ${targetTahun}`
        },
        
        // STATISTIK UTAMA BULAN INI
        statistik_utama: {
          kehadiran: {
            total_hadir: statistik.total_hadir_bulan || 0,
            total_pegawai: statistik.total_pegawai || 0,
            persentase_kehadiran: statistik.rata_kehadiran_persen || 0,
            total_terlambat: statistik.total_terlambat_bulan || 0,
            total_lembur: statistik.total_lembur_bulan || 0
          },
          kinerja: {
            total_laporan: statistik.total_laporan_bulan || 0,
            total_panjang_kr: parseFloat(statistik.total_panjang_kr_bulan || 0).toFixed(1),
            total_panjang_kn: parseFloat(statistik.total_panjang_kn_bulan || 0).toFixed(1),
            total_panjang: parseFloat(totalPanjang).toFixed(1),
            rata_per_pegawai: statistik.rata_panjang_kr_pegawai || 0,
            total_pegawai_lapor: statistik.total_pegawai_lapor || 0
          }
        },
        
        // DATA UNTUK GRAFIK PER MINGGU
        grafik_per_minggu: dataPerMinggu.map(item => ({
          minggu: `Minggu ${item.minggu_ke}`,
          total_hadir: item.total_hadir || 0,
          total_laporan: item.total_laporan || 0,
          total_panjang: parseFloat((item.total_panjang_kr || 0) + (item.total_panjang_kn || 0)).toFixed(1)
        })),
        
        // DATA UNTUK GRAFIK TREND 6 BULAN
        grafik_trend_6bulan: trend6Bulan.map(item => ({
          bulan: item.nama_bulan_singkat,
          total_hadir: item.total_hadir || 0,
          total_laporan: item.total_laporan || 0,
          total_panjang_kr: parseFloat(item.total_panjang_kr || 0).toFixed(1)
        })),
        
        // DATA UNTUK GRAFIK TARGET VS REALISASI
        target_vs_realisasi: targetVsRealisasi,
        
        // DATA TARGET
        target: {
          harian_per_pegawai: targetHarianPerPegawai,
          bulanan_per_pegawai: targetBulananPerPegawai,
          total_pegawai: totalPegawai,
          target_total: parseFloat(targetTotal).toFixed(0),
          realisasi_total: parseFloat(totalPanjang).toFixed(1),
          realisasi_persen: realisasiPersen.toFixed(1),
          sisa_target: parseFloat(Math.max(targetTotal - totalPanjang, 0)).toFixed(1),
          status_target: targetVsRealisasi.status
        },
        
        // DATA PER WILAYAH
        per_wilayah: dataPerWilayah.map(item => ({
          wilayah: item.wilayah_penugasan || 'Tidak Ditentukan',
          total_pegawai: item.total_pegawai || 0,
          total_hadir: item.total_hadir || 0,
          total_kinerja: item.total_kinerja || 0,
          persentase_kehadiran: item.persentase_kehadiran || 0,
          persentase_terlambat: item.persentase_terlambat || 0,
          rata_panjang_kr: item.rata_panjang_kr || 0
        })),
        
        // TOP PERFORMERS
        top_performers: topPerformers.map(item => ({
          nama: item.nama,
          jabatan: item.jabatan,
          wilayah: item.wilayah_penugasan,
          total_laporan: item.total_laporan || 0,
          total_panjang: parseFloat((item.total_panjang_kr || 0) + (item.total_panjang_kn || 0)).toFixed(1),
          persentase_pencapaian: targetBulananPerPegawai > 0 ? 
            (((item.total_panjang_kr || 0) + (item.total_panjang_kn || 0)) / targetBulananPerPegawai * 100).toFixed(1) : 0
        })),
        
        // PERBANDINGAN DENGAN BULAN SEBELUMNYA
        perbandingan: {
          kehadiran: {
            bulan_ini: perbandingan.hadir_bulan_ini || 0,
            bulan_lalu: perbandingan.hadir_bulan_lalu || 0,
            perubahan: perubahanHadir,
            status: perubahanHadir > 0 ? 'naik' : perubahanHadir < 0 ? 'turun' : 'stabil'
          },
          kinerja: {
            bulan_ini: parseFloat(perbandingan.panjang_bulan_ini || 0).toFixed(1),
            bulan_lalu: parseFloat(perbandingan.panjang_bulan_lalu || 0).toFixed(1),
            perubahan: perubahanPanjang,
            status: perubahanPanjang > 0 ? 'naik' : perubahanPanjang < 0 ? 'turun' : 'stabil'
          }
        },
        
        // SUMMARY
        summary: {
          status_keseluruhan: realisasiPersen >= 100 ? 'Sangat Baik' : 
                               realisasiPersen >= 80 ? 'Baik' : 
                               realisasiPersen >= 60 ? 'Cukup' : 'Perlu Perbaikan',
          rekomendasi: realisasiPersen >= 100 ? 'Pertahankan performa yang sudah baik' :
                       realisasiPersen >= 80 ? 'Tingkatkan sedikit lagi untuk mencapai target 100%' :
                       realisasiPersen >= 60 ? 'Perlu peningkatan kinerja untuk mendekati target' :
                       'Perlu evaluasi dan perbaikan signifikan'
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard statistik bulanan error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
module.exports = {
  getDashboardKehadiranHariIni,
  getDashboardKinerjaHarian,
  getDashboardRingkasanLengkap,
  getDashboardPerWilayah,
  getDashboardPegawaiAktif,
    getDashboardStatistikBulanan // Tambahkan ini
};
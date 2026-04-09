const { pool } = require('../config/database');

/**
 * =========================
 * DASHBOARD HARI INI
 * =========================
 */
const getDashboardHariIni = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // total pegawai aktif
    const [[pegawai]] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE roles = 'pegawai'
        AND is_active = 1
        AND status = 'Aktif'
    `);

    // statistik presensi hari ini dengan detail status
    const [[statistik]] = await pool.execute(`
      SELECT
        COUNT(DISTINCT p.user_id) AS total_hadir,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.status_masuk = 'Tepat Waktu' THEN 1 ELSE 0 END) AS hadir_tepat_waktu,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN p.status_masuk = 'Izin' THEN 1 ELSE 0 END) AS izin,
        SUM(CASE WHEN p.status_masuk = 'Sakit' THEN 1 ELSE 0 END) AS sakit,
        SUM(CASE WHEN p.status_masuk = 'Cuti' THEN 1 ELSE 0 END) AS cuti
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      WHERE p.tanggal = ?
        AND u.roles = 'pegawai'
        AND u.is_active = 1
        AND p.jam_masuk IS NOT NULL
    `, [today]);

    // Total pegawai yang sudah absen (hadir + terlambat + izin + sakit + cuti)
    const totalHadir = statistik.total_hadir || 0;
    const totalPegawai = pegawai.total || 0;
    const tidakHadir = Math.max(0, totalPegawai - totalHadir);

    // Hitung persentase
    const persentaseHadir = totalPegawai > 0 ? ((totalHadir / totalPegawai) * 100) : 0;
    const persentaseTidakHadir = totalPegawai > 0 ? ((tidakHadir / totalPegawai) * 100) : 0;
    const persentaseTepatWaktu = totalPegawai > 0 ? ((statistik.hadir_tepat_waktu / totalPegawai) * 100) : 0;
    const persentaseTerlambat = totalPegawai > 0 ? ((statistik.terlambat / totalPegawai) * 100) : 0;
    const persentaseIzin = totalPegawai > 0 ? ((statistik.izin / totalPegawai) * 100) : 0;
    const persentaseSakit = totalPegawai > 0 ? ((statistik.sakit / totalPegawai) * 100) : 0;
    const persentaseCuti = totalPegawai > 0 ? ((statistik.cuti / totalPegawai) * 100) : 0;

    res.json({
      success: true,
      data: {
        tanggal: today,
        total_pegawai: totalPegawai,
        hadir: totalHadir,
        tidak_hadir: tidakHadir,
        hadir_tepat_waktu: statistik.hadir_tepat_waktu || 0,
        terlambat: statistik.terlambat || 0,
        izin: statistik.izin || 0,
        sakit: statistik.sakit || 0,
        cuti: statistik.cuti || 0,
        persentase_hadir: Number(persentaseHadir.toFixed(2)),
        persentase_tidak_hadir: Number(persentaseTidakHadir.toFixed(2)),
        persentase_hadir_tepat_waktu: Number(persentaseTepatWaktu.toFixed(2)),
        persentase_terlambat: Number(persentaseTerlambat.toFixed(2)),
        persentase_izin: Number(persentaseIzin.toFixed(2)),
        persentase_sakit: Number(persentaseSakit.toFixed(2)),
        persentase_cuti: Number(persentaseCuti.toFixed(2))
      }
    });

  } catch (error) {
    console.error('Dashboard hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * =========================
 * GRAFIK KEHADIRAN BULANAN
 * =========================
 */
const getGrafikHadirBulanan = async (req, res) => {
  try {
    const tahun = req.query.tahun || new Date().getFullYear();
    const bulan = req.query.bulan || new Date().getMonth() + 1;
    const wilayah = req.query.wilayah || 'all';

    // Query untuk data bulanan (bukan harian)
    let query = `
      SELECT
        MONTH(p.tanggal) AS bulan,
        COUNT(DISTINCT p.user_id) AS total_hadir,
        COUNT(DISTINCT u.id) AS total_pegawai,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.status_masuk = 'Tepat Waktu' THEN 1 ELSE 0 END) AS hadir_tepat_waktu,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) AS terlambat,
        SUM(CASE WHEN p.status_masuk = 'Izin' THEN 1 ELSE 0 END) AS izin,
        SUM(CASE WHEN p.status_masuk = 'Sakit' THEN 1 ELSE 0 END) AS sakit,
        SUM(CASE WHEN p.status_masuk = 'Cuti' THEN 1 ELSE 0 END) AS cuti
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      WHERE YEAR(p.tanggal) = ?
        AND MONTH(p.tanggal) = ?
        AND u.roles = 'pegawai'
        AND u.is_active = 1
    `;

    const params = [tahun, bulan];

    // Filter wilayah jika bukan 'all'
    if (wilayah !== 'all') {
      query += ` AND u.wilayah_penugasan = ?`;
      params.push(wilayah);
    }

    query += ` GROUP BY MONTH(p.tanggal)`;

    const [[data]] = await pool.execute(query, params);

    // Total pegawai berdasarkan filter
    let totalQuery = `
      SELECT COUNT(*) AS total
      FROM users u
      WHERE u.roles = 'pegawai'
        AND u.is_active = 1
    `;
    
    const totalParams = [];
    
    if (wilayah !== 'all') {
      totalQuery += ` AND u.wilayah_penugasan = ?`;
      totalParams.push(wilayah);
    }
    
    const [[totalData]] = await pool.execute(totalQuery, totalParams);

    const totalPegawai = totalData.total || 0;
    const totalHadir = data?.total_hadir || 0;
    const tidakHadir = Math.max(0, totalPegawai - totalHadir);
    
    // Hitung persentase
    const persentaseHadir = totalPegawai > 0 ? ((totalHadir / totalPegawai) * 100) : 0;
    const persentaseTidakHadir = totalPegawai > 0 ? ((tidakHadir / totalPegawai) * 100) : 0;

    // Data untuk grafik (per bulan)
    const grafik = Array.from({ length: 12 }, (_, i) => {
      const bulanGrafik = i + 1;
      // Jika ini bulan yang diminta, gunakan data aktual
      if (bulanGrafik === bulan && data) {
        return {
          bulan: bulanGrafik,
          total_hadir: totalHadir,
          total_pegawai: totalPegawai,
          hadir_tepat_waktu: data.hadir_tepat_waktu || 0,
          terlambat: data.terlambat || 0,
          izin: data.izin || 0,
          sakit: data.sakit || 0,
          cuti: data.cuti || 0,
          tidak_hadir: tidakHadir,
          persentase_hadir: Number(persentaseHadir.toFixed(2)),
          persentase_tidak_hadir: Number(persentaseTidakHadir.toFixed(2))
        };
      }
      // Untuk bulan lain, return data kosong
      return {
        bulan: bulanGrafik,
        total_hadir: 0,
        total_pegawai: totalPegawai,
        hadir_tepat_waktu: 0,
        terlambat: 0,
        izin: 0,
        sakit: 0,
        cuti: 0,
        tidak_hadir: totalPegawai,
        persentase_hadir: 0,
        persentase_tidak_hadir: 100
      };
    });

    // Data untuk chart bar bulanan
    const dataBulanan = grafik.map(item => ({
      bulan: getMonthName(item.bulan),
      hadir: item.total_hadir,
      tidak_hadir: item.tidak_hadir,
      persentase_hadir: item.persentase_hadir
    }));

    res.json({
      success: true,
      data: {
        tahun,
        bulan,
        wilayah: wilayah !== 'all' ? wilayah : 'Semua Wilayah',
        total_pegawai: totalPegawai,
        total_hadir: totalHadir,
        tidak_hadir: tidakHadir,
        persentase_hadir: Number(persentaseHadir.toFixed(2)),
        persentase_tidak_hadir: Number(persentaseTidakHadir.toFixed(2)),
        grafik: grafik,
        data_bulanan: dataBulanan
      }
    });

  } catch (error) {
    console.error('Grafik bulanan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * =========================
 * PEGAWAI BELUM ABSEN
 * =========================
 */
const getPegawaiBelumAbsen = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [belumAbsen] = await pool.execute(`
      SELECT 
        u.id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        'Belum melakukan absen hari ini' AS keterangan
      FROM users u
      WHERE u.roles = 'pegawai'
        AND u.is_active = 1
        AND u.status = 'Aktif'
        AND u.id NOT IN (
          SELECT user_id
          FROM presensi
          WHERE tanggal = ?
            AND jam_masuk IS NOT NULL
        )
      ORDER BY u.nama ASC
    `, [today]);

    res.json({
      success: true,
      data: belumAbsen
    });

  } catch (error) {
    console.error('Pegawai belum absen error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * =========================
 * DAFTAR WILAYAH
 * =========================
 */
const getDaftarWilayah = async (req, res) => {
  try {
    const [wilayah] = await pool.execute(`
      SELECT DISTINCT wilayah_penugasan
      FROM users
      WHERE roles = 'pegawai'
        AND is_active = 1
        AND wilayah_penugasan IS NOT NULL
        AND wilayah_penugasan != ''
      ORDER BY wilayah_penugasan ASC
    `);

    const wilayahList = wilayah.map(w => w.wilayah_penugasan);

    res.json({
      success: true,
      data: wilayahList
    });

  } catch (error) {
    console.error('Daftar wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * =========================
 * GRAFIK KINERJA BULANAN - DIAGRAM BATANG
 * =========================
 */
const getGrafikKinerjaBulanan = async (req, res) => {
  try {
    const tahun = req.query.tahun || new Date().getFullYear();
    const bulan = req.query.bulan || new Date().getMonth() + 1;

    /**
     * 1. DATA KINERJA PER BULAN (Januari - Desember)
     */
    const [kinerjaPerBulan] = await pool.execute(`
      SELECT
        MONTH(tanggal) AS bulan,
        SUM(COALESCE(panjang_kr, 0) + COALESCE(panjang_kn, 0)) AS realisasi,
        COUNT(DISTINCT user_id) AS jumlah_pegawai
      FROM kinerja_harian
      WHERE YEAR(tanggal) = ?
      GROUP BY MONTH(tanggal)
      ORDER BY bulan ASC
    `, [tahun]);

    /**
     * 2. TOTAL PEGAWAI AKTIF
     */
    const [[pegawai]] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE roles = 'pegawai'
        AND is_active = 1
        AND status = 'Aktif'
    `);

    const totalPegawai = pegawai.total || 0;

    /**
     * 3. HITUNG TARGET PER BULAN
     */
    const hitungHariKerjaPerBulan = (bulan, tahun) => {
      let count = 0;
      const date = new Date(tahun, bulan - 1, 1);
      const lastDay = new Date(tahun, bulan, 0).getDate();

      for (let day = 1; day <= lastDay; day++) {
        const currentDate = new Date(tahun, bulan - 1, day);
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          count++;
        }
      }
      return count;
    };

    /**
     * 4. DATA GRAFIK UNTUK 12 BULAN
     */
    const grafik = Array.from({ length: 12 }, (_, i) => {
      const bulanGrafik = i + 1;
      const hariKerja = hitungHariKerjaPerBulan(bulanGrafik, tahun);
      const target = totalPegawai * hariKerja * 50;
      
      const found = kinerjaPerBulan.find(k => k.bulan === bulanGrafik);
      const realisasi = found ? Number(found.realisasi) : 0;
      const jumlahPegawai = found ? found.jumlah_pegawai : 0;
      const persentase = target > 0 ? (realisasi / target) * 100 : 0;
      const rataRata = jumlahPegawai > 0 ? realisasi / jumlahPegawai : 0;

      return {
        bulan: bulanGrafik,
        nama_bulan: getMonthName(bulanGrafik),
        target: Number(target.toFixed(2)),
        realisasi: Number(realisasi.toFixed(2)),
        persentase_capaian: Number(persentase.toFixed(2)),
        rata_rata_per_pegawai: Number(rataRata.toFixed(2)),
        jumlah_pegawai_lapor: jumlahPegawai,
        hari_kerja: hariKerja
      };
    });

    /**
     * 5. DATA BULAN INI UNTUK STATISTIK
     */
    const bulanIniData = grafik.find(g => g.bulan === bulan);
    const targetTotal = bulanIniData?.target || 0;
    const realisasiTotal = bulanIniData?.realisasi || 0;
    const persentaseRealisasi = bulanIniData?.persentase_capaian || 0;
    const rataRataPerPegawai = bulanIniData?.rata_rata_per_pegawai || 0;
    const hariKerjaBulanIni = bulanIniData?.hari_kerja || 0;

    res.json({
      success: true,
      data: {
        tahun,
        bulan,
        target_per_pegawai_per_hari: 50,
        total_pegawai: totalPegawai,
        hari_kerja_bulan_ini: hariKerjaBulanIni,
        target_total: targetTotal,
        realisasi_total: realisasiTotal,
        persentase_realisasi: persentaseRealisasi,
        rata_rata_per_pegawai: rataRataPerPegawai,
        jumlah_pegawai_lapor: bulanIniData?.jumlah_pegawai_lapor || 0,
        grafik: grafik
      }
    });

  } catch (error) {
    console.error('Grafik kinerja bulanan error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * =========================
 * DASHBOARD KINERJA HARI INI
 * =========================
 */
const getDashboardKinerjaHariIni = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayDate = new Date(today);
    const dayOfWeek = todayDate.getDay();

    /**
     * 1. CEK HARI LIBUR
     */
    const [hariLibur] = await pool.execute(
      `SELECT id, nama_libur, is_tahunan, tanggal
       FROM hari_libur
       WHERE (tanggal = ? OR (is_tahunan = 1 AND DATE_FORMAT(tanggal, '%m-%d') = DATE_FORMAT(?, '%m-%d')))
       LIMIT 1`,
      [today, today]
    );

    /**
     * 2. CEK HARI KERJA CUSTOM
     */
    const [hariKerjaCustom] = await pool.execute(
      `SELECT is_hari_kerja
       FROM hari_kerja
       WHERE tanggal = ?
       LIMIT 1`,
      [today]
    );

    let isHariKerja = dayOfWeek >= 1 && dayOfWeek <= 5;

    if (hariKerjaCustom.length > 0) {
      isHariKerja = hariKerjaCustom[0].is_hari_kerja === 1;
    }

    if (hariLibur.length > 0) {
      isHariKerja = false;
    }

    /**
     * 3. JIKA BUKAN HARI KERJA
     */
    if (!isHariKerja) {
      return res.json({
        success: true,
        data: {
          tanggal: today,
          is_hari_kerja: false,
          keterangan: hariLibur.length > 0
            ? `Libur: ${hariLibur[0].nama_libur}`
            : 'Bukan hari kerja',
          total_pegawai: 0,
          sudah_lapor: 0,
          belum_lapor: 0,
          daftar_belum_lapor: [],
          top_performers: []
        }
      });
    }

    /**
     * 4. TOTAL PEGAWAI AKTIF
     */
    const [[pegawai]] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE roles = 'pegawai'
         AND is_active = 1
         AND status = 'Aktif'`
    );

    /**
     * 5. YANG SUDAH LAPOR KINERJA
     */
    const [[sudahLapor]] = await pool.execute(
      `SELECT COUNT(DISTINCT user_id) AS total
       FROM kinerja_harian
       WHERE tanggal = ?
         AND (panjang_kr > 0 OR panjang_kn > 0)`,
      [today]
    );

    /**
     * 6. DAFTAR BELUM LAPOR KINERJA
     */
    const [belumLapor] = await pool.execute(
      `SELECT 
         u.id,
         u.nama,
         u.jabatan,
         u.wilayah_penugasan,
         'Belum lapor kinerja hari ini' AS keterangan
       FROM users u
       WHERE u.roles = 'pegawai'
         AND u.is_active = 1
         AND u.status = 'Aktif'
         AND u.id NOT IN (
           SELECT user_id
           FROM kinerja_harian
           WHERE tanggal = ?
             AND (panjang_kr > 0 OR panjang_kn > 0)
         )
       ORDER BY u.nama ASC`,
      [today]
    );

    /**
     * 7. TOP PERFORMERS HARI INI
     */
    const [topPerformers] = await pool.execute(
      `SELECT 
         u.id,
         u.nama,
         u.jabatan,
         u.wilayah_penugasan,
         kh.panjang_kr,
         kh.panjang_kn,
         (COALESCE(kh.panjang_kr, 0) + COALESCE(kh.panjang_kn, 0)) AS total_kinerja,
         ROUND((COALESCE(kh.panjang_kr, 0) + COALESCE(kh.panjang_kn, 0)) / 50 * 100, 2) AS persentase_capaian
       FROM kinerja_harian kh
       JOIN users u ON kh.user_id = u.id
       WHERE kh.tanggal = ?
         AND u.roles = 'pegawai'
         AND u.is_active = 1
         AND (kh.panjang_kr > 0 OR kh.panjang_kn > 0)
       ORDER BY total_kinerja DESC
       LIMIT 10`,
      [today]
    );

    res.json({
      success: true,
      data: {
        tanggal: today,
        is_hari_kerja: true,
        total_pegawai: pegawai.total,
        sudah_lapor: sudahLapor.total,
        belum_lapor: pegawai.total - sudahLapor.total,
        daftar_belum_lapor: belumLapor,
        top_performers: topPerformers
      }
    });

  } catch (error) {
    console.error('Dashboard kinerja hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Helper function
const getMonthName = (monthNumber) => {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return months[monthNumber - 1] || '';
};

module.exports = {
  getDashboardHariIni,
  getGrafikHadirBulanan,
  getPegawaiBelumAbsen,
  getDaftarWilayah,
  getGrafikKinerjaBulanan,
  getDashboardKinerjaHariIni
};
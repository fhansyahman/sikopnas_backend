// src/utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

const generateKinerjaPDF = (kinerjaData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50
      });

      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('LAPORAN KINERJA HARIAN', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica').text('UPT Wilayah Prajekan - SIKOPNAS', { align: 'center' });
      doc.moveDown();
      
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Informasi Pegawai
      doc.fontSize(14).font('Helvetica-Bold').text('INFORMASI PEGAWAI', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(11).font('Helvetica');
      doc.text(`Nama: ${kinerjaData.nama || '-'}`);
      doc.text(`Jabatan: ${kinerjaData.jabatan || '-'}`);
      doc.text(`Wilayah: ${kinerjaData.wilayah_penugasan || '-'}`);
      doc.text(`Tanggal: ${new Date(kinerjaData.tanggal).toLocaleDateString('id-ID')}`);
      doc.moveDown();

      // Detail Kinerja
      doc.fontSize(14).font('Helvetica-Bold').text('DETAIL KINERJA', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(11);
      doc.text(`Ruas Jalan: ${kinerjaData.ruas_jalan || '-'}`);
      doc.text(`Kegiatan: ${kinerjaData.kegiatan || '-'}`);
      doc.text(`Panjang KR: ${kinerjaData.panjang_kr || '-'}`);
      doc.text(`Panjang KN: ${kinerjaData.panjang_kn || '-'}`);
      doc.moveDown();

      // Informasi Sistem
      doc.fontSize(14).font('Helvetica-Bold').text('INFORMASI SISTEM', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(11);
      doc.text(`Dibuat: ${new Date(kinerjaData.created_at).toLocaleString('id-ID')}`);
      if (kinerjaData.updated_at) {
        doc.text(`Terakhir Diubah: ${new Date(kinerjaData.updated_at).toLocaleString('id-ID')}`);
      }
      doc.moveDown(2);

      // Footer
      doc.fontSize(10).font('Helvetica-Oblique').text('Dokumen ini dicetak secara otomatis oleh sistem SIKOPNAS', { align: 'center' });
      doc.text(`ID Laporan: ${kinerjaData.id}`, { align: 'center' });
      doc.text(`Tanggal Cetak: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

const generateRekapWilayahPDF = (wilayahData, periode, laporanList) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40
      });

      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text('REKAP LAPORAN KINERJA WILAYAH', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica').text(`Wilayah: ${wilayahData.wilayah}`, { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(`Periode: ${periode}`, { align: 'center' });
      doc.fontSize(10).font('Helvetica').text('UPT Wilayah Prajekan - SIKOPNAS', { align: 'center' });
      doc.moveDown();
      
      doc.lineWidth(1).moveTo(40, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown();

      // Statistik Ringkasan
      doc.fontSize(14).font('Helvetica-Bold').text('RINGKASAN STATISTIK', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(11).font('Helvetica');
      doc.text(`Total Laporan: ${wilayahData.total_laporan || 0}`);
      doc.text(`Total Pegawai: ${wilayahData.total_pegawai || 0}`);
      if (wilayahData.avg_panjang_kr) {
        doc.text(`Rata-rata Panjang KR: ${wilayahData.avg_panjang_kr.toFixed(2)} meter`);
      }
      if (wilayahData.avg_panjang_kn) {
        doc.text(`Rata-rata Panjang KN: ${wilayahData.avg_panjang_kn.toFixed(2)} meter`);
      }
      doc.moveDown();

      // Tabel Laporan
      doc.fontSize(14).font('Helvetica-Bold').text('DETAIL LAPORAN', { underline: true });
      doc.moveDown(0.5);

      // Table Headers
      const tableTop = doc.y;
      const tableLeft = 40;
      const colWidth = [30, 70, 100, 120, 80, 80];
      
      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(9);
      const headers = ['No', 'Tanggal', 'Nama', 'Ruas Jalan', 'Panjang KR', 'Panjang KN'];
      
      headers.forEach((header, i) => {
        const x = tableLeft + (i === 0 ? 0 : colWidth.slice(0, i).reduce((a, b) => a + b, 0));
        doc.text(header, x, tableTop, {
          width: colWidth[i],
          align: i === 0 ? 'center' : 'left'
        });
      });

      doc.moveDown(0.3);
      doc.lineWidth(0.5).moveTo(tableLeft, doc.y).lineTo(tableLeft + colWidth.reduce((a, b) => a + b, 0), doc.y).stroke();
      doc.moveDown(0.3);

      // Table Rows
      doc.font('Helvetica').fontSize(9);
      laporanList.forEach((laporan, index) => {
        const rowTop = doc.y;
        
        // Check if we need a new page
        if (rowTop > 700) {
          doc.addPage();
          doc.font('Helvetica').fontSize(9);
          doc.y = 40;
          
          // Redraw headers on new page
          headers.forEach((header, i) => {
            const x = tableLeft + (i === 0 ? 0 : colWidth.slice(0, i).reduce((a, b) => a + b, 0));
            doc.font('Helvetica-Bold').text(header, x, doc.y, {
              width: colWidth[i],
              align: i === 0 ? 'center' : 'left'
            });
          });
          doc.moveDown(0.3);
          doc.lineWidth(0.5).moveTo(tableLeft, doc.y).lineTo(tableLeft + colWidth.reduce((a, b) => a + b, 0), doc.y).stroke();
          doc.moveDown(0.3);
          doc.font('Helvetica');
        }
        
        // Row data
        const rowY = doc.y;
        
        // No
        doc.text((index + 1).toString(), tableLeft, rowY, {
          width: colWidth[0],
          align: 'center'
        });
        
        // Tanggal
        doc.text(new Date(laporan.tanggal).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }), tableLeft + colWidth[0], rowY, {
          width: colWidth[1],
          align: 'left'
        });
        
        // Nama (dipotong jika terlalu panjang)
        const nama = laporan.nama || '-';
        const namaShort = nama.length > 20 ? nama.substring(0, 20) + '...' : nama;
        doc.text(namaShort, tableLeft + colWidth[0] + colWidth[1], rowY, {
          width: colWidth[2],
          align: 'left'
        });
        
        // Ruas Jalan (dipotong jika terlalu panjang)
        const ruas = laporan.ruas_jalan || '-';
        const ruasShort = ruas.length > 25 ? ruas.substring(0, 25) + '...' : ruas;
        doc.text(ruasShort, tableLeft + colWidth[0] + colWidth[1] + colWidth[2], rowY, {
          width: colWidth[3],
          align: 'left'
        });
        
        // Panjang KR
        doc.text(laporan.panjang_kr || '-', 
          tableLeft + colWidth[0] + colWidth[1] + colWidth[2] + colWidth[3], rowY, {
          width: colWidth[4],
          align: 'center'
        });
        
        // Panjang KN
        doc.text(laporan.panjang_kn || '-', 
          tableLeft + colWidth[0] + colWidth[1] + colWidth[2] + colWidth[3] + colWidth[4], rowY, {
          width: colWidth[5],
          align: 'center'
        });
        
        doc.moveDown(0.5);
        doc.lineWidth(0.2).moveTo(tableLeft, doc.y).lineTo(tableLeft + colWidth.reduce((a, b) => a + b, 0), doc.y).stroke();
        doc.moveDown(0.3);
      });

      // Footer
      doc.moveDown(2);
      doc.fontSize(10).font('Helvetica-Oblique').text('Dokumen rekap wilayah dicetak otomatis oleh sistem SIKOPNAS', { align: 'center' });
      doc.text(`Jumlah laporan: ${laporanList.length}`, { align: 'center' });
      doc.text(`Tanggal Cetak: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

const generateWilayahAllPDFs = (wilayahData, periode, laporanList) => {
  return new Promise(async (resolve, reject) => {
    try {
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      let buffers = [];
      archive.on('data', (data) => buffers.push(data));
      archive.on('end', () => {
        const zipData = Buffer.concat(buffers);
        resolve(zipData);
      });
      archive.on('error', reject);

      // Generate rekap PDF
      const rekapPdf = await generateRekapWilayahPDF(wilayahData, periode, laporanList);
      const rekapFilename = `Rekap_Wilayah_${wilayahData.wilayah}_${periode.replace(/[\/\\:]/g, '-')}.pdf`;
      archive.append(rekapPdf, { name: rekapFilename });

      // Generate individual PDFs
      for (let i = 0; i < laporanList.length; i++) {
        const laporan = laporanList[i];
        try {
          const individualPdf = await generateKinerjaPDF(laporan);
          const safeName = (laporan.nama || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
          const dateStr = new Date(laporan.tanggal).toISOString().split('T')[0];
          const filename = `Laporan_${safeName}_${dateStr}.pdf`;
          archive.append(individualPdf, { name: filename });
        } catch (pdfError) {
          console.error(`Error generating PDF for laporan ${laporan.id}:`, pdfError);
          // Continue dengan laporan lainnya
        }
        
        // Small delay to prevent memory overload
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  generateKinerjaPDF,
  generateRekapWilayahPDF,
  generateWilayahAllPDFs
};
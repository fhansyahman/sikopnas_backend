const { app, initializePresensiSystem } = require('./app');
const { testConnection } = require('./config/database');
const cors = require('cors');
const PORT = process.env.PORT || 5000;
// Konfigurasi CORS untuk development
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://192.168.18.19:3000',
    'http://192.168.18.19:5000' // jika frontend akses langsung
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Atau lebih simple untuk development:
app.use(cors({
  origin: true, // izinkan semua origin
  credentials: true
}));

// Atau manual tanpa package cors:
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

async function startServer() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SIKOPNAS BACKEND SERVER - STARTING');
    console.log('='.repeat(60));
    
    // Test database connection
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
      console.log('⚠️  Starting server without database connection...');
      console.log('⚠️  Some features may not work properly');
    } else {
      console.log('✅ Database connection established');
    }

    // Initialize presensi system
    console.log('\n🔄 Initializing system modules...');
    try {
      const presensiInitResult = await initializePresensiSystem();
      if (presensiInitResult.success) {
        console.log('✅ Presensi system initialized successfully');
      } else {
        console.log('⚠️  Presensi system initialization had issues:', presensiInitResult.error);
      }
    } catch (initError) {
      console.log('⚠️  Presensi system initialization failed, but server will continue:', initError.message);
    }

    // Start server
    app.listen(PORT, () => {
      console.log('\n' + '='.repeat(60));
      console.log('🎉 SERVER STARTED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📊 Database: ${dbConnected ? '✅ Connected' : '❌ Disconnected'}`);
      console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`📱 Presensi API: http://localhost:${PORT}/api/presensi`);
      console.log(`👨‍💼 Admin API: http://localhost:${PORT}/api/admin/presensi`);
      console.log(`⏰ Started: ${new Date().toLocaleString('id-ID')}`);
      console.log('='.repeat(60));
      console.log('\n📋 Available Presensi Endpoints:');
      console.log('  POST   /api/presensi/masuk           - Presensi masuk');
      console.log('  POST   /api/presensi/pulang          - Presensi pulang');
      console.log('  GET    /api/presensi/hari-ini        - Cek presensi hari ini');
      console.log('  POST   /api/presensi/generate-hari-ini - Emergency generate (admin)');
      console.log('  GET    /api/presensi/system-status   - Check system status (admin)');
      console.log('='.repeat(60) + '\n');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Load schedules/autoPresensi jika ada
try {
  const autoPresensi = require('./schedules/autoPresensi');
  if (autoPresensi && typeof autoPresensi.initialize === 'function') {
    console.log('🔄 Loading auto presensi schedules...');
    autoPresensi.initialize();
  }
} catch (error) {
  console.log('⚠️  No auto presensi schedules found, using new cron system');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down server gracefully...');
  console.log('👋 Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
  console.log('👋 Goodbye!');
  process.exit(0);
});

// Start the server
startServer();
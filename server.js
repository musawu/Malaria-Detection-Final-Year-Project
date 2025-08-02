// server.js - Enhanced Medical Screening System with MongoDB and separate ModelManager
const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const fsSync = require('fs');
const bcrypt = require('bcrypt');

// Import the ModelManager
const ModelManager = require('./models/ModelManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize ModelManager
const modelManager = new ModelManager();

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medical_screening_app';

// Doctor profiles (in production, this should be in database)
const doctorProfiles = {
  '1': {
    name: 'Dr. Debra Rinyai',
    specialty: 'Infectious Diseases',
    location: 'Nairobi',
    photo: 'https://media.licdn.com/dms/image/v2/D4D03AQHvreljwrWTHA/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1667146142894?e=1756944000&v=beta&t=HCb9MeHFbp1ua5ZFXiroweOhbfXSIGCwGBjv57qiA-o',
    username: 'doctor1'
  },
  '2': {
    name: 'Dr. Sharon Lavin',
    specialty: 'Tropical Medicine',
    location: 'Mombasa',
    photo: 'https://media.licdn.com/dms/image/v2/C4D03AQEN0VHacwo6DQ/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1646507114320?e=1756944000&v=beta&t=Gg51H5SnQ7uN4Kst88Nl8gTVh9TMc1h9aulTarprEPM',
    username: 'doctor2'
  },
  '3': {
    name: 'Dr. Juliet Ndolo',
    specialty: 'Tropical Medicine',
    location: 'Mombasa',
    photo: 'https://media.licdn.com/dms/image/v2/D4D03AQFHMBsr29kbEw/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1713880497242?e=1756944000&v=beta&t=RKRpKW1dP6VTTBPwZBb-d_DRr4hNPi-4r2FIROsLveY',
    username: 'doctor3'
  }
};

// MongoDB Schemas
const patientResultSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  prediction: { type: String, required: true },
  confidence: { type: Number, required: true },
  symptoms: { type: Object, default: null },
  timestamp: { type: Date, default: Date.now },
  date: { type: String },
  time: { type: String }
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  full_name: { type: String },
  role: { type: String, required: true, enum: ['user', 'doctor', 'admin'] },
  doctorId: { type: String }, // For doctor users
  created_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true }
});

const adminLogSchema = new mongoose.Schema({
  admin_username: { type: String, required: true },
  action: { type: String, required: true },
  target_user: { type: String, default: null },
  details: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
});

const doctorAssessmentSchema = new mongoose.Schema({
  doctorId: { type: String, required: true, index: true },
  from: { type: String, required: true },
  prediction: { type: String },
  confidence: { type: Number },
  symptoms: { type: Object },
  riskLevel: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  status: { type: String, enum: ['pending', 'reviewed', 'completed'], default: 'pending' },
  timestamp: { type: Date, default: Date.now }
});

// Create indexes for better performance
patientResultSchema.index({ username: 1, timestamp: -1 });
adminLogSchema.index({ timestamp: -1 });
doctorAssessmentSchema.index({ doctorId: 1, timestamp: -1 });
userSchema.index({ username: 1, role: 1 });

// MongoDB Models
const PatientResult = mongoose.model('PatientResult', patientResultSchema);
const User = mongoose.model('User', userSchema);
const AdminLog = mongoose.model('AdminLog', adminLogSchema);
const DoctorAssessment = mongoose.model('DoctorAssessment', doctorAssessmentSchema);

// Admin logging function
const logAdminAction = async (adminUsername, action, targetUser = null, details = null) => {
  try {
    const log = new AdminLog({
      admin_username: adminUsername,
      action,
      target_user: targetUser,
      details
    });
    await log.save();
    console.log(`📝 Admin action logged: ${action} by ${adminUsername}`);
  } catch (err) {
    console.error('❌ Error logging admin action:', err);
  }
};

// Add this function after your MongoDB connection and before your routes
const createDefaultAdmin = async () => {
  try {
    // Check if any admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    
    if (!existingAdmin) {
      const defaultAdminUsername = 'admin';
      const defaultAdminPassword = 'admin123'; // Change this to a secure password
      
      const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);
      
      const defaultAdmin = new User({
        username: defaultAdminUsername,
        password: hashedPassword,
        full_name: 'System Administrator',
        email: 'admin@medicalsystem.com',
        role: 'admin',
        is_active: true
      });
      
      await defaultAdmin.save();
      
      console.log('🔑 Default admin account created:');
      console.log(`   Username: ${defaultAdminUsername}`);
      console.log(`   Password: ${defaultAdminPassword}`);
      console.log('   ⚠️ IMPORTANT: Change the default password after first login!');
      
      // Log this action
      await logAdminAction(defaultAdminUsername, 'SYSTEM_STARTUP', null, 'Default admin account created');
    } else {
      console.log('✅ Admin account already exists');
    }
  } catch (error) {
    console.error('❌ Error creating default admin:', error);
  }
};

// FIXED: Add this function to create default doctor accounts
const createDefaultDoctors = async () => {
  try {
    console.log('🩺 Checking for doctor accounts...');
    
    // Create doctor accounts based on doctorProfiles
    for (const [doctorId, profile] of Object.entries(doctorProfiles)) {
      const existingDoctor = await User.findOne({ username: profile.username });
      
      if (!existingDoctor) {
        const defaultPassword = profile.username; // Using username as password
        console.log(`🔐 Creating doctor ${profile.username} with password: ${defaultPassword}`);
        
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        console.log(`🔐 Password hashed for ${profile.username}`);
        
        const doctorUser = new User({
          username: profile.username,
          password: hashedPassword,
          full_name: profile.name,
          email: `${profile.username}@medicalsystem.com`,
          role: 'doctor',
          doctorId: doctorId, // Link to doctorProfiles
          is_active: true
        });
        
        await doctorUser.save();
        
        // IMMEDIATE TEST: Verify the password works
        const testResult = await bcrypt.compare(defaultPassword, hashedPassword);
        console.log(`🔐 Password test for ${profile.username}: ${testResult ? 'PASS' : 'FAIL'}`);
        
        console.log(`🩺 Doctor account created: ${profile.username} (${profile.name})`);
        console.log(`   Password: ${defaultPassword}`);
        console.log(`   Doctor ID: ${doctorId}`);
        
        // Log this action
        await logAdminAction('SYSTEM', 'CREATE_DOCTOR_ACCOUNT', profile.username, 
          `Auto-created doctor account for ${profile.name}`);
      } else {
        console.log(`✅ Doctor account already exists: ${profile.username}`);
        
        // VERIFY EXISTING PASSWORD WORKS
        const testPassword = profile.username;
        const passwordWorks = await bcrypt.compare(testPassword, existingDoctor.password);
        console.log(`🔐 Existing password test for ${profile.username}: ${passwordWorks ? 'PASS' : 'FAIL'}`);
        
        if (!passwordWorks) {
          console.log(`🔧 Fixing password for ${profile.username}...`);
          const newHashedPassword = await bcrypt.hash(testPassword, 10);
          await User.findOneAndUpdate(
            { username: profile.username },
            { password: newHashedPassword }
          );
          console.log(`✅ Password fixed for ${profile.username}`);
        }
      }
    }
    console.log('🩺 Doctor account setup completed');
  } catch (error) {
    console.error('❌ Error creating doctor accounts:', error);
  }
};

// Create required directories
const createDirectories = async () => {
  const dirs = ['uploads', 'models', 'public', 'patient_data'];
  for (const dir of dirs) {
    const dirPath = path.join(__dirname, dir);
    if (!fsSync.existsSync(dirPath)) {
      fsSync.mkdirSync(dirPath, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  }
};
createDirectories();

// FIXED: Enhanced savePatientResult function with better error handling
const savePatientResult = async (username, result) => {
  try {
    // Validate required fields
    if (!result.prediction) {
      throw new Error('Prediction is required');
    }

    if (!username) {
      throw new Error('Username is required');
    }

    const now = new Date();
    
    // Validate and sanitize inputs
    const safeConfidence = Number.isFinite(result.confidence) ? result.confidence : 0.8;
    const safePrediction = result.prediction;
    
    // Validate prediction value
    if (safePrediction !== 'Anemic' && safePrediction !== 'Non-anemic') {
      throw new Error(`Invalid prediction value: ${safePrediction}`);
    }

    const patientResult = new PatientResult({
      username,
      prediction: safePrediction,
      confidence: safeConfidence,
      symptoms: result.symptoms || null,
      timestamp: now,
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString()
    });

    const saved = await patientResult.save();
    console.log(`✅ Saved result for patient: ${username} (ID: ${saved._id}, Prediction: ${safePrediction})`);
    return saved;
  } catch (err) {
    console.error('❌ Error saving patient result:', err);
    console.error('❌ Input data was:', { username, result });
    throw err;
  }
};

const getPatientResults = async (username) => {
  try {
    const results = await PatientResult.find({ username })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    return results;
  } catch (err) {
    console.error('❌ Error fetching patient results:', err);
    throw err;
  }
};

const getAllPatientResults = async () => {
  try {
    const results = await PatientResult.find()
      .sort({ timestamp: -1 })
      .lean();
    return results;
  } catch (err) {
    console.error('❌ Error fetching all patient results:', err);
    throw err;
  }
};

const getSystemStats = async () => {
  try {
    const [totalUsersCount, totalTests, anemicCases, todayTests, weeklyTests, userActivity, predictionTrends, monthlyStats] = await Promise.all([
      PatientResult.distinct('username').then(users => users.length),
      PatientResult.countDocuments(),
      PatientResult.countDocuments({ prediction: 'Anemic' }),
      PatientResult.countDocuments({
        timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      }),
      PatientResult.aggregate([
        {
          $match: {
            timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      PatientResult.aggregate([
        {
          $group: {
            _id: "$username",
            tests: { $sum: 1 },
            last_test: { $max: "$timestamp" }
          }
        },
        { $sort: { tests: -1 } },
        { $limit: 10 }
      ]),
      PatientResult.aggregate([
        {
          $group: {
            _id: "$prediction",
            count: { $sum: 1 }
          }
        }
      ]),
      PatientResult.aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$timestamp" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: -1 } },
        { $limit: 12 }
      ])
    ]);

    return {
      totalUsers: [{ count: totalUsersCount }],
      totalTests: [{ count: totalTests }],
      anemicCases: [{ count: anemicCases }],
      todayTests: [{ count: todayTests }],
      weeklyTests: weeklyTests.map(item => ({ date: item._id, count: item.count })),
      userActivity: userActivity.map(item => ({ 
        username: item._id, 
        tests: item.tests, 
        last_test: item.last_test 
      })),
      predictionTrends: predictionTrends.map(item => ({ 
        prediction: item._id, 
        count: item.count 
      })),
      monthlyStats: monthlyStats.map(item => ({ 
        month: item._id, 
        count: item.count 
      }))
    };
  } catch (err) {
    console.error('❌ Error getting system stats:', err);
    throw err;
  }
};

const deletePatientResult = async (username, resultId) => {
  try {
    const result = await PatientResult.findOneAndDelete({ 
      _id: resultId, 
      username: username 
    });
    
    if (!result) {
      throw new Error('Result not found or unauthorized');
    }
    
    console.log(`✅ Deleted result ID: ${resultId} for patient: ${username}`);
    return true;
  } catch (err) {
    console.error('❌ Error deleting patient result:', err);
    throw err;
  }
};

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET || 'anemia-malaria-secret-2024',
  resave: false,
  saveUninitialized: true,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    touchAfter: 24 * 3600 // lazy session update
  }),
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure directory exists before upload
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Add more unique filename to prevent conflicts
    const uniqueName = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    console.log('File upload attempt:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    // Use ModelManager for validation
    const errors = modelManager.validateImageFile(file);
    
    if (errors.length === 0) {
      console.log('✅ File accepted for upload');
      cb(null, true);
    } else {
      console.log('❌ File rejected:', errors.join(', '));
      cb(new Error(errors.join(', ')));
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024, // Increased to 10MB
    files: 1 
  }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.loggedIn) {
    return res.redirect('/login');
  }
  next();
};

const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    if (req.session.role !== role) {
      return res.status(403).send(`
        <h3>Access Denied</h3>
        <p>You don't have permission to access this page.</p>
        <a href="/dashboard">Go to Dashboard</a>
      `);
    }
    next();
  };
};

const requireAdmin = (req, res, next) => {
  if (!req.session.loggedIn) return res.redirect('/login');
  if (req.session.role !== 'admin') {
    return res.status(403).send(`
      <h3>Access Denied</h3>
      <p>Administrator access required.</p>
      <a href="/dashboard">Go to Dashboard</a>
    `);
  }
  next();
};

// DEBUG ROUTES - Add these temporarily to diagnose password issues
app.get('/debug/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username role doctorId full_name is_active').lean();
    res.json({
      totalUsers: users.length,
      users: users
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).lean();
    if (user) {
      res.json({
        username: user.username,
        role: user.role,
        doctorId: user.doctorId,
        hasPassword: !!user.password,
        passwordHashLength: user.password ? user.password.length : 0,
        is_active: user.is_active
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Password debug route
app.get('/debug/password/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).lean();
    
    if (!user) {
      return res.json({ error: 'User not found' });
    }

    // Test password comparison with expected password
    const expectedPassword = username; // Since you're using username as password
    const manualTest = await bcrypt.compare(expectedPassword, user.password);
    
    // Also test with some other common passwords
    const testPasswords = [username, 'doctor1', 'doctor2', 'doctor3', 'admin123'];
    const testResults = {};
    
    for (const testPass of testPasswords) {
      testResults[testPass] = await bcrypt.compare(testPass, user.password);
    }
    
    res.json({
      username: user.username,
      role: user.role,
      doctorId: user.doctorId,
      passwordHashExists: !!user.password,
      passwordHashLength: user.password ? user.password.length : 0,
      passwordHashPreview: user.password ? user.password.substring(0, 10) + '...' : null,
      expectedPassword: expectedPassword,
      manualPasswordTest: manualTest,
      testResults: testResults,
      created_at: user.created_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual doctor recreation route
app.post('/debug/recreate-doctor/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Find the doctor profile
    const doctorProfile = Object.entries(doctorProfiles).find(([id, profile]) => 
      profile.username === username
    );
    
    if (!doctorProfile) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }
    
    const [doctorId, profile] = doctorProfile;
    
    // Delete existing user
    await User.findOneAndDelete({ username });
    
    // Create new user with fresh password hash
    const password = username; // Using username as password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const doctorUser = new User({
      username: profile.username,
      password: hashedPassword,
      full_name: profile.name,
      email: `${profile.username}@medicalsystem.com`,
      role: 'doctor',
      doctorId: doctorId,
      is_active: true
    });
    
    await doctorUser.save();
    
    // Test the new password immediately
    const testResult = await bcrypt.compare(password, hashedPassword);
    
    res.json({
      message: `Doctor ${username} recreated successfully`,
      password: password,
      passwordTest: testResult,
      doctorId: doctorId
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/login', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/dashboard');
  }

  const { prefill, username, password, loginType } = req.query;

  // You'll inject these values into your HTML using a templating engine or by client-side script
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.post('/signup', async (req, res) => {
  const { username, password, full_name, role } = req.body;

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.redirect('/signup?error=User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
      full_name,
      role,
      is_active: true
    });

    await newUser.save();

    // Redirect to login with username and password prefilled (not secure for production)
    res.redirect(`/login?prefill=true&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&loginType=${role}`);
  } catch (error) {
    console.error('Signup error:', error);
    res.redirect('/signup?error=Signup failed');
  }
});

// ENHANCED LOGIN ROUTE with better debugging
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  console.log('🔐 Login attempt:', { username, passwordLength: password?.length });

  try {
    const user = await User.findOne({ username });
    console.log('👤 User lookup result:', { 
      found: !!user, 
      role: user?.role, 
      doctorId: user?.doctorId,
      is_active: user?.is_active 
    });

    if (!user) {
      console.log('❌ User not found in database');
      return res.redirect('/login?error=Invalid username or password');
    }

    if (!user.is_active) {
      console.log('❌ User account is inactive');
      return res.redirect('/login?error=Account is inactive');
    }

    console.log('🔐 Attempting password comparison...');
    console.log('🔐 Input password:', password);
    console.log('🔐 Stored hash length:', user.password?.length);
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log('🔐 Password match result:', passwordMatch);
    
    if (!passwordMatch) {
      console.log('❌ Password comparison failed');
      console.log('🔍 Debug: Testing common passwords...');
      
      // Test common passwords for debugging
      const testPasswords = [username, 'doctor1', 'doctor2', 'doctor3', 'admin123'];
      for (const testPass of testPasswords) {
        const testResult = await bcrypt.compare(testPass, user.password);
        console.log(`🔍 Test password '${testPass}': ${testResult}`);
      }
      
      return res.redirect('/login?error=Invalid username or password');
    }

    // ✅ Credentials are valid
    req.session.loggedIn = true;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.doctorId = user.doctorId;

    console.log(`✅ User logged in successfully:`, {
      username: user.username,
      role: user.role,
      doctorId: user.doctorId
    });

    return res.redirect('/dashboard');
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.redirect('/login?error=Login failed');
  }
});

// FIXED: Add the missing API endpoint for current user info
app.get('/api/current-user', requireAuth, (req, res) => {
  try {
    res.json({
      username: req.session.username,
      role: req.session.role,
      doctorId: req.session.doctorId,
      loggedIn: req.session.loggedIn
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

app.get('/dashboard', requireAuth, (req, res) => {
  // Redirect based on role
  if (req.session.role === 'doctor') {
    return res.redirect(`/doctor/${req.session.doctorId}`);
  }
  
  if (req.session.role === 'admin') {
    return res.redirect('/admin');
  }
  
  // For regular users
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Admin Dashboard Route - Now serves HTML file
app.get('/admin', requireAdmin, async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// API endpoint to get dashboard data
app.get('/api/admin/dashboard-data', requireAdmin, async (req, res) => {
  try {
    const stats = await getSystemStats();
    const allResults = await getAllPatientResults();
    const allAssessments = await DoctorAssessment.find()
      .sort({ timestamp: -1 })
      .lean();
    const allUsers = await User.find({}, '-password')
      .sort({ created_at: -1 })
      .lean();

    // Add doctor names to assessments
    const assessmentsWithDoctors = allAssessments.map(assessment => ({
      ...assessment,
      doctorName: doctorProfiles[assessment.doctorId]?.name || 'Unknown Doctor'
    }));

    // Calculate summary statistics
    const totalUsers = await User.countDocuments({ role: { $ne: 'admin' } });
    const totalTests = await PatientResult.countDocuments();
    const anemicCases = await PatientResult.countDocuments({ prediction: 'Anemic' });
    const todayTests = await PatientResult.countDocuments({
      timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    const totalAssessments = allAssessments.length;

    const dashboardData = {
      stats: {
        totalUsers,
        totalTests,
        anemicCases,
        todayTests,
        totalAssessments,
        weeklyTests: stats.weeklyTests || [],
        monthlyStats: stats.monthlyStats || []
      },
      patientResults: allResults.slice(0, 50), // Limit to 50 most recent
      doctorAssessments: assessmentsWithDoctors.slice(0, 50),
      users: allUsers
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// API endpoint to get all users (for admin)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password')
      .sort({ created_at: -1 })
      .lean();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// API endpoint to get all patient results (for admin)
app.get('/api/admin/patient-results', requireAdmin, async (req, res) => {
  try {
    const results = await getAllPatientResults();
    res.json(results);
  } catch (error) {
    console.error('Error fetching patient results:', error);
    res.status(500).json({ error: 'Failed to fetch patient results' });
  }
});

// API endpoint to get all doctor assessments (for admin)
app.get('/api/admin/doctor-assessments', requireAdmin, async (req, res) => {
  try {
    const assessments = await DoctorAssessment.find()
      .sort({ timestamp: -1 })
      .lean();
    
    // Add doctor names
    const assessmentsWithDoctors = assessments.map(assessment => ({
      ...assessment,
      doctorName: doctorProfiles[assessment.doctorId]?.name || 'Unknown Doctor'
    }));
    
    res.json(assessmentsWithDoctors);
  } catch (error) {
    console.error('Error fetching doctor assessments:', error);
    res.status(500).json({ error: 'Failed to fetch doctor assessments' });
  }
});

// User API endpoints
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, email, password, fullName, role, doctorId } = req.body;

    // Validation
    if (!username || !password || !fullName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username, password, and full name are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username must be at least 3 characters long' 
      });
    }

    // Validate role
    const validRoles = ['user', 'doctor', 'admin'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid role. Must be one of: user, doctor, admin' 
      });
    }

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        error: 'Username already exists' 
      });
    }

    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        return res.status(409).json({ 
          success: false, 
          error: 'Email already registered' 
        });
      }
    }

    // Validate doctorId if creating a doctor account
    if (role === 'doctor' && doctorId && !doctorProfiles[doctorId]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid doctor ID' 
      });
    }

    // Hash password before creating user
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      username,
      email: email || null,
      password: hashedPassword, // Store hashed password
      full_name: fullName,
      role: role || 'user',
      doctorId: role === 'doctor' ? doctorId : null,
      created_at: new Date(),
      is_active: true
    });

    await newUser.save();

    console.log(`✅ New user created via API: ${username} (${fullName}) with role: ${role || 'user'}`);

    // Log admin action
    await logAdminAction(req.session.username, 'CREATE_USER_API', username, 
      `Created new ${role || 'user'} account for ${fullName}${email ? ` (${email})` : ''}`);

    // Return success response
    res.status(201).json({
      success: true,
      message: 'User account created successfully',
      user: {
        username: newUser.username,
        full_name: newUser.full_name,
        email: newUser.email,
        role: newUser.role,
        doctorId: newUser.doctorId,
        created_at: newUser.created_at,
        is_active: newUser.is_active
      }
    });

  } catch (error) {
    console.error('❌ Error creating user via API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create user account' 
    });
  }
});

// API endpoint to update user (for admin)
app.put('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const updateData = req.body;
    
    // Remove sensitive fields that shouldn't be updated this way
    delete updateData.password;
    delete updateData._id;
    
    const updatedUser = await User.findOneAndUpdate(
      { username },
      updateData,
      { new: true, select: '-password' }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await logAdminAction(req.session.username, 'UPDATE_USER', username, 
      `Updated user information`);
    
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// API endpoint to delete user (for admin)
app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    
    // Prevent deleting admin users
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin users' });
    }
    
    await User.findOneAndDelete({ username });
    
    await logAdminAction(req.session.username, 'DELETE_USER', username, 
      `Deleted user account`);
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// API endpoint to suspend/activate user (for admin)
app.post('/api/admin/users/:username/toggle-status', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Prevent suspending admin users
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot suspend admin users' });
    }
    
    user.is_active = !user.is_active;
    await user.save();
    
    await logAdminAction(req.session.username, 
      user.is_active ? 'ACTIVATE_USER' : 'SUSPEND_USER', 
      username, 
      `${user.is_active ? 'Activated' : 'Suspended'} user account`);
    
    res.json({ 
      success: true, 
      message: `User ${user.is_active ? 'activated' : 'suspended'} successfully`,
      user: { username: user.username, is_active: user.is_active }
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// API endpoint to reset user password (for admin)
app.post('/api/admin/users/:username/reset-password', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    user.password = hashedPassword;
    await user.save();
    
    await logAdminAction(req.session.username, 'RESET_PASSWORD', username, 
      'Password reset by admin');
    
    res.json({ 
      success: true, 
      message: 'Password reset successfully',
      tempPassword: tempPassword // In production, send this via email instead
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// API endpoint to get admin logs
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    const logs = await AdminLog.find()
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    res.json(logs);
  } catch (error) {
    console.error('Error fetching admin logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// User routes (protected)
app.get('/symptoms', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'symptom-checker.html'));
});

app.get('/send-assessment', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'send-assessment.html'));
});

app.get('/history', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patient-history.html'));
});

// FIXED: Prediction endpoint with better error handling for missing predictions
app.post('/predict', requireAuth, upload.single('eyelid'), async (req, res) => {
  console.log('Prediction request received from user:', req.session.username);
  
  if (!req.file) {
      return res.status(400).json({ 
          error: 'No file uploaded',
          code: 'NO_FILE'
      });
  }

  try {
      // Verify file exists
      if (!fsSync.existsSync(req.file.path)) {
          throw new Error('File not found after upload');
      }

      console.log('Processing image for prediction...');
      
      // Get prediction from ModelManager
      const result = await modelManager.predict(req.file.path);
      
      console.log('Raw prediction result:', result);
      
      // Ensure we have a valid prediction
      let finalPrediction = result.prediction;
      let finalConfidence = result.confidence || 0.8;
      
      // Handle case where prediction might be missing or invalid
      if (!finalPrediction || (finalPrediction !== 'Anemic' && finalPrediction !== 'Non-anemic')) {
          console.log('⚠️ Invalid or missing prediction, using default');
          finalPrediction = 'Non-anemic'; // Default safe prediction
          finalConfidence = 0.6; // Lower confidence for default
      }
      
      console.log('Final prediction details:', {
          prediction: finalPrediction,
          confidence: finalConfidence,
          usingDefault: result.usingDefaultPrediction
      });

      // Save to database with proper validation
      const savedResult = await savePatientResult(req.session.username, {
          prediction: finalPrediction,
          confidence: finalConfidence,
          // Add symptoms if they exist in the request
          symptoms: req.body.symptoms || null
      });

      console.log('✅ Successfully saved prediction result:', savedResult._id);

      // Clean up uploaded file
      fsSync.unlinkSync(req.file.path);

      // Return results
      res.json({
          success: true,
          prediction: finalPrediction,
          confidence: finalConfidence,
          confidencePercentage: Math.round(finalConfidence * 100),
          usingDefaultPrediction: result.usingDefaultPrediction || false
      });

  } catch (error) {
      console.error('❌ Prediction failed:', error);
      
      // Clean up file if exists
      if (req.file?.path && fsSync.existsSync(req.file.path)) {
          try {
              fsSync.unlinkSync(req.file.path);
          } catch (cleanupError) {
              console.error('Failed to cleanup file:', cleanupError);
          }
      }
      
      res.status(500).json({
          error: 'Prediction failed',
          details: error.message
      });
  }
});

// FIXED: Send assessment to doctor with better error handling
app.post('/api/sendToDoctor', requireAuth, async (req, res) => {
  const { doctorId, assessmentData } = req.body;
  
  console.log('Send to doctor request:', {
    from: req.session.username,
    doctorId,
    assessmentData
  });
  
  if (!doctorId || !assessmentData) {
    return res.status(400).json({ error: 'Missing required data.' });
  }

  // Validate doctor exists
  if (!doctorProfiles[doctorId]) {
    return res.status(400).json({ error: 'Invalid doctor selected.' });
  }

  try {
    // Ensure we have a valid prediction
    let prediction = assessmentData.prediction;
    if (!prediction || (prediction !== 'Anemic' && prediction !== 'Non-anemic')) {
      prediction = 'Non-anemic'; // Default safe prediction
      console.log('⚠️ Using default prediction for assessment');
    }

    // Save assessment to MongoDB
    const assessment = new DoctorAssessment({
      doctorId,
      from: req.session.username,
      prediction: prediction,
      confidence: assessmentData.confidence || 0.8,
      symptoms: assessmentData.symptoms || {},
      riskLevel: assessmentData.riskLevel || 'Medium',
      status: 'pending'
    });

    const savedAssessment = await assessment.save();
    console.log('✅ Assessment saved:', savedAssessment._id);

    // Also save this to patient's history with symptoms
    const resultWithSymptoms = {
      prediction: prediction,
      confidence: assessmentData.confidence || 0.8,
      symptoms: assessmentData.symptoms || {}
    };
    
    const savedResult = await savePatientResult(req.session.username, resultWithSymptoms);
    console.log('✅ Patient result saved:', savedResult._id);

    console.log(`✅ Assessment sent to doctor ${doctorId} from user ${req.session.username}`);
    res.json({ 
      success: true, 
      message: `Assessment sent to ${doctorProfiles[doctorId].name} successfully.`,
      assessmentId: savedAssessment._id
    });
  } catch (error) {
    console.error('❌ Error saving assessment:', error);
    res.status(500).json({ 
      error: 'Failed to send assessment to doctor',
      details: error.message 
    });
  }
});

// FIXED: Update the existing getDoctorAssessments endpoint
app.get('/api/getDoctorAssessments', requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.query;
    
    // Verify doctor access - only doctors can access assessments
    if (req.session.role !== 'doctor') {
      return res.status(403).json({ error: 'Access denied - doctors only' });
    }
    
    // Verify doctor is accessing their own assessments
    if (req.session.doctorId !== doctorId) {
      return res.status(403).json({ error: 'Access denied - can only view your own assessments' });
    }
    
    console.log(`🔍 Fetching assessments for doctor ${doctorId} (${req.session.username})`);
    
    const assessments = await DoctorAssessment.find({ doctorId })
      .sort({ timestamp: -1 })
      .lean();
    
    console.log(`✅ Found ${assessments.length} assessments for doctor ${doctorId}`);
    
    res.json(assessments);
  } catch (error) {
    console.error('Error fetching doctor assessments:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// API endpoint to get patient history
app.get('/api/patient-history', requireAuth, async (req, res) => {
  try {
    const results = await getPatientResults(req.session.username);
    res.json(results);
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ error: 'Failed to fetch patient history' });
  }
});

// Get patient statistics summary
app.get('/api/patient-stats', requireAuth, async (req, res) => {
  try {
    const results = await getPatientResults(req.session.username);
    
    if (results.length === 0) {
      return res.json({
        totalTests: 0,
        anemicResults: 0,
        normalResults: 0,
        avgConfidence: 0,
        thisWeekTests: 0,
        lastTest: null,
        trend: 'stable'
      });
    }

    // Calculate statistics
    const totalTests = results.length;
    const anemicResults = results.filter(r => r.prediction === 'Anemic').length;
    const normalResults = results.filter(r => r.prediction === 'Non-anemic').length;
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / totalTests;

    // This week's tests
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const thisWeekTests = results.filter(r => 
      new Date(r.timestamp) > weekAgo
    ).length;

    // Last test
    const lastTest = results[0];

    // Calculate trend (compare last 3 vs previous 3)
    let trend = 'stable';
    if (results.length >= 6) {
      const recent3 = results.slice(0, 3);
      const previous3 = results.slice(3, 6);
      const recentAvg = recent3.reduce((sum, r) => sum + r.confidence, 0) / 3;
      const previousAvg = previous3.reduce((sum, r) => sum + r.confidence, 0) / 3;
      
      if (recentAvg > previousAvg + 0.1) trend = 'improving';
      else if (recentAvg < previousAvg - 0.1) trend = 'declining';
    }

    res.json({
      totalTests,
      anemicResults,
      normalResults,
      avgConfidence: Math.round(avgConfidence * 100),
      thisWeekTests,
      lastTest,
      trend
    });
  } catch (error) {
    console.error('Error fetching patient stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// API endpoint to get available doctors (for patient interface)
app.get('/api/doctors', requireAuth, (req, res) => {
  try {
    // Return only the information needed for patient interface
    const availableDoctors = {};
    
    Object.entries(doctorProfiles).forEach(([id, doctor]) => {
      availableDoctors[id] = {
        name: doctor.name,
        specialty: doctor.specialty,
        location: doctor.location,
        photo: doctor.photo,
        username: doctor.username
      };
    });
    
    res.json(availableDoctors);
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// FIXED: Add a test endpoint to verify doctor dashboard functionality
app.get('/api/test-doctor-data/:doctorId', requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params;
    
    // Get doctor profile
    const doctorProfile = doctorProfiles[doctorId];
    if (!doctorProfile) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Get assessments
    const assessments = await DoctorAssessment.find({ doctorId })
      .sort({ timestamp: -1 })
      .lean();

    // Calculate stats
    const stats = {
      total: assessments.length,
      pending: assessments.filter(a => a.status === 'pending').length,
      highRisk: assessments.filter(a => a.riskLevel === 'High').length,
      today: assessments.filter(a => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(a.timestamp) >= today;
      }).length
    };

    res.json({
      doctor: doctorProfile,
      assessments: assessments.slice(0, 5), // First 5 for testing
      stats
    });
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Doctor dashboard
app.get('/doctor/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  
  // Check if user is a doctor
  if (req.session.role !== 'doctor') {
    return res.status(403).send(`
      <h3>Access Denied</h3>
      <p>Only doctors can access this page.</p>
      <a href="/dashboard">Go to Dashboard</a>
    `);
  }

  // Check if doctor is accessing their own dashboard
  if (req.session.doctorId !== id) {
    return res.status(403).send(`
      <h3>Access Denied</h3>
      <p>You can only access your own dashboard.</p>
      <a href="/doctor/${req.session.doctorId}">Go to Your Dashboard</a>
    `);
  }

  // Get doctor profile
  const doctor = doctorProfiles[id];
  if (!doctor) {
    return res.status(404).send('<h3>Doctor not found</h3>');
  }

  try {
    // Get assessments for this doctor from MongoDB
    const assessments = await DoctorAssessment.find({ doctorId: id })
      .sort({ timestamp: -1 })
      .lean();
    
    // Generate HTML for doctor dashboard (same as original)
    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Doctor Dashboard - ${doctor.name}</title>
        <style>
          body {
            font-family: 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #e8f5e8, #f0f9f0);
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.1);
            padding: 30px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e0e0e0;
          }
          .doctor-info {
            display: flex;
            align-items: center;
            gap: 20px;
          }
          .doctor-info img {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            border: 3px solid #4caf50;
          }
          .doctor-details h1 {
            color: #2e7d32;
            margin: 0;
            font-size: 1.8em;
          }
          .doctor-details p {
            color: #666;
            margin: 5px 0;
          }
          .logout-btn {
            background: #d32f2f;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            text-decoration: none;
            font-weight: bold;
          }
          .logout-btn:hover {
            background: #b71c1c;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .stat-card {
            background: #f0f9f0;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            border: 2px solid #e8f5e8;
          }
          .stat-card h3 {
            color: #2e7d32;
            margin: 0 0 10px 0;
            font-size: 2em;
          }
          .stat-card p {
            color: #666;
            margin: 0;
          }
          .assessment-card {
            background: #f9f9f9;
            border: 1px solid #e0e0e0;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            transition: transform 0.2s ease;
          }
          .assessment-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
          }
          .assessment-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          .assessment-meta {
            color: #666;
            font-size: 0.9em;
          }
          .risk-badge {
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 0.8em;
          }
          .risk-high {
            background: #ffebee;
            color: #d32f2f;
          }
          .risk-medium {
            background: #fff3e0;
            color: #f57c00;
          }
          .risk-low {
            background: #e8f5e8;
            color: #2e7d32;
          }
          .symptoms-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-top: 10px;
          }
          .symptom-item {
            background: #f0f9f0;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 0.9em;
            text-align: center;
          }
          .symptom-yes {
            background: #ffebee;
            color: #d32f2f;
          }
          .symptom-no {
            background: #e8f5e8;
            color: #2e7d32;
          }
          .no-assessments {
            text-align: center;
            color: #666;
            font-style: italic;
            padding: 40px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="doctor-info">
              <img src="${doctor.photo}" alt="${doctor.name}">
              <div class="doctor-details">
                <h1>${doctor.name}</h1>
                <p><strong>Specialty:</strong> ${doctor.specialty}</p>
                <p><strong>Location:</strong> ${doctor.location}</p>
              </div>
            </div>
            <form action="/logout" method="POST" style="display: inline;">
              <button type="submit" class="logout-btn">Logout</button>
            </form>
          </div>

          <div class="stats">
            <div class="stat-card">
              <h3>${assessments.length}</h3>
              <p>Total Assessments</p>
            </div>
            <div class="stat-card">
              <h3>${assessments.filter(a => a.status === 'pending').length}</h3>
              <p>Pending Reviews</p>
            </div>
            <div class="stat-card">
              <h3>${assessments.filter(a => a.riskLevel === 'High').length}</h3>
              <p>High Risk Cases</p>
            </div>
          </div>

          <h2>Patient Assessments</h2>
    `;

    if (assessments.length === 0) {
      html += '<div class="no-assessments">No assessments received yet.</div>';
    } else {
      assessments.forEach((assessment, index) => {
        const date = new Date(assessment.timestamp).toLocaleString();
        const riskClass = assessment.riskLevel ? 
          `risk-${assessment.riskLevel.toLowerCase()}` : 'risk-medium';
        
        html += `
          <div class="assessment-card">
            <div class="assessment-header">
              <div class="assessment-meta">
                <strong>From:</strong> ${assessment.from} | 
                <strong>Received:</strong> ${date}
              </div>
              <div class="risk-badge ${riskClass}">
                ${assessment.riskLevel || 'Medium'} Risk
              </div>
            </div>
            
            <div><strong>Prediction:</strong> ${assessment.prediction || 'N/A'}</div>
            
            ${assessment.symptoms ? `
              <div style="margin-top: 15px;">
                <strong>Symptoms:</strong>
                <div class="symptoms-grid">
                  ${Object.entries(assessment.symptoms).map(([symptom, value]) => 
                    `<div class="symptom-item symptom-${value}">${symptom}: ${value}</div>`
                  ).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      });
    }

    html += `
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Error loading doctor dashboard:', error);
    res.status(500).send('Error loading doctor dashboard');
  }
});

// Logout route
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login');
  });
});

// Health check endpoint - NOW INCLUDES ModelManager status
app.get('/health', (req, res) => {
  const modelStatus = modelManager.getModelStatus();
  
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    databaseConnected: mongoose.connection.readyState === 1,
    uploadsDirectory: fsSync.existsSync(path.join(__dirname, 'uploads')),
    modelsDirectory: fsSync.existsSync(path.join(__dirname, 'models')),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    modelManager: modelStatus
  };

  res.json(health);
});

// Model status endpoint
app.get('/api/model-status', (req, res) => {
  const status = modelManager.getModelStatus();
  res.json(status);
});

// FIXED: Updated startServer function to remove deprecated MongoDB options
async function startServer() {
  try {
    console.log('🚀 Initializing Medical Screening System...');
    
    // Wait for MongoDB connection (without deprecated options)
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB database');
    
    // Create default accounts and WAIT for completion
    await createDefaultAdmin();
    await createDefaultDoctors();
    console.log('✅ Default accounts setup completed');
    
    // Initialize ModelManager
    const modelStatus = await modelManager.initialize();
    console.log('📊 ModelManager Status:', modelStatus);
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Medical Screening System is ready!`);
      console.log(`🌐 Access the application at: http://localhost:${PORT}`);
      console.log(`🤖 Model Status: ${modelStatus.isLoaded ? 'Loaded' : 'Using Default Predictions'}`);
      console.log('');
      console.log('🔐 Default Login Credentials:');
      console.log('   Admin: admin / admin123');
      console.log('   Doctor 1: doctor1 / doctor1');
      console.log('   Doctor 2: doctor2 / doctor2');  
      console.log('   Doctor 3: doctor3 / doctor3');
      console.log('');
      console.log('🔍 Debug Routes Available:');
      console.log('   GET  /debug/users - List all users');
      console.log('   GET  /debug/user/:username - Check specific user');
      console.log('   GET  /debug/password/:username - Test password for user');
      console.log('   POST /debug/recreate-doctor/:username - Recreate doctor with fresh password');
      console.log('   GET  /api/test-doctor-data/:doctorId - Test doctor dashboard data');
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
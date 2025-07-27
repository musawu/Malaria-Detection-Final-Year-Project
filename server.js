// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const ort = require('onnxruntime-web');
const sharp = require('sharp');
const fs = require('fs').promises;
const fsSync = require('fs');
const sqlite3 = require('sqlite3').verbose();
const ortTensor = ort.Tensor;

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite Database Setup
const db = new sqlite3.Database('./medical_app.db', (err) => {
  if (err) {
    console.error('❌ Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
    
    // Create the patient_results table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS patient_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      prediction TEXT NOT NULL,
      confidence REAL NOT NULL,
      symptoms TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      date TEXT,
      time TEXT
    )`, (err) => {
      if (err) {
        console.error('❌ Error creating table:', err);
      } else {
        console.log('✅ Patient results table ready');
      }
    });
  }
});

// In-memory storage for assessments
const doctorAssessments = {};

// Doctor profiles (in a real app, this would be in a database)
const doctorProfiles = {
  '1': {
    name: 'Dr. Alice Mwangi',
    specialty: 'Infectious Diseases',
    location: 'Nairobi',
    photo: 'https://randomuser.me/api/portraits/women/44.jpg',
    username: 'doctor1'
  },
  '2': {
    name: 'Dr. Grace Njeri',
    specialty: 'Tropical Medicine',
    location: 'Mombasa',
    photo: 'https://randomuser.me/api/portraits/women/46.jpg',
    username: 'doctor2'
  }
};

// Create data directory for storing patient results (backup)
const DATA_DIR = '/tmp/patient_data';
const ensureDataDir = async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
};
ensureDataDir();

// Ensure required directories - Use /tmp for Vercel compatibility
['uploads', 'models'].forEach(dir => {
  const dirPath = `/tmp/${dir}`;
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
});

// Updated helper functions for SQLite database management
const savePatientResult = async (username, result) => {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toLocaleDateString();
    const time = now.toLocaleTimeString();
    
    // Convert symptoms object to JSON string if it exists
    const symptomsJson = result.symptoms ? JSON.stringify(result.symptoms) : null;
    
    const query = `INSERT INTO patient_results 
                   (username, prediction, confidence, symptoms, timestamp, date, time) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(query, [
      username, 
      result.prediction, 
      result.confidence, 
      symptomsJson, 
      timestamp, 
      date, 
      time
    ], function(err) {
      if (err) {
        console.error('❌ Error saving patient result:', err);
        reject(err);
      } else {
        console.log(`✅ Saved result for patient: ${username} (ID: ${this.lastID})`);
        resolve({
          id: this.lastID,
          username,
          prediction: result.prediction,
          confidence: result.confidence,
          symptoms: result.symptoms,
          timestamp,
          date,
          time
        });
      }
    });
  });
};

const getPatientResults = async (username) => {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM patient_results 
                   WHERE username = ? 
                   ORDER BY timestamp DESC 
                   LIMIT 50`;
    
    db.all(query, [username], (err, rows) => {
      if (err) {
        console.error('❌ Error fetching patient results:', err);
        reject(err);
      } else {
        // Parse symptoms JSON back to object
        const results = rows.map(row => ({
          ...row,
          symptoms: row.symptoms ? JSON.parse(row.symptoms) : null
        }));
        resolve(results);
      }
    });
  });
};

const deletePatientResult = async (username, resultId) => {
  return new Promise((resolve, reject) => {
    const query = `DELETE FROM patient_results 
                   WHERE id = ? AND username = ?`;
    
    db.run(query, [resultId, username], function(err) {
      if (err) {
        console.error('❌ Error deleting patient result:', err);
        reject(err);
      } else if (this.changes === 0) {
        reject(new Error('Result not found or unauthorized'));
      } else {
        console.log(`✅ Deleted result ID: ${resultId} for patient: ${username}`);
        resolve(true);
      }
    });
  });
};

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'anemia-malaria-secret-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Multer setup - Updated to use /tmp directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp/uploads/'),
  filename: (req, file, cb) =>
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    mimetype && extname ? cb(null, true) : cb(new Error('Only image files allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

// Load ONNX model - Updated path for Vercel
let sessionONNX;
const modelPath = path.join(__dirname, 'models', 'eyelid_anemia_model.onnx');
const tmpModelPath = '/tmp/models/eyelid_anemia_model.onnx';

async function loadModel() {
  // Try to load from the original location first
  if (fsSync.existsSync(modelPath)) {
    sessionONNX = await ort.InferenceSession.create(modelPath);
    console.log('✅ Model loaded from original path');
  } else if (fsSync.existsSync(tmpModelPath)) {
    sessionONNX = await ort.InferenceSession.create(tmpModelPath);
    console.log('✅ Model loaded from tmp path');
  } else {
    console.warn('⚠️ Model not found in either location');
  }
}
loadModel();

// Middleware
const requireAuth = (req, res, next) => {
  if (!req.session.loggedIn) return res.redirect('/login');
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

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/login', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password, loginType } = req.body;

  // Define valid users with their credentials and roles
  const validUsers = {
    // Regular users
    user: { password: 'pass', role: 'user' },
    admin: { password: 'admin123', role: 'admin' },
    
    // Doctors
    doctor1: { password: 'medical456', role: 'doctor', doctorId: '1' },
    doctor2: { password: 'grace2024', role: 'doctor', doctorId: '2' }
  };

  const user = validUsers[username];
  
  // Validate credentials
  if (!user || user.password !== password) {
    return res.redirect('/login?error=Invalid username or password');
  }

  // Validate role matches login type
  if (loginType && loginType === 'doctor' && user.role !== 'doctor') {
    return res.redirect('/login?error=Invalid doctor credentials');
  }
  
  if (loginType && loginType === 'user' && user.role === 'doctor') {
    return res.redirect('/login?error=Please use doctor login for doctor accounts');
  }

  // Set session data
  req.session.loggedIn = true;
  req.session.username = username;
  req.session.role = user.role;
  
  if (user.role === 'doctor') {
    req.session.doctorId = user.doctorId;
  }

  console.log(`User ${username} logged in as ${user.role}`);
  res.redirect('/dashboard');
});

app.get('/dashboard', requireAuth, (req, res) => {
  // Redirect doctors to their specific dashboard
  if (req.session.role === 'doctor') {
    return res.redirect(`/doctor/${req.session.doctorId}`);
  }
  
  // For regular users and admins
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// User routes (protected)
app.get('/symptoms', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'symptom-checker.html'));
});

app.get('/send-assessment', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'send-assessment.html'));
});

// New route for patient history page
app.get('/history', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patient-history.html'));
});

// Prediction endpoint (for users)
app.post('/predict', requireAuth, upload.single('eyelid'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    let prediction = 'Anemic';
    let confidence = 0.8;

    if (sessionONNX) {
      const inputTensor = await preprocessImage(req.file.path);
      const feeds = { [sessionONNX.inputNames[0]]: inputTensor };
      const results = await sessionONNX.run(feeds);
      confidence = results[sessionONNX.outputNames[0]].data[0];
      prediction = confidence > 0.5 ? 'Non-anemic' : 'Anemic';
    }

    // Save result to SQLite database
    const resultData = { prediction, confidence };
    await savePatientResult(req.session.username, resultData);

    req.session.lastPrediction = resultData;
    res.json({ 
      prediction, 
      confidence, 
      redirectTo: prediction === 'Anemic' ? '/symptoms' : null 
    });
  } catch (err) {
    console.error('Prediction error:', err);
    res.status(500).json({ error: 'Prediction failed.' });
  }
});

// Send assessment to doctor (updated to include symptoms)
app.post('/api/sendToDoctor', requireAuth, async (req, res) => {
  const { doctorId, assessmentData } = req.body;
  
  if (!doctorId || !assessmentData) {
    return res.status(400).json({ error: 'Missing required data.' });
  }

  // Validate doctor exists
  if (!doctorProfiles[doctorId]) {
    return res.status(400).json({ error: 'Invalid doctor selected.' });
  }

  // Initialize doctor's assessment array if it doesn't exist
  if (!doctorAssessments[doctorId]) {
    doctorAssessments[doctorId] = [];
  }

  // Add assessment to doctor's queue
  const assessment = {
    id: Date.now().toString(),
    from: req.session.username,
    timestamp: new Date().toISOString(),
    status: 'pending',
    ...assessmentData
  };

  doctorAssessments[doctorId].push(assessment);

  // Also save this to patient's history with symptoms in SQLite
  try {
    const resultWithSymptoms = {
      prediction: assessmentData.prediction,
      confidence: assessmentData.confidence || 0.8,
      symptoms: assessmentData.symptoms
    };
    await savePatientResult(req.session.username, resultWithSymptoms);
  } catch (error) {
    console.error('Error saving assessment to patient history:', error);
  }

  console.log(`Assessment sent to doctor ${doctorId} from user ${req.session.username}`);
  res.json({ 
    success: true, 
    message: `Assessment sent to ${doctorProfiles[doctorId].name} successfully.` 
  });
});

// API endpoint to get patient history from SQLite
app.get('/api/patient-history', requireAuth, async (req, res) => {
  try {
    const results = await getPatientResults(req.session.username);
    res.json(results);
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ error: 'Failed to fetch patient history' });
  }
});

// Get patient statistics summary from SQLite
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

// Export patient data (CSV format) from SQLite
app.get('/api/export-data', requireAuth, async (req, res) => {
  try {
    const results = await getPatientResults(req.session.username);
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'No data to export' });
    }

    // Create CSV content
    let csvContent = 'Date,Time,Prediction,Confidence,Symptoms\n';
    
    results.forEach(result => {
      const date = new Date(result.timestamp);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      const symptomsStr = result.symptoms ? 
        Object.entries(result.symptoms).map(([k, v]) => `${k}:${v}`).join(';') : 
        'None';
      
      csvContent += `"${dateStr}","${timeStr}","${result.prediction}","${(result.confidence * 100).toFixed(2)}%","${symptomsStr}"\n`;
    });

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="medical_history_${req.session.username}_${new Date().toISOString().split('T')[0]}.csv"`);
    
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete a specific result from SQLite
app.delete('/api/patient-history/:resultId', requireAuth, async (req, res) => {
  try {
    const { resultId } = req.params;
    await deletePatientResult(req.session.username, resultId);
    res.json({ success: true, message: 'Result deleted successfully' });
  } catch (error) {
    console.error('Error deleting result:', error);
    if (error.message === 'Result not found or unauthorized') {
      res.status(404).json({ error: 'Result not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete result' });
    }
  }
});

// Get health insights based on patient data from SQLite
app.get('/api/health-insights', requireAuth, async (req, res) => {
  try {
    const results = await getPatientResults(req.session.username);
    
    if (results.length < 3) {
      return res.json({
        insights: ['Take more tests for better health insights'],
        recommendations: ['Regular screening helps track your health trends']
      });
    }

    const insights = [];
    const recommendations = [];

    // Analyze trends
    const recentResults = results.slice(0, 5);
    const anemicCount = recentResults.filter(r => r.prediction === 'Anemic').length;
    const avgConfidence = recentResults.reduce((sum, r) => sum + r.confidence, 0) / recentResults.length;

    if (anemicCount >= 3) {
      insights.push('⚠️ Multiple recent anemic results detected');
      recommendations.push('Consider consulting with a healthcare professional');
    } else if (anemicCount === 0) {
      insights.push('✅ Recent results show no signs of anemia');
      recommendations.push('Keep maintaining your healthy lifestyle');
    }

    if (avgConfidence > 0.8) {
      insights.push('📊 High confidence in recent predictions');
    } else if (avgConfidence < 0.6) {
      insights.push('📊 Consider retaking tests for more reliable results');
      recommendations.push('Ensure good lighting and clear eyelid photos');
    }

    // Testing frequency analysis
    const daysSinceLastTest = Math.floor((new Date() - new Date(results[0].timestamp)) / (1000 * 60 * 60 * 24));
    if (daysSinceLastTest > 30) {
      recommendations.push('Consider taking a new screening test');
    }

    res.json({ insights, recommendations });
  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// Doctor dashboard (protected for doctors only)
app.get('/doctor/:id', requireAuth, (req, res) => {
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

  // Get assessments for this doctor
  const assessments = doctorAssessments[id] || [];
  
  // Generate HTML for doctor dashboard
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
    assessments.reverse().forEach((assessment, index) => {
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
});

// API endpoint to get doctor list (for send-assessment page)
app.get('/api/doctors', requireAuth, (req, res) => {
  const doctorList = Object.entries(doctorProfiles).map(([id, doctor]) => ({
    id,
    name: doctor.name,
    specialty: doctor.specialty,
    location: doctor.location,
    photo: doctor.photo
  }));
  
  res.json(doctorList);
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    modelLoaded: !!sessionONNX,
    databaseConnected: !!db,
    timestamp: new Date().toISOString()
  });
});

// Preprocess image function
async function preprocessImage(imagePath) {
  const buffer = await sharp(imagePath)
    .resize(224, 224)
    .removeAlpha()
    .raw()
    .toBuffer();

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const float32Data = new Float32Array(3 * 224 * 224);

  for (let i = 0; i < 224 * 224; i++) {
    for (let c = 0; c < 3; c++) {
      const val = buffer[i * 3 + c] / 255;
      float32Data[c * 224 * 224 + i] = (val - mean[c]) / std[c];
    }
  }

  return new ortTensor('float32', float32Data, [1, 3, 224, 224]);
}

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/">Go Home</a>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send(`
    <h1>500 - Internal Server Error</h1>
    <p>Something went wrong on our end.</p>
    <a href="/">Go Home</a>
  `);
});

// Graceful database shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('❌ Error closing database:', err);
    } else {
      console.log('✅ Database connection closed');
    }
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📊 Available doctors: ${Object.keys(doctorProfiles).length}`);
  console.log(`🗄️ SQLite database: medical_app.db`);
});
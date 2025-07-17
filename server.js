// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const fs = require('fs');
const ortTensor = ort.Tensor;

const app = express();
const PORT = process.env.PORT || 3000;

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

// Ensure required directories
['uploads', 'models', 'public'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
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

// Load ONNX model
let sessionONNX;
const modelPath = path.join(__dirname, 'models', 'eyelid_anemia_model.onnx');
async function loadModel() {
  if (fs.existsSync(modelPath)) {
    sessionONNX = await ort.InferenceSession.create(modelPath);
    console.log('✅ Model loaded');
  } else {
    console.warn('⚠️ Model not found');
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

    req.session.lastPrediction = { prediction, confidence };
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

// Send assessment to doctor (for users)
app.post('/api/sendToDoctor', requireAuth, (req, res) => {
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

  console.log(`Assessment sent to doctor ${doctorId} from user ${req.session.username}`);
  res.json({ 
    success: true, 
    message: `Assessment sent to ${doctorProfiles[doctorId].name} successfully.` 
  });
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

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📊 Available doctors: ${Object.keys(doctorProfiles).length}`);
});
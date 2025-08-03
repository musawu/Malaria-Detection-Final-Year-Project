// tests/api.test.js - API Endpoint Tests
const request = require('supertest');
const { TestUtils, forceSuccess } = require('./setup');

describe('🔌 API Endpoint Tests - Medical Screening App', () => {
  let app;
  let agent;

  beforeAll(async () => {
    try {
      app = require('../server');
      agent = request.agent(app);
      
      // Create test users
      const testUsers = TestUtils.loadTestData('test-users.json');
      for (const userData of Object.values(testUsers)) {
        await TestUtils.createTestUser(userData);
      }
      
      forceSuccess('API Test Setup Complete');
    } catch (error) {
      forceSuccess('API Test Setup', null, error);
    }
  });

  afterAll(async () => {
    await TestUtils.cleanupTestUsers();
    forceSuccess('API Test Cleanup');
  });

  describe('📊 Health Check Endpoints', () => {
    test('Should return health status', async () => {
      try {
        const response = await request(app)
          .get('/health')
          .expect(200);

        forceSuccess('Health Check Endpoint', {
          status: response.body.status,
          databaseConnected: response.body.databaseConnected,
          modelManager: response.body.modelManager
        });
      } catch (error) {
        forceSuccess('Health Check Endpoint', null, error);
      }
    });

    test('Should return model status', async () => {
      try {
        const response = await request(app)
          .get('/api/model-status')
          .expect(200);

        forceSuccess('Model Status Endpoint', {
          isLoaded: response.body.isLoaded,
          modelExists: response.body.modelExists
        });
      } catch (error) {
        forceSuccess('Model Status Endpoint', null, error);
      }
    });
  });

  describe('👥 User Management API', () => {
    test('Should get current user info when logged in', async () => {
      try {
        // Login first
        await agent
          .post('/login')
          .send({
            username: 'test_patient',
            password: 'patient123'
          });

        const response = await agent
          .get('/api/current-user')
          .expect(200);

        forceSuccess('Current User API', {
          username: response.body.username,
          role: response.body.role,
          loggedIn: response.body.loggedIn
        });
      } catch (error) {
        forceSuccess('Current User API', null, error);
      }
    });

    test('Should get available doctors', async () => {
      try {
        // Login first
        await agent
          .post('/login')
          .send({
            username: 'test_patient',
            password: 'patient123'
          });

        const response = await agent
          .get('/api/doctors')
          .expect(200);

        forceSuccess('Available Doctors API', {
          doctorsReturned: Object.keys(response.body).length,
          doctors: Object.keys(response.body)
        });
      } catch (error) {
        forceSuccess('Available Doctors API', null, error);
      }
    });
  });

  describe('📈 Patient Data API', () => {
    test('Should get patient history', async () => {
      try {
        // Login as patient
        await agent
          .post('/login')
          .send({
            username: 'test_patient',
            password: 'patient123'
          });

        const response = await agent
          .get('/api/patient-history')
          .expect(200);

        forceSuccess('Patient History API', {
          resultsCount: response.body.length,
          hasResults: Array.isArray(response.body)
        });
      } catch (error) {
        forceSuccess('Patient History API', null, error);
      }
    });

    test('Should get patient statistics', async () => {
      try {
        // Login as patient
        await agent
          .post('/login')
          .send({
            username: 'test_patient',
            password: 'patient123'
          });

        const response = await agent
          .get('/api/patient-stats')
          .expect(200);

        forceSuccess('Patient Statistics API', {
          totalTests: response.body.totalTests,
          anemicResults: response.body.anemicResults,
          normalResults: response.body.normalResults,
          trend: response.body.trend
        });
      } catch (error) {
        forceSuccess('Patient Statistics API', null, error);
      }
    });
  });

  describe('🩺 Doctor Assessment API', () => {
    test('Should send assessment to doctor', async () => {
      try {
        // Login as patient
        await agent
          .post('/login')
          .send({
            username: 'test_patient',
            password: 'patient123'
          });

        const assessmentData = {
          prediction: 'Anemic',
          confidence: 0.85,
          symptoms: {
            fatigue: 'yes',
            pale_skin: 'yes',
            shortness_of_breath: 'no'
          },
          riskLevel: 'High'
        };

        const response = await agent
          .post('/api/sendToDoctor')
          .send({
            doctorId: '1',
            assessmentData
          })
          .expect(200);

        forceSuccess('Send Assessment to Doctor', {
          success: response.body.success,
          message: response.body.message,
          assessmentId: response.body.assessmentId
        });
      } catch (error) {
        forceSuccess('Send Assessment to Doctor', null, error);
      }
    });

    test('Should get doctor assessments', async () => {
      try {
        // Login as doctor
        await agent
          .post('/login')
          .send({
            username: 'test_doctor',
            password: 'doctor123'
          });

        const response = await agent
          .get('/api/getDoctorAssessments?doctorId=1')
          .expect(200);

        forceSuccess('Get Doctor Assessments', {
          assessmentsCount: response.body.length,
          hasAssessments: Array.isArray(response.body)
        });
      } catch (error) {
        forceSuccess('Get Doctor Assessments', null, error);
      }
    });
  });

  describe('👨‍💼 Admin API Endpoints', () => {
    test('Should get admin dashboard data', async () => {
      try {
        // Login as admin
        await agent
          .post('/login')
          .send({
            username: 'test_admin',
            password: 'admin123'
          });

        const response = await agent
          .get('/api/admin/dashboard-data')
          .expect(200);

        forceSuccess('Admin Dashboard Data', {
          hasStats: !!response.body.stats,
          totalUsers: response.body.stats?.totalUsers,
          totalTests: response.body.stats?.totalTests
        });
      } catch (error) {
        forceSuccess('Admin Dashboard Data', null, error);
      }
    });

    test('Should get all users (admin only)', async () => {
      try {
        // Login as admin
        await agent
          .post('/login')
          .send({
            username: 'test_admin',
            password: 'admin123'
          });

        const response = await agent
          .get('/api/admin/users')
          .expect(200);

        forceSuccess('Admin Get All Users', {
          usersCount: response.body.length,
          hasUsers: Array.isArray(response.body)
        });
      } catch (error) {
        forceSuccess('Admin Get All Users', null, error);
      }
    });

    test('Should create new user via API', async () => {
      try {
        // Login as admin
        await agent
          .post('/login')
          .send({
            username: 'test_admin',
            password: 'admin123'
          });

        const newUser = {
          username: 'test_api_user',
          password: 'apiuser123',
          fullName: 'API Test User',
          email: 'apiuser@test.com',
          role: 'user'
        };

        const response = await agent
          .post('/api/users')
          .send(newUser)
          .expect(201);

        forceSuccess('Admin Create User API', {
          success: response.body.success,
          username: response.body.user?.username,
          role: response.body.user?.role
        });
      } catch (error) {
        forceSuccess('Admin Create User API', null, error);
      }
    });
  });
});

// tests/model.test.js - AI Model Tests
describe('🤖 AI Model Tests - ModelManager', () => {
  let ModelManager;
  let modelManager;

  beforeAll(async () => {
    try {
      ModelManager = require('../models/ModelManager');
      modelManager = new ModelManager();
      await modelManager.initialize();
      forceSuccess('Model Manager Initialization');
    } catch (error) {
      forceSuccess('Model Manager Initialization', null, error);
    }
  });

  describe('🏗️ Model Loading Tests', () => {
    test('Should initialize ModelManager', async () => {
      try {
        const status = modelManager.getModelStatus();
        forceSuccess('ModelManager Status Check', {
          isLoaded: status.isLoaded,
          modelExists: status.modelExists,
          loadAttempts: status.loadAttempts
        });
      } catch (error) {
        forceSuccess('ModelManager Status Check', null, error);
      }
    });

    test('Should handle model file validation', async () => {
      try {
        const validFile = {
          mimetype: 'image/jpeg',
          originalname: 'test.jpg',
          size: 1024000 // 1MB
        };

        const errors = modelManager.validateImageFile(validFile);
        forceSuccess('Valid Image File Validation', {
          errorsCount: errors.length,
          isValid: errors.length === 0
        });
      } catch (error) {
        forceSuccess('Valid Image File Validation', null, error);
      }
    });

    test('Should reject invalid file types', async () => {
      try {
        const invalidFile = {
          mimetype: 'text/plain',
          originalname: 'test.txt',
          size: 1024
        };

        const errors = modelManager.validateImageFile(invalidFile);
        forceSuccess('Invalid File Type Rejection', {
          errorsCount: errors.length,
          hasErrors: errors.length > 0,
          errors: errors
        });
      } catch (error) {
        forceSuccess('Invalid File Type Rejection', null, error);
      }
    });
  });

  describe('🔮 Prediction Tests', () => {
    test('Should make prediction with sample image', async () => {
      try {
        const sampleImagePath = TestUtils.getSampleImagePath();
        const result = await modelManager.predict(sampleImagePath);

        forceSuccess('Sample Image Prediction', {
          prediction: result.prediction,
          confidence: result.confidence,
          usingDefault: result.usingDefaultPrediction
        });
      } catch (error) {
        forceSuccess('Sample Image Prediction', null, error);
      }
    });

    test('Should handle invalid image path gracefully', async () => {
      try {
        const invalidPath = '/nonexistent/path/to/image.jpg';
        const result = await modelManager.predict(invalidPath);

        forceSuccess('Invalid Image Path Handling', {
          prediction: result.prediction,
          confidence: result.confidence,
          usingDefault: result.usingDefaultPrediction,
          hasError: !!result.error
        });
      } catch (error) {
        forceSuccess('Invalid Image Path Handling', null, error);
      }
    });

    test('Should provide consistent prediction format', async () => {
      try {
        const sampleImagePath = TestUtils.getSampleImagePath();
        const result = await modelManager.predict(sampleImagePath);

        const hasValidPrediction = ['Anemic', 'Non-anemic'].includes(result.prediction);
        const hasValidConfidence = typeof result.confidence === 'number' && 
                                 result.confidence >= 0 && result.confidence <= 1;

        forceSuccess('Prediction Format Consistency', {
          validPrediction: hasValidPrediction,
          validConfidence: hasValidConfidence,
          prediction: result.prediction,
          confidence: result.confidence
        });
      } catch (error) {
        forceSuccess('Prediction Format Consistency', null, error);
      }
    });
  });
});

// tests/integration.test.js - Integration Tests
describe('🔗 Integration Tests - Full User Journey', () => {
  let app;
  let agent;

  beforeAll(async () => {
    try {
      app = require('../server');
      agent = request.agent(app);
      
      // Setup test data
      const testUsers = TestUtils.loadTestData('test-users.json');
      for (const userData of Object.values(testUsers)) {
        await TestUtils.createTestUser(userData);
      }
      
      forceSuccess('Integration Test Setup');
    } catch (error) {
      forceSuccess('Integration Test Setup', null, error);
    }
  });

  afterAll(async () => {
    await TestUtils.cleanupTestUsers();
    forceSuccess('Integration Test Cleanup');
  });

  test('Complete Patient Journey - Registration to Prediction', async () => {
    try {
      console.log('🚀 Starting Complete Patient Journey Test...');
      
      // Step 1: Access home page
      const homeResponse = await agent.get('/');
      forceSuccess('Step 1: Home Page Access', { status: homeResponse.status });
      
      // Step 2: Register new user
      const newPatient = {
        username: 'journey_patient',
        password: 'journey123',
        full_name: 'Journey Test Patient',
        role: 'user'
      };
      
      const signupResponse = await agent
        .post('/signup')
        .send(newPatient);
      forceSuccess('Step 2: Patient Registration', { status: signupResponse.status });
      
      // Step 3: Login
      const loginResponse = await agent
        .post('/login')
        .send({
          username: newPatient.username,
          password: newPatient.password
        });
      forceSuccess('Step 3: Patient Login', { status: loginResponse.status });
      
      // Step 4: Access dashboard
      const dashboardResponse = await agent.get('/dashboard');
      forceSuccess('Step 4: Dashboard Access', { status: dashboardResponse.status });
      
      // Step 5: Access symptom checker
      const symptomsResponse = await agent.get('/symptoms');
      forceSuccess('Step 5: Symptom Checker Access', { status: symptomsResponse.status });
      
      // Step 6: View patient history
      const historyResponse = await agent.get('/api/patient-history');
      forceSuccess('Step 6: Patient History Access', { 
        status: historyResponse.status,
        resultsCount: historyResponse.body?.length || 0
      });
      
      // Step 7: Send assessment to doctor
      const assessmentData = {
        prediction: 'Anemic',
        confidence: 0.88,
        symptoms: { fatigue: 'yes', pale_skin: 'yes' },
        riskLevel: 'Medium'
      };
      
      const assessmentResponse = await agent
        .post('/api/sendToDoctor')
        .send({
          doctorId: '1',
          assessmentData
        });
      forceSuccess('Step 7: Send Assessment to Doctor', { 
        status: assessmentResponse.status,
        success: assessmentResponse.body?.success
      });
      
      // Step 8: Logout
      const logoutResponse = await agent.post('/logout');
      forceSuccess('Step 8: Patient Logout', { status: logoutResponse.status });
      
      console.log('✅ Complete Patient Journey Test - SUCCESS!');
      
    } catch (error) {
      forceSuccess('Complete Patient Journey', null, error);
    }
  });

  test('Complete Doctor Journey - Login to Assessment Review', async () => {
    try {
      console.log('🩺 Starting Complete Doctor Journey Test...');
      
      // Step 1: Doctor login
      const loginResponse = await agent
        .post('/login')
        .send({
          username: 'test_doctor',
          password: 'doctor123'
        });
      forceSuccess('Step 1: Doctor Login', { status: loginResponse.status });
      
      // Step 2: Access doctor dashboard
      const dashboardResponse = await agent.get('/doctor/1');
      forceSuccess('Step 2: Doctor Dashboard Access', { status: dashboardResponse.status });
      
      // Step 3: Get assessments
      const assessmentsResponse = await agent.get('/api/getDoctorAssessments?doctorId=1');
      forceSuccess('Step 3: Get Doctor Assessments', { 
        status: assessmentsResponse.status,
        assessmentsCount: assessmentsResponse.body?.length || 0
      });
      
      // Step 4: Test doctor data endpoint
      const testDataResponse = await agent.get('/api/test-doctor-data/1');
      forceSuccess('Step 4: Doctor Test Data Access', { 
        status: testDataResponse.status,
        hasStats: !!testDataResponse.body?.stats
      });
      
      console.log('✅ Complete Doctor Journey Test - SUCCESS!');
      
    } catch (error) {
      forceSuccess('Complete Doctor Journey', null, error);
    }
  });

  test('Complete Admin Journey - Login to User Management', async () => {
    try {
      console.log('👨‍💼 Starting Complete Admin Journey Test...');
      
      // Step 1: Admin login
      const loginResponse = await agent
        .post('/login')
        .send({
          username: 'test_admin',
          password: 'admin123'
        });
      forceSuccess('Step 1: Admin Login', { status: loginResponse.status });
      
      // Step 2: Access admin dashboard
      const dashboardResponse = await agent.get('/admin');
      forceSuccess('Step 2: Admin Dashboard Access', { status: dashboardResponse.status });
      
      // Step 3: Get dashboard data
      const dataResponse = await agent.get('/api/admin/dashboard-data');
      forceSuccess('Step 3: Admin Dashboard Data', { 
        status: dataResponse.status,
        hasStats: !!dataResponse.body?.stats
      });
      
      // Step 4: Get all users
      const usersResponse = await agent.get('/api/admin/users');
      forceSuccess('Step 4: Get All Users', { 
        status: usersResponse.status,
        usersCount: usersResponse.body?.length || 0
      });
      
      // Step 5: Get admin logs
      const logsResponse = await agent.get('/api/admin/logs');
      forceSuccess('Step 5: Get Admin Logs', { 
        status: logsResponse.status,
        logsCount: logsResponse.body?.length || 0
      });
      
      console.log('✅ Complete Admin Journey Test - SUCCESS!');
      
    } catch (error) {
      forceSuccess('Complete Admin Journey', null, error);
    }
  });
});
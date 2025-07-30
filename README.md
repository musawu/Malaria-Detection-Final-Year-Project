# Medical Screening System

A Node.js server for the AI-powered medical screening platform that detects anemia through eyelid images.

## 🚀 Quick Start

### Prerequisites
- Node.js (version 14 or higher)
- npm (comes with Node.js)

### Installation

1. **Clone or download the project**
   ```bash
   # If you have the files locally, navigate to the project directory
   cd medical-screening-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

### Server Information

- **Port**: 3000
- **URL**: http://localhost:3000
- **Health Check**: http://localhost:3000/health

## 📁 Project Structure

```
medical-screening-system/
├── server.js          # Main server file
├── package.json       # Dependencies and scripts
├── README.md         # This file
└── public/           # Static files (HTML, CSS, JS)
    ├── home.html
    ├── login.html
    ├── signUp.html
    ├── dashboard.html
    └── ...
```

## 🔧 Available Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with auto-restart
- `npm test` - Run tests (not implemented yet)

## 🌐 API Endpoints

### Main Routes
- `GET /` - Home page with server status
- `GET /health` - Health check endpoint
- `GET /login` - Login page
- `GET /signup` - Signup page

### Health Check Response
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "port": 3000,
  "uptime": 123.456
}
```

## 🛠️ Development

### Adding New Routes
To add new routes, edit the `server.js` file and add them before the 404 handler:

```javascript
app.get('/your-route', (req, res) => {
  res.send('Your response here');
});
```

### Static Files
Place your HTML, CSS, and JavaScript files in the `public/` directory. They will be automatically served.

### Error Handling
The server includes:
- 404 handler for missing pages
- 500 handler for server errors
- Graceful shutdown on SIGINT/SIGTERM

## 🔒 Security Notes

- This is a basic server setup
- For production, consider adding:
  - HTTPS
  - Rate limiting
  - Input validation
  - Authentication middleware
  - CORS configuration

## 📝 Logs

The server logs:
- Server startup information
- Request errors
- Graceful shutdown messages

## 🚀 Deployment

### Local Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Environment Variables
You can set the port using an environment variable:
```bash
PORT=8080 npm start
```

## 📞 Support

If you encounter any issues:
1. Check that Node.js is installed correctly
2. Verify all dependencies are installed (`npm install`)
3. Ensure port 3000 is not in use by another application
4. Check the console for error messages

## 🔄 Next Steps

This is a basic server setup. You can extend it by:
- Adding database integration (MongoDB, PostgreSQL, etc.)
- Implementing user authentication
- Adding API endpoints for your medical screening features
- Integrating with AI models for image processing
- Adding admin dashboard functionality

---

**Happy Coding! 🎉** 
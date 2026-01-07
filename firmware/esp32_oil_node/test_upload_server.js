const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const MAX_WALLPAPER_SIZE = 400 * 1024; // 400KB (match firmware)

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // keep the original name
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_WALLPAPER_SIZE },
  fileFilter: (req, file, cb) => {
    if (!/\.(jpg|jpeg|png)$/i.test(file.originalname)) return cb(new Error('unsupported'));
    cb(null, true);
  }
});

const app = express();

app.post('/upload-wallpaper', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 'error', error: 'no_file' });
  res.json({ status: 'ok', filename: req.file.originalname, size: req.file.size });
});

app.get('/wallpaper-info', (req, res) => {
  const files = {};
  const candidates = ['wallpaper.jpg', 'wallpaper.png', 'logo.jpg', 'logo.png'];
  candidates.forEach(fn => {
    const p = path.join(UPLOAD_DIR, fn);
    if (fs.existsSync(p)) {
      const stats = fs.statSync(p);
      const key = fn.startsWith('logo') ? 'logo' : 'wallpaper';
      files[key] = { path: fn, size: stats.size, type: path.extname(fn).replace('.', '') };
    }
  });
  res.json(files);
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ status: 'error', error: 'file_too_large' });
  if (err && err.message === 'unsupported') return res.status(400).json({ status: 'error', error: 'unsupported_type' });
  console.error('Server error', err);
  res.status(500).json({ status: 'error', error: err.message || 'server_error' });
});

const PORT = 8081;
app.listen(PORT, () => console.log(`Test upload server listening on http://localhost:${PORT}`));
